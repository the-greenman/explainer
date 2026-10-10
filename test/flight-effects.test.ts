// The effect contract (src/experimental/flight/contract.ts), run over EVERY registered effect (like test/purity.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listFlightEffects, registerFlightEffects, getFlightEffect, flightEffects } from '../src/experimental/flight/effect.ts';
import { registerBuiltInEffects } from '../src/experimental/flight/effects/index.ts';
import type { FlightEffect, Rect } from '../src/experimental/flight/types.ts';
import { effectProblems } from '../src/experimental/flight/contract.ts';

registerBuiltInEffects();

const from: Rect = { x: 10, y: 20, w: 64, h: 64 };
const to: Rect = { x: 400, y: 600, w: 48, h: 48 };

test('the built-ins are registered', () => {
  for (const n of ['cut', 'glide', 'fall', 'pop']) assert.ok(flightEffects(n), n);
});

for (const fx of listFlightEffects()) {
  test(`effect ${fx.name} keeps the contract`, () => assert.deepEqual(effectProblems(fx), []));
}

test('the contract check catches broken effects', () => {
  const pose = (rect: Rect) => ({ rect, rot: 0, scale: 1, opacity: 1 });
  let n = 0;
  const broken: [FlightEffect, RegExp][] = [
    [{ name: 'x', kind: 'move', at: (_a, b) => pose({ ...b }) }, /start at `from`/],
    [{ name: 'x', kind: 'enter', at: (_a, b) => pose({ ...b }) }, /from nothing/],
    [{ name: 'x', kind: 'move', at: (a, b, p) => pose({ ...a, x: a.x + (b.x - a.x) * p + (p > 0 ? n++ : 0) }) }, /deterministic|earlier calls/],
    [{ name: 'x', kind: 'move', at: (a) => pose(a) }, /input rect/],
    [{ name: 'x', kind: 'move', at: (a, _b, p) => { if (p > 0) (a as any).x = 1; return pose({ ...a }); } }, /mutates/],
    [{ name: 'x', kind: 'move', at: (a) => pose({ ...a }) }, /approach the anchor/],
    [{ name: 'x', kind: 'move', at: (a, _b, p) => pose({ ...a, w: p ? NaN : a.w }) }, /non-finite/],
  ];
  for (const [fx, re] of broken) assert.ok(effectProblems(fx).some((m) => re.test(m)), `${re}: ${effectProblems(fx).join('; ')}`);
});

test('fall: y accelerates, bounce dips below the landing line', () => {
  const fall = getFlightEffect('fall');
  const y = (p: number) => fall.at(from, to, p).rect.y;
  assert.ok(y(0.2) - from.y < y(0.4) - y(0.2), 'speeds up');
  assert.ok(Math.max(...[0.84, 0.88, 0.92].map(y)) > to.y, 'overshoots below the target');
});

test('pop: scale overshoots 1, opacity reaches 1', () => {
  const pop = getFlightEffect('pop');
  assert.ok(Math.max(...[0.2, 0.4, 0.6, 0.8].map((p) => pop.at(from, to, p).scale)) > 1);
  assert.equal(pop.at(from, to, 0.5).opacity, 1);
});

test('a site pack can add an effect and use it by name', () => {
  const drift: FlightEffect = { name: 'drift-test', kind: 'move', at: (a, b, p) => ({ rect: { x: a.x + (b.x - a.x) * p, y: a.y, w: a.w, h: a.h }, rot: 0, scale: 1, opacity: 1 }) };
  registerFlightEffects([drift]);
  assert.equal(getFlightEffect('drift-test'), drift);
  assert.throws(() => registerFlightEffects([drift]), /duplicate flight effect/);
});

test('an unknown name is a cut, warning once', () => {
  const warns: string[] = [];
  const w = console.warn;
  console.warn = (m: string) => warns.push(m);
  try {
    const a = getFlightEffect('no-such-fx'), b = getFlightEffect('no-such-fx');
    assert.equal(a.name, 'cut');
    assert.equal(b.name, 'cut');
  } finally { console.warn = w; }
  assert.equal(warns.length, 1);
});
