// The scene extension hook (registerSceneExtension): called at mount and at the end of every render, after the built-in choreography.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { registerSceneExtension, scene, sceneExtensions } from '../src/components/scene.ts';

const calls: string[] = [];
// a pure extension: stamps the time on every [data-stamp] element; opts out of scenes without any
registerSceneExtension<HTMLElement[]>({
  name: 'stamp-test',
  mount(root) { const els = Array.from(root.querySelectorAll('[data-stamp]') as ArrayLike<HTMLElement>); calls.push(`mount:${els.length}`); return els.length ? els : undefined; },
  render(_root, els, t, dur) {
    for (const el of els) el.setAttribute('data-stamp', `${t.toFixed(2)}/${dur}|${(el.style.getPropertyValue('opacity') || '-')}`);
    calls.push(`render:${t.toFixed(2)}`);
  },
});

const { document } = parseHTML(`<!doctype html><html><body><div id="host"></div>
<template data-scene="x"><section><h1 id="h" data-at="1" data-for="2" data-fx="fade">Hi</h1><p id="s" data-stamp>x</p></section></template>
<template data-scene="plain"><section><p>no stamp</p></section></template></body></html>`);
(globalThis as any).document = document;
const mount = (id: string) => { const h = document.createElement('div'); document.body.append(h); return scene.mount(h, { template: id }) as any; };

test('registered once; a duplicate name throws', () => {
  assert.ok(sceneExtensions().some((e) => e.name === 'stamp-test'));
  assert.throws(() => registerSceneExtension({ name: 'stamp-test', mount: () => undefined, render() {} }), /duplicate scene extension/);
});

test('mount is called once per scene; undefined opts the scene out', () => {
  calls.length = 0;
  const n = mount('x'); mount('plain');
  assert.deepEqual(calls, ['mount:1', 'mount:0']);
  calls.length = 0;
  scene.render(n, 0.2, { template: 'x' }, {}, [], 10);
  scene.render(mount('plain'), 0.2, { template: 'plain' }, {}, [], 10);
  assert.deepEqual(calls.filter((c) => c.startsWith('render')), ['render:2.00'], 'render only for scenes that opted in, with t = p * dur');
});

test('render runs after the built-in choreography (it sees the fade of the same render)', () => {
  const n = mount('x');
  scene.render(n, 0.2, { template: 'x' }, {}, [], 10); // t = 2: the fade (at 1, for 2) is at 0.5
  assert.equal(n.querySelector('#h').style.getPropertyValue('opacity'), '0.500');
  assert.match(n.querySelector('#s').getAttribute('data-stamp'), /^2\.00\/10\|/);
});

test('history independence with an extension registered: render(0.3) directly = after any other renders', () => {
  const out = (via?: number[]) => {
    const n = mount('x');
    for (const p of via ?? []) scene.render(n, p, { template: 'x' }, {}, [], 5);
    scene.render(n, 0.3, { template: 'x' }, {}, [], 5);
    return n.outerHTML;
  };
  const direct = out();
  assert.equal(out([1]), direct);
  assert.equal(out([0]), direct);
  assert.equal(out([0.9, 0.05, 0.6]), direct);
});

test('an extension registered after a scene mounted is mounted into it at its next render', () => {
  const n = mount('plain');
  let mounts = 0, renders = 0;
  registerSceneExtension<string>({ name: 'late-test', mount: () => { mounts++; return 'on'; }, render: () => { renders++; } });
  assert.equal(mounts, 0);
  scene.render(n, 0.1, { template: 'plain' }, {}, [], 10);
  scene.render(n, 0.2, { template: 'plain' }, {}, [], 10);
  assert.deepEqual([mounts, renders], [1, 2]);
});
