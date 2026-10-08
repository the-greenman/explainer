import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { corePack } from '../src/components/index.ts';

const fixtures: Record<string, { data: any; items: any[] }> = {
  'com.semanticops.explainer/intro@1': { data: { title: 'T {name}', subtitle: 'S', presenter: 'P' }, items: [] },
  'com.semanticops.explainer/numbered-list@1': { data: { heading: 'H' }, items: ['one', 'two {name}', { text: 'three' }] },
  'com.semanticops.explainer/choice@1': { data: { prompt: 'Pick' }, items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
};
const vars = { name: 'Ada' };

for (const comp of corePack) {
  for (const variant of comp.meta.variants) {
    test(`${comp.meta.renders} (${variant}) render(0.3) is history-independent`, () => {
      const f = fixtures[comp.meta.renders];
      assert.ok(f, 'add a fixture for every registered component');
      const out = (via?: number) => {
        const { document } = parseHTML('<div id="h"></div>');
        const data = { ...f.data, variant };
        const node = comp.mount(document.getElementById('h')!, data);
        if (via !== undefined) comp.render(node, via, data, vars, f.items, 5);
        comp.render(node, 0.3, data, vars, f.items, 5);
        return node.outerHTML;
      };
      const direct = out();
      assert.equal(out(1), direct);
      assert.equal(out(0), direct);
    });
  }
}

// Per-item `at` (seconds from cue start) is timing data: items appear when their time passes, in any order of rendering.
import { numberedList } from '../src/components/numbered-list.ts';
const opacities = (items: any[], p: number, via?: number, variant = 'panel') => {
  const { document } = parseHTML('<div id="h"></div>');
  const data = { heading: 'H', variant };
  const node = numberedList.mount(document.getElementById('h')!, data);
  if (via !== undefined) numberedList.render(node, via, data, vars, items, 10);
  numberedList.render(node, p, data, vars, items, 10);
  return Array.from(node.querySelectorAll('li')).map((li: any) => Number(/opacity:([\d.]+)/.exec(li.getAttribute('style'))![1]));
};
test('numbered-list items with `at` appear at their own time and history does not matter', () => {
  const items = [{ text: 'a', at: 1 }, { text: 'b', at: 5 }, { text: 'c', at: 8 }];
  const at = (t: number) => opacities(items, t / 10);
  assert.deepEqual(at(0.5), [0, 0, 0]);
  assert.ok(at(1.4)[0] > 0 && at(1.4)[1] === 0);
  assert.equal(at(4.9)[1], 0);
  assert.ok(at(5.5)[1] > 0 && at(5.5)[2] === 0);
  for (const via of [1, 0, 0.9]) assert.deepEqual(opacities(items, 0.55, via), at(5.5));
});
test('numbered-list without `at` keeps the even reveal', () => {
  const items = ['a', 'b', 'c', 'd'];
  const o = opacities(items, 0.2, undefined, 'default');
  assert.ok(o[0] > 0 && o[1] === 0);
});

// Creation pack: linkedom has no canvas, so test the wrapped steps' element state directly.
// Every step must reach the same element state at p=0.3 via any history (dt is always 0).
import { creationPack, creationSteps } from '../examples/creation/canvas-step.ts';

test('creation pack has a component per step', () => {
  assert.equal(creationPack.length, creationSteps.length);
});

const snap = (step: any) => JSON.stringify(step.elements, (_k, v) => (typeof v === 'function' ? undefined : v));
const W = 800, H = 450;
for (const [renders, , Step, opts] of creationSteps) {
  test(`${renders} step state at p=0.3 is history-independent`, () => {
    const make = () => new (Step as any)({ width: W, height: H, centerX: W / 2, centerY: H / 2, baseRadius: H * 0.15 }, opts);
    const at = (...path: number[]) => {
      const s = make();
      for (const p of [...path, 0.3]) { s.update(0, p); }
      return snap(s);
    };
    const direct = at();
    for (const path of [[1], [0], [0.9, 0.1, 0.65], [0.05, 0.5, 0.75, 1, 0.2], [0.2, 0.6, 0.95, 0.4]]) assert.equal(at(...path), direct, `via ${path}`);
    // sweep: many p, forward then backward, must match a fresh instance at each p
    const s = make();
    const ps = Array.from({ length: 41 }, (_, i) => i / 40);
    for (const p of [...ps, ...ps.slice().reverse()]) {
      s.update(0, p);
      const f = make(); f.update(0, p);
      assert.equal(snap(s), snap(f), `p=${p}`);
    }
  });
}
