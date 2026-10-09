import { FONT_FAMILY, INK } from '../theme.ts';
export type Surface = 'web' | 'video';
export type StillFn = (data: Record<string, any>, items: any[], dur: number) => number;

export type Component = {
  /**
   * - `surfaces`: where the component is meant to run. `web`: in-page animation (`<explainer-player play="enter|scrub">` over a
   *   `none` segment). `video`: overlay cues on video/audio segments, and the offline render. Required, so every pack declares it.
   * - `still`: the progress p at which the component shows its complete state (default 1). That frame is what print and
   *   `prefers-reduced-motion` show, and `test/still.test.ts` checks it: all text fully opaque and displayed. Set it when
   *   p=1 is not complete, e.g. a variant that fades out at the end. The function form receives `data` (carrying `variant`),
   *   `items` and the cue length `dur`, because the right p can depend on all three. Read it with `stillP()`.
   */
  meta: { renders: string; name: string; variants: string[]; surfaces: Surface[]; still?: number | StillFn };
  mount(host: Element, data: Record<string, any>): HTMLElement | SVGElement;
  /**
   * Pure: output depends only on these arguments. `dur` is the cue's length in seconds (end - start).
   * There are no enter/exit hooks and no state may carry between calls: the player can render any p in any order.
   */
  render(node: HTMLElement | SVGElement, p: number, data: Record<string, any>, vars: Record<string, string>, items: any[], dur: number): void;
};

const reg = new Map<string, Component>();
const registerListeners = new Set<() => void>();
export function registerComponents(pack: Component[]) {
  for (const c of pack) {
    if (reg.has(c.meta.renders)) throw new Error(`duplicate component for ${c.meta.renders}`);
    reg.set(c.meta.renders, c);
  }
  registerListeners.forEach((f) => f());
}
/** Call `fn` after every `registerComponents`, e.g. so an element whose component is not there yet can retry. Returns unsubscribe. */
export const onRegister = (fn: () => void) => { registerListeners.add(fn); return () => { registerListeners.delete(fn); }; };
export const lookup = (renders: string) => reg.get(renders);
export const registered = () => [...reg.values()];

/** The progress p (clamped to 0..1) at which `comp` shows its complete state for this cue; see `Component.meta.still`. */
export function stillP(comp: Pick<Component, 'meta'>, data: Record<string, any>, items: any[], dur: number): number {
  const s = comp.meta.still;
  const p = typeof s === 'function' ? s(data, items, dur) : s ?? 1;
  return Math.min(1, Math.max(0, Number.isFinite(p) ? p : 1));
}

/** Shared inline-style helpers (theme via CSS custom properties, see `src/theme.ts`). */
export const FONT = `font-family:${FONT_FAMILY};color:${INK}`;
export { fade } from '../motion.ts';
