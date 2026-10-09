import { corePack, registerComponents } from './components/index.ts';
import { ExplainerPath } from './path-view.ts';
import { ExplainerPlayer } from './player.ts';
import { bindInputs } from './store.ts';
import { initTriggers } from './triggers.ts';

export * from './clock.ts';
export * from './components/index.ts';
export * from './store.ts';
export * from './path.ts';
export * from './render-plan.ts';
export { ExplainerPlayer, ExplainerPath };

registerComponents(corePack);
customElements.define('explainer-player', ExplainerPlayer);
customElements.define('explainer-path', ExplainerPath);

const boot = () => { bindInputs(); initTriggers(); };
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
else boot();
