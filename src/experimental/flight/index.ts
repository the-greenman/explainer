// EXPERIMENTAL: `explainer/experimental/flight`. Not part of the stable API; see ../README.md and ./README.md.
// Importing this module defines <explainer-flight> and registers the built-in effects (cut, glide, fall, pop).
import { ExplainerFlight } from './element.ts';
import { registerBuiltInEffects } from './effects/index.ts';

export const status = 'experimental';
export * from './types.ts';
export { registerFlightEffects, flightEffects, getFlightEffect, listFlightEffects } from './effect.ts';
export { builtInEffects } from './effects/index.ts';
export { effectProblems } from './contract.ts';
export { chainBoxAt, rectsClose } from './chain.ts';
export { playerProgress, gatePlayerProgress, scrollProgress, scrollStop, settleProgress, type PlayerView } from './drivers.ts';
export { homeVisibility, toDocRect, fromDocRect } from './homes.ts';
export { ExplainerFlight };

registerBuiltInEffects();
if (!customElements.get('explainer-flight')) customElements.define('explainer-flight', ExplainerFlight);
