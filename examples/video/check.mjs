// Headless-Chromium measurements of the real-media paths (needs demo/video/decision-records.{mp4,vtt} from prepare.sh).
//   npx vite --port 5199 --strictPort &      (from the repo root)
//   node examples/video/check.mjs [shotDir]
// Prints a results table. User gestures are real page clicks; the scrub slider is driven by dispatching `input`
// (what a drag does) and isolated seeks call p.seek(), which is what the slider/markers end up calling.
import { chromium } from '/home/greenman/dev/semanticops/srs-web/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.URL ?? 'http://localhost:5199/examples/video/index.html';
const SHOTS = process.argv[2] ?? join(tmpdir(), 'explainer-video-check');
mkdirSync(SHOTS, { recursive: true });
const rows = [];
const row = (id, what, value, note = '') => { rows.push([id, what, String(value), note]); };
const r = (x, d = 3) => (x == null || Number.isNaN(x) ? 'n/a' : Number(x).toFixed(d));
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };
const slope = (xs, ys) => { const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n; let nu = 0, de = 0; xs.forEach((x, i) => { nu += (x - mx) * (ys[i] - my); de += (x - mx) ** 2; }); return nu / de; };

const browser = await chromium.launch();
const errors = [];
const aborted = []; // media range requests cancelled by the browser on src swap / page close: expected, counted separately
const rejs = [];
console.log('canPlayType H.264/AAC:', await (async () => { const p = await browser.newPage(); const v = await p.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.64001f, mp4a.40.2"')); await p.close(); return v; })());

let rejTotal = 0;
const done = async (page) => { const rj = await page.evaluate(() => window.__playRej).catch(() => []); rejTotal += rj.length; rejs.push(...rj); await page.context().close(); };
async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (q) => (q.failure()?.errorText === 'net::ERR_ABORTED' ? aborted : errors).push(`requestfailed ${q.failure()?.errorText}: ${q.url()}`));
  await page.addInitScript(() => {
    // count play() rejections the player swallows with .catch(() => {})
    window.__playRej = [];
    const op = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { const pr = op.call(this); pr.catch((e) => window.__playRej.push(`${e.name}: ${e.message}`)); return pr; };
    window.addEventListener('unhandledrejection', (e) => window.__playRej.push(`UNHANDLED ${e.reason}`));
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__p?.clock && window.__p.querySelector('video'));
  await page.evaluate(() => {
    const p = window.__p, v = p.querySelector('video');
    window.__log = []; window.__ev = []; window.__vfc = []; window.__on = true;
    for (const e of ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'waiting', 'seeking', 'seeked', 'ended', 'pause', 'play', 'emptied'])
      v.addEventListener(e, () => window.__ev.push({ w: performance.now(), e, ct: v.currentTime, seg: p.clock.segmentId, src: v.currentSrc.split('/').pop() }));
    const vf = (_n, md) => { window.__vfc.push({ w: performance.now(), mt: md.mediaTime, seg: p.clock.segmentId, src: v.currentSrc.split('/').pop() }); v.requestVideoFrameCallback(vf); };
    v.requestVideoFrameCallback(vf);
    const f = () => {
      const c = p.clock;
      window.__log.push({ w: performance.now(), seg: c.segmentId, t: c.t, ct: v.currentTime, pb: v.playbackRate, rate: c.rate, playing: c.playing, hold: c.holding?.id ?? null, seeking: v.seeking, rs: v.readyState, paused: v.paused, muted: v.muted, ended: v.ended, src: v.currentSrc.split('/').pop() });
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
    window.__mark = () => { window.__log.length = 0; window.__ev.length = 0; window.__vfc.length = 0; };
  });
  return page;
}
const grab = (page) => page.evaluate(() => ({ log: window.__log.slice(), ev: window.__ev.slice(), vfc: window.__vfc.slice() }));
const mark = (page) => page.evaluate(() => window.__mark());
const base = (seg) => 0; // both segments have in = 0
const stat = (page) => page.evaluate(() => { const c = window.__p.clock; return { seg: c.segmentId, t: c.t, playing: c.playing, hold: c.holding?.id ?? null, rate: c.rate }; });
const waitFor = (page, fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 'raf' });

/* ---------- a. forward 1x / 2x ---------- */
for (const rate of [1, 2]) {
  const page = await fresh();
  await page.evaluate(() => window.__p.seek(5));
  await sleep(600);
  if (rate === 2) await page.click('[data-explainer-action=rate][data-explainer-value="2"]');
  else await page.click('[data-explainer-action=play]');
  await sleep(700);
  await mark(page);
  await sleep(6000);
  const { log, vfc } = await grab(page);
  const s = log.filter((x) => x.playing && x.rate === rate);
  const wallRate = slope(s.map((x) => x.w / 1000), s.map((x) => x.t));
  const mediaRate = slope(s.map((x) => x.w / 1000), s.map((x) => x.ct));
  const d = s.map((x) => Math.abs(x.ct - x.t));
  row(`a ${rate}x`, 'clock.t advance per wall second', r(wallRate), `want ${rate}`);
  row(`a ${rate}x`, 'video.currentTime advance per wall second', r(mediaRate));
  row(`a ${rate}x`, '|video.currentTime - (in + clock.t)| p50 / max (s)', `${r(pct(d, 0.5), 4)} / ${r(Math.max(...d), 4)}`, 'media drives the clock when forward, so this is sampling skew only');
  row(`a ${rate}x`, 'waiting/stall: samples with readyState<3 or seeking', s.filter((x) => x.rs < 3 || x.seeking).length, `of ${s.length}`);
  row(`a ${rate}x`, 'frames presented per wall second (rVFC)', r(vfc.length / ((vfc.at(-1).w - vfc[0].w) / 1000), 1));
  await done(page);
}

/* ---------- b. reverse + scrub ---------- */
{
  const page = await fresh();
  await page.evaluate(() => window.__p.seek(30));
  await sleep(1200);
  await page.click('[data-explainer-action=rate][data-explainer-value="-1"]');
  await sleep(400);
  await mark(page);
  await sleep(5000);
  const { log, ev, vfc } = await grab(page);
  const s = log.filter((x) => x.playing && x.rate === -1);
  const wallRate = slope(s.map((x) => x.w / 1000), s.map((x) => x.t));
  const d = s.map((x) => Math.abs(x.ct - x.t));
  row('b reverse', 'clock.t advance per wall second', r(wallRate), 'want -1');
  row('b reverse', '|video.currentTime - clock.t| p50 / p95 / max (s)', `${r(pct(d, 0.5))} / ${r(pct(d, 0.95))} / ${r(Math.max(...d))}`, 'clock drives, writes currentTime each frame');
  row('b reverse', 'fraction of rAF samples with video.seeking', r(s.filter((x) => x.seeking).length / s.length, 2));
  const sk = ev.filter((e) => e.e === 'seeking').length, sd = ev.filter((e) => e.e === 'seeked').length;
  row('b reverse', 'seeking / seeked events in 5 s', `${sk} / ${sd}`);
  const lag = vfc.map((f) => { const near = log.reduce((a, b) => (Math.abs(b.w - f.w) < Math.abs(a.w - f.w) ? b : a)); return Math.abs(f.mt - near.t); });
  row('b reverse', 'frames presented per wall second (rVFC)', r(vfc.length / 5, 1), 'a 30 fps file; reverse is a stream of seeks');
  row('b reverse', 'presented frame vs clock |mediaTime - clock.t| p50 / p95 (s)', `${r(pct(lag, 0.5))} / ${r(pct(lag, 0.95))}`);
  await page.click('[data-explainer-action=pause]');
  await sleep(500);
  const st = await grab(page);
  const last = st.log.at(-1);
  row('b reverse', 'after pause: |video.currentTime - clock.t| (s), paused flag', `${r(Math.abs(last.ct - last.t))}, paused=${last.paused}`);

  // scrub sweep: 40 inputs 50 ms apart from 2 s to 34 s of a 38.6 s segment (like dragging the slider)
  await page.evaluate(() => window.__p.seek(0));
  await sleep(500);
  await mark(page);
  const t0 = Date.now();
  for (let i = 0; i <= 40; i++) {
    await page.evaluate((v) => { const el = document.getElementById('scrub'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, 2 + (32 * i) / 40);
    await sleep(50);
  }
  const sweepMs = Date.now() - t0;
  await sleep(1200);
  const g = await grab(page);
  const sw = g.log.filter((x) => x.w > g.log[0].w);
  const dd = sw.map((x) => Math.abs(x.ct - x.t));
  row('b scrub', `sweep 40 inputs over ${sweepMs} ms: |currentTime - clock.t| p50 / p95 / max (s)`, `${r(pct(dd, 0.5))} / ${r(pct(dd, 0.95))} / ${r(Math.max(...dd))}`, 'includes lag while seeks are in flight');
  row('b scrub', 'fraction of samples seeking', r(sw.filter((x) => x.seeking).length / sw.length, 2));
  row('b scrub', 'frames presented (rVFC) during sweep+settle', g.vfc.length);
  const fin = g.log.at(-1);
  row('b scrub', 'after settle |currentTime - clock.t| (s)', r(Math.abs(fin.ct - fin.t), 4));

  // isolated seeks: ms from p.seek() until !seeking and |currentTime - target| < 0.05, and until a frame is presented
  const times = [];
  for (const tgt of [3, 23, 11.3, 36, 0.5, 20]) {
    const res = await page.evaluate(async (tgt) => {
      const p = window.__p, v = p.querySelector('video');
      const t0 = performance.now();
      let frame = null;
      v.requestVideoFrameCallback(() => { frame = performance.now() - t0; });
      p.seek(tgt);
      return await new Promise((ok) => {
        const f = () => {
          if (!v.seeking && Math.abs(v.currentTime - tgt) < 0.05 && frame != null) ok({ tgt, settle: performance.now() - t0, frame });
          else if (performance.now() - t0 > 4000) ok({ tgt, settle: -1, frame });
          else requestAnimationFrame(f);
        };
        f();
      });
    }, tgt);
    times.push(res);
  }
  row('b scrub', 'isolated seek: ms to settled+frame (3, 23, 11.3, 36, 0.5, 20)', times.map((x) => Math.round(Math.max(x.settle, x.frame ?? 0))).join(', '), 'paused seeks; -1 = timeout');
  await done(page);
}

/* ---------- b2. overlay DOM identical forward / reverse / seek ---------- */
{
  const page = await fresh();
  const dom = (t) => page.evaluate((t) => { const p = window.__p; p.clock.t = t; p.paint(); return p.firstElementChild.lastElementChild.innerHTML; }, t);
  const cases = [['intro', [3, 17, 26]], ['purpose', [8, 42, 47.8]]];
  for (const [seg, ts] of cases) {
    for (const t of ts) {
      const out = {};
      // A: direct seek
      await page.evaluate(([seg, t]) => { const p = window.__p; p.jumpTo(seg); p.pause(); p.seek(t); p.clock.t = t; p.paint(); }, [seg, t]);
      out.seek = await dom(t);
      // B: play forward through t, pause, pin clock to exactly t
      await page.evaluate(([seg, t]) => { const p = window.__p; p.jumpTo(seg); p.seek(Math.max(0, t - 0.8)); p.setRate(1); p.play(); }, [seg, t]);
      await waitFor(page, (t) => window.__p.clock.t >= Math.min(t + 0.3, 38), t);
      await page.evaluate(() => window.__p.pause());
      out.forward = await dom(t);
      // C: play in reverse down through t, pause, pin
      await page.evaluate(([seg, t]) => { const p = window.__p; p.jumpTo(seg); p.seek(Math.min(t + 0.8, p.clock.length - 0.2)); p.setRate(-1); p.play(); }, [seg, t]);
      await waitFor(page, (t) => window.__p.clock.t <= t - 0.3 || window.__p.clock.segmentId !== 'x', t);
      await sleep(1300);
      await page.evaluate(() => window.__p.pause());
      out.reverse = await dom(t);
      const same = out.seek === out.forward && out.seek === out.reverse;
      row('b DOM', `${seg} t=${t}: overlay innerHTML seek == forward == reverse`, same ? 'identical' : 'DIFFERENT', `${out.seek.length} chars`);
      await page.evaluate(() => window.__p.setRate(1));
    }
  }
  await done(page);
}

/* ---------- c. boundary intro -> purpose while playing (one file, two cuts) ---------- */
{
  const page = await fresh();
  await page.evaluate(() => window.__p.seek(35));
  await sleep(1200);
  await mark(page);
  await page.click('[data-explainer-action=play]');
  await waitFor(page, () => window.__p.clock.segmentId === 'purpose' && window.__p.clock.t > 2.5);
  const { log, ev, vfc } = await grab(page);
  const swap = log.findIndex((x) => x.seg === 'purpose');
  const swapW = log[swap].w;
  // frame timeline across the cut: the first frame presented while the clock says purpose, +-15 frames
  const k = vfc.findIndex((f) => f.seg === 'purpose');
  const win = vfc.slice(Math.max(0, k - 15), k + 16);
  const dws = win.slice(1).map((f, i) => f.w - win[i].w);
  const dms = win.slice(1).map((f, i) => f.mt - win[i].mt);
  row('c boundary', 'frame timeline +-15 frames around the cut: inter-frame wall ms', dws.map((x) => x.toFixed(0)).join(' '), 'normal ~33 ms; cut is between the 15th and 16th interval');
  row('c boundary', 'worst inter-frame gap in the window (ms) / frames dropped over the window', `${r(Math.max(...dws), 0)} / ${r(Math.max(0, (win.at(-1).w - win[0].w) / 33.33 - (win.length - 1)), 1)}`, 'was 316 ms with separate files (133 first-frame + 183 stall)');
  row('c boundary', 'mediaTime across the cut: min / max step between frames (s)', `${r(Math.min(...dms), 3)} / ${r(Math.max(...dms), 3)}`, 'min < 0 would be a backward snap');
  row('c boundary', 'mediaTime at the first frame the clock calls purpose', r(vfc[k].mt, 3), 'purpose in = 38.6; video is 0.021 later than audio');
  const near = ev.filter((e) => Math.abs(e.w - swapW) < 400).map((e) => e.e);
  row('c boundary', 'media events within +-400 ms of the cut', near.length ? near.join(',') : 'none', 'loadstart / seeking / waiting would mean a reload or a seek');
  const lastI = log[swap - 1], firstP = log[swap];
  row('c boundary', 'clock.t last intro sample -> first purpose sample', `${r(lastI.t, 3)} (${lastI.seg}) -> ${r(firstP.t, 3)} (${firstP.seg})`);
  let longest = 0, runMs = 0;
  for (let i = swap; i < log.length && log[i].t < 2.5; i++) { if (Math.abs(log[i].t - log[i - 1].t) < 1e-6) runMs += log[i].w - log[i - 1].w; else { longest = Math.max(longest, runMs); runMs = 0; } }
  longest = Math.max(longest, runMs);
  row('c boundary', 'longest clock.t stall after the cut (ms)', r(longest, 0));
  const dAfter = log.slice(swap).filter((x) => x.t > 0.3 && x.playing).map((x) => Math.abs(x.ct - 38.6 - x.t));
  row('c boundary', 'after the cut |currentTime - (in + clock.t)| max (s)', r(Math.max(...dAfter), 4));
  const cap = await page.evaluate(() => { const v = window.__p.querySelector('video'); return { n: v.textTracks.length, tr: [...v.textTracks].map((t) => ({ mode: t.mode, cues: t.cues?.length ?? -1, src: v.querySelector('track')?.getAttribute('src').split('/').pop() })) }; });
  row('c boundary', 'captions after the cut', JSON.stringify(cap), 'one track for the whole file, both segments');
  await sleep(1500);
  const shot = await page.evaluate(() => { const v = window.__p.querySelector('video'); return { ct: +v.currentTime.toFixed(2), active: [...v.textTracks[0].activeCues].map((c) => c.text) }; });
  row('c boundary', 'active caption cue at purpose t~4', JSON.stringify(shot), 'want "Have you ever been in a meeting" (purpose cue 1.284-5.683)');
  await done(page);
}

/* ---------- d. reverse across the boundary purpose -> intro ---------- */
{
  const page = await fresh();
  await page.evaluate(() => window.__p.seek(37.2));
  await sleep(1000);
  await page.click('[data-explainer-action=play]');
  await waitFor(page, () => window.__p.clock.segmentId === 'purpose' && window.__p.clock.t > 1.5);
  await mark(page);
  await page.click('[data-explainer-action=rate][data-explainer-value="-1"]');
  await waitFor(page, () => window.__p.clock.segmentId === 'intro' && window.__p.clock.t < 37.2);
  await sleep(1500);
  const { log, ev, vfc } = await grab(page);
  const swap = log.findIndex((x) => x.seg === 'intro');
  const sw = log[swap].w;
  row('d reverse boundary', 'clock.t last purpose sample -> first intro sample', `${r(log[swap - 1].t, 3)} -> ${r(log[swap].t, 3)}`, 'path entry {intro, 38.6, to purpose} popped');
  const near = ev.filter((e) => Math.abs(e.w - sw) < 300 && ['loadstart', 'loadedmetadata', 'emptied'].includes(e.e));
  row('d reverse boundary', 'reload events within +-300 ms of the cut', near.length ? near.map((e) => e.e).join(',') : 'none');
  const f1 = vfc.find((f) => f.seg === 'intro' && f.w >= sw);
  row('d reverse boundary', 'swap -> first intro frame presented (ms), its mediaTime', f1 ? `${r(f1.w - sw, 0)}, ${r(f1.mt, 2)}` : 'none');
  const after = log.slice(swap + 1).filter((x) => x.w - sw > 600);
  const d = after.map((x) => Math.abs(x.ct - x.t));
  row('d reverse boundary', 'after settle |currentTime - clock.t| p50 / max (s)', `${r(pct(d, 0.5))} / ${r(Math.max(...d))}`);
  const ws = after.filter((x) => x.playing && x.rate === -1);
  row('d reverse boundary', 'clock rate after boundary (per wall s)', r(slope(ws.map((x) => x.w / 1000), ws.map((x) => x.t))), 'want -1');
  await done(page);
}

/* ---------- e. hold at the choice ---------- */
async function toHold(page, from = 45.5) {
  await page.evaluate((f) => { window.__p.jumpTo('purpose'); window.__p.seek(f); }, from);
  await sleep(800);
  await page.click('[data-explainer-action=play]');
  await waitFor(page, () => window.__p.clock.holding != null);
}
{
  const page = await fresh();
  await toHold(page);
  await mark(page);
  await sleep(4500);
  const { log } = await grab(page);
  const s = log.filter((x) => x.hold);
  const cts = s.map((x) => x.ct);
  let wraps = 0; for (let i = 1; i < cts.length; i++) if (cts[i] < cts[i - 1] - 0.5) wraps++;
  row('e hold', 'clock.t / playing / holding at hold', `${r(s[0].t, 3)} / ${s[0].playing} / ${s[0].hold}`, 'cue end 48.6');
  row('e hold', 'clock.t stays constant over 4.5 s (min..max)', `${r(Math.min(...s.map((x) => x.t)))}..${r(Math.max(...s.map((x) => x.t)))}`);
  row('e hold', 'media loop: currentTime range / loop wraps in 4.5 s / muted / paused', `${r(Math.min(...cts), 2)}..${r(Math.max(...cts), 2)} / ${wraps} / ${s.at(-1).muted} / ${s.at(-1).paused}`, 'loop_from 47.0, end 48.6');
  const vis = await page.evaluate(() => ({ btns: [...window.__p.querySelectorAll('button')].map((b) => b.textContent), keysOk: true }));
  row('e hold', 'choice buttons rendered', JSON.stringify(vis.btns));
  await page.screenshot({ path: `${SHOTS}/shot-choice-hold.png`, clip: await page.evaluate(() => { const b = window.__p.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }) });
  // real click on option 2: Replay the four questions -> cross-segment goes_to a marker (intro @ 15)
  const btn2 = page.locator('explainer-player button[data-option=replay]');
  await btn2.click();
  await sleep(1500);
  let s2 = await page.evaluate(() => { const c = window.__p.clock; const v = window.__p.querySelector('video'); return { seg: c.segmentId, t: c.t, ct: v.currentTime, playing: c.playing, src: v.currentSrc.split('/').pop(), hist: c.history.length }; });
  row('e hold', 'click "Replay the four questions" -> 1.5 s later', JSON.stringify(s2), 'want intro, t~16.5, playing, src intro.mp4');
  await page.click('[data-explainer-action=back]');
  await sleep(700);
  const bk = () => page.evaluate(() => { const c = window.__p.clock; const v = window.__p.querySelector('video'); return { seg: c.segmentId, t: +c.t.toFixed(2), ct: +v.currentTime.toFixed(2), playing: c.playing, hold: c.holding?.id ?? null, paused: v.paused, hist: c.history.length, btns: window.__p.querySelectorAll('button[data-option]').length }; });
  row('e hold', 'back() afterwards', JSON.stringify(await bk()), 'want purpose, t 48.6, playing false, hold=choice, media looping 47.0-48.6, 3 buttons, hist 0');
  await sleep(2500);
  const ct2 = await page.evaluate(() => window.__p.querySelector("video").currentTime);
  row('e hold', 'after back(), 2.5 s later: still held, clock.t, media currentTime in loop range', JSON.stringify({ ...(await bk()), ct: +ct2.toFixed(2) }));
  await page.keyboard.press('2');
  await sleep(1500);
  row('e hold', 'key "2" after back() (Replay the four questions)', JSON.stringify(await bk()), 'want intro, t~16.5, playing, hist 1');
  {
    // reverse after option 2: must unwind at the landing point (intro 15), not run to intro 0
    await page.evaluate(() => { const p = window.__p; window.__rev = []; p.setRate(-1); p.play(); const f = () => { const c = p.clock; window.__rev.push([c.segmentId, +c.t.toFixed(2), c.holding?.id ?? null]); if (window.__rev.length < 400) requestAnimationFrame(f); }; f(); });
    await sleep(2500);
    const rev = await page.evaluate(() => window.__rev);
    const minIntro = Math.min(...rev.filter((x) => x[0] === 'intro').map((x) => x[1]));
    const popAt = rev.findIndex((x) => x[0] === 'purpose');
    row('e hold', 'reverse after option 2: lowest intro t visited / clock at the pop', `${minIntro} / ${popAt >= 0 ? JSON.stringify(rev[popAt]) : 'no pop'} / hist ${await page.evaluate(() => window.__p.clock.history.length)}`, 'want min ~15.0 (landing), then purpose 48.6, history 0');
  }
  await done(page);
}
{
  const page = await fresh();
  await toHold(page);
  await page.keyboard.press('1'); // goes_to start (intro @0), cross-segment
  await sleep(1500);
  const s = await page.evaluate(() => { const c = window.__p.clock; const v = window.__p.querySelector('video'); return { seg: c.segmentId, t: +c.t.toFixed(2), ct: +v.currentTime.toFixed(2), playing: c.playing, src: v.currentSrc.split('/').pop() }; });
  row('e hold', 'key "1" (Watch again, goes_to start)', JSON.stringify(s), 'want intro, t~1.5');
  await done(page);
}
{
  const page = await fresh();
  await toHold(page);
  await page.keyboard.press('3'); // sets_variable + goes_to marker `record`
  await sleep(1200);
  const s = await page.evaluate(() => { const c = window.__p.clock; const v = window.__p.querySelector('video'); return { seg: c.segmentId, t: +c.t.toFixed(2), ct: +v.currentTime.toFixed(2), vars: window.__p.store.all(), shown: [...window.__p.firstElementChild.lastElementChild.children].filter((w) => !w.hidden).map((w) => w.textContent.slice(0, 40)) }; });
  row('e hold', 'key "3" (sets revisit, goes_to record)', JSON.stringify(s), 'gated "Second time round" card visible');
  await page.screenshot({ path: `${SHOTS}/shot-gated-record.png`, clip: await page.evaluate(() => { const b = window.__p.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }) });
  await done(page);
}

/* ---------- f. ended at the end of each file ---------- */
{
  const page = await fresh();
  await page.evaluate(() => { window.__p.jumpTo('purpose'); window.__p.seek(48.62); });
  await sleep(800);
  await mark(page);
  await page.click('[data-explainer-action=play]');
  await sleep(1500);
  const { log, ev } = await grab(page);
  const e = ev.find((x) => x.e === 'ended');
  const last = log.at(-1);
  row('f ended', 'purpose end (out 87.3 vs file 87.32): clock.t / playing / segment / video.ended / currentTime', `${r(last.t, 3)} / ${last.playing} / ${last.seg} / ${last.ended} / ${r(last.ct, 3)}`, e ? `ended event ${r(e.ct, 3)}` : 'no ended event');
  await done(page);
}

/* ---------- screenshots ---------- */
{
  const page = await fresh();
  const shots = [['intro', 3, 'intro-3s'], ['intro', 23, 'intro-23s'], ['purpose', 8, 'purpose-8s'], ['purpose', 44, 'purpose-44s']];
  for (const [seg, t, name] of shots) {
    await page.evaluate(([seg, t]) => { window.__p.jumpTo(seg); window.__p.seek(t); }, [seg, t]);
    await page.click('[data-explainer-action=play]');
    await waitFor(page, (t) => window.__p.clock.t >= t + 0.6 && !window.__p.querySelector('video').seeking, t);
    await page.click('[data-explainer-action=pause]');
    await sleep(400);
    const box = await page.evaluate(() => { const b = window.__p.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
    await page.screenshot({ path: `${SHOTS}/shot-${name}.png`, clip: box });
    console.log('screenshot', `${SHOTS}/shot-${name}.png`);
  }
  await done(page);
}

/* ---------- g. errors ---------- */
{
  const page = await fresh();
  await done(page);
  row('g errors', 'swallowed play() rejections / console+page errors (whole run)', `${rejTotal} / ${errors.length}`, `${[...new Set(rejs)].join(' | ')} ${errors.slice(0, 5).join(' | ')}; ${aborted.length} media requests ERR_ABORTED (browser cancels on src swap / page close)`);
  await done(page);
}

await browser.close();
const w = [0, 1, 2].map((i) => Math.max(...rows.map((x) => x[i].length)));
for (const x of rows) console.log(`${x[0].padEnd(w[0])} | ${x[1].padEnd(w[1])} | ${x[2].padEnd(w[2])}${x[3] ? ' | ' + x[3] : ''}`);
