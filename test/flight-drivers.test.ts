import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatePlayerProgress, playerProgress, scrollProgress, scrollStop, settleProgress } from '../src/experimental/flight/drivers.ts';
import { fromDocRect, homeVisibility, toDocRect } from '../src/experimental/flight/homes.ts';
import { IDLE } from '../src/experimental/flight/types.ts';

test('IDLE is the one not-started value', () => {
  assert.equal(IDLE, Number.NEGATIVE_INFINITY);
});

test('scrollProgress: 0 at the from bottom on the line, 1 at the to top on the line, linear between', () => {
  assert.equal(scrollProgress(400, 1200, 400), 0);
  assert.equal(scrollProgress(0, 800, 400), 0.5);
  assert.equal(scrollProgress(-400, 400, 400), 1);
});

test('scrollProgress: clamps below 0 and above 1', () => {
  assert.equal(scrollProgress(500, 1300, 400), 0);
  assert.equal(scrollProgress(-900, 0, 400), 1);
});

test('scrollProgress: touching or overlapping parts (gap <= 0) are a step at the line', () => {
  assert.equal(scrollProgress(300, 300, 400), 1);
  assert.equal(scrollProgress(500, 500, 400), 0);
  assert.equal(scrollProgress(500, 450, 400), 0);
  assert.equal(scrollProgress(300, 100, 400), 1);
  assert.equal(scrollProgress(NaN, 100, 400), 0, 'garbage does not start a stop');
});

test('scrollStop: progress 0 has not started', () => {
  assert.equal(scrollStop(0), IDLE);
  assert.equal(scrollStop(0.25), 0.25);
});

test('playerProgress: idle in another segment or before at; 0..1 over len; 1 for instant and len 0', () => {
  const s = { segment: 'a', at: 2, len: 2 };
  assert.equal(playerProgress(s, 'b', 3), IDLE);
  assert.equal(playerProgress(s, 'a', 1.9), IDLE);
  assert.equal(playerProgress(s, 'a', 2), 0);
  assert.equal(playerProgress(s, 'a', 3), 0.5);
  assert.equal(playerProgress(s, 'a', 9), 1);
  assert.equal(playerProgress({ ...s, instant: true }, 'a', 2), 1);
  assert.equal(playerProgress({ ...s, len: 0 }, 'a', 2), 1);
});

test('settleProgress: every started stop is finished', () => {
  assert.deepEqual(settleProgress([1, 0.3, 0, IDLE]), [1, 1, 1, IDLE]);
});

test('homeVisibility: away from a home it hides but its stays parts show; at the home both are its own', () => {
  assert.equal(homeVisibility('home', false), 'hidden');
  assert.equal(homeVisibility('stays', false), 'visible');
  assert.equal(homeVisibility('home', true), null);
  assert.equal(homeVisibility('stays', true), null);
});

test('document-space fallback: a rect saved at one scroll position is right at another', () => {
  const viewport = { x: 100, y: 500, w: 50, h: 40 };
  const doc = toDocRect(viewport, 0, 300); // saved while scrolled 300 down
  assert.deepEqual(doc, { x: 100, y: 800, w: 50, h: 40 });
  assert.deepEqual(fromDocRect(doc, 0, 300), viewport);
  assert.deepEqual(fromDocRect(doc, 0, 700), { x: 100, y: 100, w: 50, h: 40 }, 'after scrolling 400 further it is 400 higher in the viewport');
  assert.deepEqual(fromDocRect(toDocRect(viewport, 25, 60), 25, 60), viewport);
});

// ---- the reduced-motion rule (finding: players at their still time counted as started at load)
const view = (o: Partial<{ state: string | null; playMode: string | null; top: number }> = {}) => ({ state: 'paused', playMode: 'enter', top: 900, ...o });
const LINE = 400;

test('gate: a stopped (IDLE) clock stays IDLE', () => {
  assert.equal(gatePlayerProgress(IDLE, view(), false, LINE), IDLE);
  assert.equal(gatePlayerProgress(IDLE, view({ top: 0 }), true, LINE), IDLE);
});

test('gate: a player in the poster state has not started, whatever its clock says', () => {
  assert.equal(gatePlayerProgress(1, view({ state: 'poster' }), false, LINE), IDLE);
  assert.equal(gatePlayerProgress(1, view({ state: 'poster', top: 0 }), true, LINE), IDLE);
});

test('gate: normal motion passes the clock through, wherever the player is on the page', () => {
  assert.equal(gatePlayerProgress(0.4, view(), false, LINE), 0.4);
  assert.equal(gatePlayerProgress(0.4, view({ playMode: 'scrub' }), false, LINE), 0.4);
});

test('gate: reduced motion, enter/scrub player below the line (not reached) is IDLE even though it sits at its still time', () => {
  assert.equal(gatePlayerProgress(1, view({ top: 900 }), true, LINE), IDLE);
  assert.equal(gatePlayerProgress(1, view({ playMode: 'scrub', top: 401 }), true, LINE), IDLE);
});

test('gate: reduced motion, once the player top reaches the line it counts (and un-counts when scrolled back)', () => {
  assert.equal(gatePlayerProgress(1, view({ top: 400 }), true, LINE), 1);
  assert.equal(gatePlayerProgress(1, view({ top: -2000 }), true, LINE), 1, 'scrolled past');
  assert.equal(gatePlayerProgress(1, view({ top: 900 }), true, LINE), IDLE, 'scrolled back above it');
});

test('gate: reduced motion with a manual player uses its real clock (it is not pinned to the still time)', () => {
  assert.equal(gatePlayerProgress(0.5, view({ playMode: null, top: 900 }), true, LINE), 0.5);
});

test('gate: guide page under reduced motion. Three players at their still time; only the ones the reader reached count', () => {
  // the player stops of stops 2 (p1), 4 and 5 (p2) all read progress 1 because p1/p2 sit at their end
  const tops = { p1: 200, p2: 1200, p3: 2400 }; // at the top of the page: p1 is in view
  const q = [gatePlayerProgress(1, view({ top: tops.p1 }), true, LINE), gatePlayerProgress(1, view({ top: tops.p2 }), true, LINE), gatePlayerProgress(1, view({ top: tops.p2 }), true, LINE)];
  assert.deepEqual(q, [1, IDLE, IDLE], 'p2 stops do not count at load: the circle is not pinned at part 3');
});
