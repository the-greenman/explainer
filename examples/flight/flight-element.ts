// <explainer-flight for="#player">: draws one object flying between anchors outside and inside a player. Experiment: see README.
// The paint is a pure function of (segmentId, t, measured rects); nothing accumulates between paints.
import type { Rect } from '../../src/media-slots.ts';
import { chainBoxAt, homeVisibility, playerProgress, scrollProgress, scrollStop, settleProgress, type Fx } from './flight.ts';

type AnchorCfg = { selector: string } | { canvas: [number, number, number, number] };
/** A stop is driven by a player's time (`player` defaults to the element's `for`) or by a scroll stretch (`scroll`). */
type StopCfg = { player?: string; segment?: string; at?: number; for?: number; scroll?: { from: string; to: string }; anchor: number; fx?: Fx };
type Cfg = { object: string; anchors: AnchorCfg[]; stops: StopCfg[] };
type Driver = { kind: 'player'; player: Element; segment: string; at: number; len: number } | { kind: 'scroll'; from: string; to: string };
type Clk = { segmentId: string; t: number };

const LAYER_STYLE = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:visible';
const FX: Fx[] = ['cut', 'fall', 'pop', 'glide'];
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const ZERO: Rect = { x: 0, y: 0, w: 0, h: 0 };

export class ExplainerFlight extends HTMLElement {
  /** Cost of the last paints, for the check script (measured, never fed back into the paint). */
  stats = { paints: 0, ms: 0, max: 0 };
  private cfg!: Cfg;
  private drivers: Driver[] = [];
  private chain: { anchor: number; fx: Fx }[] = [];
  private clocks = new Map<Element, Clk>(); // the latest known clock of every referenced player
  private players: Element[] = [];
  private canvasPlayer: Element | null = null; // canvas anchors are in the design canvas of the `for` player (else the first referenced)
  private layer: HTMLElement | null = null;
  private flier: HTMLElement | null = null;
  private touched = new Map<Element, string>(); // element -> its inline visibility before we touched it
  private lastGood: (Rect | null)[] = [];
  private reduced = false;
  private cleanup: (() => void)[] = [];

  async connectedCallback() {
    if (document.readyState === 'loading') await new Promise<void>((r) => document.addEventListener('DOMContentLoaded', () => r(), { once: true }));
    if (!this.isConnected) return;
    try { this.cfg = JSON.parse(this.querySelector('script[type="application/json"]')?.textContent ?? ''); } catch { console.warn('<explainer-flight>: invalid JSON config'); return; }
    const dflt = this.getAttribute('for');
    const ps = new Map<string, Element>();
    for (const s of this.cfg.stops) {
      const sel = s.scroll ? null : s.player ?? dflt;
      if (sel && !ps.has(sel)) { const el = document.querySelector(sel); if (el) ps.set(sel, el); }
    }
    this.drivers = this.cfg.stops.map((s): Driver => s.scroll ? { kind: 'scroll', ...s.scroll } : { kind: 'player', player: ps.get(s.player ?? dflt ?? '') as Element, segment: s.segment ?? '', at: s.at ?? 0, len: s.for ?? 0 });
    if (this.drivers.some((d) => d.kind === 'player' && !d.player)) { console.warn('<explainer-flight>: player not found'); return; }
    this.players = [...new Set(this.drivers.flatMap((d) => (d.kind === 'player' ? [d.player] : [])))];
    this.canvasPlayer = (dflt && ps.get(dflt)) || this.players[0] || null;
    // offline render: flights do not render; touch nothing
    if (this.players.some((p) => p.hasAttribute('render'))) return;
    this.chain = this.cfg.stops.map((s) => ({ anchor: s.anchor, fx: FX.includes(s.fx as Fx) ? (s.fx as Fx) : 'cut' }));
    this.lastGood = this.cfg.anchors.map(() => null);

    this.layer = document.createElement('div');
    this.layer.setAttribute('style', LAYER_STYLE);
    this.layer.setAttribute('data-flight-layer', '');
    this.layer.setAttribute('aria-hidden', 'true'); // the flier is decoration; the real elements keep the meaning
    this.flier = document.createElement('div');
    this.flier.setAttribute('style', 'position:absolute;left:0;top:0;transform-origin:50% 50%;will-change:transform;display:none');
    this.layer.append(this.flier);
    document.body.append(this.layer);

    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = mq.matches;
    const onMq = () => { this.reduced = mq.matches; this.paint(); };
    mq.addEventListener('change', onMq);
    const again = () => this.paint();
    for (const p of this.players) {
      // before any event: the player's own clock if it is already there, else the segment of its first stop at 0
      const c = (p as any).clock, first = this.drivers.find((d): d is Extract<Driver, { kind: 'player' }> => d.kind === 'player' && d.player === p);
      this.clocks.set(p, c ? { segmentId: c.segmentId, t: c.t } : { segmentId: first?.segment ?? '', t: 0 });
      const onTime = (e: Event) => { const d = (e as CustomEvent).detail; this.clocks.set(p, { segmentId: d.segmentId, t: d.t }); this.paint(); };
      p.addEventListener('explainer:time', onTime);
      p.addEventListener('explainer:segment', again);
      this.cleanup.push(() => p.removeEventListener('explainer:time', onTime), () => p.removeEventListener('explainer:segment', again));
    }
    addEventListener('scroll', again, { passive: true, capture: true });
    addEventListener('resize', again);
    const ro = new ResizeObserver(again);
    for (const p of this.players) ro.observe(p);
    this.cleanup.push(() => mq.removeEventListener('change', onMq), () => removeEventListener('scroll', again, { capture: true }), () => removeEventListener('resize', again), () => ro.disconnect());
    this.paint();
  }

