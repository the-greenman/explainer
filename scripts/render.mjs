#!/usr/bin/env node
// Offline, frame-exact render of an explainer: plan the path with the pure clock (src/render-plan.ts), paint every frame in
// headless chromium (examples/render/index.html, no media, transparent), then encode with ffmpeg.
//   node scripts/render.mjs --manifest examples/video/manifest.json [--path default | --choose a,b] [--fps 30] [--scale 1.5]
//     [--out dir] [--mode overlay|composite|both] [--format prores|png|webm] [--burn-captions] [--var k=v]
//     [--pack module] [--css file] [--url http://localhost:5199] [--workers 4] [--max-seconds 3600] [--bg colour]
// See README.md "Rendering".
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeCuts, parseVtt, planRender, retimeCaptions, writeVtt } from '../src/render-plan.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE_W = 1280, STAGE_H = 720; // the designed CSS size of the stage; output resolution comes from --scale

// ---- args ----
const opt = { path: 'default', fps: 30, scale: 1.5, out: 'render-out', mode: 'both', format: 'prores', var: [], pack: [], css: [], url: 'http://localhost:5199', workers: 4, 'max-seconds': 3600, bg: '' };
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
if (!opt.manifest) fail('--manifest is required');
for (const k of ['fps', 'scale', 'workers', 'max-seconds']) { opt[k] = Number(opt[k]); if (!(opt[k] > 0)) fail(`--${k} must be a positive number`); }
if (!['overlay', 'composite', 'both'].includes(opt.mode)) fail('--mode is overlay, composite or both');
if (!['prores', 'png', 'webm'].includes(opt.format)) fail('--format is prores, png or webm');

const manifestFile = path.resolve(opt.manifest);
const manifestDir = path.dirname(manifestFile);
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const out = path.resolve(opt.out);
fs.mkdirSync(out, { recursive: true });
const W = Math.round(STAGE_W * opt.scale / 2) * 2, H = Math.round(STAGE_H * opt.scale / 2) * 2;
const vars = Object.fromEntries(opt.var.map((s) => { const j = s.indexOf('='); if (j < 1) fail(`--var wants name=value, got ${s}`); return [s.slice(0, j), s.slice(j + 1)]; }));
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

// ---- plan ----
const pathSpec = opt.choose !== undefined ? opt.choose.split(',').filter(Boolean) : opt.path === 'default' ? 'default' : opt.path.split(',').filter(Boolean);
const plan = planRender(manifest, { fps: opt.fps, path: pathSpec, vars, maxSeconds: opt['max-seconds'] });
const merged = mergeCuts(plan.cuts);
log(`plan: ${plan.frames.length} frames, ${plan.duration.toFixed(3)} s at ${opt.fps} fps, ${plan.cuts.length} cuts, stopped at: ${plan.stop}`);
if (plan.stop === 'max') console.warn(`render: stopped at --max-seconds ${opt['max-seconds']}; the path was not finished`);
const kinds = new Set(plan.cuts.map((c) => c.kind));
// segments without a picture (none, audio) get the theme's --explainer-bg under the overlay in the composite (--bg overrides; black if neither)
let bgColour = '';

const isUrl = (s) => /^https?:\/\//.test(s);
const resolveSrc = (s) => (isUrl(s) ? s : path.resolve(manifestDir, s));

