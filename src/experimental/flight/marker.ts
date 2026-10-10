// The in-video marker (a "karaoke ball"): a scene extension. EXPERIMENTAL (see ./README.md).
// Markup inside a scene template:
//   <span class="ball" data-marker="m1"></span>
//   <li data-marker-stop="m1" data-marker-at="0.4" data-marker-for="0.45" data-marker-fx="hop" data-marker-point="left">...</li>
// Every scene render, after the built-in choreography, the marker is placed from the clock alone: measured stop rects (in the scene's own
// CSS px) and the stops' timing go through the same chain and effect registry as a flight, so there is no state between renders. It runs in
// the offline render too (flights do not).
import { SCENE_FX_DEFAULT_FOR, type SceneExtension } from '../../components/scene.ts';
import { arrivalOf } from './arrival.ts';
import { chainBoxAt } from './chain.ts';
import { playerProgress, settleProgress } from './drivers.ts';
import { getFlightEffect } from './effect.ts';
import type { ChainStop, Rect } from './types.ts';

export type MarkerPoint = 'left' | 'center' | 'top';
type StopEl = { el: HTMLElement; at: number; len: number; fx: string; point: MarkerPoint };
type Marker = { el: HTMLElement; stops: StopEl[] };

const num = (s: string | null, d: number) => { const n = s == null || s.trim() === '' ? NaN : Number(s); return Number.isFinite(n) ? n : d; };
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const quote = (s: string) => `"${s.replace(/["\\]/g, '\\$&')}"`;
const POINTS: MarkerPoint[] = ['left', 'center', 'top'];

/** Where on a stop's box (viewport rect `b`) the marker is centred: `left` = left edge, middle height (a bullet); `center`; `top` = top edge, middle width. */
export function markerPoint(b: { left: number; top: number; width: number; height: number }, point: MarkerPoint): { x: number; y: number } {
  if (point === 'center') return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  if (point === 'top') return { x: b.left + b.width / 2, y: b.top };
  return { x: b.left, y: b.top + b.height / 2 };
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const markerExtension: SceneExtension<Marker[]> = {
  name: 'marker',
  mount(root) {
    const out: Marker[] = [];
    for (const el of Array.from(root.querySelectorAll('[data-marker]') as ArrayLike<HTMLElement>)) {
      const id = el.getAttribute('data-marker') ?? '';
      const stops = Array.from(root.querySelectorAll(`[data-marker-stop=${quote(id)}]`) as ArrayLike<HTMLElement>).map((s): StopEl => {
        const p = s.getAttribute('data-marker-point') as MarkerPoint;
        return {
          el: s, at: Math.max(0, num(s.getAttribute('data-marker-at'), 0)), len: Math.max(0, num(s.getAttribute('data-marker-for'), SCENE_FX_DEFAULT_FOR)),
          fx: s.getAttribute('data-marker-fx') || 'hop', point: POINTS.includes(p) ? p : 'left',
        };
      });
      if (!stops.length) continue;
      // moved to the end of the scene root (position:absolute, inset 0): its offset is then in the root's own CSS px whatever the template's nesting
      root.appendChild(el);
      const st = el.style;
      st.setProperty('position', 'absolute'); st.setProperty('left', '0'); st.setProperty('top', '0'); st.setProperty('transform-origin', '50% 50%');
      out.push({ el, stops });
    }
    return out.length ? out : undefined;
  },
  render(root, markers, t) {
    const rr = root.getBoundingClientRect(), ow = root.offsetWidth;
    if (!(ow > 0) || !(rr.width > 0)) return; // not laid out (hidden, detached): nothing to measure
    const k = rr.width / ow; // the canvas scale: measure in the scene's own CSS px
    const reduced = reducedMotion();
    for (const m of markers) {
      const mw = m.el.offsetWidth, mh = m.el.offsetHeight; // the marker's own size, which transforms do not change
      const rects: Rect[] = m.stops.map((s) => {
        const pt = markerPoint(s.el.getBoundingClientRect(), s.point);
        return { x: (pt.x - rr.left) / k - mw / 2, y: (pt.y - rr.top) / k - mh / 2, w: mw, h: mh };
      });
      const chain: ChainStop[] = m.stops.map((s, i) => ({ anchor: i, fx: s.fx }));
      let q = m.stops.map((s) => playerProgress({ segment: '', at: s.at, len: s.len, instant: getFlightEffect(s.fx).instant }, '', t));
      if (reduced) q = settleProgress(q);
      const box = chainBoxAt(chain, q, rects);
      const st = m.el.style;
      st.setProperty('transform', `translate(${r3(box.rect.x)}px,${r3(box.rect.y)}px) rotate(${r3(box.rot)}deg) scale(${r3(box.scale)})`);
      st.setProperty('opacity', String(r3(box.visible ? box.opacity : 0)));
      const arr = arrivalOf(chain, q, box);
      m.stops.forEach((s, i) => {
        // the property before the attribute, always: the serialised markup then does not depend on the order of earlier renders
        if (arr.target === i) s.el.style.setProperty('--marker-p', String(r3(arr.p))); else s.el.style.removeProperty('--marker-p');
        if (arr.here === i) s.el.setAttribute('data-marker-here', ''); else s.el.removeAttribute('data-marker-here');
      });
    }
  },
};
