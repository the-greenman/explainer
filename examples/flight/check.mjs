// Headless-Chromium checks of the flight example.
//   npx vite --port 5199 --strictPort &      (from the repo root)
//   node examples/flight/check.mjs [shotDir]      (default: <os tmpdir>/explainer-flight/index, or $SHOTS)
// Order independence, rest placement, leaving the stage, render mode, scroll during flight, reverse, paint cost. Exit 1 on a failed assertion.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// playwright: PLAYWRIGHT=/path/to/playwright/index.mjs, else the srs-web install named in CLAUDE.md, else the `playwright` package
const PW = process.env.PLAYWRIGHT ?? '/home/greenman/dev/semanticops/srs-web/node_modules/playwright/index.mjs';
const { chromium } = await import(PW).catch(() => import('playwright'));

const BASE = process.env.URL ?? 'http://localhost:5199/examples/flight/index.html';
const SHOTS = process.argv[2] ?? process.env.SHOTS ?? join(tmpdir(), 'explainer-flight', 'index');
mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const rectNear = (a, b, tol = 1) => a && b && near(a.x, b.x, tol) && near(a.y, b.y, tol) && near(a.w, b.w, tol) && near(a.h, b.h, tol);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
await page.goto(BASE);
await page.waitForFunction(() => document.querySelectorAll('[data-flight-layer]').length === 3 && document.querySelector('#p1').clock && document.querySelector('#p2').clock && document.querySelector('#p3').clock);

const cfg = [
  { n: 1, p: '#p1', home: ['#logo1'], layer: 0 },
  { n: 2, p: '#p2', home: ['#logo2', '#land2'], layer: 1 },
];
// seek, wait for two frames, then report the world
const at = (c, t, scroll = false) => page.evaluate(async ({ c, t, scroll }) => {
  const p = document.querySelector(c.p); if (!scroll) p.scrollIntoView({ block: 'center' }); p.seek(t);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  document.querySelectorAll('explainer-flight').forEach((f) => f.flush()); // paints are batched per frame; flush so the read is of the settled state
  const flier = document.querySelectorAll('[data-flight-layer]')[c.layer].firstChild;
  const rc = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
  const on = getComputedStyle(flier).display !== 'none';
  const stage = p.querySelector('[data-canvas]').parentElement.getBoundingClientRect();
  const cv = p.querySelector('[data-canvas]').getBoundingClientRect(), sc = cv.width / 1280;
  return {
    t: p.clock.t, flier: on ? rc(flier) : null, style: flier.getAttribute('data-s') ?? '', op: on ? getComputedStyle(flier).opacity : null,
    homes: c.home.map((h) => getComputedStyle(document.querySelector(h)).visibility),
    stage: { x: stage.left, y: stage.top, w: stage.width, h: stage.height },
    canvasBR: { x: cv.left + 1136 * sc, y: cv.top + 576 * sc, w: 96 * sc, h: 96 * sc },
    homeRects: c.home.map((h) => rc(document.querySelector(h))),
  };
}, { c, t, scroll });
const sig = (r) => JSON.stringify([r.flier, r.homes, r.style]);

// ---- order independence
const times = [0, 0.4, 0.9, 1.3, 2.5, 4.9, 5.4, 6.1, 6.3, 7, 8.2, 8.7, 9.2, 9.7, 10];
for (const c of cfg) {
  const fwd = new Map();
  for (const t of times) fwd.set(t, sig(await at(c, t)));
  const shuf = [...times].sort((a, b) => ((a * 7919) % 13) - ((b * 7919) % 13));
  let same = true;
  for (const t of shuf) if (sig(await at(c, t)) !== fwd.get(t)) { same = false; console.log('   differs at', t); }
  for (const t of [...times].reverse()) if (sig(await at(c, t)) !== fwd.get(t)) { same = false; console.log('   differs (reverse order) at', t); }
  ok(same, `player ${c.n}: same flier/homes for the same t in forward, shuffled and reverse order (${times.length} times)`);
}

