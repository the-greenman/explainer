// Pure: where a flying object is at segment time T. No DOM; the element measures the anchor rects and passes them in.
// Experiment (see README): one object, a list of stops, each stop moving it to an anchor with a named effect.
import { inOut } from '../../src/motion.ts';
import { lerpRect, type Rect } from '../../src/media-slots.ts';

export type Fx = 'cut' | 'fall' | 'pop' | 'glide';
/** From `at` the object goes (over `len` s) to `anchor` (an index into the rects). Stops of other segments are ignored. */
export type Stop = { segment: string; at: number; len: number; anchor: number; fx: Fx };
export type FlightState =
  | { kind: 'absent' }
  | { kind: 'rest'; anchor: number }
  | { kind: 'moving'; from: number; to: number; p: number; fx: Fx };
export type FlightBox = { visible: boolean; rect: Rect; rot: number; scale: number; opacity: number; restAnchor: number | null };

const EPS = 1e-6;
// fall: gravity. The fall itself takes FALL_SPLIT of p; the rest is a damped bounce below the landing line.
export const FALL_SPLIT = 0.82;
export const FALL_BOUNCE_PX = 10;
export const FALL_WOBBLE_DEG = 9;
// pop: scale 0 -> 1 with an overshoot (ease-out-back), opacity in over the first third
export const POP_OVERSHOOT = 1.9;
export const POP_FADE = 1 / 3;

const zero: Rect = { x: 0, y: 0, w: 0, h: 0 };
const num = (n: number) => (Number.isFinite(n) ? n : 0);

/** Stops of `segmentId` in time order (stable for equal `at`). */
export const stopsOf = (stops: Stop[], segmentId: string): Stop[] =>
  stops.map((s, i) => ({ s, i })).filter(({ s }) => s.segment === segmentId).sort((a, b) => a.s.at - b.s.at || a.i - b.i).map(({ s }) => s);

/** Index of the last stop whose `at` <= T, or -1. */
function activeIndex(list: Stop[], T: number): number {
  let k = -1;
  for (let i = 0; i < list.length; i++) if (list[i].at <= T) k = i;
  return k;
}

/** The discrete state at T (which anchors, how far): no rects needed. A move from an interrupted move is reported as from the previous stop's anchor. */
export function flightStateAt(stops: Stop[], segmentId: string, T: number): FlightState {
  const list = stopsOf(stops, segmentId);
  if (!list.length) return { kind: 'absent' };
  const k = activeIndex(list, T);
  const s = list[Math.max(k, 0)];
  if (k < 0) return s.fx === 'pop' ? { kind: 'absent' } : { kind: 'rest', anchor: s.anchor };
  const p = s.len > 0 && s.fx !== 'cut' ? (T - s.at) / s.len : 1;
  if (p >= 1) return { kind: 'rest', anchor: s.anchor };
  if (s.fx === 'pop' || k === 0) return { kind: 'moving', from: s.anchor, to: s.anchor, p, fx: s.fx };
  return { kind: 'moving', from: list[k - 1].anchor, to: s.anchor, p, fx: s.fx };
}

/** Time at which the stop active at T has finished moving: reduced motion paints this, so only rest states are ever shown. */
export function settledTime(stops: Stop[], segmentId: string, T: number): number {
  const list = stopsOf(stops, segmentId), k = activeIndex(list, T);
  return k < 0 ? T : Math.max(T, list[k].at + list[k].len);
}

const outBack = (x: number) => { const c1 = POP_OVERSHOOT, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; };

/** Fall from `a` to `b` at progress p in [0,1]. Ends exactly at `b` with rot 0. */
export function fallAt(a: Rect, b: Rect, p: number): { rect: Rect; rot: number } {
  if (p >= 1) return { rect: b, rot: 0 };
  const u = Math.min(1, p / FALL_SPLIT);
  const ux = inOut(u); // gentle sideways ease
  const rect = lerpRect(a, b, ux);
  rect.y = a.y + (b.y - a.y) * u * u; // gravity: y accelerates
  let rot = FALL_WOBBLE_DEG * Math.sin(2 * Math.PI * u) * (1 - u) * (b.x >= a.x ? 1 : -1);
  if (p > FALL_SPLIT) {
    const q = (p - FALL_SPLIT) / (1 - FALL_SPLIT);
    rect.y += FALL_BOUNCE_PX * Math.sin(2 * Math.PI * q) * (1 - q); // dips below the landing line, comes back, settles
    rot = 0;
  }
  return { rect, rot };
}

/** Where the object is at segment time `T`, given the anchors' rects (viewport px, whatever space the caller measures in). A pure function of its arguments. */
export function flightBoxAt(stops: Stop[], rects: Rect[], segmentId: string, T: number): FlightBox {
  return boxAt(stopsOf(stops, segmentId), rects, T);
}

function boxAt(list: Stop[], rects: Rect[], T: number): FlightBox {
  const at = (i: number) => rects[i] ?? zero;
  const rest = (i: number): FlightBox => ({ visible: true, rect: at(i), rot: 0, scale: 1, opacity: 1, restAnchor: i });
  if (!list.length) return { visible: false, rect: zero, rot: 0, scale: 1, opacity: 1, restAnchor: null };
  const k = activeIndex(list, T), s = list[Math.max(k, 0)];
  if (k < 0) return s.fx === 'pop' ? { visible: false, rect: at(s.anchor), rot: 0, scale: 0, opacity: 0, restAnchor: null } : rest(s.anchor);
  const x = s.len > 0 && s.fx !== 'cut' ? (T - s.at) / s.len : 1;
  if (x >= 1) return rest(s.anchor);
  const p = Math.max(0, x);
  const to = at(s.anchor);
  if (s.fx === 'pop') {
    return { visible: true, rect: to, rot: 0, scale: Math.max(0, outBack(p)), opacity: Math.min(1, p / POP_FADE), restAnchor: null };
  }
  // k == 0 and not a pop: nothing before it, so it is already there. Otherwise from where the object was just before (recursively:
  // an interrupted move stays continuous)
  const from = k === 0 ? to : boxAt(list, rects, s.at - EPS).rect;
  const moving = { visible: true, scale: 1, opacity: 1, restAnchor: null };
  if (s.fx === 'fall') { const f = fallAt(from, to, p); return { ...moving, rect: f.rect, rot: f.rot }; }
  return { ...moving, rect: lerpRect(from, to, inOut(p)), rot: 0 };
}

export const rectsClose = (a: Rect, b: Rect, tol = 1e-6) =>
  [a.x - b.x, a.y - b.y, a.w - b.w, a.h - b.h].every((d) => Math.abs(num(d)) <= tol);
