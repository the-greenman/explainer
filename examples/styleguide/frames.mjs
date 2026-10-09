// Review frames: one PNG per component x variant x surface x p in {0, 0.5, 1, still}, from any page that mounts the styleguide
// harness (src/styleguide.ts) in headless Chromium.
// Usage: node examples/styleguide/frames.mjs [outDir] [pageUrl] [--theme=<id>] [--only=<slug or slug__variant>[,...]]
//   outDir defaults to examples/styleguide/frames/ (git-ignored); pageUrl to http://localhost:5199/examples/styleguide/index.html
//   (a running `vite` server at the repo root). Any URL that hosts the harness works, e.g. a site's own styleguide page.
//   Playwright: set PLAYWRIGHT=/path/to/playwright/index.mjs, else the srs-web copy named in CLAUDE.md.
// Files: <renders-slug>__<variant>__<surface>__p{0,0.5,1,still}.png, e.g. explainer-intro-1__lower-third__video__p0.5.png
// Surfaces: web (360 px column), video (16:9 stage, 640 px) and phone (the stage at 360 px; video-surface components). Shot at device scale 2.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT ?? '/home/greenman/dev/semanticops/srs-web/node_modules/playwright/index.mjs');

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const outDir = resolve(pos[0] ?? new URL('./frames/', import.meta.url).pathname);
const target = new URL(pos[1] ?? 'http://localhost:5199/examples/styleguide/index.html');
if (flags.theme) target.searchParams.set('theme', flags.theme);
if (flags.only) target.searchParams.set('only', flags.only);

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(target.href);
await page.waitForFunction(() => window.__styleguide?.ready, null, { timeout: 30000 });
await page.evaluate(() => document.fonts.ready);

const cases = await page.evaluate(() => window.__styleguide.cases);
let n = 0;
for (const c of cases) {
  for (const surface of c.surfaces) {
    const el = page.locator(`article[data-key="${c.key}"] [data-surface="${surface}"]`);
    for (const [label, p] of [['0', 0], ['0.5', 0.5], ['1', 1], ['still', c.still]]) {
      await page.evaluate(([key, v]) => window.__styleguide.setP(key, v), [c.key, p]);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await el.scrollIntoViewIfNeeded();
      await el.screenshot({ path: `${outDir}/${c.key}__${surface}__p${label}.png` });
      n++;
    }
  }
}
await browser.close();
console.log(`frames: ${n} png in ${outDir} (${cases.length} component variants, ${target.href})`);
if (errors.length) { console.error(`page errors:\n  ${[...new Set(errors)].join('\n  ')}`); process.exitCode = 1; }
