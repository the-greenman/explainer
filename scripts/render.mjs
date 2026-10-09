#!/usr/bin/env node
// Offline, frame-exact render of an explainer: plan the path with the pure clock (src/render-plan.ts), paint every frame in
// headless chromium (examples/render/index.html, no media, transparent), then encode with ffmpeg.
//   node scripts/render.mjs --manifest examples/video/manifest.json [--path default | --choose a,b] [--fps 30] [--scale 1.5]
//     [--out dir] [--mode overlay|composite|both] [--format prores|png|webm] [--burn-captions] [--var k=v]
//     [--pack module] [--css file] [--url http://localhost:5199] [--workers 4] [--max-seconds 3600] [--bg colour]
//     [--canvas WxH] [--scenes file.html] [--page url [--selector css]] [--engine dist] [--chromium-arg arg] [--seek-timeout ms]
// --canvas renders at that design canvas (output W x H times --scale). --scenes: an HTML file of <template data-scene> for the render page.
// With media slots (a canvas whose scenes have data-media-slot): overlay = a transparent hole in the under layer where the video is + media.json;
// composite = the video drawn in the browser, seeked frame-exact (README "Rendering with media slots").
// --page renders a player found on a real page (with that page's own CSS and templates) instead of the render page; --manifest is then
// optional (the player's own manifest is used). See README.md "Rendering" and "Scenes".
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mediaFrame, mediaKeyframes } from '../src/media-slots.ts';
import { mergeCuts, parseVtt, planRender, retimeCaptions, writeVtt } from '../src/render-plan.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let STAGE_W = 1280, STAGE_H = 720; // the designed CSS size of the stage (--canvas); output resolution comes from --scale

// ---- args ----
const opt = { path: 'default', fps: 30, scale: 1.5, out: 'render-out', mode: 'both', format: 'prores', var: [], pack: [], css: [], url: 'http://localhost:5199', workers: 4, 'max-seconds': 3600, bg: '', canvas: '', scenes: '', page: '', selector: 'explainer-player', 'chromium-arg': [], 'seek-timeout': 15000, engine: '' };
const flags = new Set(['burn-captions', 'keep-frames']);
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const m = /^--([\w-]+)$/.exec(argv[i]);
  if (!m) fail(`unexpected argument ${argv[i]}`);
  const k = m[1];
  if (flags.has(k)) { opt[k] = true; continue; }
  if (!(k in opt) && k !== 'manifest' && k !== 'choose') fail(`unknown option --${k}`);
  const v = argv[++i];
  if (v === undefined) fail(`--${k} needs a value`);
  if (Array.isArray(opt[k])) opt[k].push(v); else opt[k] = v;
}
function fail(msg) { console.error(`render: ${msg}`); process.exit(2); }
if (!opt.manifest && !opt.page) fail('--manifest is required (or --page, to use the manifest of the player on that page)');
for (const k of ['fps', 'scale', 'workers', 'max-seconds', 'seek-timeout']) { opt[k] = Number(opt[k]); if (!(opt[k] > 0)) fail(`--${k} must be a positive number`); }
if (!['overlay', 'composite', 'both'].includes(opt.mode)) fail('--mode is overlay, composite or both');
if (!['prores', 'png', 'webm'].includes(opt.format)) fail('--format is prores, png or webm');
if (opt.canvas) {
  const m = /^(\d+)x(\d+)$/i.exec(opt.canvas);
  if (!m || !+m[1] || !+m[2]) fail('--canvas is WxH in CSS px, e.g. 720x900');
  STAGE_W = +m[1]; STAGE_H = +m[2];
}
const isUrl = (s) => /^https?:\/\//.test(s);
const pageUrl = opt.page ? (isUrl(opt.page) ? opt.page : new URL(opt.page, opt.url).href) : '';

const manifestFile = opt.manifest ? path.resolve(opt.manifest) : '';
const manifestDir = manifestFile ? path.dirname(manifestFile) : '';
const out = path.resolve(opt.out);
fs.mkdirSync(out, { recursive: true });
const W = Math.round(STAGE_W * opt.scale / 2) * 2, H = Math.round(STAGE_H * opt.scale / 2) * 2;
const vars = Object.fromEntries(opt.var.map((s) => { const j = s.indexOf('='); if (j < 1) fail(`--var wants name=value, got ${s}`); return [s.slice(0, j), s.slice(j + 1)]; }));
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const manifest = manifestFile ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : await manifestFromPage();

