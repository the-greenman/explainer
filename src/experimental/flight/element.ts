// <explainer-flight for="#player">: draws one object flying between anchors outside and inside players. EXPERIMENTAL (see ../README.md).
// The paint is a pure function of (every driver's progress, measured rects); nothing accumulates between paints. Events only mark the
// element dirty; one paint runs per animation frame.
import { r3 } from '../../num.ts';
import { arrivalOf } from './arrival.ts';
import { chainBoxAt } from './chain.ts';
import { gatePlayerProgress, playerProgress, scrollProgress, scrollStop, settleProgress } from './drivers.ts';
import { getFlightEffect } from './effect.ts';
import { fromDocRect, homeVisibility, toDocRect } from './homes.ts';
import { IDLE, type ChainStop, type Rect } from './types.ts';

type AnchorCfg = { selector: string } | { canvas: [number, number, number, number] };
/** A stop is driven by a player's time (`player` defaults to the element's `for`) or by a scroll stretch (`scroll`). */
type StopCfg = { player?: string; segment?: string; at?: number; for?: number; scroll?: { from: string; to: string }; anchor: number; fx?: string };
type Cfg = { object: string; anchors: AnchorCfg[]; stops: StopCfg[] };
type Driver = { kind: 'player'; player: Element; segment: string; at: number; len: number } | { kind: 'scroll'; from: string; to: string };
type Clk = { segmentId: string; t: number };
type Measured = { rect: Rect; els: Element[]; el: Element | null }; // el: the matched element that gave the rect (null for a canvas anchor or a hidden one)

const LAYER_STYLE = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:visible';
const ZERO: Rect = { x: 0, y: 0, w: 0, h: 0 };
const hasBox = (b: { width: number; height: number }) => b.width > 0 || b.height > 0;

export class ExplainerFlight extends HTMLElement {
  /** Cost of the last paints, for the check script (measured, never fed back into the paint). */
  stats = { paints: 0, ms: 0, max: 0 };
  private cfg!: Cfg;
  private drivers: Driver[] = [];
  private chain: ChainStop[] = [];
  private clocks = new Map<Element, Clk>(); // the latest known clock of every referenced player
  private players: Element[] = [];
  private canvasPlayer: Element | null = null; // canvas anchors are in the design canvas of the `for` player (else the first referenced)
  private layer: HTMLElement | null = null;
  private flier: HTMLElement | null = null;
  private touched = new Map<Element, string>(); // element -> its inline visibility before we touched it
  private hereEl: Element | null = null; // carries data-flight-here
  private targetEl: Element | null = null; // carries --flight-p
  private lastGood: (Rect | null)[] = []; // document coordinates (a viewport rect goes stale on scroll)
  private observed = new Set<Element>();
  private ro: ResizeObserver | null = null;
  private reduced = false;
  private dirty = false;
  private raf = 0;
  private cleanup: (() => void)[] = [];
  private gen = 0; // connection generation: setup only goes on if its call is still the latest and the element is connected
  private addedHome = new Set<Element>(); // objects this element put `data-flight-home` on (and so removes it from)
  private scanTemplates = true; // look for the object in templates on the next paint (at connect and on a segment event, not every paint)
  private warnedMissing = false;

