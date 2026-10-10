// Shared types of the flight module. Pure: no DOM.
import type { Rect } from '../../media-slots.ts';

export type { Rect };

/** Where the object is drawn: a box (viewport px, whatever space the caller measures in) plus a transform about its centre. */
export type Pose = { rect: Rect; rot: number; scale: number; opacity: number };

/**
 * One way of getting from one anchor to the next. Add one with `registerFlightEffects` (see `effect.ts`).
 * The contract is checked for every registered effect by `test/flight-effects.test.ts`.
 */
export type FlightEffect = {
  /** The name a stop uses in its `fx`. */
  name: string;
  /**
   * 'move': goes from the previous pose to the stop's anchor; `at(from, to, 0)` is `from` (rot 0, scale 1, opacity 1).
   * 'enter': appears at the anchor from nothing (pop); `from` is ignored, `at(.., 0)` has scale or opacity 0, and the object is
   * absent before it when it is the first stop.
   */
  kind: 'move' | 'enter';
  /** The stop is finished the moment it starts (a jump): the chain never calls `at`. Exempt from the continuity test at p -> 1. */
  instant?: boolean;
  /** Pose at progress p in [0,1). Pure: depends only on its arguments, never mutates them. p >= 1 is handled by the chain (rest at `to`). */
  at(from: Rect, to: Rect, p: number): Pose;
};

/** A stop as the chain sees it: the anchor (an index into the rects) and the effect's name. */
export type ChainStop = { anchor: number; fx: string };

export type FlightBox = { visible: boolean; rect: Rect; rot: number; scale: number; opacity: number; restAnchor: number | null };

/** Progress of a stop that has not started. Never a literal -Infinity elsewhere. */
export const IDLE = Number.NEGATIVE_INFINITY;
export const started = (q: number | undefined): q is number => q !== undefined && q >= 0;
