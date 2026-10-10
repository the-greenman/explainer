import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainBoxAt, rectsClose } from '../src/experimental/flight/chain.ts';
import { getFlightEffect, registerFlightEffects } from '../src/experimental/flight/effect.ts';
import { registerBuiltInEffects } from '../src/experimental/flight/effects/index.ts';
import { IDLE, type ChainStop } from '../src/experimental/flight/types.ts';
import { settleProgress } from '../src/experimental/flight/drivers.ts';

registerBuiltInEffects();

// anchors: 0 header, 1 part 1, 2 part 2, 3 part 2 (second), 4 part 3, 5 end
const C = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 10 + i * 100, y: 10 + i * 300, w: 50, h: 50 }));
const chain: ChainStop[] = [
  { anchor: 0, fx: 'cut' }, { anchor: 1, fx: 'fall' }, { anchor: 2, fx: 'glide' }, { anchor: 3, fx: 'glide' }, { anchor: 4, fx: 'fall' }, { anchor: 5, fx: 'glide' },
];
const key = (q: number[], c = chain) => JSON.stringify(chainBoxAt(c, q, C));

test('before any stop started the object rests at the first anchor (absent for a first enter effect)', () => {
  const b = chainBoxAt(chain, chain.map(() => IDLE), C);
  assert.equal(b.restAnchor, 0);
  assert.deepEqual(b.rect, C[0]);
  const popFirst = chainBoxAt([{ anchor: 1, fx: 'pop' }, { anchor: 2, fx: 'glide' }], [IDLE, IDLE], C);
  assert.equal(popFirst.visible, false);
  assert.equal(popFirst.restAnchor, null);
});

test('an empty chain draws nothing', () => {
  assert.equal(chainBoxAt([], [], C).visible, false);
});

test('the last started stop decides; rest at its anchor when finished', () => {
  assert.equal(chainBoxAt(chain, [1, 1, 1, IDLE, IDLE, IDLE], C).restAnchor, 2);
  assert.equal(chainBoxAt(chain, [1, 1, 1, 1, 1, 1], C).restAnchor, 5);
  // a later stop starting wins even when an earlier one is still moving (the earlier one is just its starting point)
  const b = chainBoxAt(chain, [1, 0.5, 0, IDLE, IDLE, IDLE], C);
  assert.equal(b.restAnchor, null);
  assert.ok(rectsClose(b.rect, chainBoxAt(chain, [1, 0.5, IDLE, IDLE, IDLE, IDLE], C).rect, 1e-9), 'continuous where stop 2 takes over from the moving stop 1');
});

test('continuous where a stop starts and where it finishes', () => {
  for (let k = 1; k < chain.length; k++) {
    const done = chain.map((_, i) => (i < k ? 1 : IDLE));
    const justBefore = chainBoxAt(chain, done, C).rect;
    const startedZero = chainBoxAt(chain, done.map((x, i) => (i === k ? 0 : x)), C).rect;
    assert.ok(rectsClose(justBefore, startedZero, 1e-9), `stop ${k} starts where the object was`);
    const justUnder = chainBoxAt(chain, done.map((x, i) => (i === k ? 0.999999 : x)), C).rect;
    assert.ok(rectsClose(justUnder, C[chain[k].anchor], 0.5), `stop ${k} ends at its anchor`);
  }
});

test('fast scroll: a stop started while the one before never did goes from that one\'s anchor, never stranded', () => {
  const b = chainBoxAt(chain, [1, 1, 1, IDLE, 0.5, IDLE], C); // stop 3 never started, 4 half way
  assert.equal(b.visible, true);
  assert.ok(b.rect.y > C[3].y && b.rect.y < C[4].y + 10, 'between the anchors of stop 3 and stop 4');
  assert.deepEqual(chainBoxAt(chain, [1, 1, 1, IDLE, 1, IDLE], C).rect, C[4]);
  for (let m = 0; m < 64; m++) { // every started / not started pattern keeps the object visible
    const x = chainBoxAt(chain, chain.map((_, i) => ((m >> i) & 1 ? 0.5 : IDLE)), C);
    assert.ok(x.visible && x.rect.w > 0, `pattern ${m}`);
  }
});

test('reverse: progress going down undoes the moves exactly (a pure function of the values)', () => {
  const path: number[][] = [];
  for (let i = 0; i <= 20; i++) path.push([1, Math.min(1, i / 10), i > 10 ? (i - 10) / 10 : IDLE, IDLE, IDLE, IDLE]);
  const fwd = path.map((q) => key(q));
  const back = [...path].reverse().map((q) => key(q)).reverse();
  assert.deepEqual(back, fwd);
});

test('order independence: any order of evaluating gives the same box; finished later stops hide earlier progress', () => {
  const states = Array.from({ length: 200 }, (_, n) => chain.map((_, i) => ((n * (i + 3)) % 7 < 3 ? IDLE : ((n * (i + 5)) % 11) / 10)));
  const direct = states.map((q) => key(q));
  for (const i of states.map((_, n) => (n * 53) % states.length)) assert.equal(key(states[i]), direct[i]);
  assert.deepEqual(chainBoxAt(chain, [1, 0.3, 1, 1, IDLE, IDLE], C), chainBoxAt(chain, [1, 0.9, 1, 1, IDLE, IDLE], C));
});

test('reduced motion: settled progress only ever rests', () => {
  for (let m = 0; m < 64; m++) {
    const q = chain.map((_, i) => ((m >> i) & 1 ? 0.5 : IDLE));
    assert.notEqual(chainBoxAt(chain, settleProgress(q), C).restAnchor, null);
  }
});