  disconnectedCallback() {
    for (const f of this.cleanup.splice(0)) f();
    for (const [h, v] of this.touched) (h as HTMLElement | SVGElement).style.visibility = v;
    this.touched.clear();
    this.layer?.remove();
    this.layer = this.flier = null;
    this.clocks.clear();
  }

  /** The object, looked up each paint: the live element (a scene mounts later than this element connects), else the first match inside a template. */
  private findObject(): { live: Element | null; source: Element | null } {
    const live = document.querySelector(this.cfg.object);
    if (live) return { live, source: live };
    for (const t of Array.from(document.querySelectorAll('template'))) { const el = t.content.querySelector(this.cfg.object); if (el) return { live: null, source: el }; }
    return { live: null, source: null };
  }

  /** The flier: a clone of the object without ids, home marks and `data-flight-stays` parts (those stay behind). Built once, from the first match. */
  private buildFlier(src: Element) {
    const clone = src.cloneNode(true) as SVGElement | HTMLElement;
    for (const e of Array.from(clone.querySelectorAll('[data-flight-stays]'))) e.remove();
    for (const e of [clone, ...Array.from(clone.querySelectorAll('*'))]) { e.removeAttribute('id'); e.removeAttribute('data-flight-home'); e.removeAttribute('data-flight-stays'); }
    clone.removeAttribute('style'); // scene choreography may have set opacity, clip-path or --fx-p on a live element
    clone.setAttribute('style', 'width:100%;height:100%;margin:0;display:block;visibility:visible');
    this.flier!.append(clone);
  }

  /** Set an element's inline visibility, remembering what it was; `null` puts it back. */
  private vis(el: Element, want: string | null) {
    const e = el as HTMLElement | SVGElement;
    if (!this.touched.has(el)) { if (want === null) return; this.touched.set(el, e.style.visibility); }
    const v = want ?? this.touched.get(el)!;
    if (e.style.visibility !== v) e.style.visibility = v;
  }

