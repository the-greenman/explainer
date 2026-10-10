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

// ---- Chain: several drivers (player clocks, scroll stretches), one object. Pure functions of per-stop progress values.
// Each stop has progress q: IDLE (not started), or 0..1+ once started (1 and over = finished). The object is placed by the LAST
// stop in declared order that has started. It moves from where it was at the end of the previous stop (a finished or never started
// stop counts as finished at its anchor; a stop still moving counts as where it is now, recursively) to this stop's anchor.
export const IDLE = -Infinity;
export type ChainStop = { anchor: number; fx: Fx };
export const started = (q: number | undefined) => q !== undefined && q >= 0;

/** Progress of a player stop: IDLE while the player is in another segment or before `at`; otherwise (T - at) / len (1 when len is 0 or fx is cut). */
export function playerProgress(s: { segment: string; at: number; len: number; fx: Fx }, segmentId: string, T: number): number {
  if (s.segment !== segmentId || T < s.at) return IDLE;
  return s.len > 0 && s.fx !== 'cut' ? Math.min(1, (T - s.at) / s.len) : 1;
}

/**
 * Progress of a scroll stretch, from measured positions in viewport px: 0 when the bottom edge of the `from` element is at `line`,
 * 1 when the top edge of the `to` element is at `line` (the gap between the two parts scrolling past `line`, the viewport middle in the
 * element). Clamped to 0..1; the stretch counts as started when it is above 0 (see `scrollStop`). Overlapping or touching parts (gap <= 0) are a step.
 */
export function scrollProgress(fromBottom: number, toTop: number, line: number): number {
  const gap = toTop - fromBottom;
  if (!(gap > 0)) return line >= fromBottom ? 1 : 0;
  return Math.min(1, Math.max(0, (line - fromBottom) / gap));
}
/** A scroll stretch starts when its progress passes 0 (so at progress exactly 0 it has not started and the earlier stop still places the object). */
export const scrollStop = (q: number): number => (q > 0 ? q : IDLE);
/** Reduced motion: every started stop is finished, so only rest states are shown. */
export const settleProgress = (q: number[]): number[] => q.map((x) => (started(x) ? 1 : IDLE));

/** Where the object is, given the progress of every stop (declared order) and the anchor rects. A pure function of its arguments. */
export function chainBoxAt(stops: ChainStop[], q: number[], rects: Rect[]): FlightBox {
  const at = (i: number) => rects[i] ?? zero;
  if (!stops.length) return { visible: false, rect: zero, rot: 0, scale: 1, opacity: 1, restAnchor: null };
  let k = -1;
  for (let i = 0; i < stops.length; i++) if (started(q[i])) k = i;
  if (k < 0) return stops[0].fx === 'pop' ? { visible: false, rect: at(stops[0].anchor), rot: 0, scale: 0, opacity: 0, restAnchor: null } : restBox(at(stops[0].anchor), stops[0].anchor);
  return chainStopBox(stops, q, rects, k);
}

const restBox = (rect: Rect, anchor: number): FlightBox => ({ visible: true, rect, rot: 0, scale: 1, opacity: 1, restAnchor: anchor });

function chainStopBox(stops: ChainStop[], q: number[], rects: Rect[], k: number): FlightBox {
  const s = stops[k], to = rects[s.anchor] ?? zero;
  const x = started(q[k]) && s.fx !== 'cut' ? q[k] : 1; // a stop that never started counts as finished (the object was carried past it)
  if (x >= 1) return restBox(to, s.anchor);
  if (s.fx === 'pop') return { visible: true, rect: to, rot: 0, scale: Math.max(0, outBack(x)), opacity: Math.min(1, x / POP_FADE), restAnchor: null };
  const from = k === 0 ? to : chainStopBox(stops, q, rects, k - 1).rect;
  const moving = { visible: true, scale: 1, opacity: 1, restAnchor: null };
  if (s.fx === 'fall') { const f = fallAt(from, to, x); return { ...moving, rect: f.rect, rot: f.rot }; }
  return { ...moving, rect: lerpRect(from, to, inOut(x)), rot: 0 };
}

/** The visibility a home element, or a `data-flight-stays` descendant of one, should have: `null` = its own (restore), else the inline value. */
export function homeVisibility(role: 'home' | 'stays', objectHere: boolean): 'hidden' | 'visible' | null {
  if (objectHere) return null;
  return role === 'home' ? 'hidden' : 'visible';
}
