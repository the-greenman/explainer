import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { captionConfig, plainCue, withCaptionsOn } from '../src/captions.ts';
import { parseVtt } from '../src/render-plan.ts';

// ---- pure: what the attribute means ----
test('captionConfig: without a canvas nothing changes (strip for audio, over the stage, below only on request)', () => {
  assert.deepEqual(captionConfig(null, false, false), { on: true, video: false, below: false });
  assert.deepEqual(captionConfig('below', false, false), { on: true, video: false, below: true });
  assert.deepEqual(captionConfig('off', false, false), { on: false, video: false, below: false });
  assert.deepEqual(captionConfig('', false, true), { on: true, video: false, below: false }, 'slots need a canvas');
});

test('captionConfig: a canvas with a media slot defaults to the strip for video, below the stage; native / over opt out', () => {
  assert.deepEqual(captionConfig(null, true, true), { on: true, video: true, below: true });
  assert.deepEqual(captionConfig('native', true, true), { on: true, video: false, below: false });
  assert.deepEqual(captionConfig('over', true, true), { on: true, video: true, below: false });
  assert.deepEqual(captionConfig('off', true, true), { on: false, video: true, below: true });
  assert.deepEqual(captionConfig(null, true, false), { on: true, video: false, below: false }, 'a canvas without slots is unchanged');
});

test('captionConfig: strip asks for it explicitly, with or without a canvas; tokens combine', () => {
  assert.deepEqual(captionConfig('strip', false, false), { on: true, video: true, below: false });
  assert.deepEqual(captionConfig('strip', true, false), { on: true, video: true, below: true });
  assert.deepEqual(captionConfig('strip below off', false, false), { on: false, video: true, below: true });
  assert.deepEqual(captionConfig('STRIP  Over', true, false), { on: true, video: true, below: false });
  assert.deepEqual(captionConfig('native strip', true, true), { on: true, video: false, below: false }, 'native wins');
});

test('withCaptionsOn: the off token comes and goes, the others stay', () => {
  assert.equal(withCaptionsOn(null, false), 'off');
  assert.equal(withCaptionsOn('off', true), null, 'nothing left: the attribute goes');
  assert.equal(withCaptionsOn('strip below', false), 'strip below off');
  assert.equal(withCaptionsOn('strip below off', true), 'strip below');
  assert.equal(withCaptionsOn('strip off', false), 'strip off');
});

test('plainCue: tags dropped, entities decoded, line breaks kept (text, never HTML)', () => {
  assert.equal(plainCue('one\ntwo'), 'one\ntwo');
  assert.equal(plainCue('<v Ann><i>hi</i> &amp; <b>bye</b></v>'), 'hi & bye');
  assert.equal(plainCue('a &lt;script&gt; b'), 'a <script> b');
  assert.equal(plainCue('<00:01.000>word'), 'word');
});

// ---- the player (linkedom, with a fake media element that has text tracks) ----
const { document, HTMLElement, Element, customElements, window } = parseHTML('<!doctype html><html><head></head><body></body></html>');
const g = globalThis as any;
Object.defineProperty(document, 'readyState', { value: 'complete' });
Object.assign(g, {
  document, HTMLElement, Element, customElements, window, CustomEvent: window.CustomEvent, Event: window.Event,
  HTMLVideoElement: class {}, // never an instance: the fake media is a plain element
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {}, removeEventListener() {},
  requestAnimationFrame: () => 1, cancelAnimationFrame() {}, IntersectionObserver: class { observe() {} disconnect() {} },
});
const VTT = 'WEBVTT\n\n00:01.000 --> 00:02.000\nfirst\nline two\n\n00:03.000 --> 00:04.000\n<i>third</i> &amp; last\n';
const cues = parseVtt(VTT).map((q) => ({ startTime: q.start, endTime: q.end, text: q.text }));
const realCreate = document.createElement.bind(document);
(document as any).createElement = (tag: string) => {
  const el = realCreate(tag);
  if (tag === 'video' || tag === 'audio') {
    Object.assign(el, { play: () => Promise.resolve(), pause() {}, currentTime: 0, muted: false, playbackRate: 1, ended: false });
    Object.defineProperty(el, 'textTracks', { get: () => Array.from(el.children as ArrayLike<any>).map((c: any) => c.track).filter(Boolean) });
  }
  if (tag === 'track') (el as any).track = { mode: 'disabled', cues };
  return el;
};
const { ExplainerPlayer } = await import('../src/player.ts');
const { corePack, registerComponents } = await import('../src/components/index.ts');
registerComponents(corePack);
customElements.define('explainer-player', ExplainerPlayer);

const SCENE = 'com.semanticops.explainer/scene@1';
const slotScene = '<template data-scene="s"><section><div data-media-slot></div>x</section></template>';
const plainScene = '<template data-scene="s"><section>x</section></template>';
const manifest = (kind: string) => ({
  id: 'm', segments: [{ id: 'a', kind, src: 'v.mp4', captions: 'v.vtt', out: 12 }],
  cues: [{ id: 'u', segment: 'a', start: 0, end: 12, renders: SCENE, data: { template: 's' } }],
});
const make = (attrs: Record<string, string>, scene: string, kind = 'video', inner = '') => {
  const el = document.createElement('explainer-player') as any;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.innerHTML = scene + inner;
  el.manifest = manifest(kind);
  document.body.append(el);
  return el;
};
const at = (el: any, t: number) => { el.clock.t = t; el.paintCaption(); return el.strip.textContent; };
const trackMode = (el: any) => el.media.textTracks[0].mode;

