// The arrival decision (src/experimental/flight/arrival.ts): which anchor the object rests at / is moving toward. Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivalOf } from '../src/experimental/flight/arrival.ts';
import { chainBoxAt } from '../src/experimental/flight/chain.ts';
import { registerBuiltInEffects } from '../src/experimental/flight/effects/index.ts';
import { IDLE, type ChainStop, type Rect } from '../src/experimental/flight/types.ts';

registerBuiltInEffects();
const rects: Rect[] = [0, 1, 2].map((i) => ({ x: i * 100, y: 0, w: 10, h: 10 }));
const stops: ChainStop[] = [{ anchor: 0, fx: 'cut' }, { anchor: 1, fx: 'glide' }, { anchor: 2, fx: 'glide' }];
const arr = (q: number[], st = stops) => arrivalOf(st, q, chainBoxAt(st, q, rects));

test('rest: here and target are the anchor, p is 1', () => {
  assert.deepEqual(arr([IDLE, IDLE, IDLE]), { here: 0, target: 0, p: 1 });
  assert.deepEqual(arr([1, 1, IDLE]), { here: 1, target: 1, p: 1 }, 'a finished glide');
  assert.deepEqual(arr([1, 1, 1]), { here: 2, target: 2, p: 1 });
});

test('moving: no here, the target is the stop being approached and p its progress', () => {
  assert.deepEqual(arr([1, 0.25, IDLE]), { here: null, target: 1, p: 0.25 });
  assert.deepEqual(arr([1, 1, 0.6]), { here: null, target: 2, p: 0.6 });
});

test('a skipped stop (never started) does not stop the object being placed by the later one', () => {
  assert.deepEqual(arr([IDLE, IDLE, 0.5]), { here: null, target: 2, p: 0.5 });
});

test('an enter first stop: nothing before it starts (the object is absent)', () => {
  const st: ChainStop[] = [{ anchor: 0, fx: 'pop' }, { anchor: 1, fx: 'glide' }];
  assert.deepEqual(arr([IDLE, IDLE], st), { here: null, target: null, p: 0 });
  assert.deepEqual(arr([0.5, IDLE], st), { here: null, target: 0, p: 0.5 });
  assert.deepEqual(arr([1, IDLE], st), { here: 0, target: 0, p: 1 });
});

test('a function of the progress alone: the same q, the same answer, in any order', () => {
  const qs = [[1, 0.25, IDLE], [IDLE, IDLE, IDLE], [1, 1, 0.6], [1, 1, 1]];
  const first = qs.map((q) => JSON.stringify(arr(q)));
  const again = [...qs].reverse().map((q) => JSON.stringify(arr(q))).reverse();
  assert.deepEqual(again, first);
});
