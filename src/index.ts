import { corePack, registerComponents } from './components/index.ts';
import { ExplainerPlayer } from './player.ts';
import { bindInputs } from './store.ts';
import { initTriggers } from './triggers.ts';

export * from './clock.ts';
export * from './components/index.ts';
export * from './store.ts';
export { ExplainerPlayer };

registerComponents(corePack);
customElements.define('explainer-player', ExplainerPlayer);

const boot = () => { bindInputs(); initTriggers(); };
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
else boot();
