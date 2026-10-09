import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxStyle, lerpRect, mediaBoxAt, parseSlot, type Rect, type SceneSlots } from '../src/media-slots.ts';
import { inOut } from '../src/motion.ts';

const CANVAS: Rect = { x: 0, y: 0, w: 1280, h: 720 };
const SMALL: Rect = { x: 800, y: 60, w: 400, h: 225 };
const FULL: Rect = { x: 0, y: 0, w: 1280, h: 720 };
const SIDE: Rect = { x: 70, y: 70, w: 520, h: 580 };
const slot = (at: number, len: number, rect: Rect, fit: 'cover' | 'contain' = 'cover') => ({ at, len, fit, rect });

// hook [0,3] no slot; small [3,6] slot at 0; zoom [6,10] slot at 0 for 1 s (moves from the small slot); side [9,12] slot at 0 for 2 s (overlaps zoom)
const scenes: SceneSlots[] = [
  { start: 0, end: 3, slots: [] },
  { start: 3, end: 6, slots: [slot(0, 0, SMALL)] },
  { start: 6, end: 10, slots: [slot(0, 1, FULL)] },
  { start: 9, end: 12, slots: [slot(0, 2, SIDE)] },
];
const visible = (i: number, T: number) => T >= scenes[i].start && T <= scenes[i].end;
const at = (T: number, sc = scenes, vis = visible) => mediaBoxAt(sc, vis, CANVAS, T);
const rect = (b: ReturnType<typeof at>) => { assert.ok(!b.hidden); return b.rect; };

test('no active slot among visible scenes: hidden', () => assert.deepEqual(at(1), { hidden: true }));

test('a slot with no length cuts to its rect', () => {
  assert.deepEqual(rect(at(3)), SMALL);
  assert.deepEqual(rect(at(5)), SMALL);
});

test('moving between slots across a scene boundary eases from the previous rect over data-for', () => {
  assert.deepEqual(rect(at(6)), SMALL); // just started: still where it was
  assert.deepEqual(rect(at(6.5)), lerpRect(SMALL, FULL, inOut(0.5)));
  assert.deepEqual(rect(at(6.25)), lerpRect(SMALL, FULL, inOut(0.25)));
  assert.deepEqual(rect(at(7)), FULL);
  assert.deepEqual(rect(at(8)), FULL);
});

test('the slot with the greatest start wins across overlapping scenes; moving from the one it replaces', () => {
  assert.deepEqual(rect(at(9)), FULL);
  assert.deepEqual(rect(at(10)), lerpRect(FULL, SIDE, inOut(0.5)));
  assert.deepEqual(rect(at(11)), SIDE);
});

test('an interrupted move stays continuous (the previous box is itself mid-move)', () => {
  const sc: SceneSlots[] = [
    { start: 0, end: 20, slots: [slot(0, 0, SMALL)] },
    { start: 5, end: 20, slots: [slot(0, 4, FULL)] },
    { start: 7, end: 20, slots: [slot(0, 2, SIDE)] },
  ];
  const vis = (i: number, T: number) => T >= sc[i].start && T <= sc[i].end;
  const before = rect(at(7 - 1e-9, sc, vis)); // mid first move: x = 0.5
  const half = lerpRect(SMALL, FULL, inOut(0.5));
  assert.ok(Math.abs(before.x - half.x) < 1e-3 && Math.abs(before.w - half.w) < 1e-3, 'half way');
  const r0 = rect(at(7, sc, vis));
  assert.ok(Math.abs(r0.x - before.x) < 1e-3 && Math.abs(r0.w - before.w) < 1e-3);
  assert.deepEqual(rect(at(9, sc, vis)), SIDE);
});