// ---- plan ----
const pathSpec = opt.choose !== undefined ? opt.choose.split(',').filter(Boolean) : opt.path === 'default' ? 'default' : opt.path.split(',').filter(Boolean);
const plan = planRender(manifest, { fps: opt.fps, path: pathSpec, vars, maxSeconds: opt['max-seconds'] });
const merged = mergeCuts(plan.cuts);
log(`plan: ${plan.frames.length} frames, ${plan.duration.toFixed(3)} s at ${opt.fps} fps, ${plan.cuts.length} cuts, stopped at: ${plan.stop}`);
if (plan.stop === 'max') console.warn(`render: stopped at --max-seconds ${opt['max-seconds']}; the path was not finished`);
const kinds = new Set(plan.cuts.map((c) => c.kind));
// segments without a picture (none, audio) get the theme's --explainer-bg under the overlay in the composite (--bg overrides; black if neither)
let bgColour = '';

const resolveSrc = (s) => (isUrl(s) ? s : manifestFile ? path.resolve(manifestDir, s) : new URL(s, pageUrl).href); // page mode: relative to the page

// cuts.json: lets an editor line the overlay up against the source
fs.writeFileSync(path.join(out, 'cuts.json'), JSON.stringify({
  manifest: manifestFile || pageUrl, path: pathSpec, fps: opt.fps, width: W, height: H, duration: plan.duration, frames: plan.frames.length, stop: plan.stop,
  vars: plan.vars,
  cuts: plan.cuts.map((c) => ({ ...(c.src ? { sourceFile: resolveSrc(c.src) } : {}), ...c })),
}, null, 2) + '\n');

// captions.vtt: source captions cut and retimed along the plan
let hasCaptions = false;
{
  const vtts = {};
  for (const ref of new Set(merged.map((c) => c.captions).filter(Boolean))) {
    const file = resolveSrc(ref);
    try { vtts[ref] = parseVtt(isUrl(file) ? await (await fetch(file)).text() : fs.readFileSync(file, 'utf8')); }
    catch (e) { console.warn(`render: captions ${ref} not read (${e.message}); skipped`); }
  }
  const cues = retimeCaptions(vtts, merged);
  if (cues.length) { fs.writeFileSync(path.join(out, 'captions.vtt'), writeVtt(cues)); hasCaptions = true; log(`captions.vtt: ${cues.length} cues`); }
}

// ---- overlay frames ----
const framesDir = opt.format === 'png' ? path.join(out, 'overlay') : path.join(out, '.frames');
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });
const compDir = path.join(out, '.frames-composite');
const compFile = (i) => path.join(compDir, `${String(i + 1).padStart(5, '0')}.png`);
const frameFile = (i) => path.join(framesDir, `${String(i + 1).padStart(5, '0')}.png`);

let vite;
async function ensureServer() {
  const probe = async () => { try { return (await fetch(`${opt.url}/examples/render/index.html`)).ok; } catch { return false; } };
  if (await probe()) return;
  const u = new URL(opt.url);
  log(`starting vite on ${u.port}`);
  vite = spawn(path.join(root, 'node_modules/.bin/vite'), ['--port', u.port, '--strictPort'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { if (await probe()) return; await new Promise((r) => setTimeout(r, 200)); }
  throw new Error(`no server at ${opt.url}`);
}

async function loadPlaywright() {
  for (const spec of [process.env.PLAYWRIGHT, 'playwright', '/home/greenman/dev/semanticops/srs-web/node_modules/playwright/index.mjs']) {
    if (!spec) continue;
    try { return await import(spec); } catch {}
  }
  throw new Error('playwright not found (set PLAYWRIGHT=/path/to/playwright/index.mjs)');
}

// ---- --page: a player on a real page, rendered with that page's CSS and scene templates ----
// Before any page script runs, every explainer-player gets the `render` attribute (and --canvas) as it is inserted, so it initialises as a render.
function markPlayers(arg) {
  const mark = (n) => {
    if (n.nodeType !== 1) return;
    const ps = n.localName === 'explainer-player' ? [n] : Array.from(n.querySelectorAll('explainer-player'));
    for (const p of ps) { p.setAttribute('render', ''); if (arg.canvas) p.setAttribute('canvas', arg.canvas); }
  };
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach(mark))).observe(document, { childList: true, subtree: true });
}

