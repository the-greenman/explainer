import { inOut } from '../../../motion.ts';
import { lerpRect } from '../../../media-slots.ts';
import type { FlightEffect, Rect } from '../types.ts';

// Gravity. The fall itself takes FALL_SPLIT of p; the rest is a damped bounce below the landing line.
export const FALL_SPLIT = 0.82;
export const FALL_BOUNCE_PX = 10;
export const FALL_WOBBLE_DEG = 9;

/** x eases sideways, y accelerates (u squared), a wobble while falling, then a damped dip below the landing line. Ends at `to` with rot 0. */
export const fall: FlightEffect = {
  name: 'fall', kind: 'move',
  at(a: Rect, b: Rect, p: number) {
    const u = Math.min(1, p / FALL_SPLIT);
    const rect = lerpRect(a, b, inOut(u)); // gentle sideways ease
    rect.y = a.y + (b.y - a.y) * u * u; // gravity: y accelerates
    let rot = FALL_WOBBLE_DEG * Math.sin(2 * Math.PI * u) * (1 - u) * (b.x >= a.x ? 1 : -1);
    if (p > FALL_SPLIT) {
      const q = (p - FALL_SPLIT) / (1 - FALL_SPLIT);
      rect.y += FALL_BOUNCE_PX * Math.sin(2 * Math.PI * q) * (1 - q); // dips below the landing line, comes back, settles
      rot = 0;
    }
    return { rect, rot: rot + 0, scale: 1, opacity: 1 }; // + 0: never -0
  },
};
