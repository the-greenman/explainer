import { inOut } from '../../../motion.ts';
import { lerpRect } from '../../../media-slots.ts';
import type { FlightEffect } from '../types.ts';

/** Ease-in-out straight line. */
export const glide: FlightEffect = {
  name: 'glide', kind: 'move',
  at: (from, to, p) => ({ rect: lerpRect(from, to, inOut(p)), rot: 0, scale: 1, opacity: 1 }),
};
