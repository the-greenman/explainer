import { ramp } from '../clock.ts';
import { interpolate } from '../store.ts';
import { FONT, type Component } from './base.ts';
import { fade, FADE_OFFSET_ITEM, ITEM_FADE_S, PANEL_OUT_S } from '../motion.ts';
import { ACCENT, CARD, CARD_INK, SAFE, SIDE_WIDTH, SIZE_ITEM, SIZE_PANEL_HEADING, SIZE_PANEL_ITEM, SIZE_SECTION, WEIGHT_STRONG } from '../theme.ts';

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
    const out = panel ? 1 - ramp(p * dur, dur - PANEL_OUT_S, dur) : 1;
    node.setAttribute('style', panel
      ? `${FONT};position:absolute;right:${SAFE};top:50%;width:${SIDE_WIDTH};transform:translateY(-50%);container-type:inline-size;box-sizing:border-box;padding:2.2%;border-radius:12px;background:${CARD};color:${CARD_INK};opacity:${out.toFixed(3)}`
      : `${FONT};position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:2rem 3rem;box-sizing:border-box`);
    const [h, ol] = Array.from(node.children) as HTMLElement[];
    h.textContent = interpolate(data.heading ?? '', vars);
    h.setAttribute('style', `margin:0 0 ${panel ? '.6em' : '1rem'};font-size:${panel ? SIZE_PANEL_HEADING : SIZE_SECTION};${fade(ramp(p, 0, 0.15))}`);
    // li count is a function of items only, so no history leaks in
    while (ol.children.length < items.length) ol.appendChild(node.ownerDocument.createElement('li'));
    while (ol.children.length > items.length) ol.lastChild!.remove();
    const n = items.length;
    // item i appears at its own `at` (seconds from cue start, data) or else at an even share of the cue
    const starts = items.map((it, i) => (typeof it?.at === 'number' ? it.at / dur : 0.15 + (0.85 * i) / n));
    const fadeP = (i: number) => (typeof items[i]?.at === 'number' ? ITEM_FADE_S / dur : ITEM_FADE_S / n);
    const share = starts.reduce((a, s, i) => (p >= s ? i : a), 0);
    const active = typeof data.step_index === 'number' ? data.step_index - 1 : Math.min(share, n - 1); // step_index is 1-based
    ol.setAttribute('style', `margin:0;padding-left:${panel ? '1.4em' : '1.5rem'};font-size:${panel ? SIZE_PANEL_ITEM : SIZE_ITEM}`);
    Array.from(ol.children).forEach((li, i) => {
      const s = starts[i];
      const o = ramp(p, s, s + fadeP(i));
      li.textContent = interpolate(text(items[i]), vars);
      li.setAttribute('style', `margin:.4rem 0;${fade(o * (i === active ? 1 : 0.6), FADE_OFFSET_ITEM)};${i === active ? `font-weight:${WEIGHT_STRONG};color:${ACCENT}` : ''}`);
    });
  },
};
