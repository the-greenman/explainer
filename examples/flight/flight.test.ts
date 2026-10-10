import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDLE, chainBoxAt, fallAt, flightBoxAt, flightStateAt, homeVisibility, playerProgress, rectsClose, scrollProgress, scrollStop, settleProgress, settledTime, type ChainStop, type Stop } from './flight.ts';

const R = [
  { x: 10, y: 10, w: 64, h: 64 }, // page header
  { x: 400, y: 300, w: 48, h: 48 }, // inside the player
  { x: 100, y: 900, w: 64, h: 64 }, // page footer
];
const S = 's';
const stops: Stop[] = [
  { segment: S, at: 0, len: 0, anchor: 0, fx: 'cut' },
  { segment: S, at: 1, len: 1, anchor: 1, fx: 'fall' },
  { segment: S, at: 5, len: 2, anchor: 2, fx: 'fall' },
];
const popFirst: Stop[] = [{ segment: S, at: 2, len: 0.5, anchor: 1, fx: 'pop' }, { segment: S, at: 4, len: 1, anchor: 2, fx: 'glide' }];
const times = Array.from({ length: 121 }, (_, i) => i / 12);

test('rest before the first stop, at the first stop\'s anchor; absent before a first pop', () => {
  assert.deepEqual(flightStateAt(stops, S, 0), { kind: 'rest', anchor: 0 });
  assert.deepEqual(flightStateAt(popFirst, S, 1), { kind: 'absent' });
  const b = flightBoxAt(popFirst, R, S, 1);
  assert.equal(b.visible, false);
  assert.equal(b.restAnchor, null);
  assert.equal(flightBoxAt(stops, R, S, 0.5).restAnchor, 0);
});

test('other segments are ignored', () => {
  assert.equal(flightBoxAt(stops, R, 'other', 3).visible, false);
  assert.deepEqual(flightStateAt(stops, 'other', 3), { kind: 'absent' });
});

test('lands exactly at at+len with rot 0, and rests there', () => {
  for (const [at, len, a] of [[1, 1, 1], [5, 2, 2]]) {
    const b = flightBoxAt(stops, R, S, at + len);
    assert.deepEqual(b.rect, R[a]);
    assert.equal(b.rot, 0);
    assert.equal(b.restAnchor, a);
  }
  assert.deepEqual(flightBoxAt(popFirst, R, S, 2.5).rect, R[1]);
  assert.equal(flightBoxAt(popFirst, R, S, 2.5).scale, 1);
});

test('continuous at stop boundaries', () => {
  for (const stop of stops.slice(1)) {
    const a = flightBoxAt(stops, R, S, stop.at - 1e-5).rect, b = flightBoxAt(stops, R, S, stop.at + 1e-5).rect;
    assert.ok(rectsClose(a, b, 0.5), `at ${stop.at}`);
  }
});

test('fall: y accelerates, bounce dips below the landing line, ends exact', () => {
  const a = R[1], b = R[2];
  const y = (p: number) => fallAt(a, b, p).rect.y;
  assert.ok(y(0.2) - a.y < (y(0.4) - y(0.2)), 'speeds up');
  assert.ok(Math.max(...[0.84, 0.88, 0.92].map(y)) > b.y, 'overshoots below the target');
  assert.deepEqual(fallAt(a, b, 1), { rect: b, rot: 0 });
  assert.ok(Math.abs(fallAt(a, b, 0.9999).rect.y - b.y) < 0.1);
  assert.deepEqual(fallAt(a, b, 0).rect, a);
});

test('pop: scale overshoots 1 and opacity reaches 1', () => {
  const ps = [0.2, 0.4, 0.6, 0.8].map((p) => flightBoxAt(popFirst, R, S, 2 + p * 0.5).scale);
  assert.ok(Math.max(...ps) > 1);
  assert.equal(flightBoxAt(popFirst, R, S, 2.45).opacity, 1);
  assert.equal(flightBoxAt(popFirst, R, S, 2.0).scale, 0);
});

test('an interrupting stop starts from where the object was (interrupted move is continuous)', () => {
  const st: Stop[] = [
    { segment: S, at: 0, len: 0, anchor: 0, fx: 'cut' },
    { segment: S, at: 1, len: 2, anchor: 1, fx: 'glide' },
    { segment: S, at: 2, len: 1, anchor: 2, fx: 'glide' }, // interrupts halfway
  ];
  const before = flightBoxAt(st, R, S, 2 - 1e-6).rect, after = flightBoxAt(st, R, S, 2 + 1e-6).rect;
  assert.ok(rectsClose(before, after, 0.01));
  assert.ok(before.x > R[0].x && before.x < R[1].x);
  assert.deepEqual(flightBoxAt(st, R, S, 3).rect, R[2]);
});

