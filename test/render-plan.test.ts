import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Manifest } from '../src/clock.ts';
import { planRender, mergeCuts, parseVtt, retimeCaptions, writeVtt } from '../src/render-plan.ts';

// intro (4 s) -> main (10 s, choice at 6..8) ; options: again -> start (loop), skip -> mark (main 5), side -> side (3 s, ends stop)
const man = (): Manifest => ({
  id: 'm',
  segments: [
    { id: 'intro', kind: 'video', src: 'a.mp4', in: 0, out: 4, captions: 'a.vtt' },
    { id: 'main', kind: 'video', src: 'a.mp4', in: 4, out: 14, captions: 'a.vtt' },
    { id: 'side', kind: 'none', out: 3, ends: 'stop' },
  ],
  markers: [{ id: 'start', segment: 'intro', t: 0 }, { id: 'mark', segment: 'main', t: 5 }],
  cues: [{
    id: 'ch', segment: 'main', start: 6, end: 8, renders: 'x', hold: true,
    items: [
      { id: 'again', goes_to: 'start', default: true },
      { id: 'skip', goes_to: 'mark', sets_variable: 'seen', sets_value: 'yes' },
      { id: 'side', goes_to: 'side' },
      { id: 'plain' },
    ],
  }],
});
const linear = (): Manifest => { const m = man(); m.cues = []; m.segments[1].ends = 'stop'; return m; };

test('linear path: frame count = duration x fps, cut boundaries exact', () => {
  for (const fps of [30, 24, 25]) {
    const p = planRender(linear(), { fps });
    assert.equal(p.stop, 'end');
    assert.equal(p.frames.length, 14 * fps);
    assert.equal(p.duration, 14);
    assert.deepEqual(p.cuts.map((c) => [c.segment, c.srcIn, c.srcOut, c.outStart, c.outEnd, c.frames]), [
      ['intro', 0, 4, 0, 4, 4 * fps], ['main', 4, 14, 4, 14, 10 * fps],
    ]);
    assert.deepEqual(p.frames[4 * fps], { segmentId: 'main', t: 0 });
    assert.deepEqual(p.frames.at(-1)!.segmentId, 'main');
    assert.ok(p.frames.at(-1)!.t < 10);
  }
});

test('default path: takes defaults, renders one lap and stops at the choice point', () => {
  const p = planRender(man(), { fps: 30 });
  assert.equal(p.stop, 'loop');
  assert.equal(p.cuts.length, 2);
  assert.equal(p.cuts[1].srcOut, 12); // main t 8 = the hold's end
  assert.equal(p.frames.length, 12 * 30);
  assert.equal(p.cuts.at(-1)!.outEnd, 12);
});

test('default path: a default that goes somewhere new is followed; a loop to a rendered spot stops', () => {
  const m = man();
  m.cues[0].items = [{ id: 'skip', goes_to: 'mark', default: true }, { id: 'again', goes_to: 'start' }];
  m.markers![1] = { id: 'mark', segment: 'main', t: 1 }; // already rendered (main 1..8): loop
  assert.equal(planRender(m, { fps: 10 }).stop, 'loop');
  m.markers![1] = { id: 'mark', segment: 'main', t: 9 }; // not rendered yet: followed, then main runs on into side
  const p = planRender(m, { fps: 10 });
  assert.equal(p.stop, 'end');
  assert.deepEqual(p.cuts.map((c) => c.segment), ['intro', 'main', 'main', 'side']);
});

test('explicit choices: cross-segment branch and a same-segment branch', () => {
  const p = planRender(man(), { fps: 10, path: ['skip', 'side'] });
  assert.deepEqual(p.cuts.map((c) => [c.segment, c.srcIn, c.srcOut, c.outStart, c.outEnd]), [
    ['intro', 0, 4, 0, 4],
    ['main', 4, 12, 4, 12], // to the hold at main t=8
    ['main', 9, 12, 12, 15], // skip -> mark t=5 (src 9), runs to the hold again
    ['side', 0, 3, 15, 18],
  ]);
  assert.equal(p.stop, 'end');
  assert.equal(p.frames.length, 180);
  assert.deepEqual(p.vars, { seen: 'yes' });
  // variables are announced on the frame where they changed
  const at = p.frames.findIndex((f) => f.vars?.seen);
  assert.equal(at, 120);
  assert.equal(p.frames.filter((f) => f.vars).length, 1);
});

test('explicit choices: a list that runs out stops at the hold; a choice without goes_to plays on', () => {
  const p = planRender(man(), { fps: 10, path: [] });
  assert.equal(p.stop, 'hold');
  assert.equal(p.frames.length, 120);
  const q = planRender(man(), { fps: 10, path: ['plain'] });
  assert.equal(q.stop, 'end');
  assert.deepEqual(q.cuts.map((c) => c.segment), ['intro', 'main', 'side']); // played on past the hold with no break in the main cut
  assert.equal(q.cuts[1].srcOut, 14);
  assert.equal(q.frames.length, 170);
});

test('explicit choices: an unknown id is an error', () => {
  assert.throws(() => planRender(man(), { fps: 10, path: ['nope'] }), /unknown option "nope"/);
});

test('maxSeconds caps the walk', () => {
  const m = man();
  const p = planRender(m, { fps: 10, path: ['again', 'again', 'again', 'again'], maxSeconds: 20 });
  assert.equal(p.stop, 'max');
  assert.equal(p.frames.length, 200);
});

test('initial vars are applied on the first frame', () => {
  const p = planRender(linear(), { fps: 10, vars: { a: '1' } });
  assert.deepEqual(p.frames[0].vars, { a: '1' });
});

test('mergeCuts joins continuations in one file, not repeats', () => {
  const p = planRender(man(), { fps: 10, path: ['skip', 'plain'] });
  assert.equal(p.cuts.length, 4); // intro, main to the hold, main from the marker on (past the hold), side
  assert.equal(mergeCuts(p.cuts).length, 3); // intro+main join; the repeat does not
  const merged = mergeCuts(planRender(linear(), { fps: 10 }).cuts);
  assert.equal(merged.length, 1);
  assert.deepEqual([merged[0].srcIn, merged[0].srcOut, merged[0].outEnd, merged[0].frames], [0, 14, 14, 140]);
});

test('captions are cut, clipped at boundaries and retimed', () => {
  const vtt = parseVtt('WEBVTT\n\n00:01.000 --> 00:02.000\none\n\n1\n00:00:03.500 --> 00:00:05.000 align:start\ntwo\nlines\n\n00:00:11.000 --> 00:00:13.000\nlate\n');
  assert.equal(vtt.length, 3);
  assert.equal(vtt[1].text, 'two\nlines');
  // path: main 5..8 then intro 0..2 => source [9,12) then [0,2)
  const cuts = [
    { segment: 'main', kind: 'video' as const, src: 'a.mp4', captions: 'a.vtt', srcIn: 9, srcOut: 12, outStart: 0, outEnd: 3, frames: 30 },
    { segment: 'intro', kind: 'video' as const, src: 'a.mp4', captions: 'a.vtt', srcIn: 0, srcOut: 2, outStart: 3, outEnd: 5, frames: 20 },
  ];
  const out = retimeCaptions({ 'a.vtt': vtt }, cuts);
  assert.deepEqual(out.map((q) => [q.start, q.end, q.text]), [[2, 3, 'late'], [4, 5, 'one']]);
  // "two" (3.5-5) lies outside both cuts; "late" (11-13) is clipped to 11-12
  assert.match(writeVtt(out), /^WEBVTT\n\n00:00:02\.000 --> 00:00:03\.000\nlate\n/);
});
