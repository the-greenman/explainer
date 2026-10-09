// Pure clock logic: no DOM. Position is {segmentId, t}; t is seconds within the segment.
export type Option = { id: string; label?: string; goes_to?: string; sets_variable?: string; sets_value?: string; default?: boolean };
export type Segment = { id: string; title?: string; kind: 'video' | 'audio' | 'none'; src?: string; in?: number; out: number; captions?: string; next?: string | null; ends?: 'continue' | 'stop' };
export type Marker = { id: string; segment: string; t: number; label?: string };
export type Cue = {
  id: string; segment: string; start: number; end: number; renders: string; variant?: string;
  data?: Record<string, any>; items?: any[]; hold?: boolean; loop_from?: number; when_var?: string; when_value?: string;
};
export type Manifest = { id: string; title?: string; segments: Segment[]; markers?: Marker[]; cues: Cue[] };
export type Pos = { segmentId: string; t: number };
/** One step of the path taken: left `segmentId` at `t` and landed in segment `to` at `toT` (`hold`: id of the held choice cue it was chosen from; `option`: the option chosen; `auto`: taken by playthrough, not chosen). */
export type Entry = Pos & { to: string; toT: number; hold?: string; option?: string; auto?: true };
export type Hooks = { segment?: (id: string) => void; hold?: (cue: Cue) => void; set?: (name: string, value: string) => void;
  /** the clock jumped by itself (a playthrough default branch): media must be re-synced with a seek */
  jump?: () => void };

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const cueProgress = (cue: { start: number; end: number }, t: number) => clamp01((t - cue.start) / (cue.end - cue.start));
/** 0..1 ramp of p between a and b */
export const ramp = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));

/** One stretch of the route: played in `segment` from `from` to `to`. `depth` is the history length to unwind to; `branched`: it began at a choice branch. */
export type RouteSpan = { segment: string; from: number; to: number; depth: number; branched: boolean };

/**
 * The route from the start to `pos` as spans, one per history entry plus the current one (always last, ending at pos.t).
 * Shared by the clock (navigation) and the path view, so they cannot disagree.
 * Span k runs in the segment entry k left, from where entry k-1 landed (0 for the first). If navigation left the route
 * (rare, see Clock.navigate) a span's segment can differ from where the previous entry landed: it then runs from 0.
 */
export function routeSpans(manifest: Manifest, history: Entry[], pos: Pos): RouteSpan[] {
  const spans: RouteSpan[] = [];
  let seg = manifest.segments[0].id;
  let from = 0;
  let branched = false;
  const add = (segment: string, to: number, depth: number) => {
    if (segment !== seg) { seg = segment; from = 0; branched = false; }
    spans.push({ segment, from, to, depth, branched });
  };
  history.forEach((e, i) => {
    add(e.segmentId, e.t, i);
    seg = e.to;
    from = e.toT;
    branched = !!e.option;
  });
  add(pos.segmentId, pos.t, history.length);
  return spans;
}

export class Clock {
  segmentId: string;
  t = 0;
  rate = 1;
  playing = false;
  history: Entry[] = [];
  holding: Cue | null = null;
  /** play through like a video: a hold takes its `default` option instead of holding (no default: it just continues) */
  playthrough = false;
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
  seek(t: number) { this.navigate({ segmentId: this.segmentId, t: Math.min(this.length, Math.max(0, t)) }); }
  tick(dt: number) { if (this.playing) this.advance(this.t + dt * this.rate); }
  /** media drives the clock */
  setTime(t: number) { this.advance(t); }

  /** Turning it on while holding takes the default at once and plays; turning it off only changes later holds. */
  setPlaythrough(on: boolean) {
    if (this.playthrough === on) return;
    this.playthrough = on;
    const h = this.holding;
    if (on && h) {
      this.holding = null;
      this.takeDefault(h);
      this.playing = true;
    }
  }

  /** Navigation (markers, prev/next, scroll sections, the jump command): see navigate(). */
  jumpTo(id: string) {
    const to = this.resolve(id);
    if (to) this.navigate(to);
  }

