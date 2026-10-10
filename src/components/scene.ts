import { clamp01, ramp } from '../clock.ts';
import { parseSlot, type SlotDef } from '../media-slots.ts';
import { FADE_OFFSET } from '../motion.ts';
import type { Component } from './base.ts';

/**
 * `com.semanticops.explainer/scene@1`: the site's own server-rendered markup, placed in the player and revealed by motion.
 * The engine never builds or restyles brand markup. See README "Scenes".
 *
 * The markup is a `<template data-scene="<id>">` (inside the player, else anywhere in the document). Any element in it may carry
 * `data-at` (seconds from the cue start), `data-for` (seconds, default 0.5) and `data-fx`. Every render sets the inline custom
 * property `--fx-p` = clamp01((t - at) / for) on such an element, and the built-in effects set a few more properties from it.
 * Any other `data-fx` name sets only `--fx-p`, for the site's CSS to use. Elements without `data-at` are untouched.
 */
export const SCENE_FX_DEFAULT_FOR = 0.5;
export const SCENE_FADE_S = 0.4;
export const SCENE_FX = ['fade', 'rise', 'write', 'wipe', 'words', 'none'];
export const SCENE_TRANSITIONS = ['cut', 'fade', 'wipe', 'wipe-left'];

export type Choreo = { el: HTMLElement; at: number; len: number; fx: string };
type Transition = 'cut' | 'fade' | 'wipe' | 'wipe-left';

const num = (s: string | null | undefined, d: number) => { const n = s == null || s.trim() === '' ? NaN : Number(s); return Number.isFinite(n) ? n : d; };
const quote = (s: string) => `"${s.replace(/["\\]/g, '\\$&')}"`;

/** The elements of `root` that carry choreography, with their parsed timing. Derived from the markup only. */
export function choreoOf(root: ParentNode): Choreo[] {
  return Array.from(root.querySelectorAll('[data-at]') as ArrayLike<HTMLElement>).map((el) => ({
    el,
    at: Math.max(0, num(el.getAttribute('data-at'), 0)),
    len: Math.max(0, num(el.getAttribute('data-for'), SCENE_FX_DEFAULT_FOR)),
    fx: el.getAttribute('data-fx') ?? 'none',
  }));
}

/** The progress (0..1) of one choreographed element at scene time `t` seconds. */
export const fxProgress = (at: number, len: number, t: number) => (len > 0 ? clamp01((t - at) / len) : t >= at ? 1 : 0);

/** A media slot element of a scene with its parsed timing; `rect` is filled by the player (measuring is the only DOM part). */
export type SlotEl = Omit<SlotDef, 'rect'> & { el: HTMLElement };
/** The `data-media-slot` elements of `root`, in document order. See README "Media slots". */
export function slotsOf(root: ParentNode): SlotEl[] {
  return Array.from(root.querySelectorAll('[data-media-slot]') as ArrayLike<HTMLElement>).map((el) => ({ el, ...parseSlot((n) => el.getAttribute(n)) }));
}

const pct = (x: number) => `${Math.round((1 - x) * 100000) / 1000}%`;

/**
 * `data-fx="words"`: wraps the words of the element's text nodes in `<span data-w>` (once, at mount, from the template alone, so
 * everything after is still a function of p). Returns the spans in document order, which is reading order across wrapped lines.
 */
export function wrapWords(el: Element): HTMLElement[] {
  const doc = el.ownerDocument;
  const out: HTMLElement[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        const text = child.textContent ?? '';
        if (!/\S/.test(text)) continue;
        const frag = doc.createDocumentFragment();
        for (const piece of text.split(/(\s+)/)) {
          if (!piece) continue;
          if (/^\s+$/.test(piece)) { frag.append(doc.createTextNode(piece)); continue; }
          const w = doc.createElement('span');
          w.setAttribute('data-w', '');
          w.textContent = piece;
          frag.append(w);
          out.push(w);
        }
        node.replaceChild(frag, child);
      } else if (child.nodeType === 1 && !['SCRIPT', 'STYLE'].includes((child as Element).tagName)) walk(child);
    }
  };
  walk(el);
  return out;
}

