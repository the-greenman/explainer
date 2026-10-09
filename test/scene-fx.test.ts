import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { scene, sceneStillP, wordOpacity } from '../src/components/scene.ts';

const { document } = parseHTML(`<!doctype html><html><body>
<div id="host"></div>
<template data-scene="w"><section class="root">
  <h1 id="h" data-at="1" data-for="2" data-fx="words">One two <em>three four</em>  five</h1>
  <p id="plain" data-at="0" data-for="1" data-fx="write">not wrapped</p>
</section></template></body></html>`);
(globalThis as any).document = document;
const DUR = 10;
const data = { template: 'w' };
const mount = (d: any = data) => { const host = document.createElement('div'); document.body.append(host); return scene.mount(host, d) as any; };
const ops = (n: any) => Array.from(n.querySelectorAll('#h [data-w]') as ArrayLike<any>).map((w) => Number(w.style.getPropertyValue('opacity')));

test('words: wraps the words of every text node once, in reading order, keeping the spaces', () => {
  const n = mount();
  const ws = Array.from(n.querySelectorAll('#h [data-w]') as ArrayLike<any>).map((w) => w.textContent);
  assert.deepEqual(ws, ['One', 'two', 'three', 'four', 'five']);
  assert.equal(n.querySelector('#h').textContent, 'One two three four  five');
  assert.equal(n.querySelectorAll('#plain [data-w]').length, 0, 'only data-fx="words" is wrapped');
  assert.ok(n.querySelector('#h em [data-w]'), 'nested inline elements are wrapped in place');
});

test('words: revealed in order by --fx-p; word i appears after i/n', () => {
  const n = mount();
  scene.render(n, 0.2, data, {}, [], DUR); // t = 2: x = 0.5 of 5 words
  assert.deepEqual(ops(n), [1, 1, 0.5, 0, 0]);
  scene.render(n, 0.1, data, {}, [], DUR); // t = 1: x = 0
  assert.deepEqual(ops(n), [0, 0, 0, 0, 0]);
  scene.render(n, 0.4, data, {}, [], DUR); // t = 4: done
  assert.deepEqual(ops(n), [1, 1, 1, 1, 1]);
  assert.equal(wordOpacity(0, 5, 0.2), 1);
  assert.equal(wordOpacity(4, 5, 0.8), 0);
});

test('words: order independence (any path to p gives the same markup) and the still is complete', () => {
  const direct = mount(); scene.render(direct, 0.25, data, {}, [], DUR);
  const via = mount();
  for (const p of [1, 0, 0.9, 0.05, 0.6]) scene.render(via, p, data, {}, [], DUR);
  scene.render(via, 0.25, data, {}, [], DUR);
  assert.equal(via.outerHTML, direct.outerHTML);
  const stillP = sceneStillP(data, DUR, 3); // choreography ends at at + for = 3 s
  const s = mount(); scene.render(s, stillP, data, {}, [], DUR);
  assert.deepEqual(ops(s), [1, 1, 1, 1, 1]);
});

test('wipe transition: clip-path inset from the top, no opacity blend, no clip when done', () => {
  const d = { template: 'w', transition: { in: 'wipe', dur: 2 } };
  const n = mount(d);
  const st = (name: string) => n.style.getPropertyValue(name);
  scene.render(n, 0, d, {}, [], DUR);
  assert.equal(st('clip-path'), 'inset(100% 0 0 0)');
  scene.render(n, 0.1, d, {}, [], DUR); // t = 1: half
  assert.equal(st('clip-path'), 'inset(50% 0 0 0)');
  assert.equal(st('opacity'), '1', 'the surface stays opaque while it is revealed');
  scene.render(n, 0.2, d, {}, [], DUR);
  assert.equal(st('clip-path'), '');
  // order independence
  const m = mount(d); scene.render(m, 0.9, d, {}, [], DUR); scene.render(m, 0.1, d, {}, [], DUR);
  assert.equal(m.style.getPropertyValue('clip-path'), 'inset(50% 0 0 0)');
});

test('wipe-left reveals from the right; its still waits for the wipe; out wipe is a cut', () => {
  const d = { template: 'w', transition: { in: 'wipe-left', out: 'wipe', dur: 2 } };
  const n = mount(d);
  scene.render(n, 0.1, d, {}, [], DUR);
  assert.equal(n.style.getPropertyValue('clip-path'), 'inset(0 0 0 50%)');
  scene.render(n, 0.95, d, {}, [], DUR);
  assert.equal(n.style.getPropertyValue('opacity'), '1');
  assert.ok(sceneStillP(d, DUR, 0.5) >= 0.2, 'the still is past the wipe');
});

test('fade and cut are unchanged', () => {
  const d = { template: 'w', transition: { in: 'fade', dur: 2 } };
  const n = mount(d);
  scene.render(n, 0.1, d, {}, [], DUR);
  assert.equal(n.style.getPropertyValue('opacity'), '0.5');
  assert.equal(n.style.getPropertyValue('clip-path'), '');
});
