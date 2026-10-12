// <explainer-flight> in linkedom. linkedom has no layout, so every measured element gets a stubbed getBoundingClientRect; the players
// are plain elements that dispatch `explainer:time`. What linkedom cannot show (real layout, real scroll, real painting) is covered by
// examples/flight/check.mjs and check-guide.mjs in a browser (npm run check:flight).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const { document, HTMLElement, Element, customElements, window } = parseHTML('<!doctype html><html><head></head><body></body></html>');
const g = globalThis as any;
Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
let reduced = false;
const mqListeners = new Set<() => void>();
const winListeners: Record<string, ((e?: any) => void)[]> = {};
const rafQueue: (() => void)[] = [];
const ros: StubRO[] = [];
class StubRO {
  observed = new Set<Element>();
  cb: () => void;
  constructor(cb: () => void) { this.cb = cb; ros.push(this); }
  observe(el: Element) { this.observed.add(el); }
  unobserve(el: Element) { this.observed.delete(el); }
  disconnect() { this.observed.clear(); }
}
Object.assign(g, {
  document, HTMLElement, Element, customElements, window,
  matchMedia: () => ({ get matches() { return reduced; }, addEventListener: (_: string, f: () => void) => mqListeners.add(f), removeEventListener: (_: string, f: () => void) => mqListeners.delete(f) }),
  addEventListener: (n: string, f: () => void) => (winListeners[n] ??= []).push(f),
  removeEventListener: (n: string, f: () => void) => { winListeners[n] = (winListeners[n] ?? []).filter((x) => x !== f); },
  requestAnimationFrame: (f: () => void) => rafQueue.push(f),
  cancelAnimationFrame: () => { rafQueue.length = 0; },
  ResizeObserver: StubRO,
  innerHeight: 800, scrollX: 0, scrollY: 0,
});

const { ExplainerFlight } = await import('../src/experimental/flight/element.ts');
const { scopeFor } = await import('../src/store.ts');
const { registerBuiltInEffects } = await import('../src/experimental/flight/effects/index.ts');
registerBuiltInEffects();
customElements.define('explainer-flight', ExplainerFlight);

type R = { x: number; y: number; w: number; h: number };
const stub = (el: Element, r: R | (() => R)) => {
  (el as any).getBoundingClientRect = () => { const q = typeof r === 'function' ? r() : r; return { left: q.x, top: q.y, right: q.x + q.w, bottom: q.y + q.h, width: q.w, height: q.h }; };
  return el;
};
// a dock has no stubbed rect of its own: it sits where the browser would put it (DOCK_ORIGIN, moved by a "scroll") plus its translate
const DOCK_ORIGIN = { x: 0, y: 0 };
(Element.prototype as any).getBoundingClientRect = function (this: Element) {
  const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(this.getAttribute('style') ?? ''), w = parseFloat((this as any).style.width) || 0, h = parseFloat((this as any).style.height) || 0;
  const l = DOCK_ORIGIN.x + (m ? +m[1] : 0), t = DOCK_ORIGIN.y + (m ? +m[2] : 0);
  return { left: l, top: t, right: l + w, bottom: t + h, width: w, height: h };
};
const $ = (s: string) => document.querySelector(s)!;
const time = (p: Element, segmentId: string, t: number) => p.dispatchEvent(new window.CustomEvent('explainer:time', { detail: { segmentId, t, duration: 10 } }));
const frame = () => { const q = rafQueue.splice(0); q.forEach((f) => f()); };
const layer = () => document.querySelector('[data-flight-layer]');
const flier = () => layer()!.firstChild as HTMLElement;
const docks = () => Array.from(document.querySelectorAll('[data-flight-dock]')) as HTMLElement[];
const dockOn = () => docks().find((d) => d.style.display !== 'none') ?? null;
/** where the object is drawn: the flier's style when it shows, else the shown dock's (a plain rest anchor) */
const placed = () => (shows() ? flier().getAttribute('data-s')! : dockOn()?.getAttribute('style') ?? '');
const shows = () => (flier() as any).style.display !== 'none' && (flier() as any).style.display !== '';

