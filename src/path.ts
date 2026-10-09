// Pure: the path taken, unrolled from history. No DOM. The segment graph loops back, so it is never drawn;
// spans and choices are listed in the order they were watched.
import { routeSpans, type Cue, type Entry, type Manifest, type Pos } from './clock.ts';

export type PathOption = { id: string; label: string; taken: boolean; auto?: true };
export type SpanStep = { kind: 'span'; segment: string; from: number; to: number; label: string; depth: number; current: boolean };
export type ChoiceStep = { kind: 'choice'; cue: string; label: string; depth: number; options: PathOption[]; current: boolean };
export type PathStep = SpanStep | ChoiceStep;

/** m:ss, segment-relative */
export const fmtTime = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * `depth` is the history length to unwind to (clock.rewindTo(depth, kind === 'choice')).
 * A span that started at a branch landing takes the marker label if one sits there; otherwise the segment `title`, otherwise its id.
 * The last span ends at `pos`; a held choice follows it as the current step.
 */
export function pathSteps(manifest: Manifest, history: Entry[], pos: Pos, holding: Cue | null): PathStep[] {
  const segLabel = (id: string) => manifest.segments.find((s) => s.id === id)?.title ?? id;
  const spanLabel = (segment: string, from: number, branched: boolean) =>
    (branched && manifest.markers?.find((m) => m.segment === segment && m.t === from)?.label) || segLabel(segment);

  const steps: PathStep[] = [];
  routeSpans(manifest, history, pos).forEach((sp) => {
    const last = sp.depth === history.length;
    steps.push({ kind: 'span', segment: sp.segment, from: sp.from, to: sp.to, label: spanLabel(sp.segment, sp.from, sp.branched), depth: sp.depth, current: last && !holding });
    const e = history[sp.depth];
    if (!last && e.hold) {
      const cue = manifest.cues.find((c) => c.id === e.hold);
      steps.push({ kind: 'choice', cue: e.hold, label: choiceLabel(cue, e.hold), depth: sp.depth, options: optionsOf(cue, e.option, e.auto), current: false });
    }
  });
  if (holding) {
    steps.push({ kind: 'choice', cue: holding.id, label: choiceLabel(holding, holding.id), depth: history.length, options: optionsOf(holding), current: true });
  }
  return steps;
}

const choiceLabel = (cue: Cue | undefined, fallback: string) => (typeof cue?.data?.prompt === 'string' && cue.data.prompt) || fallback;
const optionsOf = (cue: Cue | undefined, taken?: string, auto?: boolean): PathOption[] =>
  (cue?.items ?? []).map((o) => ({ id: o.id, label: o.label ?? o.id, taken: o.id === taken, ...(auto && o.id === taken ? { auto: true as const } : {}) }));
