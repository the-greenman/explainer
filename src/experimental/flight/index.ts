// EXPERIMENTAL: `explainer/experimental/flight`. Not part of the stable API; see ../README.md and ./README.md.
// Importing this module defines <explainer-flight>, registers the built-in effects (cut, glide, fall, pop, hop) and the in-scene marker (a scene extension).
import { registerSceneExtension, sceneExtensions } from '../../components/scene.ts';
import { ExplainerFlight } from './element.ts';
import { registerBuiltInEffects } from './effects/index.ts';
import { markerExtension } from './marker.ts';

export const status = 'experimental';
export * from './types.ts';
export { registerFlightEffects, flightEffects, getFlightEffect, listFlightEffects } from './effect.ts';
export { builtInEffects } from './effects/index.ts';
export { effectProblems } from './contract.ts';
export { chainBoxAt, rectsClose } from './chain.ts';
export { playerProgress, gatePlayerProgress, scrollProgress, scrollStop, settleProgress, latchProgress, latchSet, type PlayerView, type Latch } from './drivers.ts';
export { homeVisibility, toDocRect, fromDocRect } from './homes.ts';
export { arrivalOf, type Arrival } from './arrival.ts';
export { phraseTimes, type PhraseOptions } from './phrases.ts';
export { markerExtension, markerPoint, type MarkerPoint } from './marker.ts';
export { ExplainerFlight };

registerBuiltInEffects();
if (!sceneExtensions().some((e) => e.name === markerExtension.name)) registerSceneExtension(markerExtension);
if (!customElements.get('explainer-flight')) customElements.define('explainer-flight', ExplainerFlight);

// Buttons: <button data-flight-action="go|back|toggle" data-flight-name="takeoff" [data-flight-target="#flight"]>. One delegated listener, installed once.
const FLIGHT_ACTION = '[data-flight-action][data-flight-name]';
if (typeof document !== 'undefined' && !(globalThis as any).__explainerFlightActions) {
  (globalThis as any).__explainerFlightActions = true;
  document.addEventListener('click', (e) => {
    const b = (e.target as Element | null)?.closest?.(FLIGHT_ACTION);
    const act = b?.getAttribute('data-flight-action');
    if (!b || (act !== 'go' && act !== 'back' && act !== 'toggle')) return;
    const sel = b.getAttribute('data-flight-target');
    for (const f of Array.from(document.querySelectorAll(sel || 'explainer-flight'))) (f as ExplainerFlight)[act]?.(b.getAttribute('data-flight-name')!);
  });
}
