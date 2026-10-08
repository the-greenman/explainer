import { fmtTime, pathSteps, type ChoiceStep, type PathStep, type SpanStep } from './path.ts';
import type { ExplainerPlayer } from './player.ts';

const INK = 'var(--explainer-path-ink,var(--explainer-ink,inherit))';
const ACCENT = 'var(--explainer-accent,currentColor)';
const css = (...rules: string[]) => rules.join(';');

/**
 * `<explainer-path for="playerId" mode="crumbs|tree">`: the branching path watched so far, built from the player's
 * history (see pathSteps). Past spans and choices are buttons that rewind the player along the path.
 */
export class ExplainerPath extends HTMLElement {
  private raf = 0;
  private drawn = false;
  private now: HTMLElement | null = null;
  private nowText = '';
  private onPath = (e: Event) => { if (this.player && (e.target === this.player || this.player.contains(e.target as Node))) this.render(); };

  private get player(): ExplainerPlayer | null {
    const id = this.getAttribute('for');
    const el = id ? document.getElementById(id) : document.querySelector('explainer-player');
    return el?.localName === 'explainer-player' ? (el as ExplainerPlayer) : null;
  }

  static observedAttributes = ['mode', 'for'];
  attributeChangedCallback() { if (this.isConnected) this.drawn = false; }

  connectedCallback() {
    document.addEventListener('explainer:path', this.onPath);
    // the manifest is set after import, so the clock may not exist yet (or is replaced): the loop draws when it appears
    const loop = () => {
      const clock = this.player?.clock;
      if (clock && !this.drawn) this.render();
      if (this.now && clock) {
        const text = fmtTime(clock.t);
        if (text !== this.nowText) { this.nowText = text; this.now.textContent = text; }
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.raf);
    document.removeEventListener('explainer:path', this.onPath);
  }

  private render() {
    const p = this.player;
    if (!p?.clock) return;
    this.drawn = true;
    this.now = null;
    const c = p.clock;
    const steps = pathSteps(c.manifest, c.history, { segmentId: c.segmentId, t: c.t }, c.holding);
    const tree = this.getAttribute('mode') === 'tree';
    this.setAttribute('style', css('display:block', `color:${INK}`, 'font-family:var(--explainer-font,inherit)', 'font-size:.9em', 'line-height:1.5'));
    this.replaceChildren(tree ? this.tree(steps, p) : this.crumbs(steps, p));
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, style = '', text = '') {
    const e = document.createElement(tag);
    if (style) e.setAttribute('style', style);
    if (text) e.textContent = text;
    return e;
  }

  /** A button that rewinds, or for the current step plain text marked aria-current. */
  private control(s: PathStep, p: ExplainerPlayer, text: string) {
    const label = (s.kind === 'choice' ? '◆ ' : '') + text;
    if (s.current) {
      const span = this.el('span', 'font-weight:600', label);
      span.setAttribute('aria-current', 'step');
      return span;
    }
    const b = this.el('button', css('all:unset', 'display:inline-block', 'text-align:left', 'cursor:pointer', 'text-decoration:underline', 'text-decoration-color:transparent', 'text-underline-offset:.2em', `color:${INK}`), label);
    b.type = 'button';
    b.title = s.kind === 'choice' ? 'Back to this choice' : 'Rewind to here';
    b.tabIndex = 0;
    b.onmouseenter = () => (b.style.textDecorationColor = ACCENT);
    b.onmouseleave = () => (b.style.textDecorationColor = 'transparent');
    b.onfocus = () => (b.style.textDecorationColor = ACCENT);
    b.onblur = () => (b.style.textDecorationColor = 'transparent');
    b.onclick = () => p.rewind(s.depth, s.kind === 'choice');
    return b;
  }

  /** "▸ now m:ss" with a text node the animation loop updates. */
  private nowTag() {
    const wrap = this.el('span', `color:${ACCENT};white-space:nowrap;margin-left:.5em`);
    wrap.append('▸ ');
    this.now = this.el('span');
    this.nowText = fmtTime(this.player!.clock.t);
    this.now.textContent = this.nowText;
    wrap.append(this.now);
    return wrap;
  }

  private crumbs(steps: PathStep[], p: ExplainerPlayer) {
    const nav = this.el('nav');
    nav.setAttribute('aria-label', 'Path');
    const ol = this.el('ol', css('list-style:none', 'margin:0', 'padding:0', 'display:flex', 'flex-wrap:wrap', 'align-items:baseline', 'gap:.25em .5em'));
    steps.forEach((s, i) => {
      const li = this.el('li');
      if (i) {
        const sep = this.el('span', 'margin-right:.5em;opacity:.5', '\u203A');
        sep.setAttribute('aria-hidden', 'true');
        li.append(sep);
      }
      li.append(this.control(s, p, s.label));
      if (s.kind === 'span' && s.current) li.append(this.nowTag());
      ol.append(li);
    });
    nav.append(ol);
    return nav;
  }

  private tree(steps: PathStep[], p: ExplainerPlayer) {
    const nav = this.el('nav');
    nav.setAttribute('aria-label', 'Path');
    const list = () => this.el('ul', css('list-style:none', 'margin:0', 'padding:0'));
    const root = list();
    const dim = 'opacity:.5';
    // a bullet beside a block of text: buttons are atomic inline boxes, so a long label would otherwise drop below its bullet
    const row = (bullet: string, style = '') => {
      const li = this.el('li', `display:flex;gap:.4em;padding:.1em 0;${style}`);
      const body = this.el('div', 'min-width:0');
      li.append(this.el('span', 'flex:none', bullet), body);
      return { li, body };
    };
    const spanLi = (s: SpanStep) => {
      const { li, body } = row('\u25CF');
      body.append(this.control(s, p, s.label));
      if (s.current) {
        if (s.from > 0) body.append(this.el('span', 'margin-left:.5em;opacity:.7', `@${fmtTime(s.from)}`));
        body.append(this.nowTag());
      } else body.append(this.el('span', 'margin-left:.75em;opacity:.7;font-variant-numeric:tabular-nums;white-space:nowrap', `${fmtTime(s.from)}\u2013${fmtTime(s.to)}`));
      return li;
    };
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.kind === 'span') { root.append(spanLi(s)); continue; }
      const li = this.el('li', 'padding:.1em 0');
      li.append(this.control(s, p, s.label));
      const opts = list();
      opts.setAttribute('style', 'list-style:none;margin:0;padding:0 0 0 .6em;border-left:1px solid currentColor;margin-left:.45em');
      const next = steps[i + 1];
      for (const o of (s as ChoiceStep).options) {
        const ol = this.el('li', `padding:.1em 0 .1em .5em${o.taken ? '' : ';' + dim}`);
        ol.append(o.taken ? '● ' : '○ ', o.label);
        if (o.taken && next?.kind === 'span') {
          const sub = list();
          sub.setAttribute('style', 'list-style:none;margin:0;padding:0 0 0 1em');
          sub.append(spanLi(next));
          ol.append(sub);
          i++; // the span shown under the option taken
        }
        opts.append(ol);
      }
      li.append(opts);
      root.append(li);
    }
    nav.append(root);
    return nav;
  }
}
