import { ramp } from '../../src/clock.ts';
import { interpolate } from '../../src/store.ts';
import { registerComponents, FONT, type Component } from '../../src/components/index.ts'; // not src/index.ts: that defines the custom element (needs DOM)

const NS = 'com.semanticops.explainer.example';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const label = (it: any) => (typeof it === 'string' ? it : it.label ?? it.text ?? '');
const f = (x: number) => x.toFixed(3);

/**
 * A loop of N labelled nodes; arcs between them draw in order as p goes 0..1 and the last arc closes the loop.
 * The SVG is rebuilt from (p, items) on every call, so nothing carries over between frames.
 * Sits in a translucent card on the right (clear of a centred face).
 */
export const cycle: Component = {
  meta: { renders: `${NS}/cycle@1`, name: 'Cycle diagram', variants: ['default'], surfaces: ['video'],
    // fades out over the last 0.4 s; the loop closes by p 0.95 and the caption is in by dur-0.5, so the still is just before that fade (cues of 8 s or more)
    still: (_d, _i, dur) => Math.max(0, (dur - 0.4) / dur) },
  mount(host) {
    const root = host.ownerDocument.createElement('div');
    host.appendChild(root);
    return root;
  },
  render(node, p, data, vars, items, dur) {
    const n = items.length;
    const out = 1 - ramp(p * dur, dur - 0.4, dur);
    node.setAttribute('style', `${FONT};position:absolute;right:2.5%;top:50%;width:27%;transform:translateY(-50%);box-sizing:border-box;padding:3%;border-radius:12px;background:rgba(12,14,22,.68);color:#fff;opacity:${f(Math.min(out, ramp(p * dur, 0, 0.3)))}`);
    if (!n) { node.innerHTML = ''; return; }
    const cx = 100, cy = 100, R = 62;
    const at = (k: number) => { const a = (2 * Math.PI * k) / n - Math.PI / 2; return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; };
    const seg = 0.9 / n; // each node + its outgoing arc gets an equal share of 0.05..0.95
    let arcs = '', nodes = '';
    for (let k = 0; k < n; k++) {
      const s = 0.05 + seg * k;
      const [x1, y1] = at(k);
      const a1 = (2 * Math.PI * (k + 0.12)) / n - Math.PI / 2, a2 = (2 * Math.PI * (k + 0.88)) / n - Math.PI / 2;
      const d = `M${f(cx + R * Math.cos(a1))} ${f(cy + R * Math.sin(a1))} A${R} ${R} 0 0 1 ${f(cx + R * Math.cos(a2))} ${f(cy + R * Math.sin(a2))}`;
      const arc = ramp(p, s + seg * 0.4, s + seg);
      arcs += `<path d="${d}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="${f(1 - arc)}" fill="none" stroke="var(--explainer-accent,#7fd0ff)" stroke-width="3" stroke-linecap="round"${arc >= 1 ? ' marker-end="url(#ah)"' : ''}/>`;
      const o = ramp(p, s, s + seg * 0.4);
      const txt = interpolate(label(items[k]), vars);
      nodes += `<g opacity="${f(o)}"><circle cx="${f(x1)}" cy="${f(y1)}" r="22" fill="#1b2233" stroke="#fff" stroke-width="1.5"/><text x="${f(x1)}" y="${f(y1)}" text-anchor="middle" dominant-baseline="central" font-size="10" fill="#fff" font-family="inherit">${esc(txt)}</text></g>`;
    }
    const title = data.caption ? `<text x="100" y="100" text-anchor="middle" dominant-baseline="central" font-size="9" fill="#fff" opacity="${f(ramp(p * dur, dur - 1, dur - 0.5))}" font-family="inherit">${esc(interpolate(data.caption, vars))}</text>` : '';
    node.innerHTML = `<svg viewBox="0 0 200 200" style="display:block;width:100%;height:auto"><defs><marker id="ah" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L6 3L0 6z" fill="var(--explainer-accent,#7fd0ff)"/></marker></defs>${arcs}${nodes}${title}</svg>`;
  },
};

/** Words that pop in, each at its own `at` (seconds from cue start), stacked in a card on the right. */
export const emphasis: Component = {
  meta: { renders: `${NS}/emphasis@1`, name: 'Emphasis words', variants: ['default'], surfaces: ['video'],
    still: (_d, _i, dur) => Math.max(0, (dur - 0.5) / dur) }, // fades out over the last 0.5 s
  mount(host) {
    const root = host.ownerDocument.createElement('div');
    host.appendChild(root);
    return root;
  },
  render(node, p, data, vars, items, dur) {
    const t = p * dur;
    const out = 1 - ramp(t, dur - 0.5, dur);
    node.setAttribute('style', `${FONT};position:absolute;right:2.5%;top:50%;width:27%;transform:translateY(-50%);container-type:inline-size;box-sizing:border-box;padding:2.2%;border-radius:12px;background:rgba(12,14,22,.7);color:#fff;opacity:${f(out)}`);
    while (node.children.length < items.length) node.appendChild(node.ownerDocument.createElement('div'));
    while (node.children.length > items.length) node.lastChild!.remove();
    Array.from(node.children).forEach((el, i) => {
      const it = items[i];
      const o = ramp(t, it.at ?? 0, (it.at ?? 0) + 0.35);
      el.textContent = interpolate(label(it), vars);
      el.setAttribute('style', `font-size:15cqw;font-weight:700;line-height:1.25;color:var(--explainer-accent,#7fd0ff);opacity:${f(o)};transform:translateX(${f((1 - o) * 24)}px)`);
    });
  },
};

registerComponents([cycle, emphasis]);