// ---- player 1 placement
let r = await at(cfg[0], 0);
ok(!r.flier && r.homes[0] === 'hidden', 'p1 t=0: object absent (no flier, home hidden)');
r = await at(cfg[0], 7);
ok(r.flier && rectNear(r.flier, r.canvasBR) && r.homes[0] === 'hidden', 'p1 t=7: flier on the canvas anchor within 1px, home hidden');
r = await at(cfg[0], 6.1);
ok(r.flier && Number(r.op) < 1 && r.flier.w > 0, `p1 t=6.1: popping (opacity ${r.op})`);
r = await at(cfg[0], 10);
ok(!r.flier && r.homes[0] === 'visible', 'p1 t=10: flier hidden, the real logo visible');
let straddle = null;
for (let t = 8; t <= 9.4; t += 0.05) { r = await at(cfg[0], t); if (r.flier && r.flier.y < r.stage.y + r.stage.h && r.flier.y + r.flier.h > r.stage.y + r.stage.h) { straddle = t; break; } }
ok(straddle !== null, `p1: flier straddles the bottom edge of the stage at t=${straddle?.toFixed(2)} (it leaves the video)`);
r = await at(cfg[0], straddle ?? 8.7);
await page.screenshot({ path: join(SHOTS, 'p1-mid-flight-straddle.png') });
r = await at(cfg[0], 9.1);
ok(r.flier && r.flier.y >= r.stage.y + r.stage.h - r.flier.h, 'p1 t=9.1: flier is below/at the stage edge');
await at(cfg[0], 6.25); await page.screenshot({ path: join(SHOTS, 'p1-pop-6.25.png') });

// ---- player 2 placement
const anchorRect = (sel) => page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }, sel);
r = await at(cfg[1], 0);
ok(!r.flier && r.homes[0] === 'visible' && r.homes[1] === 'hidden', 'p2 t=0: header logo visible, landing home hidden, no flier');
r = await at(cfg[1], 3);
ok(r.flier && rectNear(r.flier, await anchorRect('#bl-a')) && r.homes.every((h) => h === 'hidden'), 'p2 t=3: flier on the scene anchor #bl-a, both homes hidden');
r = await at(cfg[1], 7.5);
const a0 = await anchorRect('#bl-a'), b0 = await anchorRect('#bl-b');
console.log(`   t=7.5: #bl-a rect ${JSON.stringify(a0)} (scene a hidden), #bl-b ${JSON.stringify(b0)}`);
ok(a0.w === 0 && r.flier && rectNear(r.flier, b0), 'p2 t=7.5: scene a hidden (zero rect); comma-list anchor follows scene b; flier on #bl-b');
r = await at(cfg[1], 4.9);
console.log(`   t=4.9 (crossfade): flier ${JSON.stringify(r.flier)}, #bl-a ${JSON.stringify(await anchorRect('#bl-a'))}`);
r = await at(cfg[1], 0.9);
ok(r.flier && r.flier.y < (await anchorRect('#bl-a')).y, 'p2 t=0.9: mid-fall into the canvas, above the anchor');
await page.screenshot({ path: join(SHOTS, 'p2-mid-flight-0.9.png') });
r = await at(cfg[1], 9.5);
ok(r.flier && r.flier.y + r.flier.h > r.stage.y + r.stage.h, 'p2 t=9.5: flier is out of the bottom of the stage');
const before = r.flier;
await page.screenshot({ path: join(SHOTS, 'p2-mid-flight-9.5.png') });
r = await at(cfg[1], 10);
ok(!r.flier && r.homes[1] === 'visible' && r.homes[0] === 'hidden', 'p2 t=10: landed: the landing home is visible, the header logo hidden');