test('strip text at clock times for a video segment, from the clock (not from events); a gap is empty', () => {
  const el = make({ canvas: '1280x720' }, slotScene);
  assert.equal(at(el, 0.5), '');
  assert.equal(at(el, 1.5), 'first\nline two', 'line breaks kept');
  assert.equal(at(el, 2.5), '');
  assert.equal(at(el, 3.5), 'third & last', 'tags stripped, entity decoded, textContent only');
  assert.equal(at(el, 1.5), 'first\nline two', 'reverse / scrub back: same answer');
  assert.equal(el.strip.children.length, 0, 'no element children: text only');
});

test('the text shows while the video is hidden (no scene has an active slot)', () => {
  const el = make({ canvas: '1280x720' }, slotScene);
  el.clock.t = 1.5; el.paint();
  assert.equal(at(el, 1.5), 'first\nline two');
  assert.equal(el.strip.hidden, false);
});

test('the native track is loaded but hidden while the strip shows it; native mode leaves it showing', () => {
  const strip = make({ canvas: '1280x720' }, slotScene);
  assert.equal(trackMode(strip), 'hidden');
  assert.equal(strip.media.textTracks[0].mode, 'hidden');
  const native = make({ canvas: '1280x720', captions: 'native' }, slotScene);
  assert.notEqual(trackMode(native), 'hidden');
  const explicit = make({ captions: 'strip' }, plainScene);
  assert.equal(trackMode(explicit), 'hidden');
  strip.setAttribute('captions', 'native'); // switching live
  assert.equal(trackMode(strip), 'showing');
  strip.setAttribute('captions', 'strip');
  assert.equal(trackMode(strip), 'hidden');
});

test('default on with slots: strip below the stage, data-explainer-captions, aria-live off, two lines reserved', () => {
  const el = make({ canvas: '1280x720' }, slotScene);
  const kids = Array.from(el.children as ArrayLike<any>);
  const stage = kids.find((c: any) => c.style?.position === 'relative');
  assert.ok(el.strip.hasAttribute('data-explainer-captions'));
  assert.equal(el.strip.getAttribute('aria-live'), 'off');
  assert.equal(kids.indexOf(el.strip), kids.indexOf(stage) + 1, 'strip follows the stage');
  assert.match(el.strip.getAttribute('style'), /min-height:calc\(2lh/);
  assert.match(el.strip.getAttribute('style'), /var\(--explainer-caption-ink/);
  assert.equal(el.strip.hidden, false, 'reserved even between cues');
  at(el, 0.5);
  assert.equal(el.strip.hidden, false);
  el.setAttribute('captions-live', 'polite');
  assert.equal(el.strip.getAttribute('aria-live'), 'polite');
});

test('kept children (the site\'s controls) lay out after the strip: stage, strip, controls', () => {
  const el = make({ canvas: '1280x720' }, slotScene, 'video', '<p data-explainer-poster>poster</p><div class="controls" id="c"><button>go</button></div>');
  const kids = Array.from(el.children as ArrayLike<any>).filter((c: any) => c.localName !== 'template');
  const iStage = kids.findIndex((c: any) => c.style?.position === 'relative');
  assert.deepEqual([iStage + 1, iStage + 2], [kids.indexOf(el.strip), kids.indexOf(el.querySelector('#c'))]);
});

test('captions="over" with slots lays the strip over the stage instead', () => {
  const el = make({ canvas: '1280x720', captions: 'over' }, slotScene);
  assert.ok(el.stage.contains(el.strip));
  assert.match(el.strip.getAttribute('style'), /position:absolute/);
});

test('toggle: the captions command hides and shows the strip, data-captions follows, other tokens stay', () => {
  const el = make({ canvas: '1280x720' }, slotScene);
  el.paintCaption();
  assert.equal(el.getAttribute('data-captions'), 'on');
  assert.equal(at(el, 1.5), 'first\nline two');
  el.command({ action: 'captions' });
  assert.equal(el.getAttribute('captions'), 'off');
  assert.equal(el.captionsOn, false);
  el.paintCaption();
  assert.equal(el.getAttribute('data-captions'), 'off');
  assert.equal(el.strip.textContent, '');
  assert.equal(el.strip.hidden, true);
  el.command({ action: 'captions', on: true });
  assert.equal(el.hasAttribute('captions'), false);
  assert.equal(el.getAttribute('data-captions'), 'on');
  assert.equal(at(el, 1.5), 'first\nline two');
  const e2 = make({ canvas: '1280x720', captions: 'strip over' }, slotScene);
  e2.command({ action: 'captions', on: false });
  assert.equal(e2.getAttribute('captions'), 'strip over off');
  e2.command({ action: 'captions' });
  assert.equal(e2.getAttribute('captions'), 'strip over');
});

test('no canvas: unchanged. Video keeps the native track showing and gets no strip text; audio uses the strip over the stage', () => {
  const v = make({}, plainScene);
  assert.equal(at(v, 1.5), '', 'video, no canvas: native');
  assert.notEqual(trackMode(v), 'hidden');
  assert.equal(v.captionsBelow, false);
  assert.ok(v.stage.contains(v.strip));
  const a = make({}, plainScene, 'audio');
  assert.equal(at(a, 1.5), 'first\nline two', 'audio strip as before');
  assert.equal(trackMode(a), 'hidden');
  const c = make({ canvas: '1280x720' }, plainScene);
  assert.equal(at(c, 1.5), '', 'a canvas without slots: unchanged');
  assert.equal(c.captionsBelow, false);
});
