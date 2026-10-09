import { cueTextAt } from './captions.ts';
import { Clock, cueProgress, type Cue, type Manifest } from './clock.ts';
import { lookup, stillP, type Component } from './components/index.ts';
import { canvasId, chooseCanvas, parseCanvas, type CanvasSpec } from './design-canvas.ts';
import { stillTime } from './still.ts';
import { gate, scopeFor, type Store } from './store.ts';
import { bindPlayMode } from './triggers.ts';
import { CAPTION_INK, CAPTION_OVER, CAPTION_PAPER, FONT_FAMILY, LEADING_CAPTION, PAPER, SIZE_CAPTION, SIZE_CAPTION_OVER } from './theme.ts';

const STYLE_ID = 'explainer-player-style';
/** The poster children stay in the DOM (no-JS, print before load) but give way once the player has painted. */
function ensureStyle() {
  if (typeof document === 'undefined' || !document.head || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = 'explainer-player > [data-explainer-poster=hidden]{display:none !important}';
  document.head.prepend(s);
}

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
  private strip: HTMLElement | null = null;
  private stripText = '';
  private layer!: HTMLElement; // where media and cue layers go: the design canvas, else the stage
  private canvasEl: HTMLElement | null = null;
  private specs: CanvasSpec[] = [];
  private spec?: CanvasSpec;
  private poster = false; // poster="still": painted at posterT until the first play, seek or jump
  private posterT = 0;
  private live = false;

  set manifest(m: Manifest) { this.pending = m; if (this.isConnected) this.init(m); }
  get manifest() { return this.clock.manifest; }

  async connectedCallback() {
    // the server-rendered children (templates, the inline manifest) may not be parsed yet
    if (document.readyState === 'loading') await new Promise<void>((r) => document.addEventListener('DOMContentLoaded', () => r(), { once: true }));
    const src = this.getAttribute('src');
    if (src && !this.pending) this.pending = await (await fetch(src)).json();
    if (!src && !this.pending) this.pending = this.inlineManifest();
    if (this.pending && this.isConnected && !this.live) this.init(this.pending);
  }

  /** A child `<script type="application/json" data-manifest>`, used when there is no `src` and no `.manifest` set. */
  private inlineManifest(): Manifest | undefined {
    const el = this.querySelector('script[type="application/json"][data-manifest]');
    if (!el) return undefined;
    try { return JSON.parse(el.textContent ?? ''); } catch (err) { console.warn('<explainer-player>: invalid JSON in <script data-manifest>', err); return undefined; }
  }

  static observedAttributes = ['playthrough', 'captions', 'canvas'];
  attributeChangedCallback(name: string) {
    if (!this.clock) return;
    if (name === 'canvas') { if (this.live) this.init(this.clock.manifest); } // the stage is rebuilt; the clock starts again
    else if (name === 'playthrough') this.applyPlaythrough(this.hasAttribute('playthrough'));
    else { this.placeStrip(); this.paintCaption(); }
  }
  /** `captions="off"` hides the caption strip of audio segments (video keeps its native track); `captions="below"` lays it out under the stage instead of over it. */
  get captionsOn() { return this.getAttribute('captions') !== 'off'; }
  set captionsOn(on: boolean) { if (on) this.removeAttribute('captions'); else this.setAttribute('captions', 'off'); }
  get captionsBelow() { return this.getAttribute('captions') === 'below'; }
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
    // only what the player made: the site's own children (templates, poster, inline manifest) stay
    this.stage?.remove();
    this.strip?.remove();
    this.live = false;
    this.canvasEl = null;
    this.media = null;
    this.curSrc = '';
    this.strip = null;
    this.stripText = '';
  }

  private init(m: Manifest) {
    this.teardown();
    this.store = scopeFor(this);
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = mq.matches && !this.hasAttribute('render');
    this.style.display = 'block';
    const poster = Array.from(this.children).filter((c) => !['TEMPLATE', 'SCRIPT'].includes(c.tagName)); // the static first: hidden after the first paint
    this.stage = document.createElement('div');
    this.specs = parseCanvas(this.getAttribute('canvas'));
    this.overlay = document.createElement('div');
    this.overlay.setAttribute('style', 'position:absolute;inset:0');
    if (this.specs.length) {
      // design canvas: layers live in a W x H CSS px box scaled to the stage width (see applyCanvas); captions stay outside it
      this.stage.setAttribute('style', 'position:relative;overflow:hidden;background:' + PAPER);
      this.canvasEl = document.createElement('div');
      this.canvasEl.append(this.overlay);
      this.stage.append(this.canvasEl);
      this.layer = this.canvasEl;
    } else {
      // container-type: components size text and layout in cqw, so a stage looks the same at any width (and in the offline render)
      this.stage.setAttribute('style', 'position:relative;overflow:hidden;aspect-ratio:16/9;container-type:inline-size;background:' + PAPER);
      this.stage.append(this.overlay);
      this.layer = this.stage;
    }
    this.spec = undefined;
    if (!this.hasAttribute('render')) {
      // caption strip for audio (an <audio> has no native display): above the overlay, never takes the pointer
      this.strip = document.createElement('div');
      this.strip.className = 'explainer-captions';
      this.strip.hidden = true;
      this.strip.setAttribute('aria-live', 'off');
    }
    this.append(this.stage);
    this.applyCanvas(false);
    this.placeStrip();

    this.clock = new Clock(m, {
      segment: (id) => { this.loadSegment(); this.emit('explainer:segment', { id }); },
      hold: () => this.syncMedia(true),
      set: (k, v) => this.store.set(k, v),
      // a playthrough branch happens inside advance(), possibly in the same segment or file: the media must follow
      jump: () => { this.syncMedia(true); this.pathChanged(); },
    });
    this.clock.playthrough = this.hasAttribute('playthrough') || this.hasAttribute('render'); // a render is a video: choices are not shown
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
    this.cleanup.push(() => this.removeEventListener('explainer:command', onCmd), () => document.removeEventListener('keydown', onKey));

    // prefers-reduced-motion: play="enter|scrub" players do not animate, they sit at the still time of the first segment; reacts to changes
    let unbind = () => {};
    const applyMode = () => {
      unbind();
      this.reduced = mq.matches && !this.hasAttribute('render');
      unbind = bindPlayMode(this, this.reduced);
      if (this.reduced && ['enter', 'scrub'].includes(this.getAttribute('play') ?? '')) this.showStill(true);
    };
    mq.addEventListener('change', applyMode);
    this.cleanup.push(() => { mq.removeEventListener('change', applyMode); unbind(); });
    applyMode();

    // print: every player pauses at the still time of its current segment, and afterwards goes back where it was
    let saved: ReturnType<ExplainerPlayer['snapshot']> | null = null;
    const before = () => { saved ??= this.snapshot(); this.showStill(false); };
    const after = () => { if (saved) this.restore(saved); saved = null; };
    addEventListener('beforeprint', before);
    addEventListener('afterprint', after);
    this.cleanup.push(() => { removeEventListener('beforeprint', before); removeEventListener('afterprint', after); });

    this.live = true;
    this.poster = this.getAttribute('poster') === 'still' && !this.hasAttribute('render');
    if (this.poster) {
      this.posterT = this.stillTime(this.clock.segmentId);
      if (this.media) this.media.currentTime = (this.clock.segment.in ?? 0) + this.posterT;
    }
    this.paint(); // first paint, then the static children give way to it
    for (const el of poster) el.setAttribute('data-explainer-poster', 'hidden');
    if (poster.length) ensureStyle();
    if (this.canvasEl && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => { this.applyCanvas(true); });
      ro.observe(this);
      this.cleanup.push(() => ro.disconnect());
    }

    this.last = performance.now();
    if (this.hasAttribute('render')) return; // offline render: no loop, frames are placed with renderFrame()
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
    if (this.hasAttribute('render')) return; // offline render: never any media
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
        // read at media creation only (not observed): <track> inherits the CORS mode of the media element
        if (this.hasAttribute('crossorigin')) el.crossOrigin = this.getAttribute('crossorigin') ?? '';
        if (el instanceof HTMLVideoElement) {
          el.playsInline = true;
          // frame-accurate reads while playing forward
          if ('requestVideoFrameCallback' in el) {
            const f = () => { if (this.media === el) { this.step(); el.requestVideoFrameCallback(f); } };
            el.requestVideoFrameCallback(f);
          }
        }
        this.layer.insertBefore(el, this.overlay);
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
        Object.assign(tr, { kind: 'captions', src: s.captions, default: s.kind !== 'audio' });
        this.media.append(tr);
        if (s.kind === 'audio') tr.track.mode = 'hidden'; // loaded, never displayed natively: paintCaption() reads track.cues
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
      else { c.tick(dt); if (m) m.currentTime = (c.segment.in ?? 0) + c.t; } // clock drives, media follows (segment re-read: the tick may have crossed a cut, e.g. in reverse)
    } else if (m && c.holding?.loop_from != null && m.currentTime >= base + c.holding.end) {
      m.currentTime = base + c.holding.loop_from;
    }
    this.paint();
    this.paintCaption();
    this.pathChanged();
  }

  /** Caption strip: the cue active at the media time (`in + t`), found by time from the hidden track so it is right in reverse and when scrubbing. textContent only. */
  /** Over the stage (default): bottom-centred above the overlay. Below: in flow after the stage, two lines always reserved so
   *  the page does not jump between cues (narrow screens, where an overlaid strip would cover the picture). */
  private placeStrip() {
    const el = this.strip;
    if (!el) return;
    const look = `box-sizing:border-box;padding:.35em .8em;text-align:center;white-space:pre-line;font:inherit;line-height:${LEADING_CAPTION};pointer-events:none;`
      + `font-family:${FONT_FAMILY};color:${CAPTION_INK};`;
    if (this.captionsBelow) {
      el.setAttribute('style', look + `display:flex;align-items:center;justify-content:center;min-height:calc(2lh + .7em);font-size:${SIZE_CAPTION};background:${CAPTION_PAPER}`);
      this.stage.after(el);
    } else {
      el.setAttribute('style', look + `position:absolute;left:50%;bottom:3%;transform:translateX(-50%);max-width:80%;font-size:${SIZE_CAPTION_OVER};border-radius:6px;`
        + `background:${CAPTION_OVER}`);
      this.stage.append(el);
    }
  }

  private paintCaption() {
    const el = this.strip;
    if (!el) return;
    const s = this.clock.segment, tr = s.kind === 'audio' && this.captionsOn ? this.media?.textTracks[0] : undefined;
    const text = tr ? cueTextAt(tr.cues as any, (s.in ?? 0) + this.clock.t) : '';
    if (text !== this.stripText) { this.stripText = text; el.textContent = text; }
    // below: the reserved space stays while captions are on, empty between cues; it goes only with captions="off" or no track
    el.hidden = this.captionsBelow ? !tr : !text;
  }

  /** Pick the design canvas for the player's width and size the canvas element to it (no-op without a `canvas` attribute). */
  private applyCanvas(repaint: boolean) {
    const el = this.canvasEl;
    if (!el || !this.specs.length) return;
    const spec = chooseCanvas(this.specs, this.clientWidth || Infinity)!;
    const scale = this.stage.clientWidth ? this.stage.clientWidth / spec.w : 1;
    const key = `${canvasId(spec)}@${scale}`;
    if (key === el.getAttribute('data-key')) return;
    el.setAttribute('data-key', key);
    this.spec = spec;
    el.setAttribute('data-canvas', canvasId(spec));
    el.setAttribute('style', `position:absolute;left:0;top:0;width:${spec.w}px;height:${spec.h}px;overflow:hidden;container-type:size;transform-origin:0 0;transform:scale(${scale})`);
    this.stage.style.aspectRatio = `${spec.w}/${spec.h}`;
    if (repaint && this.live) this.paint();
  }

  private paint() {
    const { segmentId } = this.clock;
    const t = this.poster ? this.posterT : this.clock.t;
    const vars = this.store.all();
    for (const e of this.entries) {
      const c = e.cue;
      const show = !(c.hold && this.clock.playthrough) && c.segment === segmentId && t >= c.start && t <= c.end && gate(c, vars);
      e.wrap.hidden = !show; // before render, so a cue measures its real size on its first frame
      if (show) e.comp.render(e.node as HTMLElement, this.reduced ? stillP(e.comp, e.data, c.items ?? [], c.end - c.start) : cueProgress(c, t), e.data, vars, c.items ?? [], c.end - c.start);
      if (show !== e.shown) { e.shown = show; this.emit(show ? 'explainer:cueenter' : 'explainer:cueexit', { cue: c.id }); }
    }
  }

  /**
   * Offline rendering (attribute `render`, set before the manifest): no media element, no rAF loop. Puts the clock at exactly
   * `{segmentId, t}`, applies `vars` (changed values only is fine), and paints once. Choice cues are hidden as in playthrough.
   * `scripts/render.mjs` drives this once per planned frame (`src/render-plan.ts`).
   */
  renderFrame(segmentId: string, t: number, vars: Record<string, string> = {}) {
    if (!this.hasAttribute('render')) throw new Error('renderFrame needs the render attribute on <explainer-player>');
    for (const [k, v] of Object.entries(vars)) this.store.set(k, v);
    const c = this.clock;
    c.segmentId = segmentId;
    c.holding = null;
    c.playing = false;
    c.t = t;
    this.paint();
  }

  /** The still time (seconds) of segment `id`, default the current one: `segment.still` or the latest cue still (src/still.ts). */
  stillTime(id = this.clock.segmentId) {
    const m = this.clock.manifest;
    return stillTime(m.segments.find((s) => s.id === id)!, m.cues, lookup);
  }

  /**
   * Pause on the static frame. `first`: of the first segment (reduced motion, goes through normal navigation);
   * otherwise of the current segment, placed directly like renderFrame so that history is untouched (print; see restore()).
   */
  private showStill(first: boolean) {
    const c = this.clock;
    if (first) {
      const id = c.manifest.segments[0].id;
      this.pause();
      if (c.segmentId !== id) this.jumpTo(id);
      this.seek(this.stillTime(id));
      return;
    }
    this.place(c.segmentId, this.stillTime(c.segmentId), null, false);
  }

  private place(segmentId: string, t: number, holding: Cue | null, playing: boolean) {
    const c = this.clock;
    const changed = c.segmentId !== segmentId;
    c.segmentId = segmentId;
    c.t = t;
    c.holding = holding;
    c.playing = playing;
    if (changed) this.loadSegment();
    this.syncMedia(true);
    this.pathChanged();
    this.paint();
  }

  private snapshot() {
    const c = this.clock;
    return { segmentId: c.segmentId, t: c.t, playing: c.playing, holding: c.holding, history: c.history.slice() };
  }

  private restore(s: ReturnType<ExplainerPlayer['snapshot']>) {
    this.clock.history = s.history;
    this.place(s.segmentId, s.t, s.holding, s.playing);
  }

  /** Every navigation ends the poster (`poster="still"`) and starts from the normal position; pause alone leaves it. */
  private act(fn: () => void, leavePoster = true) { if (leavePoster) this.poster = false; fn(); this.syncMedia(true); this.pathChanged(); }
  play() { this.act(() => this.clock.play()); }
  pause() { this.act(() => this.clock.pause(), false); }
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
      case 'captions': this.captionsOn = d.on ?? !this.captionsOn; return;
      case 'set': return this.store.set(d.var!, String(d.value ?? ''));
    }
  }
}
