import { ramp } from '../clock.ts';
import { interpolate } from '../store.ts';
import { FONT, fade, type Component } from './base.ts';

const text = (it: any) => (typeof it === 'string' ? it : it.text ?? it.label ?? '');

export const numberedList: Component = {
  meta: { renders: 'com.semanticops.explainer/numbered-list@1', name: 'Numbered list', variants: ['default', 'panel'] },
  mount(host) {
    const root = host.ownerDocument.createElement('div');
    root.innerHTML = '<h2></h2><ol></ol>';
    host.appendChild(root);
    return root;
  },
  render(node, p, data, vars, items, dur) {
    const panel = data.variant === 'panel';
    // panel: a translucent card on the right, for text over a talking head (face is centred); fades out over the last 0.4 s
    const out = panel ? 1 - ramp(p * dur, dur - 0.4, dur) : 1;
    node.setAttribute('style', panel
      ? `${FONT};position:absolute;right:2.5%;top:50%;width:27%;transform:translateY(-50%);container-type:inline-size;box-sizing:border-box;padding:2.2%;border-radius:12px;background:rgba(12,14,22,.7);color:#fff;opacity:${out.toFixed(3)}`
      : `${FONT};position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:2rem 3rem;box-sizing:border-box`);
    const [h, ol] = Array.from(node.children) as HTMLElement[];
    h.textContent = interpolate(data.heading ?? '', vars);
    h.setAttribute('style', `margin:0 0 ${panel ? '.6em' : '1rem'};font-size:${panel ? '9cqw' : '1.8rem'};${fade(ramp(p, 0, 0.15))}`);
    // li count is a function of items only, so no history leaks in
    while (ol.children.length < items.length) ol.appendChild(node.ownerDocument.createElement('li'));
    while (ol.children.length > items.length) ol.lastChild!.remove();
    const n = items.length;
    // item i appears at its own `at` (seconds from cue start, data) or else at an even share of the cue
    const starts = items.map((it, i) => (typeof it?.at === 'number' ? it.at / dur : 0.15 + (0.85 * i) / n));
    const fadeP = (i: number) => (typeof items[i]?.at === 'number' ? 0.4 / dur : 0.4 / n);
    const share = starts.reduce((a, s, i) => (p >= s ? i : a), 0);
    const active = typeof data.step_index === 'number' ? data.step_index - 1 : Math.min(share, n - 1); // step_index is 1-based
    ol.setAttribute('style', `margin:0;padding-left:${panel ? '1.4em' : '1.5rem'};font-size:${panel ? '7.5cqw' : '1.3rem'}`);
    Array.from(ol.children).forEach((li, i) => {
      const s = starts[i];
      const o = ramp(p, s, s + fadeP(i));
      li.textContent = interpolate(text(items[i]), vars);
      li.setAttribute('style', `margin:.4rem 0;${fade(o * (i === active ? 1 : 0.6), 8)};${i === active ? 'font-weight:700;color:var(--explainer-accent,#06c)' : ''}`);
    });
  },
};
