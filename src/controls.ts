// Pure helpers of the control API (state, readouts, scrubbing). No DOM. See README "Controls".
import { clamp01 } from './clock.ts';

export type PlayState = 'poster' | 'playing' | 'paused' | 'ended' | 'holding';

/** The `data-state` of a player: poster (never started), holding (a choice is held), playing, ended (stopped at the end of a segment), else paused. */
export function playState(s: { started: boolean; playing: boolean; holding: boolean; t: number; length: number }): PlayState {
  if (s.holding) return 'holding';
  if (s.playing) return 'playing';
  if (!s.started) return 'poster';
  return s.length > 0 && s.t >= s.length - 1e-3 ? 'ended' : 'paused';
}

/** `--explainer-progress`: t over the segment length, 0..1, rounded to 4 decimals. */
export const progressOf = (t: number, length: number) => (length > 0 ? Math.round(clamp01(t / length) * 10000) / 10000 : 0);

/** m:ss (whole seconds, rounded down; `ceil` rounds up, for a time remaining). */
export function formatTime(seconds: number, ceil = false): string {
  const s = Math.max(0, Math.floor(ceil ? Math.ceil(seconds - 1e-9) : seconds + 1e-9));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export type Display = 'time' | 'duration' | 'remaining';
/** The text of a `data-explainer-display` readout. Unknown kinds give null (left alone). */
export function displayText(kind: string, t: number, length: number): string | null {
  if (kind === 'time') return formatTime(t);
  if (kind === 'duration') return formatTime(length);
  if (kind === 'remaining') return formatTime(length - t, true);
  return null;
}

/** Pointer x across an element of width `width` starting at `left` -> fraction 0..1. */
export const pointerFraction = (clientX: number, left: number, width: number) => (width > 0 ? clamp01((clientX - left) / width) : 0);

export const SCRUB_STEP_S = 5;
/** A key on a scrub slider: `{by}` seconds from now, `{f}` an absolute fraction, or null when the key is not for it. */
export function scrubKey(key: string): { by: number } | { f: number } | null {
  switch (key) {
    case 'ArrowRight': case 'ArrowUp': return { by: SCRUB_STEP_S };
    case 'ArrowLeft': case 'ArrowDown': return { by: -SCRUB_STEP_S };
    case 'Home': return { f: 0 };
    case 'End': return { f: 1 };
    default: return null;
  }
}
