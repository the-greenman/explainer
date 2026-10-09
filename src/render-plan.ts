// Pure render plan: which {segment, t} each output frame shows, and the source cuts they come from. No DOM.
// It steps a real Clock with a fixed dt, so the graph walk (continuation, choices, defaults) is the player's own.
import { Clock, type Manifest, type Option } from './clock.ts';

export type PlanFrame = { segmentId: string; t: number; /** variable values to apply before this frame (only when they changed) */ vars?: Record<string, string> };
/** A contiguous run of frames from one segment; source times are file seconds (`in + t`). */
export type Cut = { segment: string; src?: string; captions?: string; kind: 'video' | 'audio' | 'none'; srcIn: number; srcOut: number; outStart: number; outEnd: number; frames: number };
export type Plan = {
  fps: number;
  frames: PlanFrame[];
  cuts: Cut[];
  /** seconds: frames.length / fps */
  duration: number;
  /** why the walk ended: the path ended, a choice was left holding (list ran out), a loop was cut, or the safety cap */
  stop: 'end' | 'hold' | 'loop' | 'max';
  /** variables at the end of the path */
  vars: Record<string, string>;
};
/** `'default'`: playthrough (defaults taken, stop at a loop). A list of option ids: playthrough off, one id per hold. */
export type PathSpec = 'default' | string[];
export type PlanOptions = { fps: number; path?: PathSpec; maxSeconds?: number; vars?: Record<string, string> };

const snap = (x: number) => Math.round(x * 1e6) / 1e6; // microseconds: keeps k/fps sums from missing a boundary by 1e-13
const EPS = 1e-6;

export function planRender(manifest: Manifest, opts: PlanOptions): Plan {
  const { fps } = opts;
  const path = opts.path ?? 'default';
  const maxFrames = Math.floor((opts.maxSeconds ?? 3600) * fps);
  const dt = 1 / fps;
  const vars: Record<string, string> = { ...opts.vars };
  let changed: Record<string, string> | undefined = Object.keys(vars).length ? { ...vars } : undefined;
  const clock = new Clock(manifest, { set: (k, v) => { vars[k] = v; (changed ??= {})[k] = v; } });
  const queue = path === 'default' ? [] : [...path];
  const auto = path === 'default';
  clock.playthrough = auto;
  clock.play();

  const frames: PlanFrame[] = [];
  const runs: { segmentId: string; t0: number; start: number; n: number }[] = [];
  const seen = (seg: string, t: number) => runs.some((r) => r.segmentId === seg && t >= r.t0 - EPS && t <= r.t0 + r.n * dt + EPS);
  const newRun = () => runs.push({ segmentId: clock.segmentId, t0: clock.t, start: frames.length, n: 0 });
  newRun();
  let stop: Plan['stop'] = 'end';

  for (;;) {
    if (frames.length >= maxFrames) { stop = 'max'; break; }
    const run = runs.at(-1)!;
    const t = snap(run.t0 + run.n * dt);
    frames.push({ segmentId: clock.segmentId, t, ...(changed ? { vars: changed } : {}) });
    changed = undefined;
    run.n++;
    const nt = snap(run.t0 + run.n * dt);

    const depth = clock.history.length;
    clock.setTime(nt);
    if (clock.history.length > depth) {
      // took a branch (default, or plain continuation into the next segment)
      const e = clock.history.at(-1)!;
      if (auto && seen(e.to, e.toT)) { stop = 'loop'; break; }
      newRun();
      continue;
    }
    if (clock.holding) {
      const hold = clock.holding;
      const id = queue.shift();
      if (id === undefined) { stop = 'hold'; break; }
      const opt = [hold, ...manifest.cues.filter((c) => c.segment === clock.segmentId)].flatMap((c) => (c.items ?? []) as Option[]).find((o) => o.id === id);
      if (!opt) throw new Error(`unknown option "${id}" at choice "${hold.id}" (options: ${(hold.items ?? []).map((o: Option) => o.id).join(', ')})`);
      const d2 = clock.history.length;
      clock.choose(id);
      if (clock.history.length > d2) newRun();
      else clock.setTime(nt); // a choice without goes_to: play on from the hold, same run
      continue;
    }
    if (!clock.playing) { stop = 'end'; break; }
  }

  const cuts: Cut[] = runs.filter((r) => r.n > 0).map((r) => {
    const s = manifest.segments.find((x) => x.id === r.segmentId)!;
    const base = s.in ?? 0;
    const outStart = r.start / fps;
    return {
      segment: s.id, kind: s.kind, ...(s.src ? { src: s.src } : {}), ...(s.captions ? { captions: s.captions } : {}),
      srcIn: snap(base + r.t0), srcOut: snap(base + r.t0 + r.n * dt), outStart: snap(outStart), outEnd: snap(outStart + r.n / fps), frames: r.n,
    };
  });
  return { fps, frames, cuts, duration: frames.length / fps, stop, vars };
}

/** Join cuts that continue each other in the same file (adjacent segments, or a branch that lands where the last left off). */
export function mergeCuts(cuts: Cut[]): Cut[] {
  const out: Cut[] = [];
  for (const c of cuts) {
    const p = out.at(-1);
    if (p && p.kind === c.kind && p.src === c.src && p.captions === c.captions && Math.abs(p.srcOut - c.srcIn) < EPS)
      out[out.length - 1] = { ...p, segment: `${p.segment}+${c.segment}`, srcOut: c.srcOut, outEnd: c.outEnd, frames: p.frames + c.frames };
    else out.push({ ...c });
  }
  return out;
}

// ---- captions ----

export type VttCue = { start: number; end: number; text: string };

const tc = (s: string) => {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(s.trim());
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
};
export const vttTime = (x: number) => {
  const ms = Math.round(x * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
};

export function parseVtt(src: string): VttCue[] {
  const cues: VttCue[] = [];
  for (const block of src.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = tc(a), end = tc(b.trim().split(/\s+/)[0]);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    cues.push({ start, end, text: lines.slice(i + 1).join('\n').trim() });
  }
  return cues;
}

/** Cut and retime source captions along the cuts: cues outside are dropped, cues across a cut boundary are clipped. `vtts` maps a cut's `captions` ref to the parsed cues. */
export function retimeCaptions(vtts: Record<string, VttCue[]>, cuts: Cut[]): VttCue[] {
  const out: VttCue[] = [];
  for (const c of cuts) {
    if (!c.captions) continue;
    for (const q of vtts[c.captions] ?? []) {
      const a = Math.max(q.start, c.srcIn), b = Math.min(q.end, c.srcOut);
      if (b - a > 1e-4) out.push({ start: snap(c.outStart + a - c.srcIn), end: snap(c.outStart + b - c.srcIn), text: q.text });
    }
  }
  return out.sort((x, y) => x.start - y.start);
}

export const writeVtt = (cues: VttCue[]) => `WEBVTT\n\n${cues.map((q) => `${vttTime(q.start)} --> ${vttTime(q.end)}\n${q.text}\n`).join('\n')}`;
