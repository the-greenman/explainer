import { interpolate } from '../store.ts';
import { FONT, type Component } from './base.ts';
import { ACCENT, BUTTON, BUTTON_INK, INK, PAPER, SCRIM, SCRIM_INK, SIZE_HEADING } from '../theme.ts';

// Buttons ask the player to choose via a bubbling explainer:command.
export const choice: Component = {
  meta: { renders: 'com.semanticops.explainer/choice@1', name: 'Choice', variants: ['default', 'scrim'], surfaces: ['web', 'video'] }, // still: the held state, p=1
  mount(host) {
    const root = host.ownerDocument.createElement('div');
    root.innerHTML = '<h2></h2><div class="opts"></div>';
    root.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest?.('button')?.getAttribute('data-option');
      if (id) root.dispatchEvent(new CustomEvent('explainer:command', { bubbles: true, detail: { action: 'choose', option: id } }));
    });
    host.appendChild(root);
    return root;
  },
  render(node, p, data, vars, items) {
    // scrim: dark backdrop with light text, for a choice held over video footage
    const scrim = data.variant === 'scrim';
    node.setAttribute('style', `${FONT};position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:1rem;pointer-events:auto;opacity:${p > 0 ? 1 : 0}${scrim ? `;background:${SCRIM};color:${SCRIM_INK}` : ''}`);
    const [h, box] = Array.from(node.children) as HTMLElement[];
    h.textContent = interpolate(data.prompt ?? '', vars);
    h.setAttribute('style', `margin:0;font-size:${SIZE_HEADING};${scrim ? `color:${SCRIM_INK}` : ''}`);
    box.setAttribute('style', `display:flex;gap:1rem;flex-wrap:wrap;justify-content:center${scrim ? ';padding:0 1rem' : ''}`);
    while (box.children.length < items.length) box.appendChild(node.ownerDocument.createElement('button'));
    while (box.children.length > items.length) box.lastChild!.remove();
    Array.from(box.children).forEach((b, i) => {
      b.setAttribute('data-option', items[i].id);
      b.textContent = `${i + 1}. ${interpolate(items[i].label ?? '', vars)}`;
      b.setAttribute('style', `font:inherit;padding:.5rem 1rem;cursor:pointer;border:2px solid ${ACCENT};` + (scrim ? `background:${BUTTON};color:${BUTTON_INK}` : `background:${PAPER};color:${INK}`));
    });
  },
};
