import type { Component } from './base.ts';

export type CanvasSize = { w: number; h: number; changed: boolean };
export type Draw = (ctx: CanvasRenderingContext2D, size: CanvasSize, p: number, data: Record<string, any>, vars: Record<string, string>, items: any[], dur: number) => void;

/**
 * Canvas base: mounts a full-cue canvas, sizes its backing store to the cue box × devicePixelRatio,
 * and hands `draw` a context already scaled to CSS pixels. `size.changed` is true on the first draw
 * and after any resize, so geometry built from the size can be rebuilt. Skips frames before layout.
 */
export function canvasComponent(meta: Component['meta'], draw: Draw): Component {
  const last = new WeakMap<Element, string>();
  return {
    meta,
    mount(host) {
      const c = host.ownerDocument.createElement('canvas');
      c.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;display:block');
      host.appendChild(c);
      return c;
    },
    render(node, p, data, vars, items, dur) {
      const c = node as HTMLCanvasElement;
      const w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) return;
      const dpr = globalThis.devicePixelRatio || 1;
      const key = `${w}x${h}@${dpr}`;
      const changed = last.get(c) !== key;
      if (changed) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); last.set(c, key); }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, { w, h, changed }, p, data, vars, items, dur);
    },
  };
}

/** Seeded PRNG (mulberry32): same seed, same sequence. Use instead of Math.random to keep components pure. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
