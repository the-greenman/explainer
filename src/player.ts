import { Clock, cueProgress, type Cue, type Manifest } from './clock.ts';
import { lookup, type Component } from './components/index.ts';
import { gate, scopeFor, type Store } from './store.ts';
import { bindPlayMode } from './triggers.ts';

type Entry = { cue: Cue; comp: Component; node: Element; wrap: HTMLElement; data: Record<string, any>; shown: boolean };
export type Command = { action: string; to?: string; rate?: number; t?: number; option?: string; depth?: number; hold?: boolean; on?: boolean; var?: string; value?: string };

export class ExplainerPlayer extends HTMLElement {
  clock!: Clock;
  store!: Store;
  private pending?: Manifest;
  private stage!: HTMLElement;
  private overlay!: HTMLElement;
  private media: HTMLMediaElement | null = null;
  private curSrc = '';
  private entries: Entry[] = [];
  private last = 0;
  private raf = 0;
  private cleanup: (() => void)[] = [];
  private reduced = false;
  private sig = '';

  set manifest(m: Manifest) { this.pending = m; if (this.isConnected) this.init(m); }
  get manifest() { return this.clock.manifest; }

  async connectedCallback() {
    const src = this.getAttribute('src');
    if (src && !this.pending) this.pending = await (await fetch(src)).json();
    if (this.pending && this.isConnected) this.init(this.pending);
  }

  static observedAttributes = ['playthrough'];
  attributeChangedCallback() { if (this.clock) this.applyPlaythrough(this.hasAttribute('playthrough')); }
  get playthrough() { return this.hasAttribute('playthrough'); }
  set playthrough(on: boolean) { this.toggleAttribute('playthrough', !!on); }

  /** The attribute is the source of truth; taking a default at a hold moves the clock, so media is re-synced. */
  private applyPlaythrough(on: boolean) {
    const held = !!this.clock.holding;
    this.clock.setPlaythrough(on);
    if (held && on) { this.syncMedia(true); this.pathChanged(); }
  }

  disconnectedCallback() { this.teardown(); }

  private teardown() {
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    this.replaceChildren();
    this.media = null;
    this.curSrc = '';
  }