const A0: R = { x: 10, y: 10, w: 40, h: 40 }, A1: R = { x: 300, y: 200, w: 40, h: 40 }, A2: R = { x: 100, y: 1500, w: 40, h: 40 };
const CFG = {
  object: '#logo',
  anchors: [{ selector: '#logo' }, { selector: '#a1' }, { selector: '#end' }],
  stops: [
    { segment: 's1', at: 0, anchor: 0, fx: 'cut' },
    { segment: 's1', at: 1, for: 1, anchor: 1, fx: 'glide' }, // no `player`: the single-player form, the element's `for`
    { player: '#p2', segment: 's2', at: 1, for: 1, anchor: 2, fx: 'glide' },
  ],
};

function page(cfg: any = CFG, o: { p1?: Record<string, string>; p2?: Record<string, string> } = {}) {
  while (document.body.firstChild) document.body.firstChild.remove();
  const html = `<header><svg id="logo"><circle data-flight-stays r="3"></circle><circle r="1"></circle></svg></header>
    <div id="p1"></div><div id="p2"></div><div id="a1"></div><div id="end"></div>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.append(...Array.from(wrap.childNodes));
  for (const [id, a] of [['p1', o.p1], ['p2', o.p2]] as const) for (const [k, v] of Object.entries(a ?? {})) $('#' + id).setAttribute(k, v);
  stub($('#logo'), A0); stub($('#a1'), A1); stub($('#end'), A2); stub($('#p1'), { x: 0, y: 100, w: 600, h: 300 }); stub($('#p2'), { x: 0, y: 1000, w: 600, h: 300 });
  $('#end').setAttribute('data-flight-home', '');
  const el = document.createElement('explainer-flight') as any;
  el.setAttribute('for', '#p1');
  el.innerHTML = `<script type="application/json">${JSON.stringify(cfg)}</script>`;
  document.body.append(el);
  rafQueue.length = 0;
  return el;
}
const reset = () => { DOCK_ORIGIN.x = 0; DOCK_ORIGIN.y = 0; reduced = false; g.scrollX = 0; g.scrollY = 0; rafQueue.length = 0; ros.length = 0; };

test('after flush the flier and the homes match the chain (single-player and multi-player stops)', () => {
  reset();
  const el = page();
  assert.equal(shows(), false, 'rests at the header home: no flier');
  assert.equal(($('#logo') as any).style.visibility, '', 'the home is its own');
  time($('#p1'), 's1', 1.5); el.flush();
  assert.equal(shows(), true, 'mid glide');
  assert.equal(($('#logo') as any).style.visibility, 'hidden', 'the home hides while the object is away');
  time($('#p1'), 's1', 2); el.flush();
  assert.match(placed(), new RegExp(`translate\\(${A1.x}px,${A1.y}px\\)`), 'rests at the anchor of the single-player stop');
  time($('#p2'), 's2', 2); el.flush();
  assert.equal(shows(), false, 'the p2 stop took over: the object rests at the end home, the real element shows instead');
  assert.equal(($('#end') as any).style.visibility, '');
  assert.equal(($('#logo') as any).style.visibility, 'hidden');
  time($('#p2'), 's2', 0.5); time($('#p1'), 's1', 0); el.flush();
  assert.equal(shows(), false, 'reverse: back at the header');
  assert.equal(($('#end') as any).style.visibility, 'hidden');
});

test('events only mark dirty: one paint per frame, one pending frame at a time', () => {
  reset();
  const el = page();
  const before = el.stats.paints;
  time($('#p1'), 's1', 1.2); time($('#p1'), 's1', 1.4); time($('#p1'), 's1', 1.6);
  assert.equal(rafQueue.length, 1, 'one pending requestAnimationFrame');
  assert.equal(el.stats.paints, before, 'nothing painted yet');
  frame();
  assert.equal(el.stats.paints, before + 1, 'one paint for three events');
  el.flush();
  assert.equal(el.stats.paints, before + 1, 'flush paints only when dirty');
  time($('#p1'), 's1', 1.7);
  el.flush();
  assert.equal(el.stats.paints, before + 2, 'flush paints now');
  frame();
  assert.equal(el.stats.paints, before + 2, 'the frame callback that follows finds nothing dirty');
});

test('the same clocks give the same paint in any order of events', () => {
  reset();
  const el = page();
  const sig = () => `${flier().getAttribute('data-s')}|${($('#logo') as any).style.visibility}|${($('#end') as any).style.visibility}`;
  const run = (ts: number[]) => { const out = new Map<number, string>(); for (const t of ts) { time($('#p1'), 's1', t); time($('#p2'), 's2', 0); el.flush(); out.set(t, sig()); } return out; };
  const ts = [0, 0.5, 1.2, 1.8, 2.5, 9];
  const fwd = run(ts), shuf = run([1.8, 9, 0, 2.5, 1.2, 0.5]);
  for (const t of ts) assert.equal(shuf.get(t), fwd.get(t), `t=${t}`);
});

test('a player with the render attribute: no layer, homes untouched', () => {
  reset();
  const el = page(CFG, { p2: { render: '' } });
  time($('#p1'), 's1', 1.5);
  assert.equal(layer(), null);
  assert.equal(rafQueue.length, 0);
  assert.equal(($('#logo') as any).style.visibility, '');
  assert.equal(($('#end') as any).style.visibility, '');
  assert.equal(el.stats.paints, 0);
});

test('data-flight-stays parts stay visible while the object is away, and are restored at the home', () => {
  reset();
  const el = page();
  const ring = $('#logo circle[data-flight-stays]') as any;
  time($('#p1'), 's1', 1.5); el.flush();
  assert.equal(($('#logo') as any).style.visibility, 'hidden');
  assert.equal(ring.style.visibility, 'visible');
  assert.equal(flier().querySelectorAll('circle').length, 1, 'the flier carries the dot, not the ring');
  assert.equal(flier().querySelectorAll('[id]').length, 0, 'no ids in the clone');
  time($('#p1'), 's1', 0); el.flush();
  assert.equal(($('#logo') as any).style.visibility, '');
  assert.equal(ring.style.visibility, '');
});

test('disconnect restores the homes and removes the layer, listeners and pending frame', () => {
  reset();
  const el = page();
  time($('#p1'), 's1', 1.5);
  el.flush();
  time($('#p1'), 's1', 1.6); // a pending frame
  el.remove();
  assert.equal(layer(), null);
  assert.equal(($('#logo') as any).style.visibility, '');
  assert.equal(rafQueue.length, 0, 'pending frame cancelled');
  assert.equal((winListeners.scroll ?? []).length, 0);
  assert.equal((winListeners.load ?? []).length, 0);
  assert.ok(ros.every((r) => r.observed.size === 0));
});

test('reduced motion: players pinned at their still time count only once the reader has reached them', () => {
  reset();
  reduced = true;
  // both players report their END (their still time) from the start, as under reduced motion
  const el = page(CFG, { p1: { play: 'enter', 'data-state': 'paused' }, p2: { play: 'enter', 'data-state': 'paused' } });
  stub($('#p1'), { x: 0, y: 100, w: 600, h: 300 }); // in view: top above the line (400)
  stub($('#p2'), { x: 0, y: 1200, w: 600, h: 300 }); // far below
  time($('#p1'), 's1', 10); time($('#p2'), 's2', 10); el.flush();
  assert.match(placed(), new RegExp(`translate\\(${A1.x}px,${A1.y}px\\)`), 'at part 1, not pinned at the last stop');
  stub($('#p2'), { x: 0, y: 350, w: 600, h: 300 }); // scrolled to it
  time($('#p2'), 's2', 10); el.flush();
  assert.equal(shows(), false);
  assert.equal(($('#end') as any).style.visibility, '', 'now at the end home');
  stub($('#p2'), { x: 0, y: 1200, w: 600, h: 300 }); // scrolled back
  time($('#p2'), 's2', 10); el.flush();
  assert.match(placed(), new RegExp(`translate\\(${A1.x}px,${A1.y}px\\)`), 'back at part 1');
});

test('a player in the poster state contributes nothing', () => {
  reset();
  const el = page(CFG, { p1: { 'data-state': 'poster' } });
  time($('#p1'), 's1', 5); el.flush();
  assert.equal(shows(), false, 'still at the header');
  $('#p1').setAttribute('data-state', 'playing');
  time($('#p1'), 's1', 5); el.flush();
  assert.notEqual(placed(), '', 'at part 1 (a dock)');
});

test('the fallback rect of a hidden anchor is kept in document coordinates', () => {
  reset();
  let box: R = { x: 100, y: 500, w: 50, h: 50 };
  const cfg = { object: '#nothing', anchors: [{ selector: '#sc' }], stops: [{ segment: 's1', at: 0, anchor: 0, fx: 'cut' }] };
  while (document.body.firstChild) document.body.firstChild.remove();
  const w = document.createElement('div');
  w.innerHTML = '<div id="p1"></div><div id="sc"></div><template><i id="nothing"></i></template>';
  document.body.append(...Array.from(w.childNodes));
  stub($('#sc'), () => box);
  const el = document.createElement('explainer-flight') as any;
  el.setAttribute('for', '#p1');
  el.innerHTML = `<script type="application/json">${JSON.stringify(cfg)}</script>`;
  // the object lives in a template (no live element): the flier is cloned from it
  document.body.append(el);
  assert.match(placed(), /translate\(100px,500px\)/, 'docked at the anchor');
  assert.equal(shows(), false);
  box = { x: 0, y: 0, w: 0, h: 0 }; // the scene is hidden: no box
  g.scrollY = 300;
  time($('#p1'), 's1', 1); el.flush();
  assert.match(flier().getAttribute('data-s')!, /translate\(100px,200px\)/, 'the saved rect followed the 300 px scroll');
});

test('layout shifts repaint: the root, the players and the measured elements are observed', () => {
  reset();
  const el = page();
  const ro = ros[ros.length - 1];
  const names = [...ro.observed].map((e) => (e as Element).id || (e as Element).tagName);
  for (const n of ['p1', 'p2', 'a1', 'end', 'logo']) assert.ok(names.includes(n), `observes #${n}`);
  assert.ok([...ro.observed].includes(document.documentElement), 'observes the document element');
  // an observed element moves: the observer callback alone repaints
  time($('#p1'), 's1', 2); el.flush();
  stub($('#a1'), { x: 320, y: 220, w: 40, h: 40 });
  ro.cb();
  el.flush();
  assert.match(placed(), /translate\(320px,220px\)/);
  // and load / fonts
  stub($('#a1'), { x: 330, y: 230, w: 40, h: 40 });
  for (const f of winListeners.load) f();
  el.flush();
  assert.match(placed(), /translate\(330px,230px\)/);
});

