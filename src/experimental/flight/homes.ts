// Pure: the rules for the real page elements (homes) while the object is away, and the document-space fallback of measured rects.
import type { Rect } from './types.ts';

/** The visibility a home element, or a `data-flight-stays` descendant of one, should have: `null` = its own (restore), else the inline value. */
export function homeVisibility(role: 'home' | 'stays', objectHere: boolean): 'hidden' | 'visible' | null {
  if (objectHere) return null;
  return role === 'home' ? 'hidden' : 'visible';
}

/**
 * Fallback rects (an anchor that is not shown has no box) are kept in document coordinates: a viewport rect saved at one scroll
 * position is wrong after scrolling.
 */
export const toDocRect = (r: Rect, scrollX: number, scrollY: number): Rect => ({ x: r.x + scrollX, y: r.y + scrollY, w: r.w, h: r.h });
export const fromDocRect = (r: Rect, scrollX: number, scrollY: number): Rect => ({ x: r.x - scrollX, y: r.y - scrollY, w: r.w, h: r.h });
