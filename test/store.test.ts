import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, gate, interpolate } from '../src/store.ts';

test('set notifies subscribers; unsubscribe stops it', () => {
  const s = createStore();
  const seen: string[] = [];
  const off = s.subscribe((k, v) => seen.push(`${k}=${v}`));
  s.set('name', 'Ada');
  off();
  s.set('name', 'Bob');
  assert.deepEqual(seen, ['name=Ada']);
  assert.equal(s.get('name'), 'Bob');
});

test('interpolate yields plain text: markup stays a literal string', () => {
  assert.equal(interpolate('Hi {name}!', { name: '<b>x</b>' }), 'Hi <b>x</b>!');
  assert.equal(interpolate('Hi {missing}', {}), 'Hi ');
});

test('when_var gating', () => {
  const cue = { when_var: 'scenario', when_value: 'a' };
  assert.equal(gate(cue, { scenario: 'a' }), true);
  assert.equal(gate(cue, { scenario: 'b' }), false);
  assert.equal(gate(cue, {}), false);
  assert.equal(gate({}, {}), true);
});