/**
 * --engine <dist dir>: with --page, serve this build of the engine (its index.js and chunks) in place of the page's own copy, to render a real
 * page with an engine that is not the one the page ships. Matches the page's request for the engine module by name (`explainer.js`,
 * `explainer/dist/index.js`, also vite's pre-bundle in .vite/deps) and its sibling chunks by file name.
 */
async function useEngine(ctx) {
  if (!opt.engine) return;
  const dist = path.resolve(opt.engine);
  if (!fs.existsSync(path.join(dist, 'index.js'))) throw new Error(`--engine ${dist} has no index.js (run npm run build)`);
  const js = (file) => (route) => route.fulfill({ body: fs.readFileSync(file), contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
  await ctx.route(/\/(?:explainer\.js|explainer\/dist\/index\.js)(?:\?|$)/, (route) => js(path.join(dist, 'index.js'))(route));
  await ctx.route(/\/(?:\.vite\/deps|explainer\/dist)\/([\w.-]+\.js)(?:\?|$)/, (route) => {
    const name = /\/([\w.-]+\.js)(?:\?|$)/.exec(new URL(route.request().url()).pathname + '?')[1];
    return name !== 'index.js' && fs.existsSync(path.join(dist, name)) ? js(path.join(dist, name))(route) : route.fallback();
  });
}

/** Open the page, wait for the selected player, and make it the only visible thing: top-left, W px wide, nothing behind it. Returns the page and its theme background. */
async function openRealPage(ctx, errors) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(markPlayers, { canvas: opt.canvas });
  await page.goto(pageUrl, { waitUntil: 'load' });
  try { await page.waitForFunction((sel) => document.querySelector(sel)?.clock, opt.selector, { timeout: 30000 }); }
  catch { throw new Error(`no initialised <explainer-player> matching "${opt.selector}" on ${pageUrl}`); }
  const bg = await page.evaluate(async ([sel, W]) => {
    const p = document.querySelector(sel);
    if (!p.hasAttribute('render')) throw new Error('the player was not marked as a render before it initialised');
    const probe = document.createElement('i');
    probe.style.color = getComputedStyle(p).getPropertyValue('--explainer-bg').trim() || 'transparent';
    document.body.append(probe);
    const [r, g, b, a = 1] = getComputedStyle(probe).color.match(/[\d.]+/g).map(Number);
    probe.remove();
    p.setAttribute('data-xr-player', '');
    for (let n = p.parentElement; n && n !== document.documentElement; n = n.parentElement) n.setAttribute('data-xr-keep', '');
    const s = document.createElement('style');
    s.textContent = `html,body{background:transparent!important}
      body *:not([data-xr-keep]):not([data-xr-player]):not([data-xr-player] *){visibility:hidden!important}
      html::before,html::after,body::before,body::after{display:none!important}
      [data-xr-keep]{background:none!important;border-color:transparent!important;box-shadow:none!important}
      explainer-player{--explainer-bg:transparent!important;position:fixed!important;left:0!important;top:0!important;width:${W}px!important;margin:0!important;z-index:2147483647}
      *{transition:none!important;animation:none!important}`;
    document.head.append(s);
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    return a === 0 ? '' : '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
  }, [opt.selector, STAGE_W]);
  await page.evaluate(browserHelpers, opt.selector);
  return { page, bg };
}

// Runs in the page (both the render page and a real page): the hooks the renderer calls. Everything here is plain browser code.
//   __frame(seg, t, vars) -> {media, canvas}: place the clock (the box of the video in canvas px, or null)
//   __slots() -> whether the canvas has media slots; __attach() adds the <video> the composite drives
//   __compFrame(seg, t, vars, src, fileTime, ms): __frame, then (when the video is visible) load `src` and show exactly the frame at `fileTime`
function browserHelpers(sel) {
  const p = document.querySelector(sel);
  let v = null, cur = '';
  window.__frame = (seg, t, vars) => p.renderFrame(seg, t, vars);
  window.__slots = () => p.usesMediaSlots;
  window.__attach = () => {
    v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    p.attachRenderMedia(v);
  };
  const load = (src, ms) => new Promise((ok, no) => {
    if (cur === src) return ok();
    cur = src; v.src = src;
    const to = setTimeout(() => no(new Error(`video ${src} did not load in ${ms} ms`)), ms);
    v.onloadeddata = () => { clearTimeout(to); ok(); };
    v.onerror = () => { clearTimeout(to); no(new Error(`video ${src} failed to load: ${v.error ? v.error.message || v.error.code : 'unknown error'}`)); };
  });
  // seeked + a presented frame (requestVideoFrameCallback) whose media time is the frame at `ft`; then two animation frames so the compositor has it
  const seek = (ft, ms) => new Promise((ok, no) => {
    const raf2 = (f) => requestAnimationFrame(() => requestAnimationFrame(f));
    let last = null;
    const to = setTimeout(() => no(new Error(`video frame at ${ft.toFixed(3)} s of ${cur} was not presented in ${ms} ms (readyState ${v.readyState}, last presented media time ${last})`)), ms);
    if (Math.abs(v.currentTime - ft) < 1e-4 && !v.seeking && v.readyState >= 2) return raf2(() => { clearTimeout(to); ok(0); });
    let seeked = false, meta = null;
    const finish = (dev) => { clearTimeout(to); raf2(() => ok(dev)); };
    const cb = (now, m) => {
      last = m.mediaTime;
      const dev = ft - m.mediaTime; // the presented frame starts at or just before ft: within one source frame
      if (dev < -0.003 || dev > 0.1) { v.requestVideoFrameCallback(cb); return; } // a stale frame: keep waiting
      meta = m;
      if (seeked) finish(dev);
    };
    v.requestVideoFrameCallback(cb);
    v.addEventListener('seeked', () => {
      seeked = true;
      if (meta) return finish(ft - meta.mediaTime);
      // no callback for a seek that lands on the frame already shown: accept it once the data is there
      setTimeout(() => { if (!meta && v.readyState >= 2 && Math.abs(v.currentTime - ft) < 1e-3) finish(null); }, 400);
    }, { once: true });
    v.currentTime = ft;
  });
  window.__compFrame = async (seg, t, vars, src, ft, ms) => {
    const r = p.renderFrame(seg, t, vars);
    let dev = null, shown = false;
    if (r.media && !r.media.hidden && src) { await load(src, ms * 6); dev = await seek(ft, ms); shown = true; }
    return { r, dev, shown };
  };
}

async function manifestFromPage() {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: opt['chromium-arg'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: STAGE_W, height: STAGE_H }, reducedMotion: 'no-preference' });
    await useEngine(ctx);
    const errors = [];
    const { page } = await openRealPage(ctx, errors);
    const m = await page.evaluate((sel) => JSON.parse(JSON.stringify(document.querySelector(sel).manifest)), opt.selector);
    if (errors.length) throw new Error('page errors: ' + errors.slice(0, 3).join(' | '));
    return m;
  } finally { await browser.close(); }
}

