// Headless-Chromium checks of takeoff.html: a resting object docked at a plain anchor, and the three take-off triggers (buttons, enter, variable).
//   npx vite --port 5199 --strictPort &      (from the repo root)
//   node examples/flight/check-takeoff.mjs
const PW = process.env.PLAYWRIGHT ?? '/home/greenman/dev/semanticops/srs-web/node_modules/playwright/index.mjs';
const { chromium } = await import(PW).catch(() => import('playwright'));
const BASE = process.env.URL ?? 'http://localhost:5199/examples/flight/takeoff.html';
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
await page.goto(BASE);
await page.waitForFunction(() => document.querySelectorAll('[data-flight-layer]').length === 1);
const frames = () => page.evaluate(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); document.querySelector('explainer-flight').flush(); });
// where is the object: the dock's host id, or the flier ("moving")
const where = () => page.evaluate(() => {
  const d = [...document.querySelectorAll('[data-flight-dock]')].find((e) => getComputedStyle(e).display !== 'none');
  const fl = document.querySelector('[data-flight-layer]').firstChild, on = getComputedStyle(fl).display !== 'none';
  return d ? (d.parentElement?.id || 'dock') : on ? 'moving' : 'nowhere';
});
const settle = async (ms) => { await page.waitForTimeout(ms); await frames(); return where(); };

ok((await settle(200)) === 'rest', 'at load the object rests in a dock inside #rest');
// no bounce at rest: a scroll moves the dock with the page before any frame
const sc = await page.evaluate(() => {
  const d = document.querySelector('#rest [data-flight-dock]'), t0 = d.getBoundingClientRect().top, y0 = scrollY;
  scrollBy(0, 120); const t1 = d.getBoundingClientRect().top;
  scrollTo(0, 0);
  return { dy: t1 - t0, moved: scrollY === y0 ? 0 : 1 };
});
ok(Math.abs(sc.dy + 120) <= 1, `resting: a 120 px scroll moved the dock by ${sc.dy} px at once`);
await page.evaluate(() => scrollTo(0, 0)); await frames();

// buttons
await page.click('[data-flight-action="go"]');
await page.waitForTimeout(300); await frames();
ok((await where()) === 'moving', 'Take off: the object is flying after 0.3 s');
ok((await settle(1500)) === 'perch', 'Take off: it lands in the dock at #perch');
await page.click('[data-flight-action="back"]');
await page.waitForTimeout(300); await frames();
ok((await where()) === 'moving', 'Land: flying back');
ok((await settle(1500)) === 'rest', 'Land: back in the dock at #rest');
await page.click('[data-flight-action="toggle"]');
ok((await settle(1700)) === 'perch', 'Toggle (off): flies to #perch');
await page.click('[data-flight-action="toggle"]');
ok((await settle(1700)) === 'rest', 'Toggle (on): flies back to #rest');
// a mid-flight reversal is continuous: no jump
const jump = await page.evaluate(async () => {
  const f = document.querySelector('explainer-flight'), fl = document.querySelector('[data-flight-layer]').firstChild;
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  f.go('takeoff'); await raf(); await raf(); await new Promise((r) => setTimeout(r, 400)); await raf(); f.flush();
  const a = fl.getBoundingClientRect(); f.back('takeoff'); f.flush(); const b = fl.getBoundingClientRect();
  return Math.hypot(a.left - b.left, a.top - b.top);
});
ok(jump < 12, `reversing mid-flight moves the flier ${jump.toFixed(1)} px in the same instant (one frame of travel at most)`);
await settle(1700);

// enter
await page.evaluate(() => document.querySelector('#later').scrollIntoView({ block: 'center' }));
await page.waitForTimeout(300); await frames();
ok((await where()) === 'moving' || (await where()) === 'later-box', 'enter: scrolling #later into view starts the flight');
ok((await settle(1600)) === 'later-box', 'enter: it lands in the dock at #later-box');
await page.evaluate(() => scrollTo(0, 0));
ok((await settle(1600)) === 'rest', 'enter reversed: scrolled back above #later, the object returns to #rest');

// variable
await page.selectOption('#spot', 'b');
await page.waitForTimeout(300); await frames();
ok((await where()) === 'moving', 'variable: spot = b starts the flight');
ok((await settle(1500)) === 'spot-b', 'variable: it lands in the dock at #spot-b');
await page.selectOption('#spot', 'a');
ok((await settle(1700)) === 'rest', 'variable: spot = a flies it back');

// the dock is a clone: no ids, aria-hidden
const info = await page.evaluate(() => { const d = document.querySelector('[data-flight-dock]'); return { aria: d.getAttribute('aria-hidden'), ids: d.querySelectorAll('[id]').length + (d.id ? 1 : 0) }; });
ok(info.aria === 'true' && info.ids === 0, 'the dock is aria-hidden and carries no ids');

// reduced motion: triggers settle at once
{
  const c2 = await browser.newContext({ viewport: { width: 1000, height: 700 }, reducedMotion: 'reduce' });
  const p2 = await c2.newPage();
  await p2.goto(BASE);
  await p2.waitForFunction(() => document.querySelectorAll('[data-flight-layer]').length === 1);
  await p2.click('[data-flight-action="go"]');
  await p2.waitForTimeout(100);
  await p2.evaluate(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
  const there = await p2.evaluate(() => [...document.querySelectorAll('[data-flight-dock]')].find((e) => getComputedStyle(e).display !== 'none')?.parentElement?.id);
  ok(there === 'perch', `reduced motion: Take off lands at once (${there})`);
  await c2.close();
}

console.log(errors.length ? 'console errors/warnings:\n  ' + [...new Set(errors)].join('\n  ') : 'no console errors');
ok(errors.length === 0, 'no console errors or warnings');
await browser.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
