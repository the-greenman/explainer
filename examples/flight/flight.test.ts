import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fallAt, flightBoxAt, flightStateAt, rectsClose, settledTime, type Stop } from './flight.ts';

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