  /**
   * Navigation (jumpTo and seek) keeps history equal to the route from the start to where you are:
   * 1. Back onto the route: the target lies on a span of the route (same segment, from <= t <= end; the current span
   *    reaches any later t, so a forward move in it is just a move). The most recent matching span wins (loops).
   *    History is cut back to that span's depth, the same unwinding reverse does.
   * 2. Forward along the default order (`next`/array order, as finishSegment): the continuation entries are pushed
   *    for each hop, exactly what playing there would have recorded.
   * 3. Otherwise (a branch-only segment, or before a landing marker nothing leads past) go there and leave history
   *    as it is. That is rare: navigation targets are normally markers along the story.
   * Navigation never adds what playing would not have: scrolling down then up leaves history as it was.
   */
  private navigate(to: Pos) {
    const spans = routeSpans(this.manifest, this.history, { segmentId: this.segmentId, t: this.t });
    for (let k = spans.length - 1; k >= 0; k--) {
      const sp = spans[k];
      if (sp.segment === to.segmentId && sp.from <= to.t && (k === spans.length - 1 || to.t <= sp.to)) {
        this.history.length = sp.depth;
        return this.goto(to);
      }
    }
    const hops = this.defaultHops(to);
    if (hops) this.history.push(...hops);
    this.goto(to);
  }

  /** Continuation entries from here to `to` by default order; undefined if it is not reachable that way (stops at ends:'stop', cycle-safe). */
  private defaultHops(to: Pos): Entry[] | undefined {
    const list = this.manifest.segments;
    const hops: Entry[] = [];
    const seen = new Set<string>();
    let s = this.segment;
    while (!seen.has(s.id)) {
      seen.add(s.id);
      const nextId = s.next === undefined ? list[list.indexOf(s) + 1]?.id : s.next;
      const land = s.ends === 'stop' || !nextId ? undefined : this.resolve(nextId);
      if (!land) return undefined;
      hops.push({ segmentId: s.id, t: s.out - (s.in ?? 0), to: land.segmentId, toT: land.t });
      if (land.segmentId === to.segmentId) return to.t >= land.t ? hops : undefined;
      s = list.find((x) => x.id === land.segmentId)!;
    }
    return undefined;
  }

  /** Step back along the path taken: pop the last entry and go there; a choice is shown again (held). */
  back() {
    const e = this.history.pop();
    if (!e) return;
    const hold = e.hold ? this.manifest.cues.find((c) => c.id === e.hold) : undefined;
    this.goto(e, this.playthrough ? undefined : hold); // playthrough: to the choice point, not shown; playing on takes the default again
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
      this.goto(e, this.playthrough ? undefined : this.manifest.cues.find((c) => c.id === e.hold));
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
  private branch(id: string, hold?: string, option?: string, auto = false) {
    const to = this.resolve(id);
    if (!to) return false;
    this.history.push({ segmentId: this.segmentId, t: this.t, to: to.segmentId, toT: to.t, ...(hold ? { hold } : {}), ...(option ? { option } : {}), ...(auto ? { auto: true as const } : {}) });
    this.goto(to);
    return true;
  }

  /** Playthrough at a hold (t is at its end): apply the default option like a real choice. True if it branched. */
  private takeDefault(hold: Cue) {
    const opt: Option | undefined = hold.items?.find((o) => o.default);
    if (!opt) return false;
    if (opt.sets_variable) this.hooks.set?.(opt.sets_variable, opt.sets_value ?? '');
    return !!opt.goes_to && this.branch(opt.goes_to, hold.id, opt.id, true);
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
      const pt = this.playthrough;
      // playthrough also counts a hold we stand exactly at the end of (after back() to the choice point)
      const holds = this.manifest.cues
        .filter((c) => c.segment === this.segmentId && c.hold && (c.end > old || (pt && c.end === old)) && c.end <= nt)
        .sort((a, b) => a.end - b.end);
      for (const hold of holds) {
        this.t = hold.end;
        if (!pt) {
          this.playing = false;
          this.holding = hold;
          this.hooks.hold?.(hold);
          return;
        }
        if (this.takeDefault(hold)) { this.hooks.jump?.(); return; }
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
