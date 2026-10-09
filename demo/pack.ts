// Demo pack: one neutral, tiny component for the <explainer-motion> section of the gallery. Not part of core.
import { ACCENT } from '../src/theme.ts';
import { ramp, registerComponents, type Component } from '../src/index.ts';
import { interpolate } from '../src/store.ts';

/** Text with an underline that draws in from the left over the whole cue. Fills its host box; the page sizes the host. */
export const underline: Component = {
  meta: { renders: 'com.semanticops.explainer.demo/underline@1', name: 'Underline', variants: ['default', 'thick'], surfaces: ['web'] },
  mount(host) {
    const root = host.ownerDocument.createElement('span');
    root.innerHTML = '<span class="t"></span><span class="bar"></span>';
    host.appendChild(root);
    return root;
  },
  render(node, p, data, vars) {
    node.setAttribute('style', 'position:absolute;inset:0;white-space:nowrap');
    const [t, bar] = Array.from(node.children) as HTMLElement[];
    t.textContent = interpolate(data.text ?? '', vars);
    const h = data.variant === 'thick' ? '.28em' : '.1em';
    bar.setAttribute('style', `position:absolute;left:0;bottom:-.05em;height:${h};width:${(ramp(p, 0, 1) * 100).toFixed(2)}%;background:${ACCENT}`);
  },
};

registerComponents([underline]);
