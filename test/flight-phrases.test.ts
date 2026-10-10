// phraseTimes: pure, importable in node with no DOM at all (this file never defines `document`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phraseTimes } from '../src/experimental/flight/phrases.ts';

const VTT = `WEBVTT

00:00.500 --> 00:02.000
Three things matter:

00:02.200 --> 00:03.800
the question,
the Reasons,

00:04.000 --> 00:05.500
and   the
date.

00:06.000 --> 00:07.000
The question again.
`;

test('the start of the first matching cue, case-insensitive', () => {
  assert.deepEqual(phraseTimes(VTT, ['THREE THINGS', 'the question', 'and the date']), [0.5, 2.2, 4]);
});

test('multi-line cues and odd whitespace match as one line', () => {
  assert.deepEqual(phraseTimes(VTT, ['question, the reasons']), [2.2]);
  assert.deepEqual(phraseTimes(VTT, ['and the date.']), [4]);
});

test('order: each phrase is searched after the cue of the previous one', () => {
  // "the question" is in two cues: the second match must come from the later one
  assert.deepEqual(phraseTimes(VTT, ['the question', 'the question']), [2.2, 6]);
  assert.throws(() => phraseTimes(VTT, ['and the date', 'three things']), /phrase 2 "three things" is not in any cue after the cue at 4s/);
});

test('a missing phrase throws, naming it', () => {
  assert.throws(() => phraseTimes(VTT, ['the money']), /phrase 1 "the money"/);
  assert.throws(() => phraseTimes(VTT, ['three things', '']), /phrase 2 ""/);
  assert.throws(() => phraseTimes('WEBVTT\n', ['x']), /"x"/);
});

test('offset shifts every time (scene-relative: pass minus the cue start); tags in cues are ignored', () => {
  assert.deepEqual(phraseTimes(VTT, ['the question', 'date'], { offset: -2 }), [0.2, 2]);
  assert.deepEqual(phraseTimes('WEBVTT\n\n00:01.000 --> 00:02.000\n<v Ada>the <b>question</b></v>\n', ['the question']), [1]);
});

test('no DOM needed', () => {
  assert.equal(typeof (globalThis as any).document, 'undefined');
});