const relRepo = (p) => '/' + path.relative(root, path.resolve(p)).split(path.sep).join('/');

/** A source as the browser can fetch it: absolute URL as is; relative to the page (--page), or served by vite from inside the repo. */
function browserSrc(src) {
  if (isUrl(src)) return src;
  if (pageUrl) return new URL(src, pageUrl).href;
  const r = relRepo(path.resolve(manifestDir, src));
  if (r.startsWith('/..')) throw new Error(`the media ${src} must be inside the repo for the in-browser composite (it is served by vite)`);
  return opt.url + r;
}

/** Open the workers' pages (a render page, or the real page) and ask whether the canvas has media slots. */
async function openSession() {
  const { chromium } = await loadPlaywright();
  let url = '';
  if (!pageUrl) {
    await ensureServer();
    if (relRepo(manifestFile).startsWith('/..')) throw new Error('the manifest must be inside the repo (it is served by vite)');
    const packs = opt.pack.length ? opt.pack : fs.existsSync(path.join(manifestDir, 'components.ts')) ? [path.join(manifestDir, 'components.ts')] : [];
    const csss = opt.css.length ? opt.css : fs.existsSync(path.join(manifestDir, 'theme.css')) ? [path.join(manifestDir, 'theme.css')] : [];
    const qs = new URLSearchParams();
    qs.set('manifest', relRepo(manifestFile));
    packs.forEach((p) => qs.append('pack', relRepo(p)));
    csss.forEach((p) => qs.append('css', relRepo(p)));
    if (opt.canvas) qs.set('canvas', opt.canvas);
    if (opt.scenes) qs.set('scenes', relRepo(opt.scenes));
    url = `${opt.url}/examples/render/index.html?${qs}`;
  }
  const browser = await chromium.launch({ args: opt['chromium-arg'] });
  const ctx = await browser.newContext({ viewport: { width: STAGE_W, height: STAGE_H }, deviceScaleFactor: opt.scale, reducedMotion: 'no-preference' });
  await useEngine(ctx);
  const pages = [];
  const errors = [];
  for (let i = 0; i < Math.min(opt.workers, plan.frames.length); i++) {
    let page, bg;
    if (pageUrl) ({ page, bg } = await openRealPage(ctx, errors));
    else {
      page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(url);
      await page.evaluate(() => window.__ready);
      bg = await page.evaluate(() => window.__bg);
      await page.evaluate(browserHelpers, 'explainer-player');
    }
    if (!bgColour) bgColour = opt.bg || bg || 'black';
    pages.push(page);
  }
  if (errors.length) throw new Error('page errors: ' + errors.slice(0, 3).join(' | '));
  const slots = await pages[0].evaluate(() => window.__slots());
  return { browser, pages, errors, slots };
}