test('one DOM query per selector per paint', () => {
  reset();
  const el = page();
  const orig = document.querySelectorAll.bind(document);
  const calls: string[] = [];
  (document as any).querySelectorAll = (s: string) => { calls.push(s); return orig(s); };
  try {
    time($('#p1'), 's1', 1.5); el.flush();
  } finally { (document as any).querySelectorAll = orig; }
  for (const s of ['#logo', '#a1', '#end']) assert.equal(calls.filter((c) => c === s).length, 1, `${s} queried once (${calls.join(' ')})`);
  assert.equal(calls.filter((c) => c === 'template').length, 0, 'templates are not scanned once the flier is built');
});

test('arrival marking: data-flight-here where the object rests, --flight-p on the target while moving (1 at rest), restored on disconnect', () => {
  reset();
  const el = page();
  const mark = (id: string) => ({ here: $('#' + id).hasAttribute('data-flight-here'), p: ($('#' + id) as any).style.getPropertyValue('--flight-p') });
  assert.deepEqual([mark('logo'), mark('a1'), mark('end')], [{ here: true, p: '1' }, { here: false, p: '' }, { here: false, p: '' }], 'rests at the first anchor');
  time($('#p1'), 's1', 1.5); el.flush();
  assert.deepEqual([mark('logo'), mark('a1')], [{ here: false, p: '' }, { here: false, p: '0.5' }], 'moving toward a1: its progress');
  time($('#p1'), 's1', 2); el.flush();
  assert.deepEqual([mark('a1'), mark('end')], [{ here: true, p: '1' }, { here: false, p: '' }], 'landed on a1 (not a home: the flier stays, the page is still marked)');
  time($('#p2'), 's2', 2); el.flush();
  assert.deepEqual([mark('a1'), mark('end')], [{ here: false, p: '' }, { here: true, p: '1' }]);
  time($('#p2'), 's2', 0.5); time($('#p1'), 's1', 0); el.flush();
  assert.deepEqual([mark('logo'), mark('end')], [{ here: true, p: '1' }, { here: false, p: '' }], 'reverse: back at the start');
  el.remove();
  assert.equal(document.querySelectorAll('[data-flight-here]').length, 0);
  assert.equal(($('#logo') as any).style.getPropertyValue('--flight-p'), '');
});

