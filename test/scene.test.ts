import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { scene, sceneStillP, stillP } from '../src/components/index.ts';
import { chooseCanvas, parseCanvas } from '../src/design-canvas.ts';

const BODY = `
<body>
  <explainer-player id="p"><div id="host"></div>
    <template data-scene="a">
      <section class="root">
        <h1 data-at="1" data-for="2" data-fx="write">T</h1>
        <p data-at="2" data-fx="rise">R</p>
        <hr data-at="0" data-for="4" data-fx="wipe">
        <span data-at="3" data-for="1" data-fx="fade" style="color:red">F</span>
        <span data-at="3" data-for="1" data-fx="hl-draw">H</span>
        <i data-at="3" data-for="1">N</i>
        <b class="free">free</b>
      </section>
    </template>
  </explainer-player>
  <template data-scene="a"><section class="root"><h1 class="outside">OUT</h1></section></template>
  <template data-scene="doc-only"><section class="root"><h1 class="doc-only">DOC</h1></section></template>
  <div id="loose"></div>
</body>`;
const { document } = parseHTML(`<!doctype html><html><head></head>${BODY}</html>`);
(globalThis as any).document = document;

const DUR = 10;
const data = { template: 'a' };
const mount = (d: any = data, host = document.getElementById('host')!) => scene.mount(host, d) as HTMLElement;
const style = (el: any, prop: string) => el.style.getPropertyValue(prop);
const fx = (node: any, tag: string) => node.querySelector(tag);

test('--fx-p is clamp01((t - at) / for) with t = p * dur', () => {
  const n = mount();
  const h1 = fx(n, 'h1'); // at 1, for 2
  for (const [t, want] of [[0, 0], [1, 0], [2, 0.5], [3, 1], [9, 1]] as const) {
    scene.render(n, t / DUR, data, {}, [], DUR);
    assert.equal(Number(style(h1, '--fx-p')), want, `t=${t}`);
  }
  scene.render(n, 0.25, data, {}, [], DUR);
  assert.equal(Number(style(fx(n, 'p'), '--fx-p')), 1); // data-for defaults to 0.5, at 2, t 2.5
});

test('data-for defaults to 0.5 s', () => {
  const n = mount();
  scene.render(n, 0.225, data, {}, [], DUR); // t = 2.25 -> (2.25 - 2) / 0.5
  assert.equal(Number(style(fx(n, 'p'), '--fx-p')), 0.5);
});

test('any order of renders gives the same DOM at p=0.3', () => {
  const at = (via: number[]) => {
    const n = mount();
    for (const p of via) scene.render(n, p, data, {}, [], DUR);
    scene.render(n, 0.3, data, {}, [], DUR);
    return n.outerHTML;
  };
  const direct = at([]);
  for (const via of [[1], [0], [0.9, 0.1], [0, 1, 0.5, 0.29]]) assert.equal(at(via), direct, via.join());
});

test('built-in effects set their properties from --fx-p', () => {
  const n = mount();
  scene.render(n, 0.2, data, {}, [], DUR); // t = 2
  const h1 = fx(n, 'h1'); // write at 0.5
  assert.equal(style(h1, 'clip-path'), 'inset(0 50% 0 0)');
  const hr = fx(n, 'hr'); // wipe, at 0 for 4 -> 0.5
  assert.equal(style(hr, 'clip-path'), 'inset(0 0 50% 0)');
  const p = fx(n, 'p'); // rise at 2 -> 0
  assert.equal(Number(style(p, 'opacity')), 0);
  assert.equal(style(p, 'transform'), 'translateY(12.00px)');
  scene.render(n, 0.4, data, {}, [], DUR); // t = 4: rise done
  assert.equal(Number(style(p, 'opacity')), 1);
  assert.equal(style(p, 'transform'), 'translateY(0.00px)');
  assert.equal(style(fx(n, 'h1'), 'clip-path'), 'inset(0 0% 0 0)');
  const fade = fx(n, 'span');
  assert.equal(Number(style(fade, 'opacity')), 1); // t=4: at 3 for 1 -> 1
  assert.ok(/color:red/.test(fade.getAttribute('style')), 'the site\'s own inline style is kept');
});

test('an unknown effect name, and none, set only --fx-p', () => {
  const n = mount();
  scene.render(n, 0.35, data, {}, [], DUR); // t = 3.5 -> 0.5
  for (const el of [n.querySelectorAll('span')[1], fx(n, 'i')]) {
    assert.equal(Number((el as any).style.getPropertyValue('--fx-p')), 0.5);
    assert.equal((el as any).getAttribute('style').replace(/--fx-p:[^;]+;?/, ''), '');
  }
});

test('elements without data-at are untouched', () => {
  const n = mount();
  const before = fx(n, 'b').outerHTML;
  scene.render(n, 0.6, data, {}, [], DUR);
  assert.equal(fx(n, 'b').outerHTML, before);
  assert.equal(n.querySelector('.root')!.getAttribute('style'), null);
});

test('the still of a scene: every element complete, after the last at + for', () => {
  const p = stillP(scene, data, [], DUR); // the last element ends at 4 (hr: 0+4, span: 3+1), h1 at 3, p at 2.5
  assert.equal(p, 0.4);
  const n = mount();
  scene.render(n, 0.123, data, {}, [], DUR);
  scene.render(n, p, data, {}, [], DUR);
  for (const el of Array.from(n.querySelectorAll('[data-at]')) as any[]) assert.equal(Number(el.style.getPropertyValue('--fx-p')), 1);
  assert.equal(style(n, 'opacity'), '1');
});

