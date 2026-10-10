import type { FlightEffect } from '../types.ts';

/** A jump: finished the moment it starts. `at` is only called by tests (it holds the previous pose). */
export const cut: FlightEffect = {
  name: 'cut', kind: 'move', instant: true,
  at: (from) => ({ rect: { ...from }, rot: 0, scale: 1, opacity: 1 }),
};
