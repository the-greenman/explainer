import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Clock, routeSpans, type Manifest } from '../src/clock.ts';
import { fmtTime, pathSteps } from '../src/path.ts';

const m = (): Manifest => ({
  id: 'm',
  segments: [
    { id: 'a', title: 'Alpha', kind: 'none', out: 20 },
    { id: 'b', kind: 'none', out: 10, ends: 'stop' },
  ],
  markers: [{ id: 'mid', segment: 'a', t: 5, label: 'Midpoint' }, { id: 'bm', segment: 'b', t: 0, label: 'B marker' }],
  cues: [
    { id: 'ch', segment: 'a', start: 18, end: 20, renders: 'x', hold: true, data: { prompt: 'Next, {name}?' },
      items: [{ id: 'o1', label: 'Again', goes_to: 'a' }, { id: 'o2', label: 'Middle', goes_to: 'mid' }, { id: 'o3', goes_to: 'b' }] },
    { id: 'ch2', segment: 'b', start: 8, end: 10, renders: 'x', hold: true, items: [{ id: 'p1', label: 'Back', goes_to: 'mid' }] },
  ],
});
const steps = (c: Clock) => pathSteps(c.manifest, c.history, { segmentId: c.segmentId, t: c.t }, c.holding);
const brief = (c: Clock) => steps(c).map((s) => (s.kind === 'span' ? `${s.label} ${fmtTime(s.from)}-${fmtTime(s.to)}` : `?${s.label}${s.current ? '*' : ''}`));

test('linear continuation: titles, then id when no title', () => {
  const mm = m();
  mm.cues = [];
  mm.segments[0].ends = 'continue';
  const c = new Clock(mm);
  c.play();
  c.tick(21);
  assert.deepEqual(steps(c).map((s) => [s.kind, s.kind === 'span' ? s.label : '', s.depth, s.current]),
    [['span', 'Alpha', 0, false], ['span', 'b', 1, true]]);
  assert.deepEqual(brief(c), ['Alpha 0:00-0:20', 'b 0:00-0:00']);
});

test('a single span before anything happens', () => {
  const c = new Clock(m());
  c.tick(0);
  assert.deepEqual(steps(c), [{ kind: 'span', segment: 'a', from: 0, to: 0, label: 'Alpha', depth: 0, current: true }]);
});

test('held choice is the current step; options are listed, none taken', () => {
  const c = new Clock(m());
  c.play();
  c.tick(25);
  const s = steps(c);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], { kind: 'span', segment: 'a', from: 0, to: 20, label: 'Alpha', depth: 0, current: false });
  assert.deepEqual(s[1], { kind: 'choice', cue: 'ch', label: 'Next, {name}?', depth: 0, current: true,
    options: [{ id: 'o1', label: 'Again', taken: false }, { id: 'o2', label: 'Middle', taken: false }, { id: 'o3', label: 'o3', taken: false }] });
});

test('choice then branch to a mid-segment marker: marker label, taken option recorded', () => {
  const c = new Clock(m());
  c.play();
  c.tick(25);
  c.choose('o2');
  c.tick(3);
  const s = steps(c);
  assert.equal(s.length, 3);
  assert.deepEqual(s[1].kind === 'choice' && [s[1].current, s[1].depth, s[1].options.map((o) => o.taken)], [false, 0, [false, true, false]]);
  assert.deepEqual(s[2], { kind: 'span', segment: 'a', from: 5, to: 8, label: 'Midpoint', depth: 1, current: true });
});

test('the same-segment branch lands earlier in the same segment', () => {
  const c = new Clock(m());
  c.play();
  c.tick(25);
  c.choose('o1'); // a at 0, no marker there: title
  c.tick(2);
  assert.deepEqual(brief(c), ['Alpha 0:00-0:20', '?Next, {name}?', 'Alpha 0:00-0:02']);
});

test('a branch to a segment start with a marker uses the marker label; a continuation does not', () => {
  const c = new Clock(m());
  c.play();
  c.tick(25);
  c.choose('o3');
  assert.equal((steps(c)[2] as any).label, 'B marker');
});

test('reverse across where the branch landed removes the steps', () => {
  const c = new Clock(m());
  c.play();
  c.tick(25);
  c.choose('o2');
  c.tick(1);
  assert.equal(steps(c).length, 3);
  c.setRate(-1);
  c.tick(2); // crosses 5: unwinds
  assert.deepEqual(brief(c), ['Alpha 0:00-0:20']); // back at the choice point, not re-held
  assert.equal(c.history.length, 0);
});

test('back() leaves the choice step current and held', () => {
  const c = new Clock(m());
  c.play();
  c.tick(25);
  c.choose('o2');
  c.back();
  const s = steps(c);
  assert.deepEqual(s.map((x) => [x.kind, x.current]), [['span', false], ['choice', true]]);
  assert.equal(s[1].kind === 'choice' && s[1].options.some((o) => o.taken), false);
});