test('cut and len 0 jump', () => {
  const st: Stop[] = [{ segment: S, at: 0, len: 0, anchor: 0, fx: 'cut' }, { segment: S, at: 1, len: 3, anchor: 1, fx: 'cut' }, { segment: S, at: 6, len: 0, anchor: 2, fx: 'fall' }];
  assert.deepEqual(flightBoxAt(st, R, S, 1).rect, R[1]);
  assert.deepEqual(flightBoxAt(st, R, S, 6).rect, R[2]);
});

test('a pure function of T: any order of calls, and shuffled stops, give the same box', () => {
  const direct = times.map((t) => JSON.stringify(flightBoxAt(stops, R, S, t)));
  const order = times.map((_, i) => (i * 37) % times.length);
  for (const i of order) assert.equal(JSON.stringify(flightBoxAt(stops, R, S, times[i])), direct[i]);
  const shuffled = [stops[2], stops[0], stops[1]];
  times.forEach((t, i) => assert.equal(JSON.stringify(flightBoxAt(shuffled, R, S, t)), direct[i]));
  // state agrees with box
  for (const t of times) {
    const st = flightStateAt(stops, S, t), b = flightBoxAt(stops, R, S, t);
    assert.equal(st.kind === 'rest', b.restAnchor !== null, `t=${t}`);
  }
});

test('settledTime (reduced motion): only rest states', () => {
  for (const t of times) assert.notEqual(flightBoxAt(stops, R, S, settledTime(stops, S, t)).restAnchor, null);
  assert.equal(settledTime(popFirst, S, 1), 1);
});

// ---- chain: stops with different drivers, the last started stop places the object
// anchors: 0 header, 1 part 1, 2 part 2, 3 part 2 (second), 4 part 3, 5 end
const C = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 10 + i * 100, y: 10 + i * 300, w: 50, h: 50 }));
const chain: ChainStop[] = [
  { anchor: 0, fx: 'cut' }, { anchor: 1, fx: 'fall' }, { anchor: 2, fx: 'glide' }, { anchor: 3, fx: 'glide' }, { anchor: 4, fx: 'fall' }, { anchor: 5, fx: 'glide' },
];
const key = (q: number[]) => JSON.stringify(chainBoxAt(chain, q, C));

test('scrollProgress: 0 at the from bottom on the line, 1 at the to top on the line, linear between, a step for no gap', () => {
  assert.equal(scrollProgress(400, 1200, 400), 0);
  assert.equal(scrollProgress(0, 800, 400), 0.5);
  assert.equal(scrollProgress(-400, 400, 400), 1);
  assert.equal(scrollProgress(500, 1300, 400), 0);
  assert.equal(scrollProgress(-900, 0, 400), 1);
  assert.equal(scrollProgress(300, 300, 400), 1);
  assert.equal(scrollProgress(500, 500, 400), 0);
  assert.equal(scrollStop(0), IDLE);
  assert.equal(scrollStop(0.25), 0.25);
});

test('playerProgress: idle in another segment or before at; 0..1 over len; 1 for cut and len 0', () => {
  const s = { segment: 'a', at: 2, len: 2, fx: 'glide' as const };
  assert.equal(playerProgress(s, 'b', 3), IDLE);
  assert.equal(playerProgress(s, 'a', 1.9), IDLE);
  assert.equal(playerProgress(s, 'a', 2), 0);
  assert.equal(playerProgress(s, 'a', 3), 0.5);
  assert.equal(playerProgress(s, 'a', 9), 1);
  assert.equal(playerProgress({ ...s, fx: 'cut' }, 'a', 2), 1);
  assert.equal(playerProgress({ ...s, len: 0 }, 'a', 2), 1);
});

test('chain: before any stop started the object rests at the first anchor (absent for a first pop)', () => {
  const b = chainBoxAt(chain, chain.map(() => IDLE), C);
  assert.equal(b.restAnchor, 0);
  assert.deepEqual(b.rect, C[0]);
  assert.equal(chainBoxAt([{ anchor: 1, fx: 'pop' }, { anchor: 2, fx: 'glide' }], [IDLE, IDLE], C).visible, false);
});

