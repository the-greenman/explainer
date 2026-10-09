import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const { document, HTMLElement, Element, customElements, window } = parseHTML('<!doctype html><html><head></head><body></body></html>');
const g = globalThis as any;
Object.defineProperty(document, 'readyState', { value: 'complete' });
Object.assign(g, {
  document, HTMLElement, Element, customElements, window, CustomEvent: window.CustomEvent, Event: window.Event,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {}, removeEventListener() {},
  requestAnimationFrame: () => 1, cancelAnimationFrame() {}, IntersectionObserver: class { observe() {} disconnect() {} },
});
const { ExplainerPlayer } = await import('../src/player.ts');
const { corePack, registerComponents } = await import('../src/components/index.ts');
registerComponents(corePack);
customElements.define('explainer-player', ExplainerPlayer);

const SCENE = 'com.semanticops.explainer/scene@1';
const manifest = {
  id: 'm', segments: [{ id: 'a', kind: 'none', out: 12 }],
  cues: [
    { id: 'u', segment: 'a', start: 0, end: 12, renders: SCENE, data: { template: 't' } },
    { id: 'o', segment: 'a', start: 0, end: 12, renders: SCENE, layer: 'over', data: { template: 't' } },
  ],
};
const make = (attrs: Record<string, string>, inner: string) => {
  const el = document.createElement('explainer-player') as any;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.innerHTML = `<template data-scene="t"><section>x</section></template>${inner}`;
  el.manifest = manifest;
  document.body.append(el);
  el.paint();
  return el;
};
const CONTROLS = '<div class="controls"><button id="b" data-explainer-action="toggle">go</button><span id="tm" data-explainer-display="time"></span><span id="du" data-explainer-display="duration"></span><span id="rm" data-explainer-display="remaining"></span></div>';
const click = (el: any) => el.dispatchEvent(new window.Event('click', { bubbles: true }));

test('poster: children marked data-explainer-poster are the poster; the rest are kept and lay out after the stage', () => {
  const el = make({ canvas: '1280x720' }, `<section data-explainer-poster id="po">static</section>${CONTROLS}`);
  const po = el.querySelector('#po'), controls = el.querySelector('.controls');
  assert.equal(po.getAttribute('data-explainer-poster'), 'hidden');
  assert.equal(controls.hasAttribute('data-explainer-poster'), false, 'controls stay');
  const kids = Array.from(el.children as ArrayLike<any>).filter((c) => c.localName !== 'template' && c.localName !== 'script');
  assert.equal(kids.indexOf(controls), kids.length - 1);
  assert.ok(kids.indexOf(controls) > kids.findIndex((c: any) => c.style?.position === 'relative'), 'stage comes before the controls');
});

test('poster: with none marked, every child other than template and script is the poster (earlier behaviour)', () => {
  const el = make({ canvas: '1280x720' }, '<p id="p1">a</p><p id="p2">b</p>');
  assert.equal(el.querySelector('#p1').getAttribute('data-explainer-poster'), 'hidden');
  assert.equal(el.querySelector('#p2').getAttribute('data-explainer-poster'), 'hidden');
});

test('layers: cues are "under" (default) or "over" the media, in two canvas layers', () => {
  const el = make({ canvas: '1280x720' }, '');
  const cv = el.querySelector('[data-canvas]');
  assert.equal(cv.children.length, 2);
  const [under, over] = Array.from(cv.children as ArrayLike<any>);
  assert.equal(under.querySelectorAll('[data-scene-root]').length, 1);
  assert.equal(over.querySelectorAll('[data-scene-root]').length, 1);
  assert.ok(under.compareDocumentPosition(over) & 4, 'over follows under in DOM (paints above)');
  assert.equal(over.getAttribute('style').includes('pointer-events:none'), true);
});

test('state, progress, time event, readouts, and the toggle / restart / scrub actions', () => {
  const el = make({}, `${CONTROLS}`);
  const events: any[] = [];
  el.addEventListener('explainer:time', (e: any) => events.push(e.detail));
  el.paint();
  assert.equal(el.getAttribute('data-state'), 'poster');
  assert.equal(el.style.getPropertyValue('--explainer-progress'), '0');
  assert.deepEqual([el.querySelector('#tm').textContent, el.querySelector('#du').textContent, el.querySelector('#rm').textContent], ['0:00', '0:12', '0:12']);
  el.command({ action: 'toggle' }); el.paint();
  assert.equal(el.getAttribute('data-state'), 'playing');
  el.command({ action: 'toggle' }); el.paint();
  assert.equal(el.getAttribute('data-state'), 'paused');
  el.command({ action: 'scrub', f: 0.25 }); el.paint();
  assert.equal(el.clock.t, 3);
  assert.equal(el.style.getPropertyValue('--explainer-progress'), '0.25');
  assert.equal(el.querySelector('#tm').textContent, '0:03');
  assert.equal(el.querySelector('#rm').textContent, '0:09');
  assert.deepEqual(events.at(-1), { segmentId: 'a', t: 3, duration: 12 });
  const n = events.length; el.paint(); assert.equal(events.length, n, 'no event when t did not change');
  el.command({ action: 'scrub', by: -5 }); assert.equal(el.clock.t, 0);
  el.command({ action: 'scrub', by: 50 }); el.paint();
  assert.equal(el.getAttribute('data-state'), 'ended');
  el.command({ action: 'toggle' }); el.paint();
  assert.equal(el.getAttribute('data-state'), 'playing');
  assert.equal(el.clock.t, 0, 'from the end, toggle plays from the start');
  el.command({ action: 'scrub', f: 0.5 });
  el.command({ action: 'restart' }); el.paint();
  assert.equal(el.clock.t, 0);
  assert.equal(el.getAttribute('data-state'), 'playing');
});

test('click on the stage toggles; on an action element or a kept control it does not; click-to-play="false" and play="enter" turn it off', () => {
  const el = make({}, CONTROLS);
  const stage = el.querySelector('[data-scene-root]');
  click(stage); el.paint();
  assert.equal(el.getAttribute('data-state'), 'playing');
  click(stage); el.paint();
  assert.equal(el.getAttribute('data-state'), 'paused');
  click(el.querySelector('#b')); el.paint(); // outside the stage, and an action element: the player's own click handler ignores it
  assert.equal(el.getAttribute('data-state'), 'paused');
  const off = make({ 'click-to-play': 'false' }, '');
  click(off.querySelector('[data-scene-root]')); off.paint();
  assert.equal(off.getAttribute('data-state'), 'poster');
  const enter = make({ play: 'enter' }, '');
  click(enter.querySelector('[data-scene-root]')); enter.paint();
  assert.notEqual(enter.getAttribute('data-state'), 'playing');
});
