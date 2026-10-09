import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { corePack } from '../src/components/index.ts';
import { registerComponents, registered, stillP, type Component } from '../src/components/index.ts';
import { stillTime } from '../src/still.ts';
import type { Cue, Segment } from '../src/clock.ts';
// importing a pack registers it
import '../examples/video/components.ts';

registerComponents(corePack);

const vars = { name: 'Ada' };
const NS = 'com.semanticops.explainer';
type Fx = { data: any; items: any[]; dur?: number };
const fixtures: Record<string, Fx> = {
  [`${NS}/intro@1`]: { data: { title: 'T {name}', subtitle: 'S', presenter: 'P' }, items: [] },
  [`${NS}/numbered-list@1`]: { data: { heading: 'H' }, items: ['one', 'two {name}', { text: 'three' }] },
  [`${NS}/choice@1`]: { data: { prompt: 'Pick' }, items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
  [`${NS}.example/cycle@1`]: { data: { caption: 'again {name}' }, items: [{ label: 'Debate' }, { label: 'Decide?' }, { label: 'Forget' }, { label: 'Repeat' }] },
  [`${NS}.example/emphasis@1`]: { data: {}, items: [{ text: 'clear', at: 0.2 }, { text: 'visible', at: 1 }, { text: 'useful {name}', at: 1.8 }] },
};
const DUR = 10;
// text that is dimmed on purpose (never faded): the minimum effective opacity allowed per component
const DIMMED: Record<string, number> = {
  'com.semanticops.explainer/numbered-list@1': 0.6, // inactive items
  'com.semanticops.explainer/intro@1:lower-third': 0.8, // the presenter line
};

const num = (s: string | null | undefined, re: RegExp) => { const m = s && re.exec(s); return m ? Number(m[1]) : undefined; };
const own = (n: any) => Array.from(n.childNodes as any[]).some((c) => c.nodeType === 3 && c.textContent.trim());
const opacityOf = (n: any) => num(n.getAttribute?.('style'), /(?:^|;)\s*opacity:\s*([\d.]+)/) ?? num(n.getAttribute?.('opacity'), /^([\d.]+)$/) ?? 1;
const hiddenBy = (n: any) => {
  const s = n.getAttribute?.('style') ?? '';
  return /(?:^|;)\s*display:\s*none/.test(s) ? 'display:none' : /(?:^|;)\s*visibility:\s*hidden/.test(s) ? 'visibility:hidden' : n.hasAttribute?.('hidden') ? 'hidden' : '';
};

/** Problems with a frame: the node or any ancestor-chained text element that is translucent or hidden. */
function incomplete(root: any, min: number) {
  const bad: string[] = [];
  const walk = (n: any, acc: number, hidden: string) => {
    const o = acc * opacityOf(n);
    const h = hidden || hiddenBy(n);
    if (n === root && o < 0.99 - 1e-9 && o < min - 1e-9) bad.push(`node opacity ${o}`);
    if (own(n)) {
      if (o < min - 1e-9) bad.push(`<${n.localName}> "${n.textContent.trim().slice(0, 20)}" opacity ${o}`);
      if (h) bad.push(`<${n.localName}> "${n.textContent.trim().slice(0, 20)}" ${h}`);
    }
    for (const c of Array.from(n.children as any[])) walk(c, o, h);
  };
  walk(root, 1, '');
  return bad;
}

const comps = new Map<string, Component>();
for (const c of [...corePack, ...registered()]) comps.set(c.meta.renders, c);

test('every component declares non-empty surfaces and has a fixture', () => {
  assert.ok(comps.size >= 5, `only ${comps.size} components found`);
  for (const [r, c] of comps) {
    assert.ok(Array.isArray(c.meta.surfaces) && c.meta.surfaces.length > 0, `${r}: surfaces`);
    for (const s of c.meta.surfaces) assert.ok(s === 'web' || s === 'video', `${r}: surface ${s}`);
    assert.ok(fixtures[r], `${r}: add a fixture to test/still.test.ts`);
  }
});

for (const [r, comp] of comps) {
  const fx = fixtures[r];
  if (!fx) continue; // canvas components: no DOM text to check (linkedom has no canvas)
  for (const variant of comp.meta.variants) {
    test(`${r} (${variant}) is complete at its still`, () => {
      const dur = fx.dur ?? DUR;
      const data = { ...fx.data, variant };
      const p = stillP(comp, data, fx.items, dur);
      const { document } = parseHTML('<div id="h"></div>');
      const node = comp.mount(document.getElementById('h')!, data);
      comp.render(node, p, data, vars, fx.items, dur);
      const min = DIMMED[`${r}:${variant}`] ?? DIMMED[r] ?? 0.99;
      assert.deepEqual(incomplete(node, min), [], `p=${p}`);
      // the still must not depend on how we got there
      comp.render(node, 0.2, data, vars, fx.items, dur);
      comp.render(node, p, data, vars, fx.items, dur);
      assert.deepEqual(incomplete(node, min), [], `p=${p} after p=0.2`);
    });
  }
}

test('the check fails when a still is wrong: lower-third at p=1 is blank', () => {
  const lt = comps.get(`${NS}/intro@1`)!;
  const data = { ...fixtures[`${NS}/intro@1`].data, variant: 'lower-third' };
  const { document } = parseHTML('<div id="h"></div>');
  const node = lt.mount(document.getElementById('h')!, data);
  lt.render(node, 1, data, vars, [], DUR);
  assert.ok(incomplete(node, 0.99).length > 0);
  // and a panel at p=1 (fading out)
  const nl = comps.get(`${NS}/numbered-list@1`)!;
  const d2 = { ...fixtures[`${NS}/numbered-list@1`].data, variant: 'panel' };
  const n2 = nl.mount(document.getElementById('h')!, d2);
  nl.render(n2, 1, d2, vars, fixtures[`${NS}/numbered-list@1`].items, DUR);
  assert.ok(incomplete(n2, 0.6).length > 0);
});

test('stillP: default 1, number, function form, clamped', () => {
  const m = (still?: any) => ({ meta: { renders: 'x', name: 'x', variants: [], surfaces: ['web' as const], still } });
  assert.equal(stillP(m(), {}, [], 5), 1);
  assert.equal(stillP(m(0.4), {}, [], 5), 0.4);
  assert.equal(stillP(m((d: any, i: any[], dur: number) => d.v + i.length + dur), { v: 0 }, [1], 5), 1);
  assert.equal(stillP(m(-3), {}, [], 5), 0);
  assert.equal(stillP(m(NaN), {}, [], 5), 1);
  assert.equal(stillP(m((_d: any, _i: any[], dur: number) => (dur - 0.4) / dur), {}, [], 10), 0.96);
});

// stillTime: pure
const seg = (o: Partial<Segment> = {}): Segment => ({ id: 's', kind: 'none', out: 20, ...o });
const cue = (o: Partial<Cue>): Cue => ({ id: 'c', segment: 's', start: 0, end: 10, renders: 'a', ...o });
const reg: Record<string, any> = {
  a: { meta: { still: undefined } },
  b: { meta: { still: (_d: any, _i: any[], dur: number) => (dur - 1) / dur } },
  v: { meta: { still: (d: any) => (d.variant === 'fade' ? 0.5 : 1) } },
};
const res = (r: string) => reg[r];
test('stillTime: max over cues of start + stillP * length', () => {
  assert.equal(stillTime(seg(), [cue({ start: 2, end: 6 }), cue({ start: 5, end: 15, renders: 'b' })], res), 14);
  assert.equal(stillTime(seg(), [cue({ start: 2, end: 6 }), cue({ start: 0, end: 20, renders: 'b' })], res), 19);
  assert.equal(stillTime(seg(), [cue({ start: 4, end: 8, renders: 'v', variant: 'fade' }), cue({ start: 1, end: 3 })], res), 6);
});
test('stillTime: segment.still wins, clamps, ignores other segments, hold cues and unknown components', () => {
  assert.equal(stillTime(seg({ still: 7 }), [cue({ end: 10 })], res), 7);
  assert.equal(stillTime(seg({ still: 99 }), [], res), 20);
  assert.equal(stillTime(seg({ out: 12, in: 4 }), [cue({ end: 30 })], res), 8);
  assert.equal(stillTime(seg(), [cue({ end: 9, segment: 'other' }), cue({ end: 4 })], res), 4);
  assert.equal(stillTime(seg(), [cue({ end: 4 }), cue({ start: 18, end: 20, hold: true })], res), 4);
  assert.equal(stillTime(seg(), [cue({ start: 18, end: 20, hold: true })], res), 20);
  assert.equal(stillTime(seg(), [cue({ renders: 'nope' })], res), 0);
  assert.equal(stillTime(seg(), [], res), 0);
});
