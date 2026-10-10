// The effect contract as a check any pack can run: `effectProblems(myEffect)` is [] when the effect keeps the contract.
// Pure: calls `at` and compares, no test framework. test/flight-effects.test.ts runs it over every registered effect;
// a site pack runs it over its own (`for (const fx of myEffects) assert.deepEqual(effectProblems(fx), [])`).
import type { FlightEffect, Rect } from './types.ts';

const FROM: Rect = { x: 10, y: 20, w: 64, h: 64 };
const TO: Rect = { x: 400, y: 600, w: 48, h: 48 };
const GRID = Array.from({ length: 100 }, (_, i) => i / 100); // [0, 1)
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const rectNear = (a: Rect, b: Rect, tol: number) => near(a.x, b.x, tol) && near(a.y, b.y, tol) && near(a.w, b.w, tol) && near(a.h, b.h, tol);
const same = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** Every way `fx` breaks the contract in `types.ts` (FlightEffect), as readable sentences. Empty when it keeps it. */
export function effectProblems(fx: FlightEffect, from: Rect = FROM, to: Rect = TO): string[] {
  const out: string[] = [];
  const at = (a: Rect, b: Rect, p: number) => { try { return fx.at(a, b, p); } catch (e) { out.push(`throws at p=${p}: ${(e as Error).message}`); return null; } };

  const p0 = at(from, to, 0);
  if (p0 && fx.kind === 'move' && !(same(p0.rect, from) && near(p0.rot, 0, 1e-9) && p0.scale === 1 && p0.opacity === 1)) out.push('a move effect must start at `from` (rot 0, scale 1, opacity 1)');
  if (p0 && fx.kind === 'enter' && !(p0.scale === 0 || p0.opacity === 0)) out.push('an enter effect must start from nothing (scale or opacity 0)');

  const direct = GRID.map((p) => JSON.stringify(at(from, to, p)));
  for (const [i, p] of GRID.entries()) {
    const o = at(from, to, p);
    if (o && ![o.rect.x, o.rect.y, o.rect.w, o.rect.h, o.rot, o.scale, o.opacity].every(Number.isFinite)) { out.push(`non-finite pose at p=${p}`); break; }
    if (o && (o.rect === from || o.rect === to)) { out.push(`returns an input rect at p=${p}`); break; }
    if (JSON.stringify(o) !== direct[i]) { out.push(`not deterministic at p=${p}`); break; }
  }
  // no state between calls: other arguments in between, then a shuffled order, give the same poses
  at(to, from, 0.5);
  for (const i of GRID.map((_, i) => (i * 37) % GRID.length)) if (JSON.stringify(at(from, to, GRID[i])) !== direct[i]) { out.push(`depends on earlier calls (p=${GRID[i]})`); break; }

  const a = Object.freeze({ ...from }), b = Object.freeze({ ...to });
  try { for (const p of GRID) fx.at(a, b, p); } catch { out.push('mutates its input rects'); }

  if (!fx.instant) {
    const o = at(from, to, 0.999);
    if (o && !(rectNear(o.rect, to, 0.5) && near(o.rot, 0, 0.2) && near(o.scale, 1, 0.02) && near(o.opacity, 1, 0.02))) out.push('does not approach the anchor as p -> 1 (rect, rot 0, scale 1, opacity 1)');
  }
  return out;
}