  private init(m: Manifest) {
    this.teardown();
    this.store = scopeFor(this);
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.style.display = 'block';
    this.stage = document.createElement('div');
    this.stage.setAttribute('style', 'position:relative;overflow:hidden;aspect-ratio:16/9;background:var(--explainer-bg,#fff)');
    this.overlay = document.createElement('div');
    this.overlay.setAttribute('style', 'position:absolute;inset:0');
    this.stage.append(this.overlay);
    this.append(this.stage);

    this.clock = new Clock(m, {
      segment: (id) => { this.loadSegment(); this.emit('explainer:segment', { id }); },
      hold: () => this.syncMedia(true),
      set: (k, v) => this.store.set(k, v),
      // a playthrough branch happens inside advance(), possibly in the same segment or file: the media must follow
      jump: () => { this.syncMedia(true); this.pathChanged(); },
    });
    this.clock.playthrough = this.hasAttribute('playthrough');
    // each cue's component is mounted once; fails loudly on an unregistered type
    this.entries = m.cues.map((cue) => {
      const comp = lookup(cue.renders);
      if (!comp) throw new Error(`no component registered for ${cue.renders}`);
      const wrap = document.createElement('div');
      wrap.setAttribute('style', 'position:absolute;inset:0;pointer-events:none'); // interactive components opt back in
      wrap.hidden = true;
      this.overlay.append(wrap);
      const data = { variant: cue.variant, ...cue.data };
      return { cue, comp, node: comp.mount(wrap, data), wrap, data, shown: false };
    });
    this.loadSegment();
    this.sig = '';
    this.pathChanged();

    const onCmd = (e: Event) => this.command((e as CustomEvent<Command>).detail);
    this.addEventListener('explainer:command', onCmd);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest?.('input,textarea,select') || !this.clock.holding || this.clock.playthrough) return;
      const o = this.clock.holding.items?.[Number(e.key) - 1];
      if (o) this.choose(o.id);
    };
    document.addEventListener('keydown', onKey);
    this.cleanup.push(() => this.removeEventListener('explainer:command', onCmd), () => document.removeEventListener('keydown', onKey), bindPlayMode(this));

    this.last = performance.now();
    // ponytail: rAF runs always, even idle/offscreen; gate it on IntersectionObserver if many players get heavy
    const loop = () => { this.step(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  private emit(name: string, detail: object) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
  }

  // ponytail: one media element, src reassigned on segment change. Separate files still gap (~300 ms measured
  // locally); the chosen mitigation is one file per explainer with segments as in/out cuts (same src: no reload,
  // and no re-seek when already at the cut). A second preloaded element stays in reserve for multi-file explainers.
  private loadSegment() {
    const s = this.clock.segment;
    const want = s.kind === 'none' ? null : s.kind;
    if (want !== (this.media?.localName ?? null)) {
      this.media?.remove();
      this.curSrc = '';
      this.media = null;
      if (want) {
        const el = document.createElement(want);
        el.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain');
        el.preload = 'auto';
        if (el instanceof HTMLVideoElement) {
          el.playsInline = true;
          // frame-accurate reads while playing forward
          if ('requestVideoFrameCallback' in el) {
            const f = () => { if (this.media === el) { this.step(); el.requestVideoFrameCallback(f); } };
            el.requestVideoFrameCallback(f);
          }
        }
        this.stage.insertBefore(el, this.overlay);
        this.media = el;
      }
    }
    const swap = !!this.media && s.src !== this.curSrc;
    if (this.media && swap) {
      this.media.src = this.curSrc = s.src ?? '';
      // a displayed cue of a removed track stays painted (seen in Chromium) unless the track is disabled first
      for (const t of Array.from(this.media.textTracks)) t.mode = 'disabled';
      this.media.replaceChildren();
      if (s.captions) {
        const tr = document.createElement('track');
        Object.assign(tr, { kind: 'captions', src: s.captions, default: true });
        this.media.append(tr);
      }
    }
    // same file and already at the new segment's start (an adjacent cut): don't re-seek, it would snap back and stall
    const m = this.media;
    this.syncMedia(swap || !m || Math.abs(m.currentTime - ((s.in ?? 0) + this.clock.t)) > 0.1);
  }

  private syncMedia(seek: boolean) {
    const m = this.media;
    if (!m) return;
    const c = this.clock;
    if (seek) m.currentTime = (c.segment.in ?? 0) + c.t;
    const fwd = c.playing && c.rate > 0;
    const looping = c.holding?.loop_from != null;
    m.muted = !fwd; // reverse/scrub/hold-loop are silent
    if (fwd || looping) {
      m.preservesPitch = true;
      m.playbackRate = fwd ? c.rate : 1;
      m.play().catch(() => {});
    } else m.pause();
  }

  /** `explainer:path` when the history length, segment or held choice changed (a cheap signature, compared each step). */
  private pathChanged() {
    const c = this.clock;
    const sig = `${c.history.length}|${c.segmentId}|${c.holding?.id ?? ''}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.emit('explainer:path', { depth: c.history.length, segment: c.segmentId, holding: c.holding?.id ?? null });
  }

  private step() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const c = this.clock;
    const m = this.media;
    const base = c.segment.in ?? 0;
    if (c.playing) {
      if (m && c.rate > 0) c.setTime(m.ended ? c.length : Math.max(0, m.currentTime - base)); // media drives; a file shorter than `out` ends the segment
      else { c.tick(dt); if (m) m.currentTime = base + c.t; } // clock drives, media follows
    } else if (m && c.holding?.loop_from != null && m.currentTime >= base + c.holding.end) {
      m.currentTime = base + c.holding.loop_from;
    }
    this.paint();
    this.pathChanged();
  }

  private paint() {
    const { t, segmentId } = this.clock;
    const vars = this.store.all();
    for (const e of this.entries) {
      const c = e.cue;
      const show = !(c.hold && this.clock.playthrough) && c.segment === segmentId && t >= c.start && t <= c.end && gate(c, vars);
      e.wrap.hidden = !show; // before render, so a cue measures its real size on its first frame
      if (show) e.comp.render(e.node as HTMLElement, this.reduced ? 1 : cueProgress(c, t), e.data, vars, c.items ?? [], c.end - c.start);
      if (show !== e.shown) { e.shown = show; this.emit(show ? 'explainer:cueenter' : 'explainer:cueexit', { cue: c.id }); }
    }
  }

  private act(fn: () => void) { fn(); this.syncMedia(true); this.pathChanged(); }
  play() { this.act(() => this.clock.play()); }
  pause() { this.act(() => this.clock.pause()); }
  seek(t: number) { this.act(() => this.clock.seek(t)); }
  setRate(r: number) { this.act(() => this.clock.setRate(r)); }
  jumpTo(id: string) { this.act(() => this.clock.jumpTo(id)); }
  back() { this.act(() => this.clock.back()); }
  /** Unwind the path to `depth` entries; `atChoice` re-holds the choice taken there (what clicking a path step does). */
  rewind(depth: number, atChoice = false) { this.act(() => this.clock.rewindTo(depth, atChoice)); }
  choose(option: string) {
    this.act(() => this.clock.choose(option));
    this.emit('explainer:choice', { option });
  }

  /** Same vocabulary as the explainer:command event. */
  command(d: Command) {
    switch (d.action) {
      case 'play': return this.play();
      case 'pause': return this.pause();
      case 'seek': return d.to ? this.jumpTo(d.to) : this.seek(d.t ?? 0);
      case 'rate': this.setRate(d.rate ?? 1); return this.play(); // setting a rate starts playback
      case 'jump': return this.jumpTo(d.to!);
      case 'back': return this.back();
      case 'rewind': return this.rewind(d.depth ?? 0, !!d.hold);
      case 'choose': return this.choose(d.option!);
      case 'playthrough': this.playthrough = d.on ?? !this.playthrough; return;
      case 'set': return this.store.set(d.var!, String(d.value ?? ''));
    }
  }
}
