// Pure: where the one flying object is, given the progress of every stop. No effect is named here: poses come from the registry.
//
// Each stop has a progress q: IDLE (not started) or 0..1+ once started (1 and over = finished). The object is placed by the LAST stop
// in declared order that has started. It moves from where it was at the end of the previous stop (a finished or never started stop
// counts as finished at its anchor; a stop still moving counts as where it is now, recursively) to this stop's anchor, with this
// stop's effect. Stops that share a start position chain in declared order.
import { getFlightEffect } from './effect.ts';
import { started, type ChainStop, type FlightBox, type Rect } from './types.ts';

const zero: Rect = { x: 0, y: 0, w: 0, h: 0 };
const restBox = (rect: Rect, anchor: number): FlightBox => ({ visible: true, rect, rot: 0, scale: 1, opacity: 1, restAnchor: anchor });
const goneBox = (rect: Rect): FlightBox => ({ visible: false, rect, rot: 0, scale: 0, opacity: 0, restAnchor: null });

export function chainBoxAt(stops: ChainStop[], q: number[], rects: Rect[]): FlightBox {
  const at = (i: number) => rects[i] ?? zero;
  if (!stops.length) return { visible: false, rect: zero, rot: 0, scale: 1, opacity: 1, restAnchor: null };
  let k = -1;
  for (let i = 0; i < stops.length; i++) if (started(q[i])) k = i;
  if (k < 0) {
    const first = stops[0], fx = getFlightEffect(first.fx);
    return fx.kind === 'enter' ? goneBox(at(first.anchor)) : restBox(at(first.anchor), first.anchor);
  }
  return stopBox(stops, q, rects, k);
}

function stopBox(stops: ChainStop[], q: number[], rects: Rect[], k: number): FlightBox {
  const s = stops[k], to = rects[s.anchor] ?? zero, fx = getFlightEffect(s.fx);
  const x = started(q[k]) && !fx.instant ? q[k] : 1; // a stop that never started counts as finished (the object was carried past it)
  if (x >= 1) return restBox(to, s.anchor);
  const from = fx.kind === 'enter' || k === 0 ? to : stopBox(stops, q, rects, k - 1).rect; // the first stop has nothing before it
  const pose = fx.at(from, to, x);
  return { visible: true, ...pose, restAnchor: null };
}

export const rectsClose = (a: Rect, b: Rect, tol = 1e-6) =>
  [a.x - b.x, a.y - b.y, a.w - b.w, a.h - b.h].every((d) => Math.abs(Number.isFinite(d) ? d : 0) <= tol);