test('chain: the last started stop decides; rest at its anchor when finished', () => {
  assert.equal(chainBoxAt(chain, [1, 1, 1, IDLE, IDLE, IDLE], C).restAnchor, 2);
  assert.equal(chainBoxAt(chain, [1, 1, 1, 1, 1, 1], C).restAnchor, 5);
  // a later stop starting wins even when an earlier one is still moving (the earlier one is just its starting point)
  const b = chainBoxAt(chain, [1, 0.5, 0, IDLE, IDLE, IDLE], C);
  assert.equal(b.restAnchor, null);
  assert.ok(rectsClose(b.rect, chainBoxAt(chain, [1, 0.5, IDLE, IDLE, IDLE, IDLE], C).rect, 1e-9), 'continuous where stop 2 takes over from the moving stop 1');
});

test('chain: continuous where a stop starts and where it finishes', () => {
  for (let k = 1; k < chain.length; k++) {
    const done = chain.map((_, i) => (i < k ? 1 : IDLE));
    const justBefore = chainBoxAt(chain, done, C).rect;
    const startedZero = chainBoxAt(chain, done.map((x, i) => (i === k ? 0 : x)), C).rect;
    assert.ok(rectsClose(justBefore, startedZero, 1e-9), `stop ${k} starts where the object was`);
    const justUnder = chainBoxAt(chain, done.map((x, i) => (i === k ? 0.999999 : x)), C).rect;
    assert.ok(rectsClose(justUnder, C[chain[k].anchor], 0.5), `stop ${k} ends at its anchor`);
  }
});

test('chain: fast scroll. Stop 4 started while 3 never did: the object goes from stop 3\'s anchor to stop 4\'s, never stranded', () => {
  const q = [1, 1, 1, IDLE, 0.5, IDLE]; // stops 2 done, 3 (player 2, time) never started, 4 half way
  const b = chainBoxAt(chain, q, C);
  assert.equal(b.visible, true);
  const from = C[3], to = C[4];
  assert.ok(b.rect.y > from.y && b.rect.y < to.y + 10, 'between the anchors of stop 3 and stop 4');
  assert.deepEqual(chainBoxAt(chain, [1, 1, 1, IDLE, 1, IDLE], C).rect, C[4]);
  // everything started or finished in any pattern gives a visible object
  for (let m = 0; m < 64; m++) {
    const qq = chain.map((_, i) => ((m >> i) & 1 ? 0.5 : IDLE));
    const x = chainBoxAt(chain, qq, C);
    assert.ok(x.visible && x.rect.w > 0, `pattern ${m}`);
  }
});

test('chain: reverse. Progress going down undoes the moves exactly (a pure function of the values)', () => {
  const path: number[][] = [];
  for (let i = 0; i <= 20; i++) path.push([1, Math.min(1, i / 10), i > 10 ? (i - 10) / 10 : IDLE, IDLE, IDLE, IDLE]);
  const fwd = path.map(key);
  const back = [...path].reverse().map(key).reverse();
  assert.deepEqual(back, fwd);
});

test('chain: order independence. Any order of evaluating, and the unrelated drivers\' values, give the same box', () => {
  const states = Array.from({ length: 200 }, (_, n) => chain.map((_, i) => ((n * (i + 3)) % 7 < 3 ? IDLE : ((n * (i + 5)) % 11) / 10)));
  const direct = states.map(key);
  for (const i of states.map((_, n) => (n * 53) % states.length)) assert.equal(key(states[i]), direct[i]);
  // once a later stop is finished, the progress of earlier ones no longer matters
  const a = chainBoxAt(chain, [1, 0.3, 1, 1, IDLE, IDLE], C), b = chainBoxAt(chain, [1, 0.9, 1, 1, IDLE, IDLE], C);
  assert.deepEqual(a, b);
});

test('chain: reduced motion settles started stops to rest', () => {
  assert.deepEqual(settleProgress([1, 0.3, 0, IDLE]), [1, 1, 1, IDLE]);
  for (let m = 0; m < 64; m++) {
    const qq = chain.map((_, i) => ((m >> i) & 1 ? 0.5 : IDLE));
    assert.notEqual(chainBoxAt(chain, settleProgress(qq), C).restAnchor, null);
  }
});

test('stays: away from a home it hides but its stays parts show; at the home both are its own', () => {
  assert.equal(homeVisibility('home', false), 'hidden');
  assert.equal(homeVisibility('stays', false), 'visible');
  assert.equal(homeVisibility('home', true), null);
  assert.equal(homeVisibility('stays', true), null);
});