test('arrival marking: nothing in the render mode', () => {
  reset();
  page(CFG, { p2: { render: '' } });
  assert.equal(document.querySelectorAll('[data-flight-here]').length, 0);
});

test('canvas anchors map through the `for` player even when no stop names it', () => {
  reset();
  const cfg = { object: '#logo', anchors: [{ selector: '#logo' }, { canvas: [100, 50, 20, 20] }], stops: [{ player: '#p2', segment: 's2', at: 0, anchor: 0, fx: 'cut' }, { player: '#p2', segment: 's2', at: 1, for: 1, anchor: 1, fx: 'glide' }] };
  const el = page(cfg);
  // the canvases: #p1 (the `for` player) at (0,100) at half scale; #p2 at (0,1000) at full scale
  for (const [id, y, w] of [['p1', 100, 640], ['p2', 1000, 1280]] as const) {
    const c = document.createElement('div');
    c.setAttribute('data-canvas', '1280x720');
    stub(c, { x: 0, y, w, h: w / 16 * 9 });
    $('#' + id).append(c);
  }
  time($('#p2'), 's2', 5); el.flush();
  assert.equal(shows(), false, 'rests in a dock');
  const d = docks()[0];
  assert.equal(d.parentNode, document.querySelector('#p1 [data-canvas]'), 'in the `for` player\'s canvas, not the p2 one');
  assert.match(d.getAttribute('style')!, /left:100px;top:50px;width:20px;height:20px/, 'design px');
});

