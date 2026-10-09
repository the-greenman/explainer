// Pure: where the media box is at segment time T, given the scenes' media slots. No DOM; the player measures the slot rects.
import { inOut } from './motion.ts';

export type Rect = { x: number; y: number; w: number; h: number };
export type Fit = 'cover' | 'contain';
/** One `data-media-slot` of a scene: `at`/`len` in seconds from the scene cue start, `rect` in canvas px. */
export type SlotDef = { at: number; len: number; fit: Fit; rect: Rect };
/** One scene cue: its span in the segment, and its slots in document order. */
export type SceneSlots = { start: number; end: number; slots: SlotDef[] };
/** `hidden`: no slot is active (the media is invisible, audio plays on). `rect`: the media box. */
export type MediaBox = { hidden: true } | { hidden: false; rect: Rect; fit: Fit };

const EPS = 1e-6;
export const SLOT_DEFAULT_FIT: Fit = 'cover';

export const lerpRect = (a: Rect, b: Rect, x: number): Rect => ({
  x: a.x + (b.x - a.x) * x, y: a.y + (b.y - a.y) * x, w: a.w + (b.w - a.w) * x, h: a.h + (b.h - a.h) * x,
});

const num = (s: string | null | undefined, d: number) => { const n = s == null || s.trim() === '' ? NaN : Number(s); return Number.isFinite(n) ? n : d; };
/** Timing and fit of a `data-media-slot` element from its attributes: `at` and `for` default to 0, fit to cover. */
export function parseSlot(attr: (name: string) => string | null): Pick<SlotDef, 'at' | 'len' | 'fit'> {
  return { at: Math.max(0, num(attr('data-at'), 0)), len: Math.max(0, num(attr('data-for'), 0)), fit: attr('data-media-fit') === 'contain' ? 'contain' : SLOT_DEFAULT_FIT };
}

type Active = { abs: number; slot: SlotDef } | 'none' | 'empty';

/**
 * The active slot at `T` among the scenes `visible(i, T)` says are shown: of all their slots whose activation time
 * (scene start + at) is <= T, the one with the greatest (ties: the later scene, then the later in the document).
 * 'empty': no scene is visible at all. 'none': scenes are visible but none has an active slot.
 */
function activeAt(scenes: SceneSlots[], visible: (i: number, T: number) => boolean, T: number): Active {
  let any = false;
  let best: { abs: number; slot: SlotDef } | null = null;
  for (let i = 0; i < scenes.length; i++) {
    if (!visible(i, T)) continue;
    any = true;
    for (const slot of scenes[i].slots) {
      const abs = scenes[i].start + slot.at;
      if (abs <= T && (!best || abs >= best.abs)) best = { abs, slot };
    }
  }
  return !any ? 'empty' : best ?? 'none';
}

/**
 * The media box at segment time `T`. A pure function of `T`, the scenes and the canvas size, so any path to `T` gives the same box.
 * - the active slot's rect; when it has just activated and has a length, the rect moves from where the media was just before
 *   (recursively, so an interrupted move stays continuous) with an ease-in-out over the slot's `len`;
 * - from a hidden media, or at segment time 0, the move is a cut;
 * - no scene visible at all: the media fills the canvas (`contain`); scenes visible but no active slot: hidden.
 * `visible(i, T)` says whether scene i is shown at T (the player passes its own cue test, so both agree).
 */
export function mediaBoxAt(scenes: SceneSlots[], visible: (i: number, T: number) => boolean, canvas: Rect, T: number): MediaBox {
  const a = activeAt(scenes, visible, T);
  if (a === 'empty') return { hidden: false, rect: canvas, fit: 'contain' };
  if (a === 'none') return { hidden: true };
  const { abs, slot } = a;
  if (slot.len > 0 && T < abs + slot.len && abs > 0) {
    const from = mediaBoxAt(scenes, visible, canvas, abs - EPS);
    if (!from.hidden) return { hidden: false, rect: lerpRect(from.rect, slot.rect, inOut(Math.max(0, (T - abs) / slot.len))), fit: slot.fit };
  }
  return { hidden: false, rect: slot.rect, fit: slot.fit };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** Inline style for a box, in canvas px (position, size, fit, and opacity only when hidden). Rounded so an unchanged box gives an equal string. */
export function boxStyle(b: MediaBox): string {
  const pos = 'position:absolute;';
  if (b.hidden) return pos + 'left:0;top:0;width:100%;height:100%;opacity:0';
  const { x, y, w, h } = b.rect;
  return `${pos}left:${r3(x)}px;top:${r3(y)}px;width:${r3(w)}px;height:${r3(h)}px;object-fit:${b.fit}`;
}

// ---- offline render with slots (see README "Rendering"): the hole in the under layer, and the per-frame placement list ----

/**
 * `clip-path` for the under layer so that it is transparent exactly inside `rect` (canvas px, layer `w` x `h`): an even-odd polygon,
 * the layer's outline and then the rect's (the connecting edge is walked twice and cancels). Footage placed under the overlay shows through.
 * A rect that covers the layer gives `inset(100%)` (everything is hole); the part of a rect outside the layer is ignored,
 * and a rect with nothing on the layer gives `none` (no hole).
 */
export function holePolygon(rect: Rect, w: number, h: number): string {
  const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y), x1 = Math.min(w, rect.x + rect.w), y1 = Math.min(h, rect.y + rect.h);
  if (!(x1 > x0 && y1 > y0)) return 'none';
  if (x0 <= 0 && y0 <= 0 && x1 >= w && y1 >= h) return 'inset(100%)';
  const p = (x: number, y: number) => `${r3(x)}px ${r3(y)}px`;
  return `polygon(evenodd, ${p(0, 0)}, ${p(w, 0)}, ${p(w, h)}, ${p(0, h)}, ${p(0, 0)}, ${p(x0, y0)}, ${p(x0, y1)}, ${p(x1, y1)}, ${p(x1, y0)}, ${p(x0, y0)})`;
}

/** One output frame's media placement in output px: `n` is the 0-based frame number (output time n / fps). `opacity` is 0 when no media is shown. */
export type MediaFrame = { n: number; x: number; y: number; w: number; h: number; opacity: 0 | 1; fit: Fit };
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The media box in output px, for a canvas of `canvas.w` x `canvas.h` rendered at `out.w` x `out.h`.
 * `null` (no video in this frame) and `{hidden}` both give opacity 0 with the full frame as the rect.
 */
export function mediaFrame(n: number, box: MediaBox | null, canvas: { w: number; h: number }, out: { w: number; h: number }): MediaFrame {
  if (!box || box.hidden) return { n, x: 0, y: 0, w: out.w, h: out.h, opacity: 0, fit: 'contain' };
  const sx = out.w / canvas.w, sy = out.h / canvas.h, r = box.rect;
  return { n, x: r2(r.x * sx), y: r2(r.y * sy), w: r2(r.w * sx), h: r2(r.h * sy), opacity: 1, fit: box.fit };
}

/** Keyframe form: only the frames whose placement differs from the frame before (the first is always one); values hold until the next key. */
export function mediaKeyframes(frames: MediaFrame[]): MediaFrame[] {
  const same = (a: MediaFrame, b: MediaFrame) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.opacity === b.opacity && a.fit === b.fit;
  return frames.filter((f, i) => i === 0 || !same(f, frames[i - 1]));
}
