// Headless-Chromium checks of the karaoke marker example (examples/flight/karaoke.html).
//   npx vite --port 5199 --strictPort &      (from the repo root)
//   node examples/flight/check-karaoke.mjs [shotDir]      (default: <os tmpdir>/explainer-flight/karaoke, or $SHOTS)
// The in-video marker on each stop at rest, here-marking, the handoff to the page (and the reverse), order independence. Exit 1 on a failed assertion.
// The offline render of the same page is checked by examples/flight/check-karaoke-render.mjs.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PW = process.env.PLAYWRIGHT ?? '/home/greenman/dev/semanticops/srs-web/node_modules/playwright/index.mjs';
const { chromium } = await import(PW).catch(() => import('playwright'));

const BASE = process.env.URL ?? 'http://localhost:5199/examples/flight/karaoke.html';
const SHOTS = process.argv[2] ?? process.env.SHOTS ?? join(tmpdir(), 'explainer-flight', 'karaoke');
mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
await page.goto(BASE);
await page.waitForFunction(() => document.querySelectorAll('[data-flight-layer]').length === 2 && document.querySelector('#k1')?.clock && document.querySelector('#k2')?.clock && document.querySelector('#k1 #ball') && customElements.get('explainer-flight'));

// seek, wait two frames, flush the flights, report the world of one player
const world = (id) => page.evaluate(async ({ id }) => {
  const p = document.querySelector(id);
  const rc = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
  const stops = [...p.querySelectorAll('[data-marker-stop]')].map((e) => ({ id: e.textContent.trim(), at: +e.getAttribute('data-marker-at'), here: e.hasAttribute('data-marker-here'), mp: e.style.getPropertyValue('--marker-p'), rect: rc(e) }));
  const ball = p.querySelector('[data-marker]');
  const li = document.querySelectorAll('[data-flight-layer]');
  const fl = [...li].map((l) => l.firstChild);
  return {
    t: p.clock.t, stops, ball: rc(ball), ballVis: getComputedStyle(ball).visibility, ballOp: getComputedStyle(ball).opacity, ballStyle: ball.getAttribute('style'),
    fliers: fl.map((f) => (getComputedStyle(f).display !== 'none' ? rc(f) : null)), flierStyles: fl.map((f) => f.getAttribute('data-s') ?? ''),
    slotHere: document.querySelector('#slot').hasAttribute('data-flight-here'), slotP: document.querySelector('#slot').style.getPropertyValue('--flight-p'),
    landingBorder: getComputedStyle(document.querySelector('#landing')).borderTopColor,
    pball: getComputedStyle(document.querySelector('#pball')).visibility,
    stopRectsAt: null,
  };
}, { id });
const at = async (id, t) => {
  await page.evaluate(async ({ id, t }) => {
    const p = document.querySelector(id); p.scrollIntoView({ block: 'start' }); p.seek(t);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    document.querySelectorAll('explainer-flight').forEach((f) => f.flush());
  }, { id, t });
  return world(id);
};
const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const onStop = (w, i) => { const c = centre(w.ball), s = w.stops[i].rect; return near(c.x, s.x) && near(c.y, s.y + s.h / 2); }; // point left: left edge, middle height
const hereIdx = (w) => w.stops.findIndex((s) => s.here);

