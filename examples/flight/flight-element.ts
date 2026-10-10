// <explainer-flight for="#player">: draws one object flying between anchors outside and inside a player. Experiment: see README.
// The paint is a pure function of (segmentId, t, measured rects); nothing accumulates between paints.
import type { Rect } from '../../src/media-slots.ts';
import { flightBoxAt, settledTime, stopsOf, type Fx, type Stop } from './flight.ts';

type AnchorCfg = { selector: string } | { canvas: [number, number, number, number] };
type Cfg = { object: string; anchors: AnchorCfg[]; stops: { segment: string; at: number; for?: number; anchor: number; fx?: Fx }[] };

const LAYER_STYLE = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:visible';
const FX: Fx[] = ['cut', 'fall', 'pop', 'glide'];
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export class ExplainerFlight extends HTMLElement {
  /** Cost of the last paints, for the check script (measured, never fed back into the paint). */
  stats = { paints: 0, ms: 0, max: 0 };
  private player: HTMLElement | null = null;
  private cfg!: Cfg;
  private stops: Stop[] = [];
  private object!: Element;
  private layer: HTMLElement | null = null;
  private flier: HTMLElement | null = null;
  private homes = new Map<Element, string>(); // element -> its inline visibility before we touched it
  private anchorHomes: (Element | null)[] = [];
  private lastGood: (Rect | null)[] = [];
  private last: { segmentId: string; t: number } | null = null;
  private reduced = false;
  private cleanup: (() => void)[] = [];

  async connectedCallback() {
    if (document.readyState === 'loading') await new Promise<void>((r) => document.addEventListener('DOMContentLoaded', () => r(), { once: true }));
    if (!this.isConnected) return;
    this.player = document.querySelector(this.getAttribute('for') ?? '');
    // offline render: flights do not render; touch nothing
    if (!this.player || this.player.hasAttribute('render')) return;
    try { this.cfg = JSON.parse(this.querySelector('script[type="application/json"]')?.textContent ?? ''); } catch { console.warn('<explainer-flight>: invalid JSON config'); return; }
    const obj = document.querySelector(this.cfg.object);
    if (!(obj instanceof Element)) { console.warn('<explainer-flight>: object not found'); return; }
    this.object = obj;
    this.stops = this.cfg.stops.map((s) => ({ segment: s.segment, at: s.at, len: s.for ?? 0, anchor: s.anchor, fx: FX.includes(s.fx as Fx) ? (s.fx as Fx) : 'cut' }));
    this.lastGood = this.cfg.anchors.map(() => null);

    // homes: the object itself plus every selector anchor whose element is marked data-flight-home
    obj.setAttribute('data-flight-home', '');
    const homes = new Set<Element>([obj]);
    this.anchorHomes = this.cfg.anchors.map((a) => {
      if (!('selector' in a)) return null;
      const el = Array.from(document.querySelectorAll(a.selector)).find((e) => e.hasAttribute('data-flight-home')) ?? null;
      if (el) homes.add(el);
      return el;
    });
    for (const h of homes) this.homes.set(h, (h as HTMLElement | SVGElement).style.visibility);

    const clone = obj.cloneNode(true) as SVGElement | HTMLElement;
    for (const e of [clone, ...Array.from(clone.querySelectorAll('*'))]) { e.removeAttribute('id'); e.removeAttribute('data-flight-home'); }
    clone.style.cssText += ';width:100%;height:100%;margin:0;display:block;visibility:visible';
    this.layer = document.createElement('div');
    this.layer.setAttribute('style', LAYER_STYLE);
    this.layer.setAttribute('data-flight-layer', '');
    this.flier = document.createElement('div');
    this.flier.setAttribute('style', 'position:absolute;left:0;top:0;transform-origin:50% 50%;will-change:transform;display:none');
    this.flier.append(clone);
    this.layer.append(this.flier);
    document.body.append(this.layer);

    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = mq.matches;
    const onMq = () => { this.reduced = mq.matches; this.paint(); };
    mq.addEventListener('change', onMq);
    const onTime = (e: Event) => { const d = (e as CustomEvent).detail; this.last = { segmentId: d.segmentId, t: d.t }; this.paint(); };
    const again = () => this.paint();
    this.player.addEventListener('explainer:time', onTime);
    this.player.addEventListener('explainer:segment', again);
    addEventListener('scroll', again, { passive: true, capture: true });
    addEventListener('resize', again);
    const ro = new ResizeObserver(again);
    ro.observe(this.player);
    this.cleanup.push(() => mq.removeEventListener('change', onMq), () => this.player?.removeEventListener('explainer:time', onTime), () => this.player?.removeEventListener('explainer:segment', again),
      () => removeEventListener('scroll', again, { capture: true }), () => removeEventListener('resize', again), () => ro.disconnect());

    // before any event: the player's own clock if it is already there, else the first stop's segment at 0
    const c = (this.player as any).clock;
    this.last = c ? { segmentId: c.segmentId, t: c.t } : { segmentId: this.stops[0]?.segment ?? '', t: 0 };
    this.paint();
  }

  disconnectedCallback() {
    for (const f of this.cleanup.splice(0)) f();
    for (const [h, v] of this.homes) (h as HTMLElement | SVGElement).style.visibility = v;
    this.homes.clear();
    this.layer?.remove();
    this.layer = this.flier = null;
  }

  /** Viewport rect of anchor i. A selector may match several elements (comma list): the first with a box. A hidden scene has no box: the last good rect. */
  private measure(i: number): Rect {
    const a = this.cfg.anchors[i];
    if ('canvas' in a) {
      const el = this.player!.querySelector('[data-canvas]') as HTMLElement | null;
      const b = el?.getBoundingClientRect();
      const dw = Number((el?.getAttribute('data-canvas') ?? '').split('x')[0]);
      if (!b || !(dw > 0) || b.width === 0) return this.lastGood[i] ?? { x: 0, y: 0, w: 0, h: 0 };
      const s = b.width / dw, [x, y, w, h] = a.canvas;
      return (this.lastGood[i] = { x: b.left + x * s, y: b.top + y * s, w: w * s, h: h * s });
    }
    for (const el of Array.from(document.querySelectorAll(a.selector))) {
      const b = el.getBoundingClientRect();
      if (b.width > 0 || b.height > 0) return (this.lastGood[i] = { x: b.left, y: b.top, w: b.width, h: b.height });
    }
    return this.lastGood[i] ?? { x: 0, y: 0, w: 0, h: 0 };
  }

  private paint() {
    if (!this.last || !this.flier) return;
    const t0 = performance.now();
    const { segmentId, t } = this.last;
    const idle = !stopsOf(this.stops, segmentId).length;
    const rects = this.cfg.anchors.map((_, i) => this.measure(i));
    const box = flightBoxAt(this.stops, rects, segmentId, this.reduced ? settledTime(this.stops, segmentId, t) : t);

    // the real element shows only while the object rests at one of the page homes; otherwise every home is hidden (they keep their layout)
    const home = box.restAnchor == null ? null : this.anchorHomes[box.restAnchor] ?? null;
    const flierOn = !idle && box.visible && !home;
    for (const [h, v] of this.homes) {
      const vis = idle || h === home;
      const want = vis ? v : 'hidden';
      if ((h as HTMLElement | SVGElement).style.visibility !== want) (h as HTMLElement | SVGElement).style.visibility = want;
    }
    const f = this.flier;
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
