// The styleguide harness: renders every *registered* component x variant from fixture data, each with a scrubber, a "still"
// button and true-size frames. A site mounts it in its own page after importing the core and its pack(s); see README "Styleguide".
// Import-time side effects: none. Only the registry in components/base.ts is pulled in (shared with the core entry).
import { registered, stillP, type Component } from './components/base.ts';

export type Fixture = { data: Record<string, any>; items: any[]; dur?: number };
export type StyleguideTheme = {
  id: string;
  label: string;
  /** Class put on the wrapper that holds the cards while this theme is active. Default `sg-theme-<id>`. */
  className?: string;
  /** Raw stylesheet text. Every `:root` in it is rewritten to `.<className>`, so the theme applies to the cards only. No CSS: the contract defaults. */
  css?: string;
};
export type StyleguideOptions = {
  /** By `meta.renders`. A registered component without an entry shows a "no fixture" note. */
  fixtures: Record<string, Fixture>;
  /** First is the default, unless the page URL has `?theme=<id>`. Omitted or a single entry: no switch is shown. */
  themes?: StyleguideTheme[];
  /** Substring filter on `<renders-slug>__<variant>`, comma-separated. The page URL's `?only=` is used when this is not given. */
  only?: string;
  /** Content above the cards (a site's rules panel). Put `<strong data-sg-min-size></strong>` in it to show `measureSmallestType()`. */
  intro?: HTMLElement | string;
};
export type SmallestType = { px: number; at1920: number; where: string };

export const DUR = 10;
const VARS = { name: 'Ada' };
/** The offline render's CSS stage is 1280 wide; the output is 1920 wide. */
const OUTPUT_SCALE = 1920 / 1280;

/** `com.semanticops.explainer.example/cycle@1` -> `explainer.example-cycle-1` */
export const slugOf = (renders: string) => renders.replace(/^com\.semanticops\./, '').replace(/[/@]/g, '-');
/** Rewrites every `:root` in a theme stylesheet to `.<className>`. Selectors on `html`/`body` are left alone. */
export const scopeThemeCss = (css: string, className: string) => css.replace(/:root\b/g, `.${className}`);

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

type Frame = { surface: 'web' | 'video' | 'phone'; stage: HTMLElement; node: HTMLElement | SVGElement };
type Case = {
  key: string; slug: string; renders: string; variant: string; comp: Component;
  data: Record<string, any>; items: any[]; dur: number; still: number; frames: Frame[];
  setP(p: number): void; mnode?: HTMLElement | SVGElement;
};

const CHROME = `
.explainer-sg { --sg-bg: #fafaf8; --sg-ink: #222; --sg-mute: #666; --sg-line: #d6d4cf; box-sizing: border-box; background: var(--sg-bg); color: var(--sg-ink); font: 15px/1.5 system-ui, sans-serif; padding: 0 16px 24px; }
.explainer-sg *, .explainer-sg *::before, .explainer-sg *::after { box-sizing: inherit; }
.explainer-sg > * { max-width: 1120px; margin-left: auto; margin-right: auto; }
.explainer-sg h1 { font-size: 28px; margin: 24px 0 4px; letter-spacing: -.02em; }
.explainer-sg h2 { font-size: 20px; margin: 0; letter-spacing: -.01em; }
.explainer-sg code, .explainer-sg .mono { font: 12.5px ui-monospace, monospace; }
.explainer-sg .sg-lede { color: var(--sg-mute); margin: 0 0 12px; }
.explainer-sg .sg-switch { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; margin: 12px auto 20px; }
.explainer-sg .sg-switch label { cursor: pointer; }
.explainer-sg .sg-intro { margin-bottom: 24px; }
.explainer-sg article { border-top: 1px solid var(--sg-line); padding: 20px 0 24px; }
.explainer-sg .sg-head { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; }
.explainer-sg .sg-badge { font: 500 11px/1 ui-monospace, monospace; letter-spacing: .04em; text-transform: uppercase; border: 1px solid var(--sg-line); padding: 3px 6px; background: #fff; }
.explainer-sg .sg-badge.variant { background: var(--sg-ink); color: #fff; border-color: var(--sg-ink); }
.explainer-sg .sg-ctl { display: flex; gap: 10px; align-items: center; margin: 10px 0 12px; max-width: 640px; }
.explainer-sg .sg-ctl input[type=range] { flex: 1; min-width: 0; accent-color: var(--sg-ink); }
.explainer-sg .sg-ctl button { font: inherit; padding: 2px 10px; border: 1px solid var(--sg-ink); background: #fff; color: var(--sg-ink); cursor: pointer; }
.explainer-sg .sg-ctl .p { min-width: 4.5em; text-align: right; }
.explainer-sg .sg-frames { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.explainer-sg figure { margin: 0; max-width: 100%; }
.explainer-sg figcaption { font: 12px ui-monospace, monospace; color: var(--sg-mute); margin-top: 4px; }
.explainer-sg .sg-none { padding: 12px; border: 1px dashed var(--sg-line); color: var(--sg-mute); font-size: 13px; }
.explainer-sg .sg-web { width: 360px; max-width: 100%; border: 1px solid var(--sg-line); }
.explainer-sg .sg-web .sg-stage { position: relative; overflow: hidden; aspect-ratio: 16/9; container-type: inline-size; background: var(--explainer-paper, var(--explainer-bg, #fff)); }
.explainer-sg .sg-video { width: 640px; max-width: 100%; position: relative; border: 1px solid var(--sg-line); }
.explainer-sg .sg-video.sg-phone { width: 360px; }
.explainer-sg .sg-picture { position: absolute; inset: 0; background: #8c8c8c; color: #ffffff99; font: 500 12px ui-monospace, monospace; letter-spacing: .1em; text-transform: uppercase; padding: 8px; }
.explainer-sg .sg-video .sg-stage { position: relative; overflow: hidden; aspect-ratio: 16/9; container-type: inline-size; }
`;

