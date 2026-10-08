// Pure clock logic: no DOM. Position is {segmentId, t}; t is seconds within the segment.
export type Option = { id: string; label?: string; goes_to?: string; sets_variable?: string; sets_value?: string };
export type Segment = { id: string; title?: string; kind: 'video' | 'audio' | 'none'; src?: string; in?: number; out: number; captions?: string; next?: string | null; ends?: 'continue' | 'stop' };
export type Marker = { id: string; segment: string; t: number; label?: string };
export type Cue = {
  id: string; segment: string; start: number; end: number; renders: string; variant?: string;
  data?: Record<string, any>; items?: any[]; hold?: boolean; loop_from?: number; when_var?: string; when_value?: string;
};
export type Manifest = { id: string; title?: string; segments: Segment[]; markers?: Marker[]; cues: Cue[] };
export type Pos = { segmentId: string; t: number };
/** One step of the path taken: left `segmentId` at `t` and landed in segment `to` at `toT` (`hold`: id of the held choice cue it was chosen from; `option`: the option chosen). */
export type Entry = Pos & { to: string; toT: number; hold?: string; option?: string };
export type Hooks = { segment?: (id: string) => void; hold?: (cue: Cue) => void; set?: (name: string, value: string) => void };

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const cueProgress = (cue: { start: number; end: number }, t: number) => clamp01((t - cue.start) / (cue.end - cue.start));
/** 0..1 ramp of p between a and b */
export const ramp = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));

export class Clock {
  segmentId: string;
  t = 0;
  rate = 1;
  playing = false;
  history: Entry[] = [];
  holding: Cue | null = null;
  manifest: Manifest;
  hooks: Hooks;

  constructor(manifest: Manifest, hooks: Hooks = {}) {
    this.manifest = manifest;
    this.hooks = hooks;
    this.segmentId = manifest.segments[0].id;
  }

  get segment() { return this.manifest.segments.find((s) => s.id === this.segmentId)!; }
  get length() { return this.segment.out - (this.segment.in ?? 0); }

  play() { this.holding = null; this.playing = true; }
  pause() { this.playing = false; }
  setRate(r: number) { if (r !== 0) this.rate = r; }
  seek(t: number) { this.holding = null; this.t = Math.min(this.length, Math.max(0, t)); }
  tick(dt: number) { if (this.playing) this.advance(this.t + dt * this.rate); }
  /** media drives the clock */
  setTime(t: number) { this.advance(t); }

  /** Navigation (markers, prev/next, scroll sections): moves, never touches history. */
  jumpTo(id: string) {
    const to = this.resolve(id);
    if (to) this.goto(to);
  }

  /** Step back along the path taken: pop the last entry and go there; a choice is shown again (held). */
  back() {
    const e = this.history.pop();
    if (!e) return;
    const hold = e.hold ? this.manifest.cues.find((c) => c.id === e.hold) : undefined;
    this.goto(e, hold);
  }

  /**
   * Unwind the path to `depth` entries and go to where that stretch began. `atChoice`: instead land on the choice
   * that was taken at entry `depth` (held, like back()). Out of range is a no-op.
   */
  rewindTo(depth: number, atChoice = false) {
    const h = this.history;
    if (!Number.isInteger(depth) || depth < 0 || depth > h.length) return;
    if (atChoice && (depth >= h.length || !h[depth].hold)) return;
    const popped = h.splice(depth);
    if (atChoice) {
      const e = popped[0];
      this.goto(e, this.manifest.cues.find((c) => c.id === e.hold));
    } else {
      const e = h[depth - 1];
      this.goto(e ? { segmentId: e.to, t: e.toT } : { segmentId: this.manifest.segments[0].id, t: 0 });
    }
  }

  choose(optionId: string) {
    const here = this.manifest.cues.filter((c) => c.segment === this.segmentId);
    const cues = this.holding ? [this.holding, ...here] : here;
    const opt: Option | undefined = cues.flatMap((c) => c.items ?? []).find((o) => o.id === optionId);
    if (!opt) return;
    if (opt.sets_variable) this.hooks.set?.(opt.sets_variable, opt.sets_value ?? '');
    if (opt.goes_to) this.branch(opt.goes_to, this.holding?.id, opt.id);
    this.play();
  }

  private resolve(id: string): Pos | undefined {
    const m = this.manifest.markers?.find((x) => x.id === id);
    if (m) return { segmentId: m.segment, t: m.t };
    return this.manifest.segments.some((s) => s.id === id) ? { segmentId: id, t: 0 } : undefined;
  }

  /** Take a branch of the path: like jumpTo, but records where it left from. */
  private branch(id: string, hold?: string, option?: string) {
    const to = this.resolve(id);
    if (!to) return;
    this.history.push({ segmentId: this.segmentId, t: this.t, to: to.segmentId, toT: to.t, ...(hold ? { hold } : {}), ...(option ? { option } : {}) });
    this.goto(to);
  }

  /** `hold`: restore that choice cue as held (paused, choice showing). */
  private goto(p: Pos, hold?: Cue) {
    this.holding = hold ?? null;
    if (hold) this.playing = false;
    const changed = p.segmentId !== this.segmentId;
    this.segmentId = p.segmentId;
    this.t = p.t;
    if (changed) this.hooks.segment?.(p.segmentId);
  }

  /** Segment that continues into `id` by `next` or array order. */
  private predecessor(id: string): Segment | undefined {
    const list = this.manifest.segments;
    return list.find((s, i) => {
      if (s.id === id || s.ends === 'stop') return false;
      const nextId = s.next === undefined ? list[i + 1]?.id : s.next;
      return !!nextId && this.resolve(nextId)?.segmentId === id;
    });
  }

  private advance(nt: number) {
    const old = this.t;
    const top = this.history.at(-1);
    // reversing across where the top branch landed unwinds it (any t): back to where it was taken from
    if (nt < old && top && top.to === this.segmentId && old >= top.toT && top.toT > nt) return this.goto(this.history.pop()!);
    if (nt > old) {
      const hold = this.manifest.cues
        .filter((c) => c.segment === this.segmentId && c.hold && c.end > old && c.end <= nt)
        .sort((a, b) => a.end - b.end)[0];
      if (hold) {
        this.t = hold.end;
        this.playing = false;
        this.holding = hold;
        this.hooks.hold?.(hold);
        return;
      }
      if (nt >= this.length) return this.finishSegment();
    } else if (nt < 0) {
      // past the start (e.g. navigated to before the landing point): pop a branch into here, else the default predecessor's end, else stop
      const pred = this.predecessor(this.segmentId);
      if (top && top.to === this.segmentId) this.goto(this.history.pop()!);
      else if (pred) this.goto({ segmentId: pred.id, t: pred.out - (pred.in ?? 0) });
      else { this.t = 0; this.playing = false; }
      return;
    }
    this.t = nt;
  }

  private finishSegment() {
    const s = this.segment;
    const list = this.manifest.segments;
    const nextId = s.next === undefined ? list[list.indexOf(s) + 1]?.id : s.next;
    const to = s.ends === 'stop' || !nextId ? undefined : this.resolve(nextId);
    this.t = this.length;
    if (!to) { this.playing = false; return; }
    this.history.push({ segmentId: this.segmentId, t: this.t, to: to.segmentId, toT: to.t });
    this.goto(to);
  }
}
