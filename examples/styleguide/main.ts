// The engine's own styleguide page: a thin host for src/styleguide.ts. A site does the same with its own pack, fixtures and theme CSS.
// URL params: ?theme=default|paper, ?only=<slug or slug__variant>[,...] (substring match).
import '../../src/index.ts'; // the core: registers the core pack
import '../video/components.ts'; // a pack: importing it registers it
import { mountStyleguide } from '../../src/styleguide.ts';
import { fixtures } from './fixtures.ts';
import paperCss from './paper.css?raw';

const rules = `<div style="border:1px solid #d6d4cf;border-left:6px solid #222;background:#fff;padding:12px 20px 8px">
  <h3 style="margin:0 0 4px;font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#666">How to read this page</h3>
  <ul style="margin:0 0 8px;padding-left:20px">
    <li>Each card is one component variant, rendered by its own <code>mount</code> and <code>render</code> from fixture data. The badges name the surfaces it declares in <code>meta.surfaces</code>.</li>
    <li>The frames are true size, with no transform scaling: a 360 px web column, a 640 px 16:9 stage, and the same stage at 360 px as a phone embed. Sizes in cqw scale with the frame; fixed rem/px sizes do not.</li>
    <li>The stage frames sit on a grey placeholder picture, so text over video is judged against a picture.</li>
    <li>The <strong>still</strong> button jumps to <code>meta.still</code>: the complete frame that print and reduced motion show. Drag the slider to see any other p.</li>
    <li>Smallest type on stage: <strong data-sg-min-size>measuring</strong>.</li>
    <li>The theme switch changes the CSS custom properties around the cards only. Brand rules belong to the site that owns the theme.</li>
  </ul>
</div>`;

mountStyleguide(document.getElementById('root')!, {
  fixtures,
  themes: [
    { id: 'default', label: 'default (contract defaults)' },
    { id: 'paper', label: 'paper (sample theme)', css: paperCss },
  ],
  intro: rules,
});
