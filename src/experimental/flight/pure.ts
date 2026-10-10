// EXPERIMENTAL: `explainer/experimental/flight/pure`. The parts of the flight module that need no DOM and define no element: safe to import
// in node (a build step, a test). Nothing here touches `document` or `customElements`, and importing it registers nothing: call
// `registerBuiltInEffects()` before using `chainBoxAt` with the built-in effect names.
export * from './types.ts';
export { registerFlightEffects, flightEffects, getFlightEffect, listFlightEffects } from './effect.ts';
export { builtInEffects, registerBuiltInEffects } from './effects/index.ts';
export { effectProblems } from './contract.ts';
export { chainBoxAt, rectsClose } from './chain.ts';
export { playerProgress, gatePlayerProgress, scrollProgress, scrollStop, settleProgress, type PlayerView } from './drivers.ts';
export { homeVisibility, toDocRect, fromDocRect } from './homes.ts';
export { arrivalOf, type Arrival } from './arrival.ts';
export { phraseTimes, type PhraseOptions } from './phrases.ts';
