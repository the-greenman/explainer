import { corePack, registerComponents } from './components/index.ts';
import { ExplainerMotion } from './motion-element.ts';
import { ExplainerPath } from './path-view.ts';
import { ExplainerPlayer } from './player.ts';
import { bindInputs } from './store.ts';
import { initTriggers } from './triggers.ts';

export * from './clock.ts';
export * from './components/index.ts';
export * from './store.ts';
export * as theme from './theme.ts';
export * as motion from './motion.ts';
export * from './path.ts';
export * from './render-plan.ts';
export { ExplainerPlayer, ExplainerPath, ExplainerMotion };

registerComponents(corePack);
customElements.define('explainer-player', ExplainerPlayer);
customElements.define('explainer-path', ExplainerPath);
customElements.define('explainer-motion', ExplainerMotion);

const boot = () => { bindInputs(); initTriggers(); };
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
else boot();
export * from './design-canvas.ts';