test('within one scene the slot with the greatest at <= t is active', () => {
  const sc: SceneSlots[] = [{ start: 2, end: 10, slots: [slot(0, 0, SMALL), slot(3, 0, SIDE), slot(1, 0, FULL)] }];
  const vis = (_: number, T: number) => T >= 2 && T <= 10;
  assert.deepEqual(rect(at(2, sc, vis)), SMALL);
  assert.deepEqual(rect(at(3.5, sc, vis)), FULL);
  assert.deepEqual(rect(at(5, sc, vis)), SIDE);
  assert.deepEqual(at(1.5, sc, vis), { hidden: false, rect: CANVAS, fit: 'contain' }, 'no scene visible: fills the canvas');
});

test('a scene whose slots all start later does not count: hidden until one does', () => {
  const sc: SceneSlots[] = [{ start: 0, end: 10, slots: [slot(4, 0, SIDE)] }];
  const vis = () => true;
  assert.deepEqual(at(2, sc, vis), { hidden: true });
  assert.deepEqual(rect(at(4, sc, vis)), SIDE);
});

test('no scene visible at all: the media fills the canvas', () => {
  assert.deepEqual(at(20), { hidden: false, rect: CANVAS, fit: 'contain' });
});

test('from nothing visible (a gap before the slot) the move starts from the full canvas; from hidden it is a cut', () => {
  const gap: SceneSlots[] = [{ start: 2, end: 8, slots: [slot(0, 2, SIDE)] }];
  const vis = (_: number, T: number) => T >= 2 && T <= 8;
  assert.deepEqual(rect(at(2, gap, vis)), CANVAS);
  assert.deepEqual(rect(at(3, gap, vis)), lerpRect(CANVAS, SIDE, inOut(0.5)));
  const cut: SceneSlots[] = [{ start: 0, end: 3, slots: [] }, { start: 3, end: 8, slots: [slot(0, 2, SIDE)] }];
  const v2 = (i: number, T: number) => T >= cut[i].start && T <= cut[i].end;
  assert.deepEqual(rect(at(3.5, cut, v2)), SIDE, 'previous was hidden');
  const first: SceneSlots[] = [{ start: 0, end: 8, slots: [slot(0, 2, SIDE)] }];
  assert.deepEqual(rect(at(0.5, first, () => true)), SIDE, 'at time 0 there is nothing to move from');
});

test('a function of T alone: any order of evaluation gives the same boxes', () => {
  const times = [0, 1, 3, 5.9, 6.1, 6.5, 7, 9.5, 10.5, 12, 15];
  const fwd = times.map((T) => JSON.stringify(at(T)));
  const back = times.slice().reverse().map((T) => JSON.stringify(at(T))).reverse();
  assert.deepEqual(back, fwd);
  assert.deepEqual([5, 1, 9.5, 6.5].map((T) => JSON.stringify(at(T))), [5, 1, 9.5, 6.5].map((T) => JSON.stringify(at(T))));
});

test('the fit follows the active slot', () => {
  const sc: SceneSlots[] = [{ start: 0, end: 5, slots: [slot(0, 0, SMALL, 'contain')] }];
  assert.equal((at(1, sc, () => true) as any).fit, 'contain');
  assert.equal((at(1) as any).fit, undefined); // hidden at 1
});

test('parseSlot: at and for default to 0, fit to cover', () => {
  const get = (m: Record<string, string>) => parseSlot((n) => m[n] ?? null);
  assert.deepEqual(get({}), { at: 0, len: 0, fit: 'cover' });
  assert.deepEqual(get({ 'data-at': '2.5', 'data-for': '1', 'data-media-fit': 'contain' }), { at: 2.5, len: 1, fit: 'contain' });
  assert.deepEqual(get({ 'data-at': 'x', 'data-media-fit': 'stretch' }), { at: 0, len: 0, fit: 'cover' });
});

test('boxStyle sets position, size and fit only; hidden adds opacity 0', () => {
  assert.equal(boxStyle({ hidden: false, rect: { x: 1.23456, y: 2, w: 3, h: 4 }, fit: 'cover' }), 'position:absolute;left:1.235px;top:2px;width:3px;height:4px;object-fit:cover');
  assert.match(boxStyle({ hidden: true }), /opacity:0/);
});