// cuts.json: lets an editor line the overlay up against the source
fs.writeFileSync(path.join(out, 'cuts.json'), JSON.stringify({
  manifest: manifestFile, path: pathSpec, fps: opt.fps, width: W, height: H, duration: plan.duration, frames: plan.frames.length, stop: plan.stop,
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

async function renderFrames() {
  await ensureServer();
  const { chromium } = await loadPlaywright();
  const rel = (p) => '/' + path.relative(root, path.resolve(p)).split(path.sep).join('/');
  if (rel(manifestFile).startsWith('/..')) throw new Error('the manifest must be inside the repo (it is served by vite)');
  const packs = opt.pack.length ? opt.pack : fs.existsSync(path.join(manifestDir, 'components.ts')) ? [path.join(manifestDir, 'components.ts')] : [];
  const csss = opt.css.length ? opt.css : fs.existsSync(path.join(manifestDir, 'theme.css')) ? [path.join(manifestDir, 'theme.css')] : [];
  const qs = new URLSearchParams();
  qs.set('manifest', rel(manifestFile));
  packs.forEach((p) => qs.append('pack', rel(p)));
  csss.forEach((p) => qs.append('css', rel(p)));
  const url = `${opt.url}/examples/render/index.html?${qs}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: STAGE_W, height: STAGE_H }, deviceScaleFactor: opt.scale, reducedMotion: 'no-preference' });
  const pages = [];
  const errors = [];
  for (let i = 0; i < Math.min(opt.workers, plan.frames.length); i++) {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url);
    await page.evaluate(() => window.__ready);
    if (!bgColour) bgColour = opt.bg || (await page.evaluate(() => window.__bg)) || 'black';
    pages.push(page);
  }
  if (errors.length) throw new Error('page errors: ' + errors.slice(0, 3).join(' | '));
  let next = 0, done = 0;
  const tick = setInterval(() => process.stdout.write(`\r  frames ${done}/${plan.frames.length}   `), 2000);
  const clip = { x: 0, y: 0, width: STAGE_W, height: STAGE_H };
  await Promise.all(pages.map(async (page) => {
    for (;;) {
      const i = next++;
      if (i >= plan.frames.length) return;
      const f = plan.frames[i];
      // workers pick frames out of order, so every frame carries the full variable state it needs
      await page.evaluate(([s, t, v]) => window.__frame(s, t, v), [f.segmentId, f.t, varsAt(i)]);
      fs.writeFileSync(frameFile(i), await page.screenshot({ clip, omitBackground: true, type: 'png' }));
      done++;
    }
  }));
  clearInterval(tick);
  process.stdout.write('\r');
  if (errors.length) throw new Error('page errors: ' + errors.slice(0, 3).join(' | '));
  await browser.close();
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

function composite() {
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
    const v = c.kind === 'video' && m >= 0 && hasStream(file, 'v') ? `${m}:v:0` : `${lavfi(`color=c=${bgColour || opt.bg || 'black'}:s=${W}x${H}:r=${opt.fps}`)}:v:0`;
    const a = m >= 0 && hasStream(file, 'a') ? `${m}:a:0` : `${lavfi('anullsrc=r=48000:cl=stereo')}:a:0`;
    filters.push(`[${v}]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${opt.fps},format=yuv420p,trim=end_frame=${c.frames},setpts=PTS-STARTPTS[v${k}]`);
    filters.push(`[${a}]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur=${dur},atrim=end=${dur},asetpts=PTS-STARTPTS[a${k}]`);
  });
  filters.push(`${merged.map((_, k) => `[v${k}][a${k}]`).join('')}concat=n=${n}:v=1:a=1[bv][ba]`);
  const count = () => inputs.filter((x) => x === '-i').length;
  const ovIdx = count();
  inputs.push(...seqArgs);
  const burn = opt['burn-captions'] && hasCaptions;
  filters.push(`[bv][${ovIdx}:v]overlay=format=auto:shortest=1,format=yuv420p${burn ? '[ov]' : '[fv]'}`);
  if (burn) filters.push(`[ov]subtitles=captions.vtt:original_size=${W}x${H}:force_style='FontSize=${Math.round(H / 30)},Outline=2,Shadow=0,MarginV=${Math.round(H / 20)}'[fv]`);
  const soft = !opt['burn-captions'] && hasCaptions;
  const subIdx = count();
  if (soft) inputs.push('-i', 'captions.vtt');
  ffmpeg([...inputs, '-filter_complex', filters.join(';'), '-map', '[fv]', '-map', '[ba]', ...(soft ? ['-map', `${subIdx}:s`, '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng'] : []),
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', String(opt.fps), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'video.mp4'], 'video.mp4');
}

try {
  const r0 = Date.now();
  await renderFrames();
  const rs = (Date.now() - r0) / 1000;
  log(`painted ${plan.frames.length} frames at ${W}x${H} in ${rs.toFixed(1)} s (${(plan.frames.length / rs).toFixed(1)} frames/s)`);
  if (opt.mode !== 'composite') { const e0 = Date.now(); encodeOverlay(); log(`overlay encoded (${opt.format}) in ${((Date.now() - e0) / 1000).toFixed(1)} s`); }
  if (opt.mode !== 'overlay') { const e0 = Date.now(); composite(); log(`composite encoded in ${((Date.now() - e0) / 1000).toFixed(1)} s`); }
  if ((opt.format !== 'png' && !opt['keep-frames']) || opt.mode === 'composite') fs.rmSync(framesDir, { recursive: true, force: true });
  log(`done: ${out}`);
} finally {
  if (vite) vite.kill();
}
