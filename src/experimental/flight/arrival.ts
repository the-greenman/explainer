// Pure: which anchor the object rests at and which one it is approaching, from the chain. The flight element marks the page with it
// (`data-flight-here`, `--flight-p`) and so does the in-scene marker (`data-marker-here`, `--marker-p`): the site's CSS does the highlight.
import { started, type ChainStop, type FlightBox } from './types.ts';

/** `here`: the anchor index the object rests at (else null). `target`: the anchor it rests at or is moving toward (else null), with arrival progress `p` (1 at rest). */
export type Arrival = { here: number | null; target: number | null; p: number };

const NONE: Arrival = { here: null, target: null, p: 0 };

/** `box` is `chainBoxAt(stops, q, rects)`; `q` the same progress list. Before any stop has started an `enter` first stop has no object: nothing. */
export function arrivalOf(stops: ChainStop[], q: number[], box: FlightBox): Arrival {
  if (box.restAnchor != null) return { here: box.restAnchor, target: box.restAnchor, p: 1 };
  let k = -1;
  for (let i = 0; i < stops.length; i++) if (started(q[i])) k = i;
  if (k < 0 || !box.visible) return NONE;
  return { here: null, target: stops[k].anchor, p: Math.min(1, Math.max(0, q[k])) };
}