  /** Viewport rect of anchor i. A selector may match several elements (comma list): the first with a box. A hidden scene has no box: the last good rect. */
  private measure(i: number): Rect {
    const a = this.cfg.anchors[i];
    if ('canvas' in a) {
      const el = this.canvasPlayer?.querySelector('[data-canvas]') as HTMLElement | null;
      const b = el?.getBoundingClientRect();
      const dw = Number((el?.getAttribute('data-canvas') ?? '').split('x')[0]);
      if (!b || !(dw > 0) || b.width === 0) return this.lastGood[i] ?? ZERO;
      const s = b.width / dw, [x, y, w, h] = a.canvas;
      return (this.lastGood[i] = { x: b.left + x * s, y: b.top + y * s, w: w * s, h: h * s });
    }
    for (const el of Array.from(document.querySelectorAll(a.selector))) {
      const b = el.getBoundingClientRect();
      if (b.width > 0 || b.height > 0) return (this.lastGood[i] = { x: b.left, y: b.top, w: b.width, h: b.height });
    }
    return this.lastGood[i] ?? ZERO;
  }

  /** Progress of every stop from its own driver: a player's latest clock, or the scroll stretch measured now. */
  private progress(): number[] {
    const line = innerHeight / 2;
    return this.drivers.map((d, i) => {
      if (d.kind === 'player') { const c = this.clocks.get(d.player); return c ? playerProgress({ segment: d.segment, at: d.at, len: d.len, fx: this.chain[i].fx }, c.segmentId, c.t) : -Infinity; }
      const f = document.querySelector(d.from)?.getBoundingClientRect(), t = document.querySelector(d.to)?.getBoundingClientRect();
      return f && t ? scrollStop(scrollProgress(f.bottom, t.top, line)) : -Infinity;
    });
  }

  private paint() {
    if (!this.flier) return;
    const t0 = performance.now();
    const { live, source } = this.findObject();
    if (source && !this.flier.firstChild) this.buildFlier(source);
    const rects = this.cfg.anchors.map((_, i) => this.measure(i));
    for (const el of Array.from(this.touched.keys())) if (!el.isConnected) this.touched.delete(el); // a scene that was unmounted
    let q = this.progress();
    if (this.reduced) q = settleProgress(q);
    const box = chainBoxAt(this.chain, q, rects);

    // homes, resolved each paint: the live object plus the first data-flight-home element of each selector anchor
    live?.setAttribute('data-flight-home', '');
    const anchorHome = this.cfg.anchors.map((a) => ('selector' in a ? Array.from(document.querySelectorAll(a.selector)).find((e) => e.hasAttribute('data-flight-home')) ?? null : null));
    const homes = new Set<Element>(anchorHome.filter((e): e is Element => !!e));
    if (live) homes.add(live);
    // the real element shows only while the object rests at one of the page homes; otherwise the home is hidden (layout kept) and its stays parts stay visible
    const here = box.restAnchor == null ? null : anchorHome[box.restAnchor] ?? null;
    for (const h of homes) {
      const own = h === here;
      this.vis(h, homeVisibility('home', own));
      for (const s of Array.from(h.querySelectorAll('[data-flight-stays]'))) this.vis(s, homeVisibility('stays', own));
    }
    const f = this.flier;
    const flierOn = box.visible && !here && box.rect.w > 0 && box.rect.h > 0 && !!f.firstChild;
    if (!flierOn) { if (f.style.display !== 'none') f.style.display = 'none'; f.removeAttribute('data-s'); }
    else {
      const r = box.rect;
      const style = `display:block;width:${r3(r.w)}px;height:${r3(r.h)}px;opacity:${r3(box.opacity)};transform:translate(${r3(r.x)}px,${r3(r.y)}px) rotate(${r3(box.rot)}deg) scale(${r3(box.scale)})`;
      if (f.getAttribute('data-s') !== style) { f.setAttribute('data-s', style); f.style.cssText = `position:absolute;left:0;top:0;transform-origin:50% 50%;will-change:transform;${style}`; }
    }
    const dt = performance.now() - t0;
    this.stats.paints++; this.stats.ms += dt; this.stats.max = Math.max(this.stats.max, dt);
  }
}

if (!customElements.get('explainer-flight')) customElements.define('explainer-flight', ExplainerFlight);