type Active = { measure(): SmallestType | null };
let active: Active | null = null;

/**
 * The smallest on-stage type of the mounted styleguide: every video-surface case rendered at its still on an off-screen
 * 1280 px stage inside the active theme wrapper, the smallest computed font size, and that x1.5 for a 1920 render.
 * `null` if nothing is mounted or no text was measured. Also written into any `[data-sg-min-size]` element on the page.
 */
export function measureSmallestType(): SmallestType | null {
  return active?.measure() ?? null;
}

/** Mounts the harness into `root`. Returns a cleanup that removes everything it added. */
export function mountStyleguide(root: HTMLElement, opts: StyleguideOptions): () => void {
  const params = new URLSearchParams(location.search);
  const onlyStr = opts.only ?? params.get('only') ?? '';
  const only = onlyStr.split(',').map((s) => s.trim()).filter(Boolean);
  const themes: StyleguideTheme[] = opts.themes?.length ? opts.themes : [{ id: 'default', label: 'default' }];
  const classOf = (t: StyleguideTheme) => t.className ?? `sg-theme-${t.id}`;

  const wrap = h('div', 'explainer-sg');
  const style = h('style');
  style.textContent = CHROME + themes.filter((t) => t.css).map((t) => scopeThemeCss(t.css!, classOf(t))).join('\n');
  const header = h('header');
  header.append(h('h1', '', 'Styleguide'));
  const lede = h('p', 'sg-lede');
  lede.innerHTML = 'Every registered component and variant, rendered by its own <code>mount</code> and <code>render</code> from fixture data. Drag the slider to scrub p; "still" jumps to the frame print and reduced motion show.';
  header.append(lede);
  const list = h('main');
  list.className = 'sg-list';
  wrap.append(style, header);
  if (opts.intro) {
    const intro = h('section', 'sg-intro');
    if (typeof opts.intro === 'string') intro.innerHTML = opts.intro; else intro.append(opts.intro);
    wrap.append(intro);
  }
  wrap.append(list);
  root.append(wrap);

  // ---- cases ----
  const cases: Case[] = [];
  const matches = (slug: string, variant: string) => !only.length || only.some((o) => `${slug}__${variant}`.includes(o));
  for (const comp of registered()) {
    const fx = opts.fixtures[comp.meta.renders];
    for (const variant of comp.meta.variants) {
      const slug = slugOf(comp.meta.renders);
      if (!matches(slug, variant)) continue;
      const data = { ...(fx?.data ?? {}), variant };
      const items = fx?.items ?? [];
      const dur = fx?.dur ?? DUR;
      const still = stillP(comp, data, items, dur);

      const art = h('article');
      art.dataset.key = `${slug}__${variant}`;
      const head = h('div', 'sg-head');
      head.append(h('h2', '', comp.meta.name), h('span', 'sg-badge variant', variant));
      for (const s of comp.meta.surfaces) head.append(h('span', 'sg-badge', s));
      head.append(h('code', 'mono', comp.meta.renders));
      art.append(head);
      if (!fx) art.append(h('p', 'sg-none', 'No fixture for this component: add one under its renders id in the fixtures passed to mountStyleguide.'));

      const ctl = h('div', 'sg-ctl');
      const range = h('input');
      Object.assign(range, { type: 'range', min: '0', max: '1', step: '0.001', value: String(still) });
      range.setAttribute('aria-label', `p for ${comp.meta.name} (${variant})`);
      const readout = h('span', 'p mono');
      const stillBtn = h('button', '', 'still');
      stillBtn.title = `jump to stillP = ${still.toFixed(3)}`;
      ctl.append(h('span', 'mono', 'p'), range, readout, stillBtn);
      art.append(ctl);

      const frames: Frame[] = [];
      const row = h('div', 'sg-frames');
      // web column and 16:9 stage declare their surface; the phone embed is the stage at 360 px, so it follows `video`
      const defs = [
        { name: 'web', needs: 'web', cls: 'sg-web', caption: 'web column, 360 px', none: 'web column' },
        { name: 'video', needs: 'video', cls: 'sg-video', caption: '16:9 stage, 640 px', none: '16:9 stage' },
        { name: 'phone', needs: 'video', cls: 'sg-video sg-phone', caption: 'phone embed, 360 px', none: 'phone embed' },
      ] as const;
      for (const d of defs) {
        const fig = h('figure');
        if (!comp.meta.surfaces.includes(d.needs)) {
          fig.append(h('div', 'sg-none', `Not declared for the ${d.none}: meta.surfaces is [${comp.meta.surfaces.join(', ')}].`));
          row.append(fig);
          continue;
        }
        const outer = h('div', d.cls);
        outer.dataset.surface = d.name;
        const stage = h('div', 'sg-stage');
        if (d.name === 'web') outer.append(stage);
        else outer.append(h('div', 'sg-picture', 'picture'), stage); // the stage is a true-size size container, as in the player: cqw does the scaling
        fig.append(outer, h('figcaption', '', d.caption));
        row.append(fig);
        frames.push({ surface: d.name, stage, node: null as any });
      }
      art.append(row);
      list.append(art);

      // mount after the frames are in the document: canvas components size from their laid-out box
      for (const f of frames) f.node = comp.mount(f.stage, data);
      const c: Case = {
        key: `${slug}__${variant}`, slug, renders: comp.meta.renders, variant, comp, data, items, dur, still, frames,
        setP(p) {
          range.value = String(p);
          readout.textContent = p.toFixed(3);
          for (const f of frames) comp.render(f.node, p, data, VARS, items, dur);
        },
      };
      range.addEventListener('input', () => c.setP(Number(range.value)));
      stillBtn.addEventListener('click', () => c.setP(still));
      c.setP(still);
      cases.push(c);
    }
  }

  // ---- smallest type size on stage ----
  const mhost = h('div');
  mhost.setAttribute('style', 'position:fixed;left:-20000px;top:0;width:1280px;pointer-events:none');
  list.append(mhost); // inside the theme wrapper
  const mstages = new Map<Case, HTMLElement>();
  let minSize: SmallestType | null = null;
  const measure = (): SmallestType | null => {
    let best = { px: Infinity, where: '' };
    for (const c of cases) {
      if (!c.comp.meta.surfaces.includes('video')) continue;
      let stage = mstages.get(c);
      if (!stage) {
        stage = h('div', 'sg-stage');
        stage.setAttribute('style', 'position:relative;aspect-ratio:16/9;container-type:inline-size;overflow:hidden');
        mhost.append(stage);
        mstages.set(c, stage);
        c.mnode = c.comp.mount(stage, c.data);
      }
      c.comp.render(c.mnode!, c.still, c.data, VARS, c.items, c.dur);
      for (const el of [stage, ...stage.querySelectorAll('*')]) {
        if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
        const cs = getComputedStyle(el);
        let px = parseFloat(cs.fontSize);
        if (el instanceof SVGGraphicsElement) px *= el.getScreenCTM()?.a ?? 1; // SVG text is in user units: scale by the drawn size
        if (cs.display === 'none' || !px) continue;
        if (px < best.px) best = { px, where: `${c.comp.meta.name} (${c.variant})` };
      }
    }
    minSize = Number.isFinite(best.px) ? { px: best.px, at1920: best.px * OUTPUT_SCALE, where: best.where } : null;
    for (const out of wrap.querySelectorAll('[data-sg-min-size]')) {
      out.textContent = minSize ? `${minSize.px.toFixed(1)} px on the 1280 stage = ${minSize.at1920.toFixed(1)} px at 1920, in ${minSize.where}` : 'no text measured';
    }
    return minSize;
  };

  // ---- theme switch ----
  const setTheme = (id: string) => {
    const t = themes.find((x) => x.id === id) ?? themes[0];
    for (const x of themes) list.classList.toggle(classOf(x), x === t);
    const radio = wrap.querySelector<HTMLInputElement>(`input[name=sg-theme][value="${t.id}"]`);
    if (radio) radio.checked = true;
    measure();
  };
  if (themes.length > 1) {
    const sw = h('div', 'sg-switch');
    sw.setAttribute('role', 'radiogroup');
    sw.setAttribute('aria-label', 'Theme');
    sw.append(h('strong', '', 'Theme'));
    for (const t of themes) {
      const label = h('label');
      const r = h('input');
      Object.assign(r, { type: 'radio', name: 'sg-theme', value: t.id });
      r.addEventListener('change', () => { if (r.checked) setTheme(t.id); });
      label.append(r, ` ${t.label}`);
      sw.append(label);
    }
    header.after(sw);
  }
  const instance: Active = { measure: () => measure() };
  active = instance;
  setTheme(params.get('theme') ?? themes[0].id);
  // measure again once fonts are in: wrapping and SVG scale can change
  void document.fonts?.ready.then(() => { if (active === instance) measure(); });

  // hooks for examples/styleguide/frames.mjs (or any host's review script)
  (window as any).__styleguide = {
    cases: cases.map((c) => ({ key: c.key, slug: c.slug, renders: c.renders, variant: c.variant, surfaces: c.frames.map((f) => f.surface), still: c.still })),
    setP(key: string, p: number) { cases.find((c) => c.key === key)!.setP(p); },
    minSize: () => minSize,
    ready: true,
  };

  return () => {
    if (active === instance) { active = null; delete (window as any).__styleguide; }
    wrap.remove();
  };
}