/** Opacity of word `i` of `n` at progress `x`: it starts at i/n and fades in over the next 1/n, so x = 1 shows every word. */
export const wordOpacity = (i: number, n: number, x: number) => clamp01(x * n - i);

/** Built-in effects: the properties each sets from its progress `x`. A function of `x` alone. */
function applyFx(c: Choreo, x: number) {
  const el = c.el, fx = c.fx, s = el.style;
  s.setProperty('--fx-p', String(Math.round(x * 1000) / 1000));
  switch (fx) {
    case 'fade': s.setProperty('opacity', x.toFixed(3)); break;
    case 'rise':
      s.setProperty('opacity', x.toFixed(3));
      s.setProperty('transform', `translateY(${((1 - x) * FADE_OFFSET).toFixed(2)}px)`);
      break;
    case 'write': s.setProperty('clip-path', `inset(0 ${pct(x)} 0 0)`); break;
    case 'wipe': s.setProperty('clip-path', `inset(0 0 ${pct(x)} 0)`); break;
    case 'words': {
      const w = words.get(el) ?? [];
      w.forEach((span, i) => span.style.setProperty('opacity', wordOpacity(i, w.length, x).toFixed(3)));
      break;
    }
    // 'none' and any other name: --fx-p only, the site's CSS does the rest
  }
}

/** The `<template data-scene="id">` for a scene: the first inside the nearest `<explainer-player>`, else the first in the document. */
export function findSceneTemplate(host: Element, id: string): HTMLTemplateElement | null {
  const sel = `template[data-scene=${quote(id)}]`;
  return (host.closest?.('explainer-player')?.querySelector(sel) ?? host.ownerDocument?.querySelector(sel) ?? null) as HTMLTemplateElement | null;
}

const parts = (data: Record<string, any>) => {
  const tr = data.transition ?? {};
  const kind = (v: unknown): Transition => (SCENE_TRANSITIONS.includes(v as string) ? (v as Transition) : 'cut');
  // out: only cut and fade exist; a wipe at the end is a cut
  const out = kind(tr.out);
  return { tin: kind(tr.in), tout: out === 'fade' ? out : 'cut' as Transition, fade: Math.max(0, num(String(tr.dur ?? ''), SCENE_FADE_S)) };
};

/**
 * Progress p at which the whole scene is complete: every choreographed element done (max of at + for), the in-fade done,
 * and before any out-fade begins. `end` is the choreography end in seconds (null: the scene has none).
 */
export function sceneStillP(data: Record<string, any>, dur: number, end: number | null): number {
  const { tin, tout, fade } = parts(data);
  if (!(dur > 0)) return 1;
  const inEnd = tin !== 'cut' ? fade : 0;
  let t = end === null && !inEnd ? dur : Math.max(end ?? 0, inEnd);
  if (tout === 'fade') t = Math.min(t, dur - fade);
  return clamp01(t / dur);
}

/** Seconds at which the last choreographed element of the scene `id` completes, over the matching templates in the document; null when none. */
function sceneEnd(id: unknown): number | null {
  const doc = (globalThis as any).document as Document | undefined;
  if (!doc || typeof id !== 'string') return null;
  let end: number | null = null;
  for (const tpl of Array.from(doc.querySelectorAll(`template[data-scene=${quote(id)}]`) as ArrayLike<HTMLTemplateElement>)) {
    for (const c of choreoOf((tpl as any).content ?? tpl)) end = Math.max(end ?? 0, c.at + c.len);
  }
  return end;
}

