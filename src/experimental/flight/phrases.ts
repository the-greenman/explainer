// Pure, no DOM: the times at which phrases of the narration start, read from its captions (WebVTT). Importable in node.
// Use it at BUILD time (Astro, node) to compute `data-marker-at` from the narration text instead of typing numbers.
import { parseVtt } from '../../render-plan.ts';

export type PhraseOptions = {
  /** Seconds added to every time. Pass `-cueStart` to get times from the scene cue start (the convention of `data-at`). Default 0. */
  offset?: number;
};

const norm = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * For each string of `matches`, the start (seconds) of the first cue whose text contains it (case-insensitive, whitespace and line
 * breaks normalised, cue tags removed), searching only the cues AFTER the cue of the previous match. So the phrases are in narration
 * order and each lands in a cue of its own. Throws, naming the phrase, when there is none.
 */
export function phraseTimes(vttText: string, matches: string[], opts: PhraseOptions = {}): number[] {
  const cues = parseVtt(vttText).map((c) => ({ start: c.start, text: norm(c.text) }));
  const offset = opts.offset ?? 0;
  const out: number[] = [];
  let from = 0;
  matches.forEach((m, n) => {
    const want = norm(m);
    const i = want ? cues.findIndex((c, j) => j >= from && c.text.includes(want)) : -1;
    if (i < 0) {
      const where = from > 0 ? ` after the cue at ${cues[from - 1].start}s` : '';
      throw new Error(`phraseTimes: phrase ${n + 1} "${m}" is not in any cue${where} (${cues.length} cues)`);
    }
    out.push(Math.round((cues[i].start + offset) * 1000) / 1000);
    from = i + 1;
  });
  return out;
}
