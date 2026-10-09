import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cueTextAt } from '../src/captions.ts';

const cues = [
  { startTime: 0, endTime: 4.59, text: 'one' },
  { startTime: 6.1, endTime: 10.79, text: 'two' },
  { startTime: 10.79, endTime: 15, text: 'three' },
  { startTime: 20, endTime: 40, text: 'long' },
  { startTime: 22, endTime: 23, text: 'inside' },
];

test('cueTextAt: inside a cue, at its start, in a gap, at its end', () => {
  assert.equal(cueTextAt(cues, 0), 'one');
  assert.equal(cueTextAt(cues, 4.589), 'one');
  assert.equal(cueTextAt(cues, 4.59), '', 'end is exclusive');
  assert.equal(cueTextAt(cues, 5), '', 'gap');
  assert.equal(cueTextAt(cues, 6.1), 'two');
  assert.equal(cueTextAt(cues, 10.79), 'three', 'contiguous cues: the later one at the boundary');
  assert.equal(cueTextAt(cues, 16), '');
  assert.equal(cueTextAt(cues, 1000), '');
  assert.equal(cueTextAt(cues, -1), '');
});

test('cueTextAt: an earlier long cue still covers a time after a nested cue ended', () => {
  assert.equal(cueTextAt(cues, 22.5), 'inside');
  assert.equal(cueTextAt(cues, 30), 'long');
});

test('cueTextAt: same answer whatever order the times are asked in (reverse, scrub)', () => {
  const ts = [12, 0.5, 7, 12, 30, 5];
  const fwd = ts.map((t) => cueTextAt(cues, t));
  const again = [...ts].reverse().map((t) => cueTextAt(cues, t)).reverse();
  assert.deepEqual(again, fwd);
});

test('cueTextAt: empty or missing list', () => {
  assert.equal(cueTextAt([], 1), '');
  assert.equal(cueTextAt(null, 1), '');
});