/**
 * An extension point for packs: a scene may carry behaviour the core does not know (a marker that hops between elements, say).
 * `mount(root)` is called once per scene mount, after the template is cloned in, and returns the extension's per-mount state
 * (the elements it found) or `undefined` to opt out of that scene. `render(root, state, t, dur)` is called at the END of every
 * scene render, after the built-in choreography (so measured positions include `rise` transforms), with `t` = `p * dur` seconds
 * from the cue start. Like a component, `render` must be a pure function of (t, layout): no state between calls except `state`.
 * An extension registered after a scene mounted is mounted into it at that scene's next render, so the order of imports does not matter.
 * A stable mechanism, not experimental; see README "Scenes".
 */
export type SceneExtension<S = unknown> = {
  name: string;
  mount(root: HTMLElement): S | undefined;
  render(root: HTMLElement, state: S, t: number, dur: number): void;
};
const extensions = new Map<string, SceneExtension<any>>();
export function registerSceneExtension<S>(ext: SceneExtension<S>) {
  if (extensions.has(ext.name)) throw new Error(`duplicate scene extension ${ext.name}`);
  extensions.set(ext.name, ext);
}
export const sceneExtensions = (): SceneExtension<any>[] => [...extensions.values()];

function mountExtensions(node: HTMLElement) {
  const st = extState.get(node)!;
  for (const e of extensions.values()) if (!st.has(e.name)) st.set(e.name, e.mount(node));
}

const mounted = new WeakMap<Element, Choreo[]>();
const extState = new WeakMap<Element, Map<string, unknown>>(); // scene root -> extension name -> its state (undefined: opted out); absent: not mounted yet
const words = new WeakMap<Element, HTMLElement[]>(); // element with data-fx="words" -> its word spans, made at mount
const warned = new Set<string>();

export const scene: Component = {
  meta: {
    renders: 'com.semanticops.explainer/scene@1', name: 'Scene', variants: ['default'], surfaces: ['web', 'video'],
    still: (data, _items, dur) => sceneStillP(data, dur, sceneEnd(data.template)),
  },
  mount(host, data) {
    const id = String(data.template ?? '');
    const node = host.ownerDocument.createElement('div');
    node.setAttribute('style', 'position:absolute;inset:0');
    node.setAttribute('data-scene-root', id);
    host.appendChild(node); // attached first so the player can be found from the host
    const tpl = findSceneTemplate(host, id);
    if (tpl) node.append(((tpl as any).content ?? tpl).cloneNode(true));
    else if (!warned.has(id)) { warned.add(id); console.warn(`scene: no <template data-scene="${id}"> found`); }
    const ch = choreoOf(node);
    for (const c of ch) if (c.fx === 'words') words.set(c.el, wrapWords(c.el));
    mounted.set(node, ch);
    extState.set(node, new Map());
    mountExtensions(node);
    return node;
  },
  render(node, p, data, _vars, _items, dur) {
    const t = p * dur;
    const { tin, tout, fade } = parts(data);
    const inF = tin !== 'cut' && fade > 0 ? ramp(t, 0, fade) : 1;
    const outF = tout === 'fade' && fade > 0 ? 1 - ramp(t, dur - fade, dur) : 1;
    const st = (node as HTMLElement).style;
    // fade: opacity only. wipe: the new surface is opaque and is revealed by a clip from the bottom (wipe-left: from the right), no blend
    st.setProperty('opacity', String(Math.round((tin === 'fade' ? inF : 1) * outF * 1000) / 1000));
    if (tin === 'wipe' || tin === 'wipe-left') {
      if (inF >= 1) st.removeProperty('clip-path');
      else st.setProperty('clip-path', tin === 'wipe' ? `inset(${pct(inF)} 0 0 0)` : `inset(0 0 0 ${pct(inF)})`);
    }
    for (const c of mounted.get(node) ?? []) applyFx(c, fxProgress(c.at, c.len, t));
    mountExtensions(node as HTMLElement); // an extension registered since the mount
    for (const e of extensions.values()) { const st = extState.get(node)!.get(e.name); if (st !== undefined) e.render(node as HTMLElement, st, t, dur); }
  },
};
