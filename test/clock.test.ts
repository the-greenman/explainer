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

test('navigation forward along the default order pushes the hops playing would have recorded', () => {
  const c = new Clock(m());
  c.seek(3);
  assert.equal(c.history.length, 0);
  c.jumpTo('mk'); // a -> b -> c@2 (b is 5 long, c has no landing marker: lands at c@0 and the marker is later in c)
  assert.deepEqual(c.history, [{ segmentId: 'a', t: 10, to: 'b', toT: 0 }, { segmentId: 'b', t: 5, to: 'c', toT: 0 }]);
  assert.deepEqual([c.segmentId, c.t], ['c', 2]);
  c.jumpTo('a'); // back onto the route: unwinds
  assert.equal(c.history.length, 0);
  c.back(); // nothing to pop
  assert.equal(c.segmentId, 'a');
});

test('scroll-style down then up leaves history as it was', () => {
  const c = new Clock(m());
  c.manifest.cues = [];
  c.play();
  c.tick(10.1); // a -> b by continuation: one entry
  const before = JSON.stringify(c.history);
  for (const id of ['mk', 'b', 'mk', 'b']) c.jumpTo(id); // down to c and up again, ending where it began
  assert.equal(JSON.stringify(c.history), before);
  assert.equal(c.history.length, 1);
  c.jumpTo('a');
  assert.equal(c.history.length, 0);
  for (const id of ['mk', 'b', 'a', 'mk', 'b', 'a']) c.jumpTo(id);
  assert.deepEqual(c.history, []);
  assert.deepEqual([c.segmentId, c.t], ['a', 0]);
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
  assert.deepEqual(c.history, [{ segmentId: 'a', t: 10, to: 'b', toT: 0, hold: 'ch', option: 'o1' }]);
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

test('rewindTo(depth) unwinds to a span start; atChoice lands held on the choice', () => {
  const mm = m();
  mm.segments[1].ends = undefined;
  const c = new Clock(mm);
  c.play();
  c.tick(11); // held at a:10
  c.choose('o1'); // -> b 0 (entry 0, hold)
  c.tick(5); // b ends, continues to c (entry 1)
  assert.equal(c.segmentId, 'c');
  assert.equal(c.history.length, 2);
  c.rewindTo(1); // span 1 = b, from 0
  assert.deepEqual([c.segmentId, c.t, c.history.length, c.holding], ['b', 0, 1, null]);
  c.rewindTo(0, true); // the choice
  assert.deepEqual([c.segmentId, c.t, c.playing, c.holding?.id, c.history.length], ['a', 10, false, 'ch', 0]);
  c.choose('o1'); // options work again
  assert.equal(c.segmentId, 'b');
  c.rewindTo(0); // span 0 = a, from 0
  assert.deepEqual([c.segmentId, c.t, c.history.length], ['a', 0, 0]);
});

test('rewindTo ignores out-of-range depths and a non-choice entry', () => {
  const c = new Clock(m());
  c.play();
  c.tick(11);
  c.choose('o1');
  c.tick(5); // continuation entry 1 (no hold)
  const before = JSON.stringify(c.history);
  c.rewindTo(5);
  c.rewindTo(-1);
  c.rewindTo(1, true); // entry 1 is a continuation
  c.rewindTo(2, true); // nothing to pop
  assert.equal(JSON.stringify(c.history), before);
});

// ---- playthrough: holds take their default option ----
const pm = (def?: string): Manifest => ({
  id: 'p',
  segments: [{ id: 'a', kind: 'none', out: 10 }, { id: 'b', kind: 'none', out: 5, ends: 'stop' }],
  markers: [{ id: 'mid', segment: 'a', t: 3 }],
  cues: [{
    id: 'ch', segment: 'a', start: 8, end: 9, renders: 'x', hold: true,
    items: [
      { id: 'again', goes_to: 'a', ...(def === 'again' ? { default: true } : {}) },
      { id: 'mid', goes_to: 'mid', sets_variable: 'v', sets_value: '1', ...(def === 'mid' ? { default: true } : {}) },
      { id: 'tob', goes_to: 'b', ...(def === 'tob' ? { default: true } : {}) },
    ],
  }],
});
const pt = (def?: string) => { const c = new Clock(pm(def)); c.playthrough = true; c.play(); return c; };

test('playthrough takes the default at the hold; history records hold, option and auto', () => {
  const c = pt('tob');
  c.tick(9.5);
  assert.deepEqual([c.segmentId, c.t, c.playing, c.holding], ['b', 0, true, null]);
  assert.deepEqual(c.history, [{ segmentId: 'a', t: 9, to: 'b', toT: 0, hold: 'ch', option: 'tob', auto: true }]);
});

test('playthrough with no default continues past the hold without holding', () => {
  const c = pt();
  let held = false;
  c.hooks.hold = () => (held = true);
  c.tick(9.5);
  assert.deepEqual([c.segmentId, c.t, c.playing, held, c.holding], ['a', 9.5, true, false, null]);
  c.tick(1); // end of a: default continuation to b
  assert.equal(c.segmentId, 'b');
  assert.equal(c.history.length, 1);
  assert.equal(c.history[0].auto, undefined);
  c.tick(10); // b ends (stop)
  assert.deepEqual([c.segmentId, c.playing], ['b', false]);
});

test('playthrough default applies sets_variable via the set hook', () => {
  const c = pt('mid');
  const vars: Record<string, string> = {};
  c.hooks.set = (k, v) => (vars[k] = v);
  c.tick(9.5);
  assert.deepEqual(vars, { v: '1' });
  assert.deepEqual([c.segmentId, c.t], ['a', 3]);
});

test('a looping default keeps playing and history grows per lap', () => {
  const c = pt('again');
  for (let i = 0; i < 30; i++) c.tick(1);
  assert.equal(c.playing, true);
  assert.equal(c.holding, null);
  assert.ok(c.history.length >= 3, `laps: ${c.history.length}`);
  assert.ok(c.history.every((e) => e.auto && e.hold === 'ch' && e.option === 'again'));
});

test('reverse unwinds an auto branch like a chosen one, and keeps reversing', () => {
  const c = pt('mid');
  c.tick(9.5); // auto to a@3
  c.tick(1); // a@4
  c.setRate(-1);
  c.tick(2); // crosses 3: unwinds to the choice point (a@9)
  assert.deepEqual([c.segmentId, c.t, c.history.length, c.holding], ['a', 9, 0, null]);
  assert.equal(c.playing, true);
  c.tick(1); // keeps reversing
  assert.equal(c.t, 8);
});

test('toggling on while holding takes the default and plays', () => {
  const c = new Clock(pm('tob'));
  c.play();
  c.tick(9.5);
  assert.equal(c.holding?.id, 'ch');
  c.setPlaythrough(true);
  assert.deepEqual([c.segmentId, c.playing, c.holding], ['b', true, null]);
  assert.equal(c.history[0].auto, true);
});

test('toggling off: the next hold holds', () => {
  const c = pt('again');
  c.tick(9.5); // auto to a@0
  assert.equal(c.history.length, 1);
  c.setPlaythrough(false);
  c.tick(9.5);
  assert.deepEqual([c.t, c.playing, c.holding?.id, c.history.length], [9, false, 'ch', 1]);
});

test('back() in playthrough goes to the choice point unshown; playing on takes the default again', () => {
  const c = pt('again');
  c.tick(9.5);
  c.back();
  assert.deepEqual([c.segmentId, c.t, c.holding, c.history.length, c.playing], ['a', 9, null, 0, true]);
  c.tick(0.1); // continuing from exactly the hold's end
  assert.deepEqual([c.t, c.history.length], [0, 1]);
  assert.equal(c.history[0].auto, true);
});

test('rewindTo(atChoice) in playthrough: same, and a paused clock stays paused until played', () => {
  const c = pt('again');
  c.tick(9.5);
  c.pause();
  c.rewindTo(0, true);
  assert.deepEqual([c.t, c.holding, c.playing], [9, null, false]);
  c.play();
  c.tick(0.1);
  assert.equal(c.history.length, 1);
});

test('jump hook fires for same-segment and cross-segment auto branches, not for chosen ones', () => {
  for (const [def, seg] of [['mid', 'a'], ['tob', 'b']] as const) {
    const c = pt(def);
    let n = 0;
    c.hooks.jump = () => n++;
    c.tick(9.5);
    assert.deepEqual([n, c.segmentId], [1, seg]);
  }
  const c = new Clock(pm('mid'));
  let n = 0;
  c.hooks.jump = () => n++;
  c.play();
  c.tick(9.5);
  c.choose('mid');
  assert.equal(n, 0);
});

// ---- navigation keeps history equal to the route from the start to here ----
const route = (extra: Partial<Manifest> = {}): Manifest => ({
  id: 'r',
  segments: [
    { id: 'in', kind: 'none', out: 10 }, { id: 'f', kind: 'none', out: 20 }, { id: 'g', kind: 'none', out: 20 },
    { id: 'h', kind: 'none', out: 20 }, { id: 'x', kind: 'none', out: 10, ends: 'stop' },
  ],
  markers: [
    { id: 'm-in', segment: 'in', t: 8 }, { id: 'm-f', segment: 'f', t: 5 }, { id: 'm-g', segment: 'g', t: 4 },
    { id: 'm-h', segment: 'h', t: 3 }, { id: 'm-x', segment: 'x', t: 0 }, { id: 'f2', segment: 'f', t: 12 },
  ],
  cues: [],
  ...extra,
});
const at = (c: Clock) => [c.segmentId, c.t, c.history.map((e) => `${e.segmentId}>${e.to}`).join(' ')];

test('jump back onto the route truncates; forward pushes the hops; hops', () => {
  const c = new Clock(route());
  c.play();
  c.tick(10); c.tick(7); // in -> f at 7
  assert.deepEqual(at(c), ['f', 7, 'in>f']);
  c.jumpTo('m-g'); // f -> g@4: hop f>g
  assert.deepEqual(at(c), ['g', 4, 'in>f f>g']);
  c.jumpTo('m-h'); // g>h
  assert.deepEqual(at(c), ['h', 3, 'in>f f>g g>h']);
  c.jumpTo('m-in'); // back to the first span
  assert.deepEqual(at(c), ['in', 8, '']);
  c.jumpTo('m-f'); // forward again: in>f
  assert.deepEqual(at(c), ['f', 5, 'in>f']);
});

test('a loop: the most recent matching span wins', () => {
  const mm = route();
  // f -> f@2 branch (like "again"): route in>f, f>f(2)
  mm.cues = [{ id: 'ch', segment: 'f', start: 18, end: 20, renders: 'x', hold: true, items: [{ id: 'again', goes_to: 'f2' }] }];
  const c = new Clock(mm);
  c.play();
  c.tick(10); c.tick(21); // hold at f:20
  c.choose('again'); // f@12
  c.tick(3); // f 15
  assert.deepEqual(at(c), ['f', 15, 'in>f f>f']);
  c.jumpTo('m-f'); // f@5: only the first f span (0..20) covers it
  assert.deepEqual(at(c), ['f', 5, 'in>f']);
  // re-loop, then a target covered by both spans (f@13): the later span wins
  c.tick(15); c.choose('again'); c.tick(3);
  c.manifest.markers!.push({ id: 'f13', segment: 'f', t: 13 });
  c.jumpTo('f13');
  assert.deepEqual(at(c), ['f', 13, 'in>f f>f']);
});

test('after a choice branch: a marker inside the branch stays in it; before the choice point unwinds it', () => {
  const mm = route();
  mm.cues = [{ id: 'ch', segment: 'f', start: 18, end: 20, renders: 'x', hold: true, items: [{ id: 'togo', goes_to: 'x' }] }];
  mm.markers!.push({ id: 'x5', segment: 'x', t: 5 });
  const c = new Clock(mm);
  c.play();
  c.tick(10); c.tick(21);
  c.choose('togo'); // branch to x@0
  c.tick(2);
  c.jumpTo('x5');
  assert.deepEqual(at(c), ['x', 5, 'in>f f>x']);
  assert.equal(c.history[1].option, 'togo');
  c.jumpTo('m-f'); // before the choice point: unwinds the branch
  assert.deepEqual(at(c), ['f', 5, 'in>f']);
});

test('seek to before a mid-segment branch landing unwinds it (earlier span of the same segment)', () => {
  const mm = route();
  mm.cues = [{ id: 'ch', segment: 'f', start: 18, end: 20, renders: 'x', hold: true, items: [{ id: 'to', goes_to: 'm-g' }, { id: 'again', goes_to: 'f2' }] }];
  const c = new Clock(mm);
  c.play();
  c.tick(10); c.tick(21);
  c.choose('again'); // f@20 -> f@12
  c.tick(2);
  assert.deepEqual(at(c), ['f', 14, 'in>f f>f']);
  c.seek(10); // before the landing at 12: sits on the first f span
  assert.deepEqual(at(c), ['f', 10, 'in>f']);
  c.seek(18); // later in the same span: just a move
  assert.deepEqual(at(c), ['f', 18, 'in>f']);
  c.seek(0);
  assert.deepEqual(at(c), ['f', 0, 'in>f']);
  c.seek(0.5);
  c.seek(0);
  c.jumpTo('start-missing'); // unknown id: no-op
  assert.deepEqual(at(c), ['f', 0, 'in>f']);
});

test('forward navigation then reverse goes back through the recorded hops', () => {
  const c = new Clock(route());
  c.jumpTo('m-h'); // in>f f>g g>h
  assert.deepEqual(at(c), ['h', 3, 'in>f f>g g>h']);
  c.setRate(-1);
  c.play();
  c.tick(3.5); // past h's start: back to the end of g
  assert.deepEqual(at(c), ['g', 20, 'in>f f>g']);
  c.tick(20);
  c.tick(0.5); // and g's start: end of f
  assert.deepEqual(at(c), ['f', 20, 'in>f']);
});

test('an off-route jump leaves history unchanged (branch-only segment)', () => {
  const mm = route();
  mm.segments.splice(1, 0, { id: 'side', kind: 'none', out: 5, next: 'f' });
  mm.segments[0].next = 'f'; // side is not reachable by default from anywhere
  const c = new Clock(mm);
  c.jumpTo('m-g');
  const before = JSON.stringify(c.history);
  c.jumpTo('side');
  assert.equal(JSON.stringify(c.history), before);
  assert.deepEqual([c.segmentId, c.t], ['side', 0]);
  c.jumpTo('side'); // again, still a move
  assert.equal(JSON.stringify(c.history), before);
});

test("ends:'stop' blocks the default chain: a segment past it is off-route", () => {
  const c = new Clock(route());
  c.jumpTo('m-h');
  c.jumpTo('m-x'); // h -> x by order, x is reachable (x itself stops after)
  assert.equal(c.history.at(-1)!.to, 'x');
  const mm = route();
  mm.segments[1].ends = 'stop'; // f stops: g, h, x are not reachable from f
  const d = new Clock(mm);
  d.jumpTo('m-f');
  const before = JSON.stringify(d.history);
  d.jumpTo('m-g');
  assert.equal(JSON.stringify(d.history), before);
  assert.deepEqual([d.segmentId, d.t], ['g', 4]);
});

test('a cycle in the default chain terminates; reaching the current segment again pushes the lap', () => {
  const mm = route();
  mm.segments[2].next = 'f'; // f -> g -> f ...
  mm.segments[1].next = undefined;
  const c = new Clock(mm);
  c.jumpTo('m-f'); // in>f, now at f@5
  c.jumpTo('f'); // f@0 : before... f span covers 0..5? from 0 -> on the route
  assert.equal(c.history.length, 1);
  c.jumpTo('m-h'); // h is unreachable: f -> g -> f (seen) stops
  assert.equal(c.history.length, 1);
  assert.equal(c.segmentId, 'h');
});