test('the still allows for the in-fade and stops before the out-fade', () => {
  assert.equal(sceneStillP({}, 10, 4), 0.4);
  assert.equal(sceneStillP({ transition: { in: 'fade', dur: 2 } }, 10, 1), 0.2); // in-fade (2 s) outlasts the choreography
  assert.equal(sceneStillP({ transition: { out: 'fade' } }, 10, 4), 0.4); // default fade 0.4 s: out starts at 9.6
  assert.equal(sceneStillP({ transition: { out: 'fade', dur: 2 } }, 10, 9.5), 0.8); // clamped to where the out-fade begins
  assert.equal(sceneStillP({}, 10, null), 1); // nothing choreographed, cut out: p=1 is complete
  assert.equal(sceneStillP({ transition: { out: 'fade' } }, 10, null), 0.96);
  assert.equal(sceneStillP({}, 0, 4), 1);
});

test('transition: cut by default, fade in and out with dur (default 0.4 s)', () => {
  const op = (d: any, t: number) => { const n = mount(d); scene.render(n, t / DUR, d, {}, [], DUR); return Number(style(n, 'opacity')); };
  assert.equal(op(data, 0), 1);
  assert.equal(op({ template: 'a', transition: { in: 'fade' } }, 0), 0);
  assert.equal(op({ template: 'a', transition: { in: 'fade' } }, 0.2), 0.5);
  assert.equal(op({ template: 'a', transition: { in: 'fade', dur: 2 } }, 1), 0.5);
  assert.equal(op({ template: 'a', transition: { in: 'fade' } }, 5), 1);
  assert.equal(op({ template: 'a', transition: { out: 'fade' } }, 9.8), 0.5);
  assert.equal(op({ template: 'a', transition: { out: 'fade' } }, 10), 0);
  assert.equal(op({ template: 'a', transition: { in: 'cut', out: 'cut' } }, 10), 1);
});

test('the template is found inside the player before the document', () => {
  assert.equal(mount().querySelector('.outside'), null);
  assert.ok(mount().querySelector('h1[data-at]'));
  // outside any player: the document's own template (a loose host)
  const loose = document.getElementById('loose')!;
  assert.ok(scene.mount(loose, { template: 'doc-only' }).querySelector('.doc-only'));
  // not in the player: falls back to the document
  assert.ok(scene.mount(document.getElementById('host')!, { template: 'doc-only' }).querySelector('.doc-only'));
});

test('a missing template mounts an empty scene and still renders', () => {
  const n = scene.mount(document.getElementById('host')!, { template: 'nope' }) as HTMLElement;
  scene.render(n, 0.5, { template: 'nope' }, {}, [], DUR);
  assert.equal(n.children.length, 0);
});

test('the template content is cloned: the template is never touched', () => {
  const tpl = document.querySelector('explainer-player template') as any;
  const before = tpl.innerHTML;
  const n = mount();
  scene.render(n, 0.5, data, {}, [], DUR);
  assert.equal(tpl.innerHTML, before);
});

// ---- design canvas selection (pure) ----
test('parseCanvas reads WxH entries with an optional @<N', () => {
  assert.deepEqual(parseCanvas('1280x720 720x900@<600'), [{ w: 1280, h: 720 }, { w: 720, h: 900, below: 600 }]);
  assert.deepEqual(parseCanvas('  1280X720,  640x360@<400.5 '), [{ w: 1280, h: 720 }, { w: 640, h: 360, below: 400.5 }]);
  assert.deepEqual(parseCanvas('junk 0x5 12x 1280x720@600 800x600'), [{ w: 800, h: 600 }]);
  assert.deepEqual(parseCanvas(''), []);
  assert.deepEqual(parseCanvas(null), []);
});

test('chooseCanvas: the first matching condition wins, an entry with no condition is the fallback', () => {
  const specs = parseCanvas('1280x720 720x900@<600');
  assert.deepEqual(chooseCanvas(specs, 1000), { w: 1280, h: 720 });
  assert.deepEqual(chooseCanvas(specs, 600), { w: 1280, h: 720 }); // under N is strict
  assert.deepEqual(chooseCanvas(specs, 599.9), { w: 720, h: 900, below: 600 });
  assert.deepEqual(chooseCanvas(specs, 0), { w: 720, h: 900, below: 600 });
  const three = parseCanvas('1920x1080 1280x720@<1000 720x900@<600');
  assert.deepEqual(chooseCanvas(three, 800), { w: 1280, h: 720, below: 1000 }); // listed order: the first that holds
  assert.deepEqual(chooseCanvas(three, 500), { w: 1280, h: 720, below: 1000 });
  assert.deepEqual(chooseCanvas(parseCanvas('720x900@<600 1280x720@<1000'), 500), { w: 720, h: 900, below: 600 });
  assert.deepEqual(chooseCanvas(three, 2000), { w: 1920, h: 1080 });
  // every condition fails and there is no fallback: the last entry
  assert.deepEqual(chooseCanvas(parseCanvas('720x900@<600 640x360@<400'), 5000), { w: 640, h: 360, below: 400 });
  assert.equal(chooseCanvas([], 500), undefined);
});
