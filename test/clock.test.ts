import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Clock, cueProgress, type Manifest } from '../src/clock.ts';

const m = (): Manifest => ({
  id: 'm',
  segments: [
    { id: 'a', kind: 'none', out: 10 },
    { id: 'b', kind: 'none', out: 5 },
    { id: 'c', kind: 'none', out: 5, ends: 'stop' },
    { id: 'd', kind: 'none', out: 5 },
  ],
  markers: [{ id: 'mk', segment: 'c', t: 2 }],
  cues: [{
    id: 'ch', segment: 'a', start: 8, end: 10, renders: 'x', hold: true,
    items: [{ id: 'o1', goes_to: 'b' }, { id: 'o2', sets_variable: 'x', sets_value: '1' }],
  }],
});

test('default continuation goes to the next segment in order', () => {
  const c = new Clock(m());
  c.manifest.cues = [];
  c.play();
  c.tick(11);
  assert.equal(c.segmentId, 'b');
  assert.equal(c.t, 0);
  assert.equal(c.playing, true);
});

test('next overrides array order (segment and marker)', () => {
  const mm = m();
  mm.cues = [];
  mm.segments[0].next = 'mk';
  const c = new Clock(mm);
  c.play();
  c.tick(10);
  assert.deepEqual([c.segmentId, c.t], ['c', 2]);
});

test('hold at the choice cue end pauses; play resumes past it', () => {
  const c = new Clock(m());
  let held = '';
  c.hooks.hold = (cue) => (held = cue.id);
  c.play();
  c.tick(11);
  assert.deepEqual([c.t, c.playing, held], [10, false, 'ch']);
  c.play();
  c.tick(0.1); // resumes past the hold: segment ends, continues to b
  assert.equal(c.segmentId, 'b');
});

test('choose -> jump -> reverse past segment start lands in the history entry at its exit time', () => {
  const c = new Clock(m());
  c.play();
  c.tick(11); // held at 10
  c.choose('o1');
  assert.equal(c.segmentId, 'b');
  assert.equal(c.playing, true);
  c.tick(1);
  c.setRate(-1);
  c.tick(2); // crosses b's start
  assert.deepEqual([c.segmentId, c.t, c.playing], ['a', 10, true]);
});

test('choose with sets_variable and no goes_to sets and resumes', () => {
  const c = new Clock(m());
  const vars: Record<string, string> = {};
  c.hooks.set = (k, v) => (vars[k] = v);
  c.play();
  c.tick(11);
  c.choose('o2');
  assert.deepEqual(vars, { x: '1' });
  assert.equal(c.playing, true);
  assert.equal(c.segmentId, 'a');
});

test('back() returns to the previous history entry', () => {
  const c = new Clock(m());
  c.seek(3);
  c.jumpTo('c');
  assert.equal(c.segmentId, 'c');
  c.back();
  assert.deepEqual([c.segmentId, c.t], ['a', 3]);
  c.back(); // empty history: no-op
  assert.equal(c.segmentId, 'a');
});

test("ends:'stop' stops at the segment end", () => {
  const c = new Clock(m());
  c.jumpTo('c');
  c.play();
  c.tick(6);
  assert.deepEqual([c.segmentId, c.t, c.playing], ['c', 5, false]);
});

test('reversing at the very start with no history clamps at 0', () => {
  const c = new Clock(m());
  c.setRate(-1);
  c.play();
  c.tick(1);
  assert.equal(c.t, 0);
});

test('cueProgress is the same function of t at any rate', () => {
  const cue = { start: 0, end: 4 };
  for (const [rate, secs, p] of [[0.5, 2, 0.25], [2, 1, 0.5], [2, 5, 1]] as const) {
    const c = new Clock({ id: 'x', segments: [{ id: 's', kind: 'none', out: 100 }], cues: [] });
    c.setRate(rate);
    c.play();
    c.tick(secs);
    assert.equal(cueProgress(cue, c.t), p);
  }
});