// per-frame media placement (output px) from the passes; only when the canvas has media slots
const mediaAt = [];
const canvasSize = { w: STAGE_W, h: STAGE_H };

/**
 * Paint every frame once. `composite: false`: the transparent overlay (with slots: a hole in the under layer where the media box is).
 * `composite: true` (slots only): the finished picture, the video seeked to each frame's file time and drawn in its slot.
 * Workers take consecutive blocks of frames (a video seeks cheaply forward).
 */
async function paintPass(session, { composite, file }) {
  const { pages, errors } = session;
  const total = plan.frames.length;
  const BLOCK = composite ? 25 : 1;
  const nBlocks = Math.ceil(total / BLOCK);
  let next = 0, done = 0, maxDev = 0, seeks = 0;
  const label = composite ? 'composite' : 'overlay';
  const tick = setInterval(() => process.stdout.write(`\r  ${label} frames ${done}/${total}   `), 2000);
  const clip = { x: 0, y: 0, width: STAGE_W, height: STAGE_H };
  if (composite) {
    await Promise.all(pages.map((p) => p.evaluate((bg) => {
      window.__attach();
      const s = document.createElement('style');
      s.textContent = `html,body{background:${bg}!important}`; // the colour under segments without a picture, as in the ffmpeg composite
      document.head.append(s);
    }, bgColour)));
  }
  const segs = Object.fromEntries(manifest.segments.map((s) => [s.id, s]));
  const srcOf = Object.fromEntries(manifest.segments.filter((s) => s.kind === 'video' && s.src).map((s) => [s.id, browserSrc(s.src)]));
  await Promise.all(pages.map(async (page) => {
    for (;;) {
      const b = next++;
      if (b >= nBlocks) return;
      for (let i = b * BLOCK; i < Math.min(total, (b + 1) * BLOCK); i++) {
        const f = plan.frames[i];
        // workers pick frames out of order, so every frame carries the full variable state it needs
        const args = [f.segmentId, f.t, varsAt(i)];
        let r;
        if (composite) {
          const s = segs[f.segmentId];
          let out;
          try { out = await page.evaluate(([a, src, ft, ms]) => window.__compFrame(a[0], a[1], a[2], src, ft, ms), [args, srcOf[f.segmentId] ?? '', (s.in ?? 0) + f.t, opt['seek-timeout']]); }
          catch (e) { throw new Error(`frame ${i} (${f.segmentId} @ ${f.t}): ${e.message}`); }
          r = out.r;
          if (out.shown) { seeks++; if (out.dev) maxDev = Math.max(maxDev, Math.abs(out.dev)); }
        } else r = await page.evaluate(([s, t, v]) => window.__frame(s, t, v), args);
        if (session.slots && r.canvas) { canvasSize.w = r.canvas.w; canvasSize.h = r.canvas.h; mediaAt[i] = mediaFrame(i, r.media, r.canvas, { w: W, h: H }); }
        fs.writeFileSync(file(i), await page.screenshot({ clip, omitBackground: !composite, type: 'png' }));
        done++;
      }
    }
  }));
  clearInterval(tick);
  process.stdout.write('\r');
  if (errors.length) throw new Error('page errors: ' + errors.slice(0, 3).join(' | '));
  return { seeks, maxDev };
}

