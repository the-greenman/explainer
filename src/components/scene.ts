import { clamp01, ramp } from '../clock.ts';
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
export const SCENE_FX = ['fade', 'rise', 'write', 'wipe', 'none'];

export type Choreo = { el: HTMLElement; at: number; len: number; fx: string };
type Transition = 'cut' | 'fade';

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

const pct = (x: number) => `${Math.round((1 - x) * 100000) / 1000}%`;

/** Built-in effects: the properties each sets from its progress `x`. A function of `x` alone. */
function applyFx(el: HTMLElement, fx: string, x: number) {
  const s = el.style;
  s.setProperty('--fx-p', String(Math.round(x * 1000) / 1000));
  switch (fx) {
    case 'fade': s.setProperty('opacity', x.toFixed(3)); break;
    case 'rise':
      s.setProperty('opacity', x.toFixed(3));
      s.setProperty('transform', `translateY(${((1 - x) * FADE_OFFSET).toFixed(2)}px)`);
      break;
    case 'write': s.setProperty('clip-path', `inset(0 ${pct(x)} 0 0)`); break;
    case 'wipe': s.setProperty('clip-path', `inset(0 0 ${pct(x)} 0)`); break;
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
  const kind = (v: unknown): Transition => (v === 'fade' ? 'fade' : 'cut');
  return { tin: kind(tr.in), tout: kind(tr.out), fade: Math.max(0, num(String(tr.dur ?? ''), SCENE_FADE_S)) };
};

/**
 * Progress p at which the whole scene is complete: every choreographed element done (max of at + for), the in-fade done,
 * and before any out-fade begins. `end` is the choreography end in seconds (null: the scene has none).
 */
export function sceneStillP(data: Record<string, any>, dur: number, end: number | null): number {
  const { tin, tout, fade } = parts(data);
  if (!(dur > 0)) return 1;
  const inEnd = tin === 'fade' ? fade : 0;
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

const mounted = new WeakMap<Element, Choreo[]>();
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
    mounted.set(node, choreoOf(node));
    return node;
  },
  render(node, p, data, _vars, _items, dur) {
    const t = p * dur;
    const { tin, tout, fade } = parts(data);
    const inF = tin === 'fade' && fade > 0 ? ramp(t, 0, fade) : 1;
    const outF = tout === 'fade' && fade > 0 ? 1 - ramp(t, dur - fade, dur) : 1;
    (node as HTMLElement).style.setProperty('opacity', String(Math.round(inF * outF * 1000) / 1000));
    for (const c of mounted.get(node) ?? []) applyFx(c.el, c.fx, fxProgress(c.at, c.len, t));
  },
};