// ---- demo 3: a piece stays behind (home inside a scene template; the ring is data-flight-stays)
const d3 = (t) => page.evaluate(async (t) => {
  const p = document.querySelector('#p3'); p.scrollIntoView({ block: 'start' }); p.seek(t);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  document.querySelectorAll('explainer-flight').forEach((f) => f.flush()); // paints are batched per frame; flush so the read is of the settled state
  const vis = (s) => getComputedStyle(document.querySelector(s)).visibility;
  const fl = document.querySelectorAll('[data-flight-layer]')[2].firstChild;
  const b = fl.getBoundingClientRect(), on = getComputedStyle(fl).display !== 'none';
  const rc = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  return { on, flier: on ? { x: b.left, y: b.top, w: b.width, h: b.height } : null, circles: fl.querySelectorAll('circle').length, clonedIds: fl.querySelectorAll('[id]').length,
    logo: vis('#logo3'), ring: vis('#logo3 [data-flight-stays]'), landRing: vis('#land3 [data-flight-stays]'), land: vis('#land3'), landDot: vis('#land3 circle:not([data-flight-stays])'),
    landRect: rc('#land3'), sceneRect: rc('#logo3'), aria: fl.parentElement.getAttribute('aria-hidden') };
}, t);
let e = await d3(3);
ok(!e.on && e.logo === 'visible' && e.ring === 'visible' && e.land === 'hidden' && e.landRing === 'visible', `demo 3 t=3: whole logo in the scene, no flier, page home hidden but its ring shows (${JSON.stringify({ logo: e.logo, ring: e.ring, land: e.land, landRing: e.landRing })})`);
e = await d3(6.7);
ok(e.on && e.circles === 1 && e.clonedIds === 0 && e.logo === 'hidden' && e.ring === 'visible' && e.landRing === 'visible', `demo 3 t=6.7: dot flies (flier has ${e.circles} circle, no ids), scene logo hidden, ring still visible in the scene`);
ok(e.aria === 'true', 'the flier layer is aria-hidden');
const mid3 = e.flier;
e = await d3(6);
ok(e.on && rectNear(e.flier, e.sceneRect, 1), 'demo 3 t=6: the flier starts exactly on the scene logo');
e = await d3(8.4);
ok(!e.on && e.logo === 'hidden' && e.ring === 'visible' && e.land === 'visible' && e.landDot === 'visible', 'demo 3 t=8.4: landed: page home shows (dot and ring), no flier, scene keeps only the ring');
// scene logo opacity (data-fx fade) does not leak into the flier
await d3(6.7);
const leak = await page.evaluate(() => document.querySelectorAll('[data-flight-layer]')[2].firstChild.querySelector('svg').getAttribute('style'));
ok(!/opacity|--fx-p|clip-path/.test(leak), `demo 3: the flier clone carries no scene choreography styles (${leak})`);
const strip = [];
for (const t of [5.9, 6.3, 6.7, 7.1, 7.5, 8.1]) { await d3(t); const f = join(SHOTS, `d3-${t}.png`); await page.locator('#p3').locator('xpath=ancestor::section').screenshot({ path: f }); strip.push(f); }
await d3(0); // reset
void mid3;

// ---- scroll during a flight
await page.evaluate(() => scrollTo(0, 0));
r = await at(cfg[1], 9.5, true);
const before0 = r.flier;
await page.evaluate(() => scrollTo(0, 150));
await page.waitForTimeout(100);
r = await at(cfg[1], 9.5, true);
const sy = await page.evaluate(() => scrollY);
ok(sy > 0 && near(r.flier.y, before0.y - sy, 1.5) && near(r.flier.x, before0.x, 1), `scroll by ${sy}: flier moved with the page (dy ${r.flier.y - before0.y})`);
await page.evaluate(() => { const p = document.querySelector('#p2'); scrollTo(0, scrollY + p.getBoundingClientRect().bottom - 500); });
await page.waitForTimeout(100);
await page.screenshot({ path: join(SHOTS, 'p2-mid-flight-9.5-scrolled.png') });
// scroll with no explainer:time (paused, no seek): the scroll listener alone repaints
await page.evaluate(() => scrollTo(0, 60));
await page.waitForTimeout(100);
const noSeek = await page.evaluate(() => { const f = document.querySelectorAll('[data-flight-layer]')[1].firstChild.getBoundingClientRect(); return { y: f.top, sy: scrollY }; });
ok(near(noSeek.y, before0.y - noSeek.sy, 1.5), `scroll alone (no time event) repaints: dy ${noSeek.y - before0.y} for scroll ${noSeek.sy}`);
await page.evaluate(() => scrollTo(0, 0));

