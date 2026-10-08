import { ramp } from '../clock.ts';
import { interpolate } from '../store.ts';
import { FONT, fade, type Component } from './base.ts';

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
    h.setAttribute('style', `margin:0;font-size:${minimal ? 1.6 : 2.6}rem;${fade(ramp(p, 0, 0.3))}`);
    sub.setAttribute('style', `margin:.5rem 0 0;font-size:1.2rem;${fade(ramp(p, 0.2, 0.5))}`);
    who.setAttribute('style', `margin:1rem 0 0;font-size:.9rem;color:var(--explainer-accent,#06c);${fade(ramp(p, 0.4, 0.7))}`);
  },
};

// Over a talking head: a small translucent card at the left, above the native captions (bottom-centre), clear of a centred face.
function renderLowerThird(node: HTMLElement | SVGElement, p: number, data: Record<string, any>, vars: Record<string, string>) {
  node.setAttribute('style', `${FONT};position:absolute;left:2.5%;bottom:24%;width:28%;container-type:inline-size;box-sizing:border-box;padding:1.6% 2%;border-left:5px solid var(--explainer-accent,#06c);background:rgba(12,14,22,.7);color:#fff;border-radius:0 10px 10px 0;${fade(Math.min(ramp(p, 0, 0.08), 1 - ramp(p, 0.92, 1)), 10)}`);
  const [h, sub, who] = Array.from(node.children) as HTMLElement[];
  h.textContent = interpolate(data.title ?? '', vars);
  sub.textContent = interpolate(data.subtitle ?? '', vars);
  who.textContent = interpolate(data.presenter ?? '', vars);
  h.setAttribute('style', 'margin:0;font-size:10cqw;line-height:1.15;color:#fff');
  sub.setAttribute('style', `margin:.4em 0 0;font-size:7cqw;line-height:1.3;color:#fff;display:${sub.textContent ? 'block' : 'none'}`);
  who.setAttribute('style', `margin:.5em 0 0;font-size:6cqw;color:#fff;opacity:.8;display:${who.textContent ? 'block' : 'none'}`);
}
