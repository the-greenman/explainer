import { ramp } from '../clock.ts';
import { interpolate } from '../store.ts';
import { FONT, type Component } from './base.ts';
import { fade, FADE_OFFSET_CARD } from '../motion.ts';
import { ACCENT, CARD, CARD_INK, LEADING_SUB, LEADING_TITLE, SAFE, LOWER_WIDTH, SIZE_BYLINE, SIZE_CARD_NOTE, SIZE_CARD_SUB, SIZE_CARD_TITLE, SIZE_HEADING, SIZE_SUBTITLE, SIZE_TITLE } from '../theme.ts';

export const intro: Component = {
  meta: { renders: 'com.semanticops.explainer/intro@1', name: 'Intro', variants: ['default', 'minimal', 'lower-third'] },
  mount(host, data) {
    const d = host.ownerDocument;
    const root = d.createElement('div');
    root.innerHTML = '<h1></h1><p class="sub"></p><p class="who"></p>';
    host.appendChild(root);
    return root;
  },
  render(node, p, data, vars) {
    if (data.variant === 'lower-third') return renderLowerThird(node, p, data, vars);
    const minimal = data.variant === 'minimal';
    node.setAttribute('style', `${FONT};position:absolute;inset:0;display:flex;flex-direction:column;justify-content:${minimal ? 'flex-end' : 'center'};align-items:${minimal ? 'flex-start' : 'center'};text-align:${minimal ? 'left' : 'center'};padding:2rem;box-sizing:border-box`);
    const [h, sub, who] = Array.from(node.children) as HTMLElement[];
    h.textContent = interpolate(data.title ?? '', vars);
    sub.textContent = interpolate(data.subtitle ?? '', vars);
    who.textContent = interpolate(data.presenter ?? '', vars);
    h.setAttribute('style', `margin:0;font-size:${minimal ? SIZE_HEADING : SIZE_TITLE};${fade(ramp(p, 0, 0.3))}`);
    sub.setAttribute('style', `margin:.5rem 0 0;font-size:${SIZE_SUBTITLE};${fade(ramp(p, 0.2, 0.5))}`);
    who.setAttribute('style', `margin:1rem 0 0;font-size:${SIZE_BYLINE};color:${ACCENT};${fade(ramp(p, 0.4, 0.7))}`);
  },
};

// Over a talking head: a small translucent card at the left, above the native captions (bottom-centre), clear of a centred face.
function renderLowerThird(node: HTMLElement | SVGElement, p: number, data: Record<string, any>, vars: Record<string, string>) {
  node.setAttribute('style', `${FONT};position:absolute;left:${SAFE};bottom:24%;width:${LOWER_WIDTH};container-type:inline-size;box-sizing:border-box;padding:1.6% 2%;border-left:5px solid ${ACCENT};background:${CARD};color:${CARD_INK};border-radius:0 10px 10px 0;${fade(Math.min(ramp(p, 0, 0.08), 1 - ramp(p, 0.92, 1)), FADE_OFFSET_CARD)}`);
  const [h, sub, who] = Array.from(node.children) as HTMLElement[];
  h.textContent = interpolate(data.title ?? '', vars);
  sub.textContent = interpolate(data.subtitle ?? '', vars);
  who.textContent = interpolate(data.presenter ?? '', vars);
  h.setAttribute('style', `margin:0;font-size:${SIZE_CARD_TITLE};line-height:${LEADING_TITLE};color:${CARD_INK}`);
  sub.setAttribute('style', `margin:.4em 0 0;font-size:${SIZE_CARD_SUB};line-height:${LEADING_SUB};color:${CARD_INK};display:${sub.textContent ? 'block' : 'none'}`);
  who.setAttribute('style', `margin:.5em 0 0;font-size:${SIZE_CARD_NOTE};color:${CARD_INK};opacity:.8;display:${who.textContent ? 'block' : 'none'}`);
}