// ---- reverse: play backwards, then the same t seeked must look identical
await at(cfg[1], 9.8);
const rev = await page.evaluate(async () => {
  const p = document.querySelector('#p2'); p.setRate(-1); p.play();
  await new Promise((r) => setTimeout(r, 700)); p.pause();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  document.querySelectorAll('explainer-flight').forEach((f) => f.flush()); // paints are batched per frame; flush so the read is of the settled state
  const f = document.querySelectorAll('[data-flight-layer]')[1].firstChild;
  return { t: p.clock.t, style: f.getAttribute('data-s') ?? '', on: getComputedStyle(f).display !== 'none' };
});
const again = await at(cfg[1], rev.t);
ok(rev.t < 9.8 && rev.on && rev.style === again.style, `reverse play from 9.8 reached t=${rev.t.toFixed(3)}; flier identical to a seek to that t (moving back up)`);

// ---- paint cost while playing (rAF-driven explainer:time), both flights
const cost = await page.evaluate(async () => {
  const fl = [...document.querySelectorAll('explainer-flight')].slice(0, 2);
  fl.forEach((f) => { f.stats = { paints: 0, ms: 0, max: 0 }; });
  document.querySelector('#p1').seek(0); document.querySelector('#p2').seek(0);
  document.querySelector('#p1').setRate(1); document.querySelector('#p2').setRate(1); document.querySelector('#p1').play(); document.querySelector('#p2').play();
  await new Promise((r) => setTimeout(r, 3000));
  document.querySelector('#p1').pause(); document.querySelector('#p2').pause();
  return fl.map((f) => ({ paints: f.stats.paints, avgMs: +(f.stats.ms / f.stats.paints).toFixed(4), maxMs: +f.stats.max.toFixed(3) }));
});
console.log('   paint cost (3 s of play, two players at once):', JSON.stringify(cost));
ok(cost.every((c) => c.paints > 30 && c.avgMs < 1), 'paint cost under 1 ms average per frame');

