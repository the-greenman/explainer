import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayText, formatTime, playState, pointerFraction, progressOf, scrubKey } from '../src/controls.ts';

const base = { started: true, playing: false, holding: false, t: 3, length: 12 };

test('playState', () => {
  assert.equal(playState({ ...base, started: false, t: 0 }), 'poster');
  assert.equal(playState({ ...base, playing: true }), 'playing');
  assert.equal(playState(base), 'paused');
  assert.equal(playState({ ...base, t: 12 }), 'ended');
  assert.equal(playState({ ...base, holding: true, playing: true }), 'holding');
  assert.equal(playState({ ...base, started: false, playing: true }), 'playing');
});

test('progress is t over the segment length, 0..1', () => {
  assert.equal(progressOf(3, 12), 0.25);
  assert.equal(progressOf(20, 12), 1);
  assert.equal(progressOf(1, 0), 0);
});

test('m:ss readouts', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(59.9), '0:59');
  assert.equal(formatTime(61), '1:01');
  assert.equal(formatTime(600), '10:00');
  assert.equal(displayText('time', 4.5, 12), '0:04');
  assert.equal(displayText('duration', 4.5, 12), '0:12');
  assert.equal(displayText('remaining', 0, 12), '0:12');
  assert.equal(displayText('remaining', 4.5, 12), '0:08');
  assert.equal(displayText('nope', 4.5, 12), null);
});

test('scrub: pointer x maps across the width; keys step 5 s and jump to the ends', () => {
  assert.equal(pointerFraction(150, 100, 200), 0.25);
  assert.equal(pointerFraction(0, 100, 200), 0);
  assert.equal(pointerFraction(900, 100, 200), 1);
  assert.equal(pointerFraction(5, 0, 0), 0);
  assert.deepEqual(scrubKey('ArrowRight'), { by: 5 });
  assert.deepEqual(scrubKey('ArrowLeft'), { by: -5 });
  assert.deepEqual(scrubKey('Home'), { f: 0 });
  assert.deepEqual(scrubKey('End'), { f: 1 });
  assert.equal(scrubKey('a'), null);
});
