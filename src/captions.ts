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

/**
 * What the `captions` attribute of the player means, given whether a design canvas is in use and whether some scene has a media slot.
 * A space-separated list of tokens (an unknown token is ignored):
 * - `off`: the strip is hidden (the toggle writes this token and keeps the others);
 * - `strip`: every segment kind with captions uses the strip, video included (the native track stays loaded, mode `hidden`);
 * - `native`: video keeps the browser's own cue display; audio still uses the strip (an `<audio>` has none);
 * - `below` / `over`: the strip lies under the stage (two lines reserved) or over it, at the bottom.
 * With a canvas whose scenes carry a media slot, `strip` and `below` are the defaults (`native` and `over` opt out). Without a canvas
 * nothing changes: the strip is for audio, over the stage, unless `below` is given.
 */
export type CaptionConfig = { on: boolean; /** video uses the strip too */ video: boolean; below: boolean };
export function captionConfig(attr: string | null | undefined, canvas: boolean, slots: boolean): CaptionConfig {
  const t = new Set((attr ?? '').toLowerCase().split(/\s+/).filter(Boolean));
  const video = !t.has('native') && (t.has('strip') || (canvas && slots));
  return { on: !t.has('off'), video, below: t.has('below') || (!t.has('over') && canvas && video) };
}

/** The attribute with the `off` token set or cleared, other tokens kept; null when nothing is left (the attribute is then removed). */
export function withCaptionsOn(attr: string | null | undefined, on: boolean): string | null {
  const t = (attr ?? '').split(/\s+/).filter((x) => x && x.toLowerCase() !== 'off');
  if (!on) t.push('off');
  return t.length ? t.join(' ') : null;
}

const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&lrm;': '‎', '&rlm;': '‏' };
/** Cue text for display as plain text: WebVTT tags (`<i>`, `<v Name>`, `<00:01.000>`) dropped, the few cue entities decoded, line breaks kept. */
export function plainCue(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|nbsp|lrm|rlm);/g, (e) => ENT[e]);
}