// ---- one-frame lag: the flight paints in a requestAnimationFrame after the event that marked it dirty. An anchor inside a moving scene
// element is the worst case, so a probe box is moved by the player's own explainer:time (as a scene's choreography is) at 300 px/s, and a
// second flight rests on it. Recorded, not asserted tightly: the lag is how far the flier trails the probe at the end of each frame.
const lag = await page.evaluate(async () => {
  const p = document.querySelector('#p2');
  const probe = Object.assign(document.createElement('div'), { id: 'lagprobe' });
  probe.style.cssText = 'position:absolute;left:0;top:300px;width:40px;height:40px';
  const tpl = document.createElement('template');
  tpl.innerHTML = '<i id="lagobj" style="display:block;width:40px;height:40px;background:#c00"></i>';
  const fl = document.createElement('explainer-flight');
  fl.setAttribute('for', '#p2');
  fl.innerHTML = '<script type="application/json">{"object":"#lagobj","anchors":[{"selector":"#lagprobe"}],"stops":[{"segment":"s2","at":0,"anchor":0,"fx":"cut"}]}<\/script>';
  document.body.append(probe, tpl, fl);
  p.scrollIntoView({ block: 'center' });
  const px = []; const frames = [];
  p.addEventListener('explainer:time', (e) => { probe.style.left = e.detail.t * 300 + 'px'; probe.dataset.f = String(document.timeline.currentTime); });
  const layer = [...document.querySelectorAll('[data-flight-layer]')].pop();
  // sample at the end of every frame (a task posted from a rAF callback runs after all of that frame's callbacks): the state a frame shows
  let run = true;
  const sample = () => { if (!run) return; requestAnimationFrame(() => setTimeout(() => { px.push(probe.getBoundingClientRect().left - layer.firstChild.getBoundingClientRect().left); sample(); }, 0)); };
  const flush = fl.flush.bind(fl);
  fl.flush = () => { const before = fl.stats.paints; flush(); if (fl.stats.paints > before) frames.push(document.timeline.currentTime - Number(probe.dataset.f)); };
  p.seek(0); p.setRate(1); p.play(); sample();
  await new Promise((r) => setTimeout(r, 1500));
  run = false;
  p.pause();
  await new Promise((r) => setTimeout(r, 50));
  const out = { n: px.length, meanPx: px.reduce((a, b) => a + b, 0) / px.length, maxPx: Math.max(...px.map(Math.abs)), meanFrameMs: frames.reduce((a, b) => a + b, 0) / frames.length };
  probe.remove(); tpl.remove(); fl.remove();
  return out;
});
console.log('   one-frame lag (probe moving 300 px/s inside p2):', JSON.stringify(lag));
ok(lag.n > 30 && lag.maxPx < 12, `the flier trails a moving anchor by at most ${lag.maxPx?.toFixed(1)} px (mean ${lag.meanPx?.toFixed(1)} px); its paint runs ${lag.meanFrameMs?.toFixed(1)} ms after the event that caused it`);

// ---- reduced motion: no in-between frames
const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, reducedMotion: 'reduce' });
const rp = await ctx.newPage();
await rp.goto(BASE);
await rp.waitForFunction(() => document.querySelectorAll('[data-flight-layer]').length === 3 && document.querySelector('#p2').clock);
const red = [];
for (const t of [0.6, 0.9, 1.2, 9.2, 9.5]) {
  red.push(await rp.evaluate(async (t) => {
    document.querySelector('#p2').seek(t);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  document.querySelectorAll('explainer-flight').forEach((f) => f.flush()); // paints are batched per frame; flush so the read is of the settled state
    const f = document.querySelectorAll('[data-flight-layer]')[1].firstChild;
    return { t, on: getComputedStyle(f).display !== 'none', land: getComputedStyle(document.querySelector('#land2')).visibility };
  }, t));
}
console.log('   reduced motion:', JSON.stringify(red));
ok(red[0].on && red[1].on && red[2].on && !red[3].on && red[3].land === 'visible' && red[4].land === 'visible', 'reduced motion: the move is a cut (rest at the stop\'s anchor from its start)');
await ctx.close();

// ---- render attribute: nothing happens
const rpage = await browser.newPage({ viewport: { width: 1100, height: 800 } });
await rpage.goto(BASE + '?render');
await rpage.waitForTimeout(800);
const rend = await rpage.evaluate(() => ({
  layers: document.querySelectorAll('[data-flight-layer]').length,
  styles: ['#logo1', '#logo2', '#land2', '#logo3', '#land3', '#land3 [data-flight-stays]', '#logo3 [data-flight-stays]'].map((s) => document.querySelector(s)?.getAttribute('style') ?? null),
  attr: document.querySelector('#p1').hasAttribute('render'),
}));
ok(rend.attr && rend.layers === 0 && rend.styles.every((s) => !/visibility/.test(s ?? '')), `render attribute: no flight layer, homes untouched: no inline visibility; #logo3's own opacity is the scene's data-fx (${JSON.stringify(rend)})`);

console.log(errors.length ? 'console errors/warnings:\n  ' + errors.join('\n  ') : 'no console errors');
await browser.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