test('rewinding to a step by its depth reproduces the clicked view', () => {
  const c = new Clock(m());
  c.play();
  c.tick(25);
  c.choose('o2'); // entry 0
  c.tick(16); // 5 -> 20 -> hold
  c.tick(1);
  c.choose('o3'); // entry 1 (a, 20 -> b)
  c.tick(11); // b to 10: ch2 hold at 10
  const all = steps(c);
  assert.deepEqual(all.map((s) => s.kind + s.depth), ['span0', 'choice0', 'span1', 'choice1', 'span2', 'choice2']);
  const choice1 = all[3];
  c.rewindTo(choice1.depth, choice1.kind === 'choice');
  assert.deepEqual(brief(c), ['Alpha 0:00-0:20', '?Next, {name}?', 'Midpoint 0:05-0:20', '?Next, {name}?*']);
  const span1 = steps(c)[2];
  c.rewindTo(span1.depth);
  assert.deepEqual(brief(c), ['Alpha 0:00-0:20', '?Next, {name}?', 'Midpoint 0:05-0:05']);
});

test('fmtTime', () => {
  assert.deepEqual([0, 9.9, 65, 600].map(fmtTime), ['0:00', '0:09', '1:05', '10:00']);
});

test('navigation along the default order records the hops (a step per segment)', () => {
  const c = new Clock(m());
  c.jumpTo('b');
  c.tick(0);
  assert.deepEqual(brief(c), ['Alpha 0:00-0:20', 'b 0:00-0:00']);
});

test('an off-route position (history unchanged) is labelled by the segment it is in, from 0', () => {
  const mm = m();
  mm.segments.push({ id: 'side', kind: 'none', out: 5, ends: 'stop' });
  mm.segments[1].ends = 'stop';
  const c = new Clock(mm);
  c.jumpTo('side'); // b stops: side is only reachable by a branch
  c.tick(0);
  assert.equal(c.history.length, 0);
  assert.deepEqual(brief(c), ['side 0:00-0:00']);
});

test('pathSteps spans are the shared routeSpans', () => {
  const c = new Clock(m());
  c.play();
  c.tick(25);
  c.choose('o2');
  c.tick(3);
  const sp = routeSpans(c.manifest, c.history, { segmentId: c.segmentId, t: c.t });
  assert.deepEqual(steps(c).filter((s) => s.kind === 'span').map((s) => s.kind === 'span' && [s.segment, s.from, s.to, s.depth]),
    sp.map((x) => [x.segment, x.from, x.to, x.depth]));
});

test('an auto-taken option is a choice step with taken and auto', () => {
  const mm = m();
  mm.cues[0].items![1].default = true;
  const c = new Clock(mm);
  c.playthrough = true;
  c.play();
  c.tick(25);
  c.tick(1);
  const s = steps(c);
  const ch = s[1];
  assert.equal(ch.kind, 'choice');
  assert.deepEqual(ch.kind === 'choice' && ch.options, [
    { id: 'o1', label: 'Again', taken: false },
    { id: 'o2', label: 'Middle', taken: true, auto: true },
    { id: 'o3', label: 'o3', taken: false },
  ]);
  assert.equal(s[2].kind === 'span' && s[2].label, 'Midpoint');
});

test('chapter cuts of one file: jumping around never leaves a stale or lost crumb', () => {
  // the shape of a long narrated story: chapters as cuts, markers inside chapters (and one just before a cut)
  const ch = (id: string, title: string, a: number, b: number) => ({ id, title, kind: 'audio' as const, src: 'story.m4a', in: a, out: b });
  const tm: Manifest = {
    id: 'chapters',
    segments: [ch('intro', 'Intro', 0, 45), ch('fool', 'The Fool', 45, 184), ch('magician', 'The Magician', 184, 333), ch('high-priestess', 'The High Priestess', 333, 415), ch('empress', 'The Empress', 415, 514)],
    markers: [{ id: 'card-0', segment: 'intro', t: 41.4 }, { id: 'card-3', segment: 'empress', t: 2.2 }],
    cues: [],
  };
  const c = new Clock(tm);
  const crumbs = () => steps(c).filter((s) => s.kind === 'span').map((s) => s.label).join(' › ');
  c.play();
  c.tick(45); // intro ends: continues into the Fool
  assert.equal(crumbs(), 'Intro › The Fool');
  c.jumpTo('magician');
  c.tick(10);
  assert.equal(crumbs(), 'Intro › The Fool › The Magician');
  c.jumpTo('card-3');
  assert.equal(crumbs(), 'Intro › The Fool › The Magician › The High Priestess › The Empress');
  c.jumpTo('card-0');
  assert.equal(crumbs(), 'Intro');
  c.play();
  c.tick(3.6);
  c.tick(0);
  assert.equal(crumbs(), 'Intro › The Fool');
});