test('connect, disconnect, connect before the ready wait resolves: one layer; the final disconnect leaves none', async () => {
  reset();
  const el = page();
  el.remove();
  Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
  const listeners: (() => void)[] = [];
  const add = document.addEventListener.bind(document);
  (document as any).addEventListener = (n: string, f: () => void, o?: any) => { if (n === 'DOMContentLoaded') listeners.push(f); else add(n, f, o); };
  try {
    document.body.append(el);
    el.remove();
    document.body.append(el);
  } finally { (document as any).addEventListener = add; Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true }); }
  assert.equal(listeners.length, 2);
  listeners.forEach((f) => f());
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(document.querySelectorAll('[data-flight-layer]').length, 1);
  el.remove();
  assert.equal(document.querySelectorAll('[data-flight-layer]').length, 0);
  assert.equal((winListeners.scroll ?? []).length, 0);
  assert.equal((winListeners.resize ?? []).length, 0);
});

test('data-flight-home is removed from the object on disconnect when the element added it', () => {
  reset();
  const el = page();
  assert.equal($('#logo').hasAttribute('data-flight-home'), true);
  assert.equal($('#end').hasAttribute('data-flight-home'), true);
  el.remove();
  assert.equal($('#logo').hasAttribute('data-flight-home'), false, 'added by the element: removed');
  assert.equal($('#end').hasAttribute('data-flight-home'), true, 'the site\'s own mark stays');
});

