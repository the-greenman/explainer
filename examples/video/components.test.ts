import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { cycle, emphasis } from './components.ts';

const vars = { name: 'Ada' };
const cases = [
  { c: cycle, data: { caption: 'again {name}' }, items: [{ label: 'Debate' }, { label: 'Decide?' }, { label: 'Forget <b>' }, { label: 'Repeat' }] },
  { c: emphasis, data: {}, items: [{ text: 'clear', at: 0.2 }, { text: 'visible', at: 1 }, { text: 'useful {name}', at: 1.8 }] },
];

for (const { c, data, items } of cases) {
  test(`${c.meta.renders} render(p) is identical direct / after p=1 / after p=0 / after 1,0.7,0`, () => {
    for (const p of [0, 0.1, 0.3, 0.5, 0.97, 1]) {
      const out = (...via: number[]) => {
        const { document } = parseHTML('<div id="h"></div>');
        const node = c.mount(document.getElementById('h')!, data);
        for (const v of via) c.render(node, v, data, vars, items, 6);
        c.render(node, p, data, vars, items, 6);
        return node.outerHTML;
      };
      const direct = out();
      assert.ok(direct.length > 50);
      for (const via of [[1], [0], [1, 0.7, 0]]) assert.equal(out(...via), direct, `p=${p} via ${via}`);
    }
  });
}

test('cycle draws in order: node 1 before node 3, arcs offset shrinks, markup is escaped', () => {
  const { document } = parseHTML('<div id="h"></div>');
  const items = cases[0].items;
  const node = cycle.mount(document.getElementById('h')!, cases[0].data);
  const at = (p: number) => { cycle.render(node, p, cases[0].data, vars, items, 6); return node.outerHTML; };
  const ops = (h: string) => [...h.matchAll(/<g opacity="([\d.]+)"/g)].map((m) => Number(m[1]));
  const early = ops(at(0.2)), late = ops(at(1));
  assert.ok(early[0] > 0 && early[3] === 0);
  assert.deepEqual(late, [1, 1, 1, 1]);
  assert.ok(!at(1).includes('<b>'));
  assert.ok(at(1).includes('again Ada'));
  assert.ok(at(1).includes('stroke-dashoffset="0.000"'));
});

test('emphasis words appear at their own `at`', () => {
  const { document } = parseHTML('<div id="h"></div>');
  const node = emphasis.mount(document.getElementById('h')!, {});
  const items = cases[1].items;
  const ops = (t: number) => { emphasis.render(node, t / 6, {}, vars, items, 6); return Array.from(node.children).map((el: any) => Number(/opacity:([\d.]+)/.exec(el.getAttribute('style'))![1])); };
  assert.deepEqual(ops(0.1), [0, 0, 0]);
  const m = ops(1.1);
  assert.ok(m[0] === 1 && m[1] > 0 && m[2] === 0);
});
