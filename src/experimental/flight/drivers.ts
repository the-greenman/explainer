// Pure: the progress of a stop from its driver. A stop is driven by a player's clock or by a scroll stretch.
import { IDLE, started } from './types.ts';

/** Progress of a player stop: IDLE while the player is in another segment or before `at`; otherwise (T - at) / len (1 when len is 0 or the effect is instant). */
export function playerProgress(s: { segment: string; at: number; len: number; instant?: boolean }, segmentId: string, T: number): number {
  if (s.segment !== segmentId || T < s.at) return IDLE;
  return s.len > 0 && !s.instant ? Math.min(1, (T - s.at) / s.len) : 1;
}

/**
 * What the element knows about a player when it decides whether the player has really reached a stop.
 * `state` is the player's `data-state`; `playMode` its `play` attribute; `top` its viewport top edge.
 */
export type PlayerView = { state: string | null; playMode: string | null; top: number };

/**
 * Whether the reader has reached this player, for the progress `q` that its clock reports.
 * - `poster`: the player has not started (first paint at the poster time); its clock says nothing about the reader's journey: IDLE.
 * - reduced motion with `play="enter|scrub"`: the player does not animate but sits at its still time (often the END of its segment),
 *   so every stop of that segment reads as started at load. The reader's journey is the page scroll instead: the player counts only
 *   once its top edge has reached the viewport line (the middle, the same line as scroll stops). Scrolling back above it un-starts it.
 * Otherwise `q` is returned unchanged.
 */
export function gatePlayerProgress(q: number, view: PlayerView, reduced: boolean, line: number): number {
  if (!started(q)) return IDLE;
  if (view.state === 'poster') return IDLE;
  if (reduced && (view.playMode === 'enter' || view.playMode === 'scrub') && !(view.top <= line)) return IDLE;
  return q;
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

/**
 * A trigger stop's own small clock: the last switch (`dir` 1 on / -1 off), when it happened (`since`, the caller's clock in seconds)
 * and the progress it started from. `null` = never triggered = IDLE.
 */
export type Latch = { dir: 1 | -1; since: number; from: number };

/** Progress of a trigger stop at `now`: from + dir * (now - since) / len, clamped to 0..1. `len` <= 0 is a step (on = 1, off = IDLE). Off and back at 0 is IDLE; on at exactly 0 has started. */
export function latchProgress(l: Latch | null, now: number, len: number): number {
  if (!l) return IDLE;
  if (!(len > 0)) return l.dir === 1 ? 1 : IDLE;
  const v = Math.min(1, Math.max(0, l.from + (l.dir * (now - l.since)) / len));
  return l.dir === -1 && v <= 0 ? IDLE : v;
}

/** Switch a latch on or off at `now`: the new one starts from the current progress, so a reversal halfway is continuous. The same direction returns `l` itself. */
export function latchSet(l: Latch | null, on: boolean, now: number, len: number): Latch {
  const dir = on ? 1 : -1;
  if (l && l.dir === dir) return l;
  const p = latchProgress(l, now, len);
  return { dir, since: now, from: started(p) ? p : 0 };
}