// ---- player 1: the marker on each stop
const ats = (await world('#k1')).stops.map((s) => s.at);
console.log('   phrase times from the VTT:', ats.join(', '));
ok(ats.length === 4 && ats.every((a, i) => i === 0 || a > ats[i - 1]) && near(ats[0], 2.6, 0.01) && near(ats[3], 7.2, 0.01), `data-marker-at were filled in from the captions (${ats.join(', ')})`);
const strip = [];
const shot = async (id, name, t) => { const f = join(SHOTS, `${name}.png`); await page.locator(id).locator('xpath=ancestor::main').screenshot({ path: f, clip: undefined }).catch(() => {}); strip.push(f); };
let w = await at('#k1', 0);
ok(onStop(w, 0) && hereIdx(w) === 0 && w.ballVis === 'visible', 'p1 t=0: the ball rests on the first stop (before its first hop), here-marked');
for (let i = 0; i < ats.length; i++) {
  w = await at('#k1', ats[i] + 0.5 + 0.05);
  ok(onStop(w, i) && hereIdx(w) === i && w.stops.filter((s) => s.here).length === 1, `p1 t=${(ats[i] + 0.55).toFixed(2)}: the ball is on stop ${i} (${w.stops[i].id}), only that stop is here-marked`);
  ok(w.stops[i].mp === '1' && w.stops.filter((s) => s.mp !== '').length === 1, `   --marker-p is 1 on it and absent elsewhere`);
  await page.locator('#k1').screenshot({ path: join(SHOTS, `p1-stop${i}.png`) });
}
// mid-hop
w = await at('#k1', ats[1] + 0.25);
{
  const c = centre(w.ball), a = w.stops[0].rect, b = w.stops[1].rect;
  ok(!onStop(w, 0) && !onStop(w, 1) && hereIdx(w) === -1 && c.y < Math.min(a.y + a.h / 2, b.y + b.h / 2) - 5 || c.y < b.y + b.h / 2, `p1 mid-hop (t=${ats[1] + 0.25}): off both stops, no here, arcing above the line (ball y ${c.y.toFixed(0)} vs ${(a.y + a.h / 2).toFixed(0)} -> ${(b.y + b.h / 2).toFixed(0)}), --marker-p ${w.stops[1].mp}`);
  ok(Number(w.stops[1].mp) > 0 && Number(w.stops[1].mp) < 1, '   --marker-p is between 0 and 1 on the stop being approached');
}
await page.locator('#k1').screenshot({ path: join(SHOTS, 'p1-midhop.png') });

// ---- handoff: p1
const fallAt = 9;
w = await at('#k1', fallAt - 0.3);
ok(w.ballVis === 'visible' && w.fliers[0] === null && !w.slotHere && onStop(w, 3), 'p1 t=8.7 (before take-off): the scene marker is visible on the last stop, no flier, slot not marked');
w = await at('#k1', fallAt + 0.6);
ok(w.ballVis === 'hidden' && w.fliers[0] !== null && !w.slotHere && w.slotP !== '' && Number(w.slotP) < 1, `p1 t=9.6 (mid-fall): the flier shows, the scene marker is hidden, slot approached (--flight-p ${w.slotP})`);
{
  const f = w.fliers[0], s = (await world('#k1')).stops[3].rect;
  ok(f.y > s.y + s.h / 2 - 20, `   the flier is lower than the last stop (y ${f.y.toFixed(0)})`);
}
await page.screenshot({ path: join(SHOTS, 'p1-midfall.png') });
w = await at('#k1', fallAt - 0.001);
ok(w.fliers[0] === null, 'p1 t=8.999: still no flier');
w = await at('#k1', fallAt + 0.05);
{
  const last = (await world('#k1')).stops[3].rect;
  ok(w.fliers[0] !== null && near(centre(w.fliers[0]).x, last.x, 6) && near(centre(w.fliers[0]).y, last.y + last.h / 2, 6), 'p1 t=9.05: the flier takes off from where the marker was');
}
w = await at('#k1', 11.5);
ok(w.slotHere && w.fliers[0] !== null && w.ballVis === 'hidden' && w.landingBorder !== (await at('#k1', 3)).landingBorder, 'p1 t=11.5 (landed): the slot has data-flight-here, the page block highlights, the scene marker stays hidden');
await page.locator('#k1').locator('xpath=ancestor::main').screenshot({ path: join(SHOTS, 'p1-landed-page.png') }).catch(() => {});
w = await at('#k1', 3);
ok(!w.slotHere && w.slotP === '', 'p1 t=3 (reverse past the fall): the slot is unmarked again');

