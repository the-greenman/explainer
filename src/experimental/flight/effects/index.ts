import { registerFlightEffects } from '../effect.ts';
import type { FlightEffect } from '../types.ts';
import { cut } from './cut.ts';
import { fall } from './fall.ts';
import { glide } from './glide.ts';
import { hop } from './hop.ts';
import { pop } from './pop.ts';

export const builtInEffects: FlightEffect[] = [cut, glide, fall, pop, hop];

let done = false;
/** Registers the built-ins once (safe to call again; the entry point calls it on import). */
export function registerBuiltInEffects() {
  if (done) return;
  done = true;
  registerFlightEffects(builtInEffects);
}
