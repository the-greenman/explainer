// Headless-Chromium checks of guide.html: one object carried through three parts by player clocks and scroll stretches.
//   npx vite --port 5199 --strictPort &      (from the repo root)
//   node examples/flight/check-guide.mjs [shotDir]      (default: <os tmpdir>/explainer-flight/guide, or $SHOTS)
// Both modes (play="enter" and ?mode=scrub). Clocks are controlled by seeking (enter mode: paused first), then a realistic enter run is only recorded.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// playwright: PLAYWRIGHT=/path/to/playwright/index.mjs, else the srs-web install named in CLAUDE.md, else the `playwright` package
const PW = process.env.PLAYWRIGHT ?? '/home/greenman/dev/semanticops/srs-web/node_modules/playwright/index.mjs';
const { chromium } = await import(PW).catch(() => import('playwright'));

const BASE = process.env.URL ?? 'http://localhost:5199/examples/flight/guide.html';
const SHOTS = process.argv[2] ?? process.env.SHOTS ?? join(tmpdir(), 'explainer-flight', 'guide');
mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };
const ANCHORS = ['#logo-h', '#a1', '#a2', '#a2b', '#a3', '#end-home'];
const NAMES = ['header', 'part1', 'part2', 'part2b', 'part3', 'end'];

const browser = await chromium.launch();
const errors = [];
async function open(mode, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${mode}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${mode}: ${m.text()}`); });
  await page.goto(BASE + (mode === 'scrub' ? '?mode=scrub' : ''));
  await page.waitForFunction(() => document.querySelectorAll('[data-flight-layer]').length === 1 && ['#p1', '#p2', '#p3'].every((s) => document.querySelector(s).clock));
  return { ctx, page };
}
const frames = (page) => page.evaluate(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); document.querySelectorAll('explainer-flight').forEach((f) => f.flush()); });
const snap = (page) => page.evaluate(({ ANCHORS, NAMES }) => {
  const fl = document.querySelector('[data-flight-layer]').firstChild;
  const rc = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
  const on = getComputedStyle(fl).display !== 'none', f = on ? rc(fl) : null;
  const vis = (s) => getComputedStyle(document.querySelector(s)).visibility;
  let where = on ? 'moving' : (vis('#logo-h') === 'visible' ? 'header' : vis('#end-home') === 'visible' ? 'end' : 'NOWHERE');
  if (on) ANCHORS.forEach((s, i) => { const a = rc(document.querySelector(s)); if (Math.abs(a.x - f.x) < 1 && Math.abs(a.y - f.y) < 1 && Math.abs(a.w - f.w) < 1) where = NAMES[i]; });
  const onscreen = on ? f.y + f.h > 0 && f.y < innerHeight : where === 'header' ? true : where === 'end' ? rc(document.querySelector('#end-home')).y < innerHeight : false;
  return { y: Math.round(scrollY), on, f: f && Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Math.round(v * 2) / 2])), where, onscreen,
    clocks: ['#p1', '#p2', '#p3'].map((s) => Math.round(document.querySelector(s).clock.t * 100) / 100), hh: vis('#logo-h'), eh: vis('#end-home') };
}, { ANCHORS, NAMES });
const sig = (s) => JSON.stringify([s.on, s.f, s.where, s.hh, s.eh]);
// go to scroll y; enter mode: let the scroll triggers run, then pause every player and put the clocks where the test wants them
async function settle(page, mode, y, K) {
  await page.evaluate((y) => scrollTo(0, y), y);
  await page.waitForTimeout(mode === 'enter' ? 250 : 50);
  if (mode === 'enter') await page.evaluate((K) => ['#p1', '#p2', '#p3'].forEach((s, i) => { const p = document.querySelector(s); p.pause(); p.seek(K[i]); }), K);
  await frames(page);
  return snap(page);
}
const maxY = (page) => page.evaluate(() => document.documentElement.scrollHeight - innerHeight);

for (const mode of ['enter', 'scrub']) {
  console.log(`\n=== mode: ${mode} ===`);
  const { ctx, page } = await open(mode);
  const max = await maxY(page);
  const ys = []; for (let y = 0; y <= max; y += 200) ys.push(y); ys.push(max);
  console.log(`   page height ${max + 800}, ${ys.length} scroll steps`);

  // forward then back, with equal clocks (enter) or the clocks the scroll itself sets (scrub)
  const Ks = mode === 'enter' ? [[2, 0, 0], [2, 5, 0], [2, 10, 0], [10, 10, 10]] : [null];
  for (const K of Ks) {
    const fwd = [], back = [];
    for (const y of ys) fwd.push(await settle(page, mode, y, K));
    for (const y of [...ys].reverse()) back.unshift(await settle(page, mode, y, K));
    let diff = 0;
    ys.forEach((y, i) => { if (sig(fwd[i]) !== sig(back[i])) { diff++; console.log('   differs at y', y, JSON.stringify(fwd[i]), JSON.stringify(back[i])); } });
    ok(diff === 0, `${mode}${K ? ' clocks ' + JSON.stringify(K) : ''}: scroll-back gives the same flier/home state as scroll-forward at all ${ys.length} positions`);
    ok(fwd.every((s) => s.where !== 'NOWHERE'), `${mode}${K ? ' ' + JSON.stringify(K) : ''}: at every position the object is somewhere (flier or a home)`);
    console.log('   trace (y:where' + (mode === 'scrub' ? ' clocks' : '') + '): ' + fwd.map((s) => `${s.y}:${s.where}${s.onscreen ? '' : '(off)'}${mode === 'scrub' ? s.clocks.map((c) => c).join('/') : ''}`).join('  '));
  }

  // fast scroll: jump straight from the top to each part with nothing in between
  for (const [name, sel] of [['part 2', '#part2'], ['part 3', '#part3'], ['the end', '#end-home']]) {
    await settle(page, mode, 0, [0, 0, 0]);
    const y = await page.evaluate((s) => Math.round(scrollY + document.querySelector(s).getBoundingClientRect().top - 200), sel);
    const s = await settle(page, mode, y, [0, 0, 0]);
    ok(s.where !== 'NOWHERE', `${mode} fast scroll straight to ${name}: object is ${s.where}${s.onscreen ? ', on screen' : ', OFF SCREEN (observed)'} clocks ${JSON.stringify(s.clocks)}`);
    if (mode === 'scrub') ok(s.onscreen || name === 'part 2', `scrub: after the jump to ${name} the object is on screen`);
  }

  // reduced motion is checked below; resize: at rest the flier follows its anchor
  await settle(page, mode, 0, [0, 0, 0]);
  if (mode === 'enter') {
    const at3 = () => page.evaluate(() => Math.round(scrollY + document.querySelector('#part3').getBoundingClientRect().top - 120));
    const before = await settle(page, mode, await at3(), [2, 10, 10]);
    await page.setViewportSize({ width: 800, height: 700 });
    await page.waitForTimeout(250);
    const after = await settle(page, mode, await at3(), [2, 10, 10]);
    ok(before.where === 'part3' && after.where === 'part3', `resize 1100x800 -> 800x700: object at ${before.where} before, ${after.where} after (flier ${JSON.stringify(before.f)} -> ${JSON.stringify(after.f)}; it is on the anchor within 1px)`);
    await page.setViewportSize({ width: 1100, height: 800 });
  }

  // reduced motion happens in its own context
  await ctx.close();
}

// ---- filmstrips (scrub mode: the clocks are the scroll, so forward and back are comparable frames)
{
  const { ctx, page } = await open('scrub');
  const max = await maxY(page);
  const ys = []; for (let i = 0; i <= 11; i++) ys.push(Math.round((max * i) / 11));
  const shot = async (y, tag) => { await settle(page, 'scrub', y, null); const f = join(SHOTS, `g-${tag}.png`); await page.screenshot({ path: f }); return f; };
  const fw = [], bw = [];
  for (const [i, y] of ys.entries()) fw.push(await shot(y, `fwd-${String(i).padStart(2, '0')}`));
  for (const [i, y] of [...ys].reverse().entries()) bw.push(await shot(y, `back-${String(i).padStart(2, '0')}`));
  console.log('   filmstrip frames written:', fw.length + bw.length);
  await ctx.close();
}

// ---- sticky header: the flier is drawn above it
{
  const { ctx, page } = await open('enter');
  let hit = null;
  for (let t = 0.5; t <= 1.0 && !hit; t += 0.02) {
    await settle(page, 'enter', 0, [t, 0, 0]);
    const s = await page.evaluate(() => { const h = document.querySelector('header.site').getBoundingClientRect(), f = document.querySelector('[data-flight-layer]').firstChild.getBoundingClientRect(); return { headerBottom: h.bottom, flierTop: f.top, flierBottom: f.bottom }; });
    if (s.flierTop < s.headerBottom && s.flierBottom > s.headerBottom) hit = { t, ...s };
  }
  if (hit) await page.screenshot({ path: join(SHOTS, 'g-over-sticky-header.png') });
  console.log('   fall out of the sticky header:', JSON.stringify(hit));
  ok(!!hit, 'enter: while it falls out of the header the flier straddles the sticky header\'s bottom edge (drawn above it; see g-over-sticky-header.png)');
  await ctx.close();
}

// ---- reduced motion: mid-stretch scroll positions show only rest states
{
  const { ctx, page } = await open('enter', { reducedMotion: 'reduce' });
  const max = await maxY(page);
  let moving = 0, n = 0;
  for (let y = 0; y <= max; y += 100) { const s = await settle(page, 'enter', y, [2, 5, 10]); n++; if (s.where === 'moving') moving++; }
  ok(moving === 0, `reduced motion: at ${n} scroll positions the object is always at an anchor or a home, never between (${moving} in between)`);
  await ctx.close();
}

// ---- reduced motion at load: the players sit at their still time (the end of their segments) but the reader has not reached them
{
  const { ctx, page } = await open('enter', { reducedMotion: 'reduce' });
  await page.waitForTimeout(300);
  await frames(page);
  const s = await snap(page);
  console.log('   reduced motion at load:', JSON.stringify({ where: s.where, clocks: s.clocks }));
  ok(s.where === 'header' || s.where === 'part1', `reduced motion at load (players at their still time ${JSON.stringify(s.clocks)}): the object is at ${s.where}, not pinned at the last player stop`);
  await ctx.close();
}

// ---- ?render: inert
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  // the module runs before DOMContentLoaded, so set the attribute the moment the element is parsed
  await page.addInitScript(() => new MutationObserver(() => document.querySelector('#p2')?.setAttribute('render', '')).observe(document, { childList: true, subtree: true }));
  await page.goto(BASE);
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({ layers: document.querySelectorAll('[data-flight-layer]').length, vis: ['#logo-h', '#end-home'].map((s) => document.querySelector(s).style.visibility) }));
  ok(r.layers === 0 && r.vis.every((v) => !v), `a referenced player with render: no layer, homes untouched (${JSON.stringify(r)})`);
  await ctx.close();
}

// ---- realistic enter run: only recorded
{
  const { ctx, page } = await open('enter');
  const log = [];
  const rec = async (tag) => { const s = await snap(page); log.push(`${tag}: y=${s.y} object ${s.where}${s.onscreen ? '' : ' (off screen)'} clocks ${JSON.stringify(s.clocks)}`); return s; };
  const scrollTo = (y) => page.evaluate((y) => scrollTo(0, y), y);
  const top = (sel, off = 100) => page.evaluate(([s, o]) => Math.round(scrollY + document.querySelector(s).getBoundingClientRect().top - o), [sel, off]);
  await rec('load');
  await scrollTo(await top('#part1')); await page.waitForTimeout(2500); await rec('part 1 in view, 2.5 s');
  const g0 = await top('#gap1', 0), g1 = await top('#part2', 100);
  for (let i = 1; i <= 12; i++) { await scrollTo(Math.round(g0 + ((g1 - g0) * i) / 12)); await page.waitForTimeout(120); if (i % 4 === 0) await rec(`gap ${i}/12`); }
  await page.waitForTimeout(4000); await rec('part 2 in view, +4 s');
  await page.waitForTimeout(7000); await rec('part 2 in view, +11 s (it ended)');
  await scrollTo(await top('#part3')); await page.waitForTimeout(1500); await rec('part 3 in view +1.5 s');
  await scrollTo(await maxY(page)); await page.waitForTimeout(1500); await rec('end of the page');
  await scrollTo(await top('#part2')); await page.waitForTimeout(800); await rec('back at part 2 (p2 still at its end)');
  await scrollTo(await top('#gap1', 0)); await page.waitForTimeout(800); await rec('back in the gap above part 2');
  await scrollTo(0); await page.waitForTimeout(1500); await rec('back at the top, +1.5 s');
  await page.waitForTimeout(10000); await rec('back at the top, +11.5 s');
  console.log('   realistic enter run (recorded, not asserted):\n     ' + log.join('\n     '));
  await ctx.close();
}

console.log(errors.length ? 'console errors/warnings:\n  ' + [...new Set(errors)].join('\n  ') : 'no console errors');
await browser.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
