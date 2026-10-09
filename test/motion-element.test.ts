import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

// A DOM for the element: linkedom plus the few browser globals it touches.
const { document, HTMLElement, Element, customElements, window } = parseHTML('<!doctype html><html><head></head><body></body></html>');
const g = globalThis as any;
Object.defineProperty(document, 'readyState', { value: 'complete' });
let reducedNow = false;
const mqListeners = new Set<() => void>();
const printListeners: Record<string, (() => void)[]> = {};
Object.assign(g, {
  document, HTMLElement, Element, customElements, window,
  matchMedia: () => ({ get matches() { return reducedNow; }, addEventListener: (_: string, f: () => void) => mqListeners.add(f), removeEventListener: (_: string, f: () => void) => mqListeners.delete(f) }),
  addEventListener: (n: string, f: () => void) => (printListeners[n] ??= []).push(f),
  removeEventListener: (n: string, f: () => void) => { printListeners[n] = (printListeners[n] ?? []).filter((x) => x !== f); },
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
  IntersectionObserver: class { observe() {} disconnect() {} },
});

const { ExplainerMotion } = await import('../src/motion-element.ts');
const { corePack, registerComponents, stillP } = await import('../src/components/index.ts');
registerComponents(corePack);
customElements.define('explainer-motion', ExplainerMotion);

const NUM = 'com.semanticops.explainer/numbered-list@1';
const INTRO = 'com.semanticops.explainer/intro@1';
const list = corePack.find((c) => c.meta.renders === NUM)!;

function make(attrs: Record<string, string>, inner = '') {
  const el = document.createElement('explainer-motion') as any;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.innerHTML = inner;
  document.body.append(el);
  return el;
}

const data = { heading: 'H {name}', variant: 'default' };
const items = ['one', 'two', { text: 'three' }];

test('seek(p) renders exactly what render() gives at that p', () => {
  const el = make({ renders: NUM, dur: '5', play: 'manual' });
  el.data = data; el.items = items;
  el.seek(0.3);
  const { document: d2 } = parseHTML('<div id="h"></div>');
  const node = list.mount(d2.getElementById('h')!, data);
  list.render(node, 0.3, data, {}, items, 5);
  assert.equal(el.innerHTML, (node as any).parentNode.innerHTML);
});

test('any order of seeks gives the same DOM at p=0.3', () => {
  const at = (via: number[]) => {
    const el = make({ renders: NUM, dur: '5', play: 'manual' });
    el.data = data; el.items = items;
    for (const p of via) el.seek(p);
    el.seek(0.3);
    return el.innerHTML;
  };
  const direct = at([]);
  for (const via of [[1], [0], [0.9, 0.1], [1, 0, 0.55]]) assert.equal(at(via), direct);
});

test('variables fill {name} and repaint on change', () => {
  const el = make({ renders: NUM, dur: '5', play: 'manual' });
  el.data = { heading: 'Hi {who}' };
  el.seek(1);
  assert.match(el.querySelector('h2').textContent, /^Hi $/);
  el.store.set('who', 'Ada');
  assert.equal(el.querySelector('h2').textContent, 'Hi Ada');
});

test('data and items come from a child JSON script; static children are replaced', () => {
  const el = make({ renders: NUM, dur: '5', play: 'manual' },
    '<p id="still">static</p><script type="application/json">{"data":{"heading":"FromJson"},"items":["x","y"]}</script>');
  el.seek(1);
  assert.equal(el.querySelector('#still'), null);
  assert.equal(el.querySelector('h2').textContent, 'FromJson');
  assert.equal(el.querySelectorAll('li').length, 2);
});

test('an unregistered component leaves the static children in place, and mounts when its pack registers', async () => {
  const warn = console.warn; const seen: string[] = [];
  console.warn = (m: string) => seen.push(m);
  try {
    const el = make({ renders: 'nope@1', play: 'manual' }, '<p id="still">static</p>');
    assert.ok(el.querySelector('#still'));
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(seen.length, 1);
    registerComponents([{ ...list, meta: { ...list.meta, renders: 'nope@1' } }]);
    assert.equal(el.querySelector('#still'), null);
    assert.ok(el.querySelector('h2'));
  } finally { console.warn = warn; }
});

test('a component without the web surface warns once and still renders', () => {
  const warn = console.warn; const seen: string[] = [];
  console.warn = (m: string) => seen.push(m);
  try {
    const video = { ...list, meta: { ...list.meta, renders: 'test/video-only@1', surfaces: ['video' as const] } };
    registerComponents([video]);
    const a = make({ renders: video.meta.renders, play: 'manual' }); a.data = { heading: 'V' }; a.seek(1);
    const b = make({ renders: video.meta.renders, play: 'manual' }); b.data = { heading: 'V' }; b.seek(1);
    assert.equal(seen.filter((m) => m.includes('"web"')).length, 1);
    assert.equal(a.querySelector('h2').textContent, 'V');
  } finally { console.warn = warn; }
});

test('print shows the still and afterprint restores; reduced motion shows the still', () => {
  const lt = { variant: 'lower-third', title: 'T' };
  const el = make({ renders: INTRO, dur: '10', play: 'manual', variant: 'lower-third' });
  el.data = lt;
  const intro = corePack.find((c) => c.meta.renders === INTRO)!;
  const stillAt = stillP(intro, lt, [], 10);
  assert.equal(stillAt, 0.5);
  el.seek(0);
  const at0 = el.innerHTML;
  printListeners.beforeprint!.forEach((f) => f());
  const printed = el.innerHTML;
  assert.notEqual(printed, at0);
  el.seek(0); // painting under print stays on the still
  assert.equal(el.innerHTML, printed);
  printListeners.afterprint!.forEach((f) => f());
  assert.equal(el.innerHTML, at0);

  reducedNow = true; mqListeners.forEach((f) => f());
  assert.equal(el.innerHTML, printed);
  el.seek(0);
  assert.equal(el.innerHTML, printed);
  reducedNow = false; mqListeners.forEach((f) => f());
  assert.equal(el.innerHTML, at0);
});
