// The in-video marker (a "karaoke ball"): a scene extension. EXPERIMENTAL (see ./README.md).
// Markup inside a scene template:
//   <span class="ball" data-marker="m1"></span>
//   <li data-marker-stop="m1" data-marker-at="0.4" data-marker-for="0.45" data-marker-fx="hop" data-marker-point="left">...</li>
// Every scene render, after the built-in choreography, the marker is placed from the clock alone: measured stop rects (in the scene's own
// CSS px) and the stops' timing go through the same chain and effect registry as a flight, so there is no state between renders. It runs in
// the offline render too (flights do not).
import { SCENE_FX_DEFAULT_FOR, type SceneExtension } from '../../components/scene.ts';
import { num, r3 } from '../../num.ts';
import { arrivalOf } from './arrival.ts';
import { chainBoxAt } from './chain.ts';
import { playerProgress, settleProgress } from './drivers.ts';
import { getFlightEffect } from './effect.ts';
import type { ChainStop, Rect } from './types.ts';

export type MarkerPoint = 'left' | 'center' | 'top';
type StopEl = { el: HTMLElement; at: number; len: number; fx: string; point: MarkerPoint };
type Marker = { el: HTMLElement; stops: StopEl[] };

const quote = (s: string) => `"${s.replace(/["\\]/g, '\\$&')}"`;
const POINTS: MarkerPoint[] = ['left', 'center', 'top'];

/** Where on a stop's box (viewport rect `b`) the marker is centred: `left` = left edge, middle height (a bullet); `center`; `top` = top edge, middle width. */
export function markerPoint(b: { left: number; top: number; width: number; height: number }, point: MarkerPoint): { x: number; y: number } {
  if (point === 'center') return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  if (point === 'top') return { x: b.left + b.width / 2, y: b.top };
  return { x: b.left, y: b.top + b.height / 2 };
}

let reducedMq: MediaQueryList | null = null, reducedFn: unknown; // cached per matchMedia function (null: none in this environment)
const reducedMotion = () => {
  const fn = typeof matchMedia === 'function' ? matchMedia : null;
  if (fn !== reducedFn) { reducedFn = fn; reducedMq = fn ? fn('(prefers-reduced-motion: reduce)') : null; }
  return !!reducedMq?.matches;
};
/** Set a style property only when its value changes (an unchanged render writes nothing). */
const setProp = (el: HTMLElement, name: string, v: string) => { if (el.style.getPropertyValue(name) !== v) el.style.setProperty(name, v); };

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
    // all layout reads first, then the writes
    const rr = root.getBoundingClientRect(), ow = root.offsetWidth;
    if (!(ow > 0) || !(rr.width > 0)) return; // not laid out (hidden, detached): nothing to measure
    const k = rr.width / ow; // the canvas scale: measure in the scene's own CSS px
    // the offline render (a player with `render`) never settles, like the player's own reduced-motion check
    const reduced = reducedMotion() && !root.closest('explainer-player')?.hasAttribute('render');
    const planned = markers.map((m) => {
      const mw = m.el.offsetWidth, mh = m.el.offsetHeight; // the marker's own size, which transforms do not change
      const rects: Rect[] = m.stops.map((s) => {
        const pt = markerPoint(s.el.getBoundingClientRect(), s.point);
        return { x: (pt.x - rr.left) / k - mw / 2, y: (pt.y - rr.top) / k - mh / 2, w: mw, h: mh };
      });
      const chain: ChainStop[] = m.stops.map((s, i) => ({ anchor: i, fx: s.fx }));
      let q = m.stops.map((s) => playerProgress({ segment: '', at: s.at, len: s.len, instant: getFlightEffect(s.fx).instant }, '', t));
      if (reduced) q = settleProgress(q);
      const box = chainBoxAt(chain, q, rects);
      return { m, box, arr: arrivalOf(chain, q, box) };
    });
    for (const { m, box, arr } of planned) {
      setProp(m.el, 'transform', `translate(${r3(box.rect.x)}px,${r3(box.rect.y)}px) rotate(${r3(box.rot)}deg) scale(${r3(box.scale)})`);
      setProp(m.el, 'opacity', String(r3(box.visible ? box.opacity : 0)));
      m.stops.forEach((s, i) => {
        // the property before the attribute, always: the serialised markup then does not depend on the order of earlier renders
        if (arr.target === i) setProp(s.el, '--marker-p', String(r3(arr.p))); else if (s.el.style.getPropertyValue('--marker-p') !== '') s.el.style.removeProperty('--marker-p');
        const here = s.el.hasAttribute('data-marker-here');
        if (arr.here === i) { if (!here) s.el.setAttribute('data-marker-here', ''); } else if (here) s.el.removeAttribute('data-marker-here');
      });
    }
  },
};
