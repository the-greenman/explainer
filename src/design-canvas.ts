// Pure: the design canvas of a player. The `canvas` attribute is a list such as "1280x720 720x900@<600": each entry a size in CSS px,
// optionally with `@<N` ("use when the player is narrower than N px"). No DOM.
export type CanvasSpec = { w: number; h: number; below?: number };

/** Parse the attribute. Entries are separated by whitespace or commas; malformed entries are skipped. */
export function parseCanvas(attr: string | null | undefined): CanvasSpec[] {
  const out: CanvasSpec[] = [];
  for (const tok of (attr ?? '').split(/[\s,]+/)) {
    const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?:@<(\d+(?:\.\d+)?))?$/i.exec(tok);
    if (!m) continue;
    const w = Number(m[1]), h = Number(m[2]);
    if (!(w > 0 && h > 0)) continue;
    out.push(m[3] === undefined ? { w, h } : { w, h, below: Number(m[3]) });
  }
  return out;
}

/**
 * The canvas for a player `width` px wide: the first conditioned entry whose condition holds; otherwise the fallback, the first
 * entry with no condition; otherwise (every condition fails and there is no fallback) the last entry. `undefined` for an empty list.
 */
export function chooseCanvas(specs: CanvasSpec[], width: number): CanvasSpec | undefined {
  return specs.find((s) => s.below !== undefined && width < s.below) ?? specs.find((s) => s.below === undefined) ?? specs[specs.length - 1];
}

export const canvasId = (s: CanvasSpec) => `${s.w}x${s.h}`;
