// The in-video marker (a scene extension) in linkedom. linkedom has no layout: rects and sizes are stubbed. What it cannot show (real
// layout, the canvas scale, the offline render) is covered by examples/flight/check-karaoke.mjs in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { registerBuiltInEffects } from '../src/experimental/flight/effects/index.ts';
import { markerExtension } from '../src/experimental/flight/marker.ts';
import { registerSceneExtension, scene } from '../src/components/scene.ts';

registerBuiltInEffects();
registerSceneExtension(markerExtension);

const TPL = (first = '') => `<section class="s">
  <ul>
    <li id="a" data-marker-stop="m1" data-marker-at="0.4" data-marker-for="0.4" ${first}>One</li>
    <li id="b" data-marker-stop="m1" data-marker-at="1.2" data-marker-for="0.4" data-marker-point="center">Two</li>
    <li id="c" data-marker-stop="m1" data-marker-at="2" data-marker-for="0.4" data-marker-fx="glide" data-marker-point="top">Three</li>
    <li id="other" data-marker-stop="m2" data-marker-at="0">Another marker</li>
  </ul>
  <span id="ball" data-marker="m1"></span>
</section>`;
const DUR = 5;
const data = { template: 't' };
let n = 0;

type Layout = { scale?: number; w?: number };
function mount(tpl = TPL(), layout: Layout = {}) {
  const { document } = parseHTML(`<!doctype html><html><body><div id="host"></div><template data-scene="t">${tpl}</template></body></html>`);
  (globalThis as any).document = document;
  const root = scene.mount(document.getElementById('host')!, data) as any;
  const k = layout.scale ?? 1, w = layout.w ?? 1280;
  const stubRect = (el: any, x: number, y: number, ww: number, h: number) => {
    el.getBoundingClientRect = () => ({ left: x * k, top: y * k, width: ww * k, height: h * k, right: (x + ww) * k, bottom: (y + h) * k });
  };
  stubRect(root, 0, 0, w, 720);
  Object.defineProperty(root, 'offsetWidth', { value: w });
  // stops: x 200, rows 100 px apart, 300 x 40
  [['a', 100], ['b', 200], ['c', 300], ['other', 400]].forEach(([id, y]) => { const e = root.querySelector('#' + id); if (e) stubRect(e, 200, y as number, 300, 40); });
  const ball = root.querySelector('#ball');
  if (ball) { Object.defineProperty(ball, 'offsetWidth', { value: 20 }); Object.defineProperty(ball, 'offsetHeight', { value: 20 }); }
  return root;
}
const at = (root: any, t: number) => scene.render(root, t / DUR, data, {}, [], DUR);
const pos = (root: any) => {
  const m = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(root.querySelector('#ball').style.getPropertyValue('transform'));
  return m ? { x: +m[1], y: +m[2] } : null;
};
const op = (root: any) => Number(root.querySelector('#ball').style.getPropertyValue('opacity'));
// the marker is centred on its point of the stop: left = (left edge, middle), center, top = (middle width, top edge); minus half its 20 px
const REST = { a: { x: 190, y: 110 }, b: { x: 340, y: 210 }, c: { x: 340, y: 290 } };

test('the marker is moved to the end of the scene root and positioned absolutely', () => {
  const root = mount();
  assert.equal(root.lastElementChild.id, 'ball');
  assert.equal(root.querySelector('#ball').style.getPropertyValue('position'), 'absolute');
  assert.equal(root.querySelector('#other').hasAttribute('data-marker-here'), false, 'a stop of a marker with no element is left alone');
});

test('at rest it sits on the stop (point: left, center, top), before the first stop starts on the first', () => {
  const root = mount();
  at(root, 0.1);
  assert.deepEqual(pos(root), REST.a, 'before it starts: rests on the first stop');
  assert.equal(op(root), 1);
  at(root, 0.8); assert.deepEqual(pos(root), REST.a, 'first hop done');
  at(root, 1.6); assert.deepEqual(pos(root), REST.b, 'center of the second stop');
  at(root, 2.4); assert.deepEqual(pos(root), REST.c, 'top of the third (glide)');
  at(root, 4.9); assert.deepEqual(pos(root), REST.c, 'stays on the last');
});

test('mid-hop it is between the stops and above the line between them', () => {
  const root = mount();
  at(root, 1.4); // half of the b hop
  const p = pos(root)!;
  assert.ok(p.x > REST.a.x && p.x < REST.b.x);
  assert.ok(p.y < REST.a.y, 'the arc rises above the first stop');
});

test('here-marking: data-marker-here where it rests, --marker-p on the stop being approached, nothing elsewhere', () => {
  const root = mount();
  const st = (id: string) => ({ here: root.querySelector('#' + id).hasAttribute('data-marker-here'), p: root.querySelector('#' + id).style.getPropertyValue('--marker-p') });
  at(root, 0.1);
  assert.deepEqual([st('a'), st('b')], [{ here: true, p: '1' }, { here: false, p: '' }]);
  at(root, 1.4);
  assert.deepEqual([st('a'), st('b'), st('c')], [{ here: false, p: '' }, { here: false, p: '0.5' }, { here: false, p: '' }]);
  at(root, 1.7);
  assert.deepEqual([st('a'), st('b')], [{ here: false, p: '' }, { here: true, p: '1' }]);
  assert.deepEqual(st('other'), { here: false, p: '' }, 'the other marker id is not ours');
});

