import type { FlightEffect } from '../types.ts';

// scale 0 -> 1 with an overshoot (ease-out-back), opacity in over the first POP_FADE of p
export const POP_OVERSHOOT = 1.9;
export const POP_FADE = 1 / 3;

const outBack = (x: number) => { const c1 = POP_OVERSHOOT, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; };

/** Appears at its anchor. */
export const pop: FlightEffect = {
  name: 'pop', kind: 'enter',
  at: (_from, to, p) => ({ rect: { ...to }, rot: 0, scale: Math.max(0, outBack(p)), opacity: Math.min(1, p / POP_FADE) }),
};
