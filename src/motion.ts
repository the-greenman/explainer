/**
 * Motion tokens. A pure `render` cannot read CSS, so motion is code: named curves and constants that components
 * import. Nothing here has state. All curves map [0,1] to [0,1].
 */
import { ramp } from './clock.ts';

export { ramp };

export type Easing = (x: number) => number;

/** Identity. This is what `ramp` already is, so every current fade is linear. */
export const linear: Easing = (x) => x;
/** Decelerating (ease-out cubic): fast start, soft landing. For entrances. */
export const out: Easing = (x) => 1 - (1 - x) ** 3;
/** Ease-in-out cubic. For moves between two resting places. */
export const inOut: Easing = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);

/** Default rise of a fading-in element, in px: it starts this far below its place. */
export const FADE_OFFSET = 12;
/** Rise for a card that fades in and out as a whole (lower third). */
export const FADE_OFFSET_CARD = 10;
/** Rise for a list item. */
export const FADE_OFFSET_ITEM = 8;
/** Seconds a side panel takes to fade out at the end of its cue. */
export const PANEL_OUT_S = 0.4;
/** Seconds a list item takes to fade in. */
export const ITEM_FADE_S = 0.4;

/** Inline style for an element at fade progress `o` (0..1): opacity and a rise of `dy` px. */
export const fade = (o: number, dy = FADE_OFFSET) => `opacity:${o.toFixed(3)};transform:translateY(${((1 - o) * dy).toFixed(2)}px)`;