test('a first stop with fx pop: absent before it, there after', () => {
  const root = mount(TPL().replace('data-marker-at="0.4"', 'data-marker-at="0.4" data-marker-fx="pop"'));
  at(root, 0.2);
  assert.equal(op(root), 0);
  assert.equal(root.querySelector('#a').hasAttribute('data-marker-here'), false);
  at(root, 0.9);
  assert.equal(op(root), 1);
  assert.deepEqual(pos(root), REST.a);
  assert.equal(root.querySelector('#a').hasAttribute('data-marker-here'), true);
});

test('history independence: render(0.3 s .. 2 s) directly or after any other renders gives the same markup', () => {
  for (const t of [0.3, 1.4, 2.2]) {
    const direct = (() => { const r = mount(); at(r, t); return r.outerHTML; })();
    for (const via of [[5, 0], [0, 4.9, 1.7], [2.5]]) {
      const r = mount();
      for (const v of via) at(r, v);
      at(r, t);
      assert.equal(r.outerHTML, direct, `t=${t} via ${via}`);
    }
  }
});

test('measured in the scene\'s own CSS px: a scaled canvas gives the same positions', () => {
  const full = mount(TPL(), { scale: 1 }), half = mount(TPL(), { scale: 0.5 });
  for (const t of [0.1, 1.4, 2.4]) { at(full, t); at(half, t); assert.deepEqual(pos(half), pos(full), `t=${t}`); }
});

test('a root with no size (hidden, not laid out) is left untouched', () => {
  const root = mount(TPL(), { w: 0 });
  const mine = () => root.querySelector('section').outerHTML + root.querySelector('#ball').outerHTML;
  const before = mine();
  at(root, 1.4);
  assert.equal(mine(), before);
});

test('reduced motion: rest states only', () => {
  (globalThis as any).matchMedia = () => ({ matches: true });
  try {
    const root = mount();
    at(root, 1.4); // mid-hop to b: settles to b
    assert.deepEqual(pos(root), REST.b);
    assert.equal(root.querySelector('#b').getAttribute('data-marker-here'), '');
    assert.equal(root.querySelector('#b').style.getPropertyValue('--marker-p'), '1');
  } finally { delete (globalThis as any).matchMedia; }
});

test('under a player with the render attribute reduced motion never settles (offline render)', () => {
  (globalThis as any).matchMedia = () => ({ matches: true });
  try {
    const root = mount();
    const pl = root.ownerDocument.createElement('explainer-player');
    pl.setAttribute('render', '');
    root.parentNode.parentNode.append(pl);
    pl.append(root.parentNode);
    at(root, 1.4); // mid-hop to b
    const p = pos(root)!;
    assert.notDeepEqual(p, REST.b, 'not settled');
    assert.notDeepEqual(p, REST.a);
    assert.equal(root.querySelector('#b').hasAttribute('data-marker-here'), false);
  } finally { delete (globalThis as any).matchMedia; }
});

test('rendering the same t twice writes nothing the second time', () => {
  const root = mount();
  at(root, 1.4);
  const writes: string[] = [];
  // spy on the prototypes (linkedom makes the style object on demand)
  const sp = Object.getPrototypeOf(root.querySelector('#ball').style), ep = Object.getPrototypeOf(Object.getPrototypeOf(root.querySelector('#ball')));
  const patched: [any, string, any][] = [];
  const spy = (o: any, k: string) => { const orig = o[k]; patched.push([o, k, orig]); o[k] = function (...a: any[]) { writes.push(`${k}:${a[0]}`); return orig.apply(this, a); }; };
  try {
    spy(sp, 'setProperty'); spy(sp, 'removeProperty');
    let o = ep; while (o && !Object.hasOwn(o, 'setAttribute')) o = Object.getPrototypeOf(o);
    spy(o, 'setAttribute'); spy(o, 'removeAttribute');
    at(root, 1.4);
    // the scene root's own opacity is the scene's write, not the marker's
    assert.deepEqual(writes.filter((w) => w !== 'setProperty:opacity'), [], 'no marker write the second time');
    assert.ok(writes.filter((w) => w === 'setProperty:opacity').length <= 1);
    writes.length = 0;
    at(root, 2.1);
    assert.ok(writes.some((w) => w === 'setProperty:transform'), 'a different t does write');
  } finally { for (const [o, k, f] of patched) o[k] = f; }
});

test('no marker markup: the extension opts out and the scene is untouched', () => {
  const root = mount('<section><p>plain</p></section>');
  const before = root.querySelector('section').outerHTML;
  at(root, 1);
  assert.equal(root.querySelector('section').outerHTML, before);
  assert.equal(root.querySelector('section').nextSibling, null, 'nothing added');
});