test('a missing object selector warns once across many paints and scans templates only at connect and after a segment event', () => {
  reset();
  const warns: string[] = [];
  const w = console.warn; console.warn = (...a: any[]) => { warns.push(a.join(' ')); };
  const orig = document.querySelectorAll.bind(document);
  let scans = 0;
  (document as any).querySelectorAll = (s: string) => { if (s === 'template') scans++; return orig(s); };
  try {
    const el = page({ ...CFG, object: '#nothing' });
    scans = 0;
    for (let i = 0; i < 10; i++) { time($('#p1'), 's1', 0.1 * i); el.flush(); }
    assert.equal(scans, 0, 'no template scan on later paints');
    assert.equal(warns.filter((x) => /#nothing/.test(x)).length, 1, 'warned once');
    $('#p1').dispatchEvent(new window.CustomEvent('explainer:segment', { detail: { id: 's2' } })); el.flush();
    assert.equal(scans, 1, 'one scan after a segment event');
    for (let i = 0; i < 5; i++) { time($('#p1'), 's1', 0.2 * i); el.flush(); }
    assert.equal(scans, 1);
    assert.equal(warns.filter((x) => /#nothing/.test(x)).length, 1, 'still once');
  } finally { console.warn = w; (document as any).querySelectorAll = orig; }
});

// ---- docking and triggered stops
let NOW = 0; // seconds; performance.now() is stubbed to it (the trigger latches read it)
const realNow = globalThis.performance.now.bind(globalThis.performance);
const clockStub = (on: boolean) => Object.defineProperty(globalThis.performance, 'now', { value: on ? () => NOW * 1000 : realNow, configurable: true, writable: true });
const TCFG = (on: any, extra: any = {}) => ({ object: '#logo', anchors: [{ selector: '#logo' }, { selector: '#a1' }], stops: [{ segment: 's1', at: 0, anchor: 0, fx: 'cut' }, { on, for: 1, anchor: 1, fx: 'glide', ...extra }] });

test('dock: at a plain rest anchor the object is an aria-hidden clone inside the anchor and the fixed flier hides; a scroll writes nothing', () => {
  reset();
  const el = page();
  time($('#p1'), 's1', 2); el.flush();
  const d = dockOn()!;
  assert.ok(d, 'a dock shows');
  assert.equal(d.parentNode, $('#a1'), 'last child of the anchor');
  assert.equal($('#a1').lastChild, d);
  assert.equal(d.getAttribute('aria-hidden'), 'true');
  assert.equal(shows(), false, 'the fixed flier is hidden');
  assert.equal(d.querySelectorAll('[id]').length, 0, 'no ids in the clone');
  assert.equal(d.querySelectorAll('circle').length, 1, 'the stays part is not in the clone');
  assert.match(d.getAttribute('style')!, /position:absolute/);
  assert.equal(($('#a1') as any).style.position, '', 'the anchor itself is untouched');
  const before = d.getAttribute('style');
  stub($('#a1'), { x: A1.x, y: A1.y - 150, w: A1.w, h: A1.h }); DOCK_ORIGIN.y -= 150; // the page scrolled: the browser moved both
  g.scrollY = 150; for (const f of winListeners.scroll ?? []) f();
  el.flush();
  assert.equal(d.getAttribute('style'), before, 'a scroll changes no dock style');
  assert.equal(shows(), false);
  stub($('#a1'), { x: A1.x + 30, y: A1.y - 150, w: A1.w, h: A1.h }); // the anchor moved in the page: the dock follows
  time($('#p1'), 's1', 2.1); el.flush();
  assert.match(d.getAttribute('style')!, /translate\(330px,200px\)/);
});

test('dock: hides and the flier shows on take-off; shows again on landing; a void anchor gets the dock after it', () => {
  reset();
  const el = page();
  time($('#p1'), 's1', 2); el.flush();
  time($('#p2'), 's2', 1.5); el.flush();
  assert.equal(!!dockOn(), false, 'no dock while moving');
  assert.equal(shows(), true);
  time($('#p2'), 's2', 0); time($('#p1'), 's1', 2); el.flush();
  assert.ok(dockOn());
  assert.equal(shows(), false);
  // void host: img
  const img = document.createElement('img'); img.id = 'a1'; $('#a1').replaceWith(img); stub(img, A1);
  time($('#p1'), 's1', 0); el.flush(); time($('#p1'), 's1', 2); el.flush();
  const d = dockOn()!;
  assert.equal(d.parentNode, document.body, 'beside the img, not inside it');
  assert.equal(img.nextSibling, d);
});

test('dock: none at a data-flight-home anchor (the real element shows)', () => {
  reset();
  const el = page();
  assert.equal(docks().length, 0, 'at the header home');
  time($('#p2'), 's2', 2); el.flush();
  assert.equal(docks().length, 0, 'at the end home');
  assert.equal(shows(), false);
  assert.equal(($('#end') as any).style.visibility, '');
});

test('dock: a canvas anchor docks in the canvas in design px; removed on disconnect', () => {
  reset();
  const cfg = { object: '#logo', anchors: [{ selector: '#logo' }, { canvas: [100, 50, 20, 30] }], stops: [{ segment: 's1', at: 0, anchor: 0, fx: 'cut' }, { segment: 's1', at: 1, for: 1, anchor: 1, fx: 'glide' }] };
  const el = page(cfg);
  const c = document.createElement('div'); c.setAttribute('data-canvas', '1280x720'); stub(c, { x: 0, y: 100, w: 640, h: 360 }); $('#p1').append(c);
  time($('#p1'), 's1', 3); el.flush();
  const d = docks()[0];
  assert.equal(d.parentNode, c);
  assert.match(d.getAttribute('style')!, /left:100px;top:50px;width:20px;height:30px/);
  assert.equal(shows(), false);
  el.remove();
  assert.equal(docks().length, 0);
  assert.equal(c.childNodes.length, 0);
});

test('dock: removed on disconnect, and the anchor is left as it was', () => {
  reset();
  const el = page();
  time($('#p1'), 's1', 2); el.flush();
  assert.equal(docks().length, 1);
  el.remove();
  assert.equal(docks().length, 0);
  assert.equal($('#a1').childNodes.length, 0);
});

test('trigger stop: go / back drive it through the latch (stubbed clock); frames run only while it moves', () => {
  clockStub(true); reset(); NOW = 100;
  const el = page(TCFG({ name: 'takeoff' }));
  assert.equal(shows(), false, 'before: at the home');
  el.go('takeoff'); frame();
  assert.equal(shows(), true, 'just started: moving');
  assert.equal(rafQueue.length, 1, 'still moving: another frame is queued');
  NOW = 100.5; frame();
  assert.equal(shows(), true);
  assert.match(flier().getAttribute('data-s')!, /translate\(155px,105px\)/, 'half way');
  NOW = 101; frame();
  assert.equal(shows(), false, 'landed in a dock');
  assert.ok(dockOn());
  assert.equal(rafQueue.length, 0, 'at rest: no frame loop');
  el.back('takeoff'); NOW = 101.25; frame();
  assert.equal(shows(), true, 'flying back');
  assert.match(flier().getAttribute('data-s')!, /translate\(\s*2[0-9.]+px,/, 'a quarter of the way back (from the same rect, no jump)');
  NOW = 102; frame();
  assert.equal(shows(), false);
  assert.equal(!!dockOn(), false);
  assert.equal(($('#logo') as any).style.visibility, '', 'back at the home');
  el.toggle('takeoff'); NOW = 103; frame();
  assert.ok(dockOn(), 'toggle on');
  el.toggle('takeoff'); NOW = 104; frame();
  assert.equal(!!dockOn(), false, 'toggle off');
  el.go('other'); assert.equal(rafQueue.length, 0, 'an unknown name does nothing');
});

test('trigger stop: a reversal half way is continuous', () => {
  clockStub(true); reset(); NOW = 10;
  const el = page(TCFG({ name: 'k' }));
  el.go('k'); NOW = 10.5; el.flush();
  el.back('k'); NOW = 10.5; frame(); el.flush();
  assert.match(flier().getAttribute('data-s')!, /translate\(155px,105px\)/, 'the same place at the instant of the reversal');
  NOW = 10.75; frame();
  assert.match(flier().getAttribute('data-s')!, /translate\(28\.125px,/, 'going back toward the home');
});

test('trigger stop: a store variable fires it (and one already true at load is finished, not animated)', () => {
  clockStub(true); reset(); NOW = 200;
  const store = scopeFor(document.body);
  store.set('stepA', 'one');
  const el = page(TCFG({ var: 'stepA', value: 'two' }));
  assert.equal(shows(), false);
  store.set('stepA', 'two'); NOW = 200.5; el.flush();
  assert.equal(shows(), true, 'moving');
  NOW = 201; el.flush();
  assert.ok(dockOn(), 'landed');
  store.set('stepA', 'one'); NOW = 202; el.flush();
  assert.equal(!!dockOn(), false, 'unset: back home');
  el.remove();
  store.set('stepA', 'two'); // unsubscribed: nothing throws, nothing paints
  store.set('stepB', 'two');
  const el2 = page(TCFG({ var: 'stepB', value: 'two' }));
  assert.ok(dockOn(), 'true at load: already landed');
  assert.equal(shows(), false);
  el2.remove();
});

test('trigger stop: reduced motion settles it', () => {
  clockStub(true); reset(); NOW = 300; reduced = true;
  const el = page(TCFG({ name: 'r' }));
  el.go('r'); frame();
  assert.ok(dockOn(), 'finished at once');
  assert.equal(rafQueue.length, 0);
});

test('(restore the real clock)', () => { clockStub(false); });