test('cut: finished the moment it starts, whatever q', () => {
  const st: ChainStop[] = [{ anchor: 0, fx: 'cut' }, { anchor: 1, fx: 'cut' }, { anchor: 2, fx: 'glide' }];
  assert.equal(chainBoxAt(st, [1, 0, IDLE], C).restAnchor, 1);
  assert.deepEqual(chainBoxAt(st, [1, 0, IDLE], C).rect, C[1]);
});

test('equal start positions chain in declared order: the second glide starts from the first one\'s anchor', () => {
  // two stops both start at "the same moment" (q 0 for both): the second is the last started and takes over from where the first stood
  const st: ChainStop[] = [{ anchor: 0, fx: 'cut' }, { anchor: 1, fx: 'glide' }, { anchor: 2, fx: 'glide' }];
  const atStart = chainBoxAt(st, [1, 0, 0], C);
  assert.ok(rectsClose(atStart.rect, chainBoxAt(st, [1, 0, IDLE], C).rect, 1e-9), 'same pose as stop 1 at its start');
  assert.deepEqual(atStart.rect, C[0], 'stop 1 had not moved yet, so stop 2 starts at anchor 0');
  const mid = chainBoxAt(st, [1, 1, 0.5], C).rect; // stop 1 finished (at anchor 1), stop 2 half way
  assert.ok(mid.x > C[1].x && mid.x < C[2].x && mid.y > C[1].y && mid.y < C[2].y);
  assert.deepEqual(chainBoxAt(st, [1, 1, 1], C).rect, C[2]);
  // order of declaration decides, not any sort by start: reversing the declaration reverses the winner
  const rev: ChainStop[] = [{ anchor: 0, fx: 'cut' }, { anchor: 2, fx: 'glide' }, { anchor: 1, fx: 'glide' }];
  assert.equal(chainBoxAt(rev, [1, 0, 0], C).restAnchor, null);
  assert.deepEqual(chainBoxAt(rev, [1, 1, 1], C).rect, C[1]);
});

test('a registered custom effect works by name in the chain', () => {
  registerFlightEffects([{ name: 'drift-chain', kind: 'move', at: (a, b, p) => ({ rect: { x: a.x + (b.x - a.x) * p, y: a.y, w: a.w, h: a.h }, rot: 0, scale: 1, opacity: 1 }) }]);
  const st: ChainStop[] = [{ anchor: 0, fx: 'cut' }, { anchor: 3, fx: 'drift-chain' }];
  const b = chainBoxAt(st, [1, 0.5], C);
  assert.equal(b.rect.y, C[0].y, 'the custom effect decided: x moves, y does not');
  assert.equal(b.rect.x, C[0].x + (C[3].x - C[0].x) * 0.5);
  assert.equal(chainBoxAt(st, [1, 1], C).restAnchor, 3);
});

test('an unknown fx in a stop behaves as cut', () => {
  const w = console.warn; console.warn = () => {};
  try {
    const st: ChainStop[] = [{ anchor: 0, fx: 'cut' }, { anchor: 2, fx: 'nope-chain' }];
    assert.equal(getFlightEffect('nope-chain').name, 'cut');
    assert.equal(chainBoxAt(st, [1, 0], C).restAnchor, 2);
  } finally { console.warn = w; }
});

test('pop in the middle of a chain appears at its anchor, not where the object was', () => {
  const st: ChainStop[] = [{ anchor: 0, fx: 'cut' }, { anchor: 2, fx: 'pop' }];
  const b = chainBoxAt(st, [1, 0.5], C);
  assert.deepEqual(b.rect, C[2]);
  assert.ok(b.scale > 0);
});

test('a stop interrupting a moving one keeps scale, opacity and rotation continuous, and still lands exactly', () => {
  const st: ChainStop[] = [{ anchor: 0, fx: 'cut' }, { anchor: 1, fx: 'pop' }, { anchor: 2, fx: 'glide' }];
  const interrupted = chainBoxAt(st, [1, 0.2, IDLE], C); // pop at p = 0.2: scale and opacity are well below 1
  assert.ok(interrupted.scale < 1 && interrupted.opacity < 1);
  const start = chainBoxAt(st, [1, 0.2, 0], C); // the glide starts at that moment
  assert.ok(Math.abs(start.scale - interrupted.scale) < 1e-9, 'scale');
  assert.ok(Math.abs(start.opacity - interrupted.opacity) < 1e-9, 'opacity');
  assert.ok(Math.abs(start.rot - interrupted.rot) < 1e-9, 'rot');
  assert.ok(rectsClose(start.rect, interrupted.rect, 1e-9), 'rect');
  const near = chainBoxAt(st, [1, 0.2, 0.001], C);
  assert.ok(Math.abs(near.scale - interrupted.scale) < 0.01 && Math.abs(near.opacity - interrupted.opacity) < 0.01, 'no jump just after the boundary');
  const end = chainBoxAt(st, [1, 0.2, 0.999999], C);
  assert.ok(rectsClose(end.rect, C[2], 0.5), 'lands at its anchor');
  assert.ok(Math.abs(end.scale - 1) < 1e-3 && Math.abs(end.opacity - 1) < 1e-3, 'and with the effect\'s own scale and opacity');
  assert.equal(chainBoxAt(st, [1, 0.2, 1], C).restAnchor, 2);
});
