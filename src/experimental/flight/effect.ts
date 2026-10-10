// The effect registry, in the style of `registerComponents` (src/components/base.ts): a pack registers effects once, a stop names one in `fx`.
//
//   registerFlightEffects([{ name: 'drift', kind: 'move', at: (from, to, p) => ({ rect: lerpRect(from, to, p), rot: 0, scale: 1, opacity: 1 }) }]);
//
// then `{ "fx": "drift" }` in a stop. An unknown name is a `cut` (with one console warning per name), so a typo never loses the object.
import { cut } from './effects/cut.ts';
import type { FlightEffect } from './types.ts';

const reg = new Map<string, FlightEffect>();
const warned = new Set<string>();

export function registerFlightEffects(effects: FlightEffect[]) {
  for (const e of effects) {
    if (reg.has(e.name)) throw new Error(`duplicate flight effect ${e.name}`);
    reg.set(e.name, e);
  }
}
/** The effect registered under `name`, or undefined. */
export const flightEffects = (name: string): FlightEffect | undefined => reg.get(name);
/** The effect for a stop's `fx`; an unknown name warns once and is a `cut`. */
export function getFlightEffect(name: string): FlightEffect {
  const e = reg.get(name);
  if (e) return e;
  if (!warned.has(name)) { warned.add(name); console.warn(`<explainer-flight>: unknown fx "${name}", using cut`); }
  return reg.get('cut') ?? cut;
}
export const listFlightEffects = (): FlightEffect[] => [...reg.values()];
