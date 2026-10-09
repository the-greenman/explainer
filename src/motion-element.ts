import { clamp01 } from './clock.ts';
import { lookup, onRegister, stillP, type Component } from './components/index.ts';
import type { Command } from './player.ts';
import { scopeFor, type Store } from './store.ts';
import { bindEnter, bindScrub } from './triggers.ts';

export type MotionPlay = 'enter' | 'scrub' | 'hover' | 'manual';
const MODES: MotionPlay[] = ['enter', 'scrub', 'hover', 'manual'];

const warned = new Set<string>();
const warnOnce = (key: string, msg: string) => { if (!warned.has(key)) { warned.add(key); console.warn(msg); } };

const STYLE_ID = 'explainer-motion-style';
/** Zero-specificity defaults (`:where`), so any page rule wins. `position:relative` lets absolutely-placed components fill the box. */
function ensureStyle() {
  if (typeof document === 'undefined' || !document.head || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = ':where(explainer-motion){display:inline-block;position:relative;container-type:inline-size}';
  document.head.prepend(s);
}

/**
 * `<explainer-motion renders="com.semanticops.explainer/intro@1" variant="minimal" dur="2" play="enter">`
 *
 * Mounts one registered component in itself, with no stage, manifest or aspect ratio: the page sizes it. It has its own
 * clock over `dur` seconds; every paint calls the component's pure `render(node, t / dur, ...)`. Any light-DOM children it
 * has before it mounts (the site's server-rendered still) stay visible until then and are replaced by the component.
 */
export class ExplainerMotion extends HTMLElement {
  static observedAttributes = ['renders', 'variant', 'dur', 'play', 'scrub-root', 'rate'];

  store!: Store;
  /** Time on the element's own clock, seconds, 0..dur. */
  t = 0;
  private _data?: Record<string, any>;
  private _items?: any[];
  private comp?: Component;
  private node?: Element;
  private rate = 0; // signed; 0 = stopped
  private raf = 0;
  private last = 0;
  private reduced = false;
  private printing = false;
  private resumeAfterPrint = 0;
  private cleanup: (() => void)[] = [];
  private unbind = () => {};
  private mounted = false;
  private waiting?: () => void;

  /** Component data (merged over `variant`). Set from JS, or read from the child `<script type="application/json">`. */
  get data() { return this._data ?? {}; }
  set data(v: Record<string, any>) { this._data = v; this.paint(); }
  get items() { return this._items ?? []; }
  set items(v: any[]) { this._items = v; this.paint(); }

  get dur() { const d = Number(this.getAttribute('dur')); return d > 0 ? d : 1; }
  get playMode(): MotionPlay { const m = this.getAttribute('play') as MotionPlay; return MODES.includes(m) ? m : 'enter'; }
  /** Progress 0..1 on the element's own clock (not the painted p, which is the still under reduced motion or print). */
  get p() { return clamp01(this.t / this.dur); }
  get playing() { return this.rate !== 0; }
  private get baseRate() { const r = Math.abs(Number(this.getAttribute('rate'))); return r > 0 ? r : 1; }

  connectedCallback() {
    ensureStyle();
    if (document.readyState === 'loading') {
      // the server-rendered children may not be parsed yet
      const go = () => { if (this.isConnected) this.mount(); };
      document.addEventListener('DOMContentLoaded', go, { once: true });
      return;
    }
    this.mount();
  }

  disconnectedCallback() { this.teardown(); }

  attributeChangedCallback(name: string) {
    if (!this.mounted) return;
    if (name === 'renders' || name === 'variant') { this.teardown(); this.mount(); }
    else if (name === 'play' || name === 'scrub-root') this.bindMode();
    else if (name === 'rate' && this.rate) this.rate = Math.sign(this.rate) * this.baseRate;
    else this.paint();
  }

  private readJson() {
    const s = this.querySelector('script[type="application/json"]');
    if (!s) return;
    try {
      const j = JSON.parse(s.textContent ?? '{}');
      if (this._data === undefined && j.data && typeof j.data === 'object') this._data = j.data;
      if (this._items === undefined && Array.isArray(j.items)) this._items = j.items;
    } catch (err) {
      console.warn('<explainer-motion>: invalid JSON in child <script>', err);
    }
  }

  private mount() {
    if (this.mounted) return;
    const renders = this.getAttribute('renders') ?? '';
    const comp = lookup(renders);
    this.readJson();
    if (!comp) {
      // leave the static children where they are; a pack imported after this element upgraded registers later, so retry then
      if (!this.waiting) { const off = onRegister(() => { if (lookup(renders)) { off(); this.waiting = undefined; if (this.isConnected) this.mount(); } }); this.waiting = off; }
      // warn only if it is still missing once the page has loaded
      const warn = () => { if (this.waiting) warnOnce('missing:' + renders, `<explainer-motion>: no component registered for "${renders}"`); };
      if (document.readyState === 'complete') setTimeout(warn, 0); else addEventListener('load', warn, { once: true });
      return;
    }
    if (!comp.meta.surfaces.includes('web')) warnOnce('surface:' + renders, `<explainer-motion>: ${renders} does not declare the "web" surface; rendering anyway`);
    this.comp = comp;
    this.store = scopeFor(this);
    this.replaceChildren(); // the component takes over from the static still
    this.node = comp.mount(this, this.fullData());
    this.mounted = true;

    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
    this.reduced = !!mq?.matches;
    const onMq = () => { this.reduced = !!mq?.matches; this.rate = 0; this.bindMode(); };
    mq?.addEventListener?.('change', onMq);
    const unsub = this.store.subscribe(() => this.paint());
    // print: show the still, then restore
    const before = () => { if (this.printing) return; this.printing = true; this.resumeAfterPrint = this.rate; this.stop(); this.paint(); };
    const after = () => { if (!this.printing) return; this.printing = false; this.paint(); if (this.resumeAfterPrint) this.run(this.resumeAfterPrint); this.resumeAfterPrint = 0; };
    addEventListener('beforeprint', before);
    addEventListener('afterprint', after);
    const onCmd = (e: Event) => { this.command((e as CustomEvent<Command>).detail); };
    this.addEventListener('explainer:command', onCmd);
    this.cleanup.push(() => { mq?.removeEventListener?.('change', onMq); unsub(); removeEventListener('beforeprint', before); removeEventListener('afterprint', after); this.removeEventListener('explainer:command', onCmd); });
    this.bindMode();
    this.paint();
  }

  private teardown() {
    this.waiting?.();
    this.waiting = undefined;
    this.stop();
    this.unbind();
    this.unbind = () => {};
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    this.mounted = false;
    this.node = undefined;
    this.comp = undefined;
  }

  private bindMode() {
    this.unbind();
    this.unbind = () => {};
    if (this.reduced) { this.stop(); this.paint(); return; } // sits at the still, nothing bound
    const d = {
      forward: () => this.run(this.baseRate),
      reverse: () => this.run(-this.baseRate),
      pause: () => this.stop(),
      seekFraction: (f: number) => this.seek(f),
    };
    switch (this.playMode) {
      case 'enter': this.unbind = bindEnter(this, d); break;
      case 'scrub': this.unbind = bindScrub(this, this.getAttribute('scrub-root'), d); break;
      case 'hover': {
        const on = () => d.forward(), off = () => d.reverse();
        this.addEventListener('pointerenter', on);
        this.addEventListener('pointerleave', off);
        this.addEventListener('focusin', on);
        this.addEventListener('focusout', off);
        this.unbind = () => {
          this.removeEventListener('pointerenter', on);
          this.removeEventListener('pointerleave', off);
          this.removeEventListener('focusin', on);
          this.removeEventListener('focusout', off);
        };
        break;
      }
    }
    this.paint();
  }

  private fullData() { return { variant: this.getAttribute('variant') ?? undefined, ...this._data }; }

  /** The p that is painted: the still under reduced motion or print, else the clock's. */
  private paintedP() {
    const data = this.fullData();
    return this.reduced || this.printing ? stillP(this.comp!, data, this.items, this.dur) : this.p;
  }

  private paint() {
    if (!this.mounted || !this.comp || !this.node) return;
    this.comp.render(this.node as HTMLElement, this.paintedP(), this.fullData(), this.store.all(), this.items, this.dur);
  }

  private run(rate: number) {
    if (this.reduced || this.printing) return;
    this.rate = rate;
    this.last = performance.now();
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private stop() {
    this.rate = 0;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (!this.rate) return;
    this.t = Math.min(this.dur, Math.max(0, this.t + ((now - this.last) / 1000) * this.rate));
    this.last = now;
    this.paint();
    if ((this.rate > 0 && this.t >= this.dur) || (this.rate < 0 && this.t <= 0)) { this.rate = 0; return; }
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Play forward (from the start if it is at the end). Uses the `rate` attribute as speed. */
  play() {
    if (this.t >= this.dur) this.t = 0;
    this.run(this.baseRate);
  }
  pause() { this.stop(); }
  /** Go to progress `p` (0..1) of the element's own clock and paint. Pure in p: any order of seeks gives the same DOM. */
  seek(p: number) { this.t = clamp01(p) * this.dur; this.paint(); }
  /** Signed speed multiplier (negative plays backwards) and start playing, like the player. 0 pauses. */
  setRate(r: number) { if (r) this.run(r); else this.stop(); }

  /** Same vocabulary as the player's explainer:command, where it makes sense: play, pause, seek (`t` seconds), rate, set. */
  command(d: Command) {
    switch (d.action) {
      case 'play': return this.play();
      case 'pause': return this.pause();
      case 'seek': return this.seek((d.t ?? 0) / this.dur);
      case 'rate': return this.setRate(d.rate ?? 1);
      case 'set': return this.store?.set(d.var!, String(d.value ?? ''));
    }
  }
}
