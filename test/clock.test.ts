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

test('back() pops the last path entry (here a default continuation) and goes there', () => {
  const c = new Clock(m());
  c.manifest.cues = [];
  c.play();
  c.tick(11); // a -> b by continuation
  assert.equal(c.segmentId, 'b');
  c.back();
  assert.deepEqual([c.segmentId, c.t], ['a', 10]);
  c.back(); // empty history: no-op
  assert.equal(c.segmentId, 'a');
});

test('navigation (jumpTo, markers) never pushes history', () => {
  const c = new Clock(m());
  c.seek(3);
  c.jumpTo('c');
  c.jumpTo('mk');
  c.jumpTo('a');
  assert.equal(c.history.length, 0);
  c.back(); // nothing to pop
  assert.equal(c.segmentId, 'a');
});

test('scroll-style repeated jumps leave history unchanged', () => {
  const c = new Clock(m());
  c.play();
  c.tick(11); // held at 10: no entry
  c.manifest.cues = [];
  c.play();
  c.tick(0.1); // a -> b by continuation: one entry
  const before = JSON.stringify(c.history);
  for (const id of ['mk', 'b', 'a', 'mk', 'b', 'a', 'd']) c.jumpTo(id);
  assert.equal(JSON.stringify(c.history), before);
  assert.equal(c.history.length, 1);
});

test('marker jump inside a segment, then reverse past its start, lands on the predecessor end (not the pre-jump position)', () => {
  const c = new Clock(m());
  c.manifest.cues = [];
  c.play();
  c.tick(10.5); // a -> b by continuation, entry {a,10,to b}
  c.tick(2); // b at 2.5
  c.jumpTo('b'); // jump within b
  c.seek(3);
  c.setRate(-1);
  c.tick(4); // past b's start
  assert.deepEqual([c.segmentId, c.t], ['a', 10]);
  assert.equal(c.history.length, 0, 'the entry was popped');
});

test('jump into a segment without history, reverse past its start: predecessor end via order, nothing popped', () => {
  const c = new Clock(m());
  c.manifest.cues = [];
  c.jumpTo('b');
  c.play();
  c.setRate(-1);
  c.tick(1);
  assert.deepEqual([c.segmentId, c.t, c.playing], ['a', 10, true]);
  c.tick(2);
  assert.equal(c.t, 8);
  assert.equal(c.history.length, 0);
});

test('predecessor honours next; a segment nothing continues into clamps at 0 and stops', () => {
  const mm = m();
  mm.cues = [];
  mm.segments[0].next = 'd'; // a -> d, so b has no predecessor except... none (a skips it)
  const c = new Clock(mm);
  c.jumpTo('b');
  c.setRate(-1);
  c.play();
  c.tick(1);
  assert.deepEqual([c.segmentId, c.t, c.playing], ['b', 0, false]);
  c.jumpTo('d');
  c.play();
  c.tick(6);
  assert.deepEqual([c.segmentId, c.playing], ['a', true]);
});

test('choose records the hold; back() restores the held choice (paused, holding set)', () => {
  const c = new Clock(m());
  c.play();
  c.tick(11); // held at 10
  c.choose('o1');
  assert.deepEqual(c.history, [{ segmentId: 'a', t: 10, to: 'b', toT: 0, hold: 'ch' }]);
  c.tick(1);
  c.back();
  assert.deepEqual([c.segmentId, c.t, c.playing, c.holding?.id], ['a', 10, false, 'ch']);
  c.choose('o1'); // the options work again
  assert.equal(c.segmentId, 'b');
  assert.equal(c.history.length, 1);
});

test('choose, then reverse past the branch target start: pops to the choice point without re-holding', () => {
  const c = new Clock(m());
  c.play();
  c.tick(11);
  c.choose('o1');
  c.tick(0.5);
  c.setRate(-1);
  c.tick(1); // crosses b's start
  assert.deepEqual([c.segmentId, c.t, c.playing, c.holding], ['a', 10, true, null]);
  assert.equal(c.history.length, 0);
  c.tick(2); // continues in reverse through the choice cue
  assert.equal(c.t, 8);
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

const branchy = () => {
  const mm = m();
  mm.segments[1].out = 60; // b is long enough for a mid-segment landing
  mm.markers!.push({ id: 'b3', segment: 'b', t: 3 }, { id: 'a2', segment: 'a', t: 2 });
  mm.cues[0].items = [{ id: 'o1', goes_to: 'b3' }, { id: 'o3', goes_to: 'a2' }];
  return new Clock(mm);
};

test('branch landing mid-segment in another segment: reverse pops when crossing the landing point', () => {
  const c = branchy();
  c.play();
  c.tick(11);
  c.choose('o1'); // lands b@3
  c.tick(1); // b 4
  c.setRate(-1);
  const seen: number[] = [];
  for (let i = 0; i < 4 && c.segmentId === 'b'; i++) { c.tick(0.5); if (c.segmentId === 'b') seen.push(c.t); }
  assert.ok(seen.every((x) => x >= 3), `visited b before landing: ${seen}`);
  assert.deepEqual([c.segmentId, c.t, c.holding], ['a', 10, null]);
  assert.equal(c.history.length, 0);
});

test('same-segment branch to an earlier marker: reverse pops at the landing point, then continues normally', () => {
  const c = branchy();
  c.play();
  c.tick(11);
  c.choose('o3'); // a@10 -> a@2
  c.tick(1); // a 3
  c.setRate(-1);
  c.tick(0.5); // 2.5
  assert.equal(c.history.length, 1);
  c.tick(1); // crosses 2
  assert.deepEqual([c.segmentId, c.t], ['a', 10]);
  assert.equal(c.history.length, 0);
  c.tick(2);
  assert.equal(c.t, 8);
});

test('navigating to before the landing point, then reversing to 0: the segment-start fallback pops', () => {
  const c = branchy();
  c.play();
  c.tick(11);
  c.choose('o1'); // b@3
  c.jumpTo('b'); // b@0, before toT
  c.setRate(-1);
  c.play();
  c.tick(1);
  assert.deepEqual([c.segmentId, c.t], ['a', 10]);
  assert.equal(c.history.length, 0);
});