// variables in force at frame i (the plan only lists changes)
const varStates = [];
{ let cur = {}; plan.frames.forEach((f, i) => { if (f.vars) cur = { ...cur, ...f.vars }; varStates[i] = cur; }); }
const varsAt = (i) => varStates[i];

function ffmpeg(args, label) {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { cwd: out, stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${label})`);
}
const seqArgs = ['-framerate', String(opt.fps), '-start_number', '1', '-i', path.join(framesDir, '%05d.png')];

function encodeOverlay() {
  if (opt.format === 'prores') ffmpeg([...seqArgs, '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', '-r', String(opt.fps), 'overlay.mov'], 'overlay.mov');
  else if (opt.format === 'webm') ffmpeg([...seqArgs, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-b:v', '0', '-crf', '24', '-r', String(opt.fps), 'overlay.webm'], 'overlay.webm');
}

// ---- composite ----
const probeCache = {};
function hasStream(file, type) {
  const key = `${file}|${type}`;
  if (!(key in probeCache)) {
    const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', type === 'a' ? 'a' : 'v', '-show_entries', 'stream=index', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    probeCache[key] = r.status === 0 && r.stdout.trim() !== '';
  }
  return probeCache[key];
}

// `browserFrames`: the picture already is the finished frames from the browser (media slots: the video is drawn in its slot there), so only the audio is cut here.
function composite(browserFrames) {
  const inputs = [];
  const filters = [];
  const n = merged.length;
  merged.forEach((c, k) => {
    const dur = c.frames / opt.fps;
    const file = c.src ? resolveSrc(c.src) : undefined;
    const nIn = () => inputs.filter((x) => x === '-i').length;
    const lavfi = (spec) => { inputs.push('-f', 'lavfi', '-t', String(dur), '-i', spec); return nIn() - 1; };
    const media = () => { inputs.push('-ss', String(c.srcIn), '-t', String(dur), '-i', file); return nIn() - 1; };
    // video cut: one input for picture and sound; audio cut: background picture; none: background and silence
    const m = (c.kind !== 'none' && file) ? media() : -1;
    const v = browserFrames ? '' : c.kind === 'video' && m >= 0 && hasStream(file, 'v') ? `${m}:v:0` : `${lavfi(`color=c=${bgColour || opt.bg || 'black'}:s=${W}x${H}:r=${opt.fps}`)}:v:0`;
    const a = m >= 0 && hasStream(file, 'a') ? `${m}:a:0` : `${lavfi('anullsrc=r=48000:cl=stereo')}:a:0`;
    if (!browserFrames) filters.push(`[${v}]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${opt.fps},format=yuv420p,trim=end_frame=${c.frames},setpts=PTS-STARTPTS[v${k}]`);
    filters.push(`[${a}]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur=${dur},atrim=end=${dur},asetpts=PTS-STARTPTS[a${k}]`);
  });
  if (browserFrames) filters.push(`${merged.map((_, k) => `[a${k}]`).join('')}concat=n=${n}:v=0:a=1[ba]`);
  else filters.push(`${merged.map((_, k) => `[v${k}][a${k}]`).join('')}concat=n=${n}:v=1:a=1[bv][ba]`);
  const count = () => inputs.filter((x) => x === '-i').length;
  const ovIdx = count();
  inputs.push(...(browserFrames ? ['-framerate', String(opt.fps), '-start_number', '1', '-i', path.join(compDir, '%05d.png')] : seqArgs));
  const burn = opt['burn-captions'] && hasCaptions;
  if (browserFrames) filters.push(`[${ovIdx}:v]format=yuv420p${burn ? '[ov]' : '[fv]'}`);
  else filters.push(`[bv][${ovIdx}:v]overlay=format=auto:shortest=1,format=yuv420p${burn ? '[ov]' : '[fv]'}`);
  if (burn) filters.push(`[ov]subtitles=captions.vtt:original_size=${W}x${H}:force_style='FontSize=${Math.round(H / 30)},Outline=2,Shadow=0,MarginV=${Math.round(H / 20)}'[fv]`);
  const soft = !opt['burn-captions'] && hasCaptions;
  const subIdx = count();
  if (soft) inputs.push('-i', 'captions.vtt');
  ffmpeg([...inputs, '-filter_complex', filters.join(';'), '-map', '[fv]', '-map', '[ba]', ...(soft ? ['-map', `${subIdx}:s`, '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng'] : []),
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', String(opt.fps), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'video.mp4'], 'video.mp4');
}

// media.json (per output frame) and media.keyframes.json (placement changes only), in output px; see README "Rendering with media slots"
function writeMedia() {
  const frames = plan.frames.map((_, i) => mediaAt[i]);
  if (frames.some((x) => !x)) throw new Error('internal: a frame has no media placement');
  const head = { fps: opt.fps, width: W, height: H, canvas: canvasSize, coordinates: 'output px, origin top-left; n is the 0-based output frame (time n / fps); opacity 0: no media in the frame' };
  fs.writeFileSync(path.join(out, 'media.json'), JSON.stringify({ ...head, frames }) + '\n');
  const keys = mediaKeyframes(frames);
  fs.writeFileSync(path.join(out, 'media.keyframes.json'), JSON.stringify({ ...head, hold: 'a key holds until the next key', keys }, null, 1) + '\n');
  log(`media.json: ${frames.length} frames, ${keys.length} keyframes`);
}

const timings = {};
const timed = async (name, fn) => { const t = Date.now(); const r = await fn(); timings[name] = (Date.now() - t) / 1000; return r; };
try {
  const session = await openSession();
  try {
    // with media slots the video is placed by the page: overlay mode cuts a hole for it, composite mode draws it there (not the ffmpeg scale-to-frame)
    const inBrowser = session.slots && opt.mode !== 'overlay';
    log(`media slots: ${session.slots ? 'in use' : 'none'}${inBrowser ? ' (composite in the browser)' : ''}`);
    if (opt.mode !== 'composite' || !session.slots) {
      const r = await timed('overlay frames', () => paintPass(session, { composite: false, file: frameFile }));
      log(`painted ${plan.frames.length} overlay frames at ${W}x${H} in ${timings['overlay frames'].toFixed(1)} s (${(plan.frames.length / timings['overlay frames']).toFixed(1)} frames/s)`);
    }
    if (inBrowser) {
      fs.rmSync(compDir, { recursive: true, force: true });
      fs.mkdirSync(compDir, { recursive: true });
      const r = await timed('composite frames', () => paintPass(session, { composite: true, file: compFile }));
      log(`painted ${plan.frames.length} composite frames in ${timings['composite frames'].toFixed(1)} s (${(plan.frames.length / timings['composite frames']).toFixed(1)} frames/s); ${r.seeks} frames with video (each seeked to its exact file time), largest lag of the presented frame behind the requested time ${(r.maxDev * 1000).toFixed(1)} ms`);
    }
    if (session.slots) writeMedia();
    if (opt.mode !== 'composite') { await timed('overlay encode', async () => encodeOverlay()); log(`overlay encoded (${opt.format}) in ${timings['overlay encode'].toFixed(1)} s`); }
    if (opt.mode !== 'overlay') { await timed('composite encode', async () => composite(inBrowser)); log(`composite encoded in ${timings['composite encode'].toFixed(1)} s`); }
    if ((opt.format !== 'png' && !opt['keep-frames']) || opt.mode === 'composite') fs.rmSync(framesDir, { recursive: true, force: true });
    if (!opt['keep-frames']) fs.rmSync(compDir, { recursive: true, force: true });
    log(`done: ${out}`);
  } finally { await session.browser.close(); }
} finally {
  if (vite) vite.kill();
}
