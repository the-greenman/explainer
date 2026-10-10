import { inOut } from '../../../motion.ts';
import { lerpRect } from '../../../media-slots.ts';
import type { FlightEffect, Rect } from '../types.ts';

// A ball's hop: the path is a parabola over the straight line between the anchors, travelled with an ease in and out.
/** Lift of the arc above the straighter route, in px: HOP_LIFT_RATIO of the horizontal plus vertical distance, kept between the two limits. */
export const HOP_LIFT_RATIO = 0.35;
export const HOP_LIFT_MIN = 24;
export const HOP_LIFT_MAX = 140;
/** The squash on landing: over the last HOP_LAND of p the scale dips by HOP_SQUASH and returns to 1. */
export const HOP_LAND = 0.15;
export const HOP_SQUASH = 0.14;

/** The lift for a hop of (dx, dy): HOP_LIFT_RATIO * (|dx| + |dy|) between HOP_LIFT_MIN and HOP_LIFT_MAX. */
export const hopLift = (dx: number, dy: number) => Math.min(HOP_LIFT_MAX, Math.max(HOP_LIFT_MIN, HOP_LIFT_RATIO * (Math.abs(dx) + Math.abs(dy))));

/**
 * Arc from `from` to `to`. With u the eased progress, y = linear(u) - 4 u (1 - u) (lift + |dy| / 2): the extra |dy| / 2 keeps the apex
 * above BOTH endpoints however steep the hop (a bare lift would let a long drop never rise). Squashes a little on landing, ending at scale 1.
 */
export const hop: FlightEffect = {
  name: 'hop', kind: 'move',
  at(a: Rect, b: Rect, p: number) {
    const u = inOut(p), dy = b.y - a.y;
    const rect = lerpRect(a, b, u);
    rect.y -= 4 * u * (1 - u) * (hopLift(b.x - a.x, dy) + Math.abs(dy) / 2);
    const q = (p - (1 - HOP_LAND)) / HOP_LAND;
    const scale = q > 0 ? 1 - HOP_SQUASH * Math.sin(Math.PI * q) : 1;
    return { rect, rot: 0, scale, opacity: 1 };
  },
};