  async connectedCallback() {
    const mine = ++this.gen;
    if (document.readyState === 'loading') await new Promise<void>((r) => document.addEventListener('DOMContentLoaded', () => r(), { once: true }));
    if (mine !== this.gen || !this.isConnected) return; // disconnected (or reconnected, which started its own setup) while waiting
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
    // canvas anchors are in the `for` player's canvas even when no stop names it (`ps` only holds the players some stop names)
    this.canvasPlayer = (dflt && document.querySelector(dflt)) || this.players[0] || null;
    this.scanTemplates = true;
    // offline render: flights do not render; touch nothing
    if (this.players.some((p) => p.hasAttribute('render'))) return;
    this.chain = this.cfg.stops.map((s) => ({ anchor: s.anchor, fx: s.fx ?? 'cut' }));
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
    const onMq = () => { this.reduced = mq.matches; this.invalidate(); };
    mq.addEventListener('change', onMq);
    const again = () => this.invalidate();
    for (const p of this.players) {
      // before any event: the player's own clock if it is already there, else the segment of its first stop at 0
      const c = (p as any).clock, first = this.drivers.find((d): d is Extract<Driver, { kind: 'player' }> => d.kind === 'player' && d.player === p);
      this.clocks.set(p, c ? { segmentId: c.segmentId, t: c.t } : { segmentId: first?.segment ?? '', t: 0 });
      const onTime = (e: Event) => { const d = (e as CustomEvent).detail; this.clocks.set(p, { segmentId: d.segmentId, t: d.t }); this.invalidate(); };
      p.addEventListener('explainer:time', onTime);
      const onSeg = () => { this.scanTemplates = true; this.invalidate(); }; // a new segment may mount the scene that holds the object
      p.addEventListener('explainer:segment', onSeg);
      this.cleanup.push(() => p.removeEventListener('explainer:time', onTime), () => p.removeEventListener('explainer:segment', onSeg));
    }
    addEventListener('scroll', again, { passive: true, capture: true });
    addEventListener('resize', again);
    addEventListener('load', again);
    // layout shifts without a time or scroll event: the page, the players and every element we measured
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(again);
      this.ro.observe(document.documentElement);
      for (const p of this.players) this.watch(p);
    }
    (document as any).fonts?.ready?.then(again);
    this.cleanup.push(() => mq.removeEventListener('change', onMq), () => removeEventListener('scroll', again, { capture: true }), () => removeEventListener('resize', again), () => removeEventListener('load', again),
      () => { this.ro?.disconnect(); this.ro = null; this.observed.clear(); });
    this.paint(); // the first paint is not deferred
  }

  disconnectedCallback() {
    this.gen++; // invalidates a setup still waiting for the document
    for (const f of this.cleanup.splice(0)) f();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0; this.dirty = false;
    for (const [h, v] of this.touched) (h as HTMLElement | SVGElement).style.visibility = v;
    this.touched.clear();
    this.mark(null, null, 0);
    for (const e of this.addedHome) e.removeAttribute('data-flight-home');
    this.addedHome.clear();
    this.layer?.remove();
    this.layer = this.flier = null;
    this.clocks.clear();
  }

  /** Mark dirty; at most one paint per frame, in a requestAnimationFrame. */
  private invalidate() {
    if (!this.flier) return;
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.flush(); });
  }

  /** Paint now if something changed since the last paint (tests and check scripts; the frame callback calls it too). */
  flush() {
    if (!this.dirty || !this.flier) return;
    this.dirty = false;
    this.paint();
  }

  private watch(el: Element) {
    if (!this.ro || this.observed.has(el)) return;
    this.observed.add(el);
    this.ro.observe(el);
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

  /**
   * Viewport rect of anchor i. A selector may match several elements (comma list): the first with a box. A hidden scene has no box:
   * the last good rect, kept in document coordinates. Also returns every element the selector matched (one query per paint).
   */
  private measure(i: number, all: (sel: string) => Element[], canvas: () => { b: DOMRect; dw: number } | null, sx: number, sy: number): Measured {
    const a = this.cfg.anchors[i], stale = (): Rect => { const g = this.lastGood[i]; return g ? fromDocRect(g, sx, sy) : ZERO; };
    const keep = (r: Rect): Rect => { this.lastGood[i] = toDocRect(r, sx, sy); return r; };
    if ('canvas' in a) {
      const c = canvas();
      if (!c) return { rect: stale(), els: [], el: null };
      const s = c.b.width / c.dw, [x, y, w, h] = a.canvas;
      return { rect: keep({ x: c.b.left + x * s, y: c.b.top + y * s, w: w * s, h: h * s }), els: [], el: null };
    }
    const els = all(a.selector);
    for (const el of els) {
      this.watch(el);
      const b = el.getBoundingClientRect();
      if (hasBox(b)) return { rect: keep({ x: b.left, y: b.top, w: b.width, h: b.height }), els, el };
    }
    return { rect: stale(), els, el: null };
  }

  /** Progress of every stop from its own driver: a player's latest clock (gated, see `gatePlayerProgress`), or the scroll stretch measured now. */
  private progress(all: (sel: string) => Element[]): number[] {
    const line = innerHeight / 2;
    return this.drivers.map((d, i) => {
      if (d.kind === 'player') {
        const c = this.clocks.get(d.player);
        if (!c) return IDLE;
        const q = playerProgress({ segment: d.segment, at: d.at, len: d.len, instant: getFlightEffect(this.chain[i].fx).instant }, c.segmentId, c.t);
        const playMode = d.player.getAttribute('play');
        const pinned = this.reduced && (playMode === 'enter' || playMode === 'scrub');
        return gatePlayerProgress(q, { state: d.player.getAttribute('data-state'), playMode, top: pinned ? d.player.getBoundingClientRect().top : 0 }, this.reduced, line);
      }
      const fe = all(d.from)[0], te = all(d.to)[0];
      if (fe) this.watch(fe);
      if (te) this.watch(te);
      const f = fe?.getBoundingClientRect(), t = te?.getBoundingClientRect();
      return f && t ? scrollStop(scrollProgress(f.bottom, t.top, line)) : IDLE;
    });
  }

  /** Arrival marking: `data-flight-here` on the element the object rests at, `--flight-p` (0..1, 1 at rest) on the one it rests at or moves toward. Removed everywhere else. */
  private mark(here: Element | null, target: Element | null, p: number) {
    if (this.hereEl !== here) { this.hereEl?.removeAttribute('data-flight-here'); this.hereEl = here; }
    here?.setAttribute('data-flight-here', '');
    if (this.targetEl !== target) { (this.targetEl as HTMLElement | null)?.style.removeProperty('--flight-p'); this.targetEl = target; }
    if (target) { const v = String(r3(p)); const st = (target as HTMLElement).style; if (st.getPropertyValue('--flight-p') !== v) st.setProperty('--flight-p', v); }
  }

  private paint() {
    if (!this.flier) return;
    const t0 = performance.now();
    const memo = new Map<string, Element[]>(); // one DOM query per selector per paint
    const all = (sel: string) => { let r = memo.get(sel); if (!r) memo.set(sel, (r = Array.from(document.querySelectorAll(sel)))); return r; };
    let cv: { b: DOMRect; dw: number } | null | undefined;
    const canvas = () => {
      if (cv !== undefined) return cv;
      const el = this.canvasPlayer?.querySelector('[data-canvas]') as HTMLElement | null, b = el?.getBoundingClientRect();
      const dw = Number((el?.getAttribute('data-canvas') ?? '').split('x')[0]);
      return (cv = b && dw > 0 && b.width > 0 ? { b, dw } : null);
    };
    const sx = scrollX || 0, sy = scrollY || 0;

    // the object: the live element (a scene mounts later than this element connects); until the flier is built, else the first match in a template
    const live = all(this.cfg.object)[0] ?? null;
    if (!this.flier.firstChild) {
      let src: Element | null = live;
      if (!src && this.scanTemplates) {
        this.scanTemplates = false; // scan again only after a segment event (or a reconnect), never on every paint
        for (const t of Array.from(document.querySelectorAll('template'))) { src = t.content.querySelector(this.cfg.object); if (src) break; }
        if (!src && !this.warnedMissing) { this.warnedMissing = true; console.warn(`<explainer-flight>: object "${this.cfg.object}" matches nothing in the page or its templates`); }
      }
      if (src) this.buildFlier(src);
    }
    const measured = this.cfg.anchors.map((_, i) => this.measure(i, all, canvas, sx, sy));
    const rects = measured.map((m) => m.rect);
    for (const el of Array.from(this.touched.keys())) if (!el.isConnected) this.touched.delete(el); // a scene that was unmounted
    for (const el of Array.from(this.observed)) if (!el.isConnected) { this.observed.delete(el); this.ro?.unobserve(el); }
    let q = this.progress(all);
    if (this.reduced) q = settleProgress(q);
    const box = chainBoxAt(this.chain, q, rects);

    // homes: the live object plus the first data-flight-home element of each selector anchor
    if (live && !live.hasAttribute('data-flight-home')) { live.setAttribute('data-flight-home', ''); this.addedHome.add(live); }
    const anchorHome = measured.map((m) => m.els.find((e) => e.hasAttribute('data-flight-home')) ?? null);
    const homes = new Set<Element>(anchorHome.filter((e): e is Element => !!e));
    if (live) homes.add(live);
    // the real element shows only while the object rests at one of the page homes; otherwise the home is hidden (layout kept) and its stays parts stay visible
    const here = box.restAnchor == null ? null : anchorHome[box.restAnchor] ?? null;
    for (const h of homes) {
      const own = h === here;
      this.vis(h, homeVisibility('home', own));
      for (const s of Array.from(h.querySelectorAll('[data-flight-stays]'))) this.vis(s, homeVisibility('stays', own));
    }
    const arr = arrivalOf(this.chain, q, box);
    this.mark(arr.here != null ? measured[arr.here].el : null, arr.target != null ? measured[arr.target].el : null, arr.p);
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
