// Pure caption lookup (no DOM): the strip for audio segments reads the active cue by time, never from `cuechange`,
// so it is right in reverse and when scrubbing.
export type TimedText = { startTime: number; endTime: number; text: string };

/**
 * Text of the cue active at `t` (start <= t < end), or ''. `cues` must be sorted by start (as a parsed track's are).
 * Binary search for the last cue starting at or before `t`, then a short walk back in case an earlier, longer cue still covers `t`.
 */
export function cueTextAt(cues: ArrayLike<TimedText> | null | undefined, t: number): string {
  if (!cues || !cues.length) return '';
  let lo = 0, hi = cues.length - 1, i = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].startTime <= t) { i = mid; lo = mid + 1; } else hi = mid - 1;
  }
  for (let k = i, n = 0; k >= 0 && n < 4; k--, n++) if (t < cues[k].endTime) return cues[k].text;
  return '';
}