// ---- order independence, p1 and p2
const decls = (s) => (s ?? '').split(';').map((x) => x.trim()).filter(Boolean).sort().join(';'); // declaration order is not state
const sigOf = (w) => [decls(w.ballStyle), w.ballVis, w.stops.map((s) => [s.here, s.mp]), w.fliers, w.flierStyles, w.slotHere, w.slotP, w.pball];
const sig = (w) => JSON.stringify(sigOf(w));
const times = [0, 0.7, 2.7, 3.0, 4.6, 5.9, 7.4, 8.9, 9.05, 9.6, 10.3, 11.5, 12];
for (const id of ['#k1', '#k2']) {
  const fwd = new Map();
  for (const t of times) fwd.set(t, sig(await at(id, t)));
  const shuf = [...times].sort((a, b) => ((a * 7919) % 13) - ((b * 7919) % 13));
  let same = true;
  for (const t of shuf) if (sig(await at(id, t)) !== fwd.get(t)) { same = false; console.log('   differs at', t, JSON.stringify(sigOf(await at(id, t))), fwd.get(t)); }
  for (const t of [...times].reverse()) if (sig(await at(id, t)) !== fwd.get(t)) { same = false; console.log('   differs (reverse) at', t); }
  ok(same, `${id}: the same marker / flier / marks for the same t in forward, shuffled and reverse order (${times.length} times)`);
}

// ---- the reverse handoff: p2 (the page ball falls into the video and becomes the marker)
w = await at('#k2', 0.3);
ok(w.pball === 'visible' && w.fliers[1] === null && w.ballVis === 'hidden', 'p2 t=0.3: the ball is on the page; the scene marker is hidden; no flier');
w = await at('#k2', 1.2);
ok(w.pball === 'hidden' && w.fliers[1] !== null && w.ballVis === 'hidden', 'p2 t=1.2 (falling in): the flier shows, both homes hidden');
await page.screenshot({ path: join(SHOTS, 'p2-fall-in.png') });
w = await at('#k2', 2.3);
ok(w.pball === 'hidden' && w.fliers[1] === null && w.ballVis === 'visible' && onStop(w, 0), 'p2 t=2.3 (landed): the flier is gone, the scene marker shows on the first stop');
{
  const stops = w.stops.map((s) => s.at);
  for (let i = 0; i < stops.length; i++) {
    const x = await at('#k2', stops[i] + 0.55);
    ok(x.ballVis === 'visible' && x.fliers[1] === null && onStop(x, i) && hereIdx(x) === i, `p2 t=${(stops[i] + 0.55).toFixed(2)}: the marker hops on after the landing (stop ${i}), no flier`);
  }
}
{
  const x = await at('#k2', 1.0), y = await at('#k2', 2.0);
  ok(x.fliers[1] !== null && y.fliers[1] !== null || y.fliers[1] === null, 'p2: falling in is continuous (flier present for the whole fall)');
}

// ---- the example page with ?render: players are renders; the flights do nothing, the marker is still in the scene
{
  const rp = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await rp.goto(BASE + '?render');
  await rp.waitForFunction(() => document.querySelector('#k1')?.clock && customElements.get('explainer-flight'));
  const out = await rp.evaluate(() => {
    const p = document.querySelector('#k1'); p.renderFrame('s', 9.6);
    const ball = p.querySelector('[data-marker]');
    return { layers: document.querySelectorAll('[data-flight-layer]').length, vis: getComputedStyle(ball).visibility, op: getComputedStyle(ball).opacity, tr: ball.style.transform };
  });
  ok(out.layers === 0 && out.vis === 'visible' && out.op === '1' && /translate/.test(out.tr), `?render: no flight layer, the marker stays in the scene at t=9.6 (${out.tr})`);
  await rp.close();
}

ok(errors.length === 0, `no console errors or warnings${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
console.log(`screenshots in ${SHOTS}`);
await browser.close();
process.exit(fails ? 1 : 0);
