import { FONT_FAMILY, INK } from '../theme.ts';

export type Component = {
  meta: { renders: string; name: string; variants: string[] };
  mount(host: Element, data: Record<string, any>): HTMLElement | SVGElement;
  /**
   * Pure: output depends only on these arguments. `dur` is the cue's length in seconds (end - start).
   * There are no enter/exit hooks and no state may carry between calls: the player can render any p in any order.
   */
  render(node: HTMLElement | SVGElement, p: number, data: Record<string, any>, vars: Record<string, string>, items: any[], dur: number): void;
};

const reg = new Map<string, Component>();
export function registerComponents(pack: Component[]) {
  for (const c of pack) {
    if (reg.has(c.meta.renders)) throw new Error(`duplicate component for ${c.meta.renders}`);
    reg.set(c.meta.renders, c);
  }
}
export const lookup = (renders: string) => reg.get(renders);

/** Shared inline-style helpers (theme via CSS custom properties, see `src/theme.ts`). */
export const FONT = `font-family:${FONT_FAMILY};color:${INK}`;
export { fade } from '../motion.ts';
