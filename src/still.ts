// Pure: the still time of a segment, the t at which print and reduced motion show it. No DOM.
import type { Cue, Segment } from './clock.ts';
import { stillP, type Component } from './components/base.ts';

/**
 * The still time of `seg` in seconds within the segment:
 * - `seg.still` if the manifest gives one, else
 * - the max over the segment's cues of `cue.start + stillP * (cue.end - cue.start)`, i.e. when the last cue is complete.
 *   Hold cues (choices) are left out because they sit at the very end and would hide the rest; they count only
 *   if the segment has no other cue. Cues of unregistered components are skipped. No cues: 0.
 * Always clamped to 0..segment length.
 */
export function stillTime(seg: Segment, cues: Cue[], resolve: (renders: string) => Pick<Component, 'meta'> | undefined): number {
  const length = seg.out - (seg.in ?? 0);
  const clamp = (t: number) => Math.min(length, Math.max(0, t));
  if (typeof seg.still === 'number') return clamp(seg.still);
  const mine = cues.filter((c) => c.segment === seg.id);
  const pick = mine.some((c) => !c.hold) ? mine.filter((c) => !c.hold) : mine;
  let t = 0;
  for (const c of pick) {
    const comp = resolve(c.renders);
    if (!comp) continue;
    const p = stillP(comp, { variant: c.variant, ...c.data }, c.items ?? [], c.end - c.start);
    t = Math.max(t, c.start + p * (c.end - c.start));
  }
  return clamp(t);
}
