// Pure clock logic: no DOM. Position is {segmentId, t}; t is seconds within the segment.
export type Option = { id: string; label?: string; goes_to?: string; sets_variable?: string; sets_value?: string };
export type Segment = { id: string; kind: 'video' | 'audio' | 'none'; src?: string; in?: number; out: number; captions?: string; next?: string | null; ends?: 'continue' | 'stop' };
export type Marker = { id: string; segment: string; t: number; label?: string };
export type Cue = {
  id: string; segment: string; start: number; end: number; renders: string; variant?: string;
  data?: Record<string, any>; items?: any[]; hold?: boolean; loop_from?: number; when_var?: string; when_value?: string;
};
export type Manifest = { id: string; title?: string; segments: Segment[]; markers?: Marker[]; cues: Cue[] };
export type Pos = { segmentId: string; t: number };
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
  history: Pos[] = [];
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

  jumpTo(id: string) {
    const to = this.resolve(id);
    if (!to) return;
    this.history.push({ segmentId: this.segmentId, t: this.t });
    this.goto(to);
  }

  back() {
    const e = this.history.pop();
    if (e) this.goto(e);
  }

  choose(optionId: string) {
    const here = this.manifest.cues.filter((c) => c.segment === this.segmentId);
    const cues = this.holding ? [this.holding, ...here] : here;
    const opt: Option | undefined = cues.flatMap((c) => c.items ?? []).find((o) => o.id === optionId);
    if (!opt) return;
    if (opt.sets_variable) this.hooks.set?.(opt.sets_variable, opt.sets_value ?? '');
    if (opt.goes_to) this.jumpTo(opt.goes_to);
    this.play();
  }

  private resolve(id: string): Pos | undefined {
    const m = this.manifest.markers?.find((x) => x.id === id);
    if (m) return { segmentId: m.segment, t: m.t };
    return this.manifest.segments.some((s) => s.id === id) ? { segmentId: id, t: 0 } : undefined;
  }

  private goto(p: Pos) {
    this.holding = null;
    const changed = p.segmentId !== this.segmentId;
    this.segmentId = p.segmentId;
    this.t = p.t;
    if (changed) this.hooks.segment?.(p.segmentId);
  }

  private advance(nt: number) {
    const old = this.t;
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
      const e = this.history.pop();
      if (e) this.goto(e);
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
    this.history.push({ segmentId: this.segmentId, t: this.t });
    this.goto(to);
  }
}
