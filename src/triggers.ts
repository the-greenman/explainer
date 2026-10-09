import { clamp01 } from './clock.ts';
import type { Command, ExplainerPlayer } from './player.ts';

// commands go to players and to <explainer-motion> (both have command())
type Commandable = { command(c: Command): void };
const commandable = (e: Element | null): e is Element & Commandable => e?.localName === 'explainer-player' || e?.localName === 'explainer-motion';
const target = (sel?: string | null) =>
  (sel ? [...document.querySelectorAll(sel)] : [document.querySelector('explainer-player')]).filter(commandable);

function run(el: HTMLElement) {
  const v = el.dataset.explainerValue ?? (el as HTMLInputElement).value;
  const cmd: Command = { action: el.dataset.explainerAction!, to: el.dataset.explainerTo, rate: +v, t: +v, on: v === 'on' ? true : v === 'off' ? false : undefined };
  target(el.dataset.explainerTarget).forEach((p) => p.command(cmd));
}

/** Delegated buttons/sliders, document-level commands and scroll-section seeks. */
export function initTriggers() {
  document.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-explainer-action]');
    if (el && !(el instanceof HTMLInputElement)) run(el);
  });
  document.addEventListener('input', (e) => {
    const el = e.target as HTMLElement;
    if (el instanceof HTMLInputElement && el.dataset.explainerAction) run(el);
  });
  // commands dispatched on a player or motion element are handled by it; those on the document go to detail.target or the first player
  document.addEventListener('explainer:command', (e) => {
    if ((e.target as Element).closest?.('explainer-player,explainer-motion')) return;
    const d = (e as CustomEvent<Command & { target?: string }>).detail;
    target(d.target).forEach((p) => p.command(d));
  });
  // ponytail: sections present at init only, no MutationObserver
  const io = new IntersectionObserver(
    (es) => es.forEach((en) => {
      const el = en.target as HTMLElement;
      if (en.isIntersecting) target(el.dataset.explainerTarget).forEach((p) => p.command({ action: 'jump', to: el.dataset.explainerSeek! }));
    }),
    { rootMargin: '-45% 0px -45% 0px' }, // fires as a section crosses mid-viewport, scrolling either way
  );
  document.querySelectorAll('[data-explainer-seek]').forEach((el) => io.observe(el));
}

/** What a scroll mode drives: a player, or an `<explainer-motion>`. */
export type ScrollDriver = {
  /** play forward at rate 1 / play backward at rate -1 / stop */
  forward(): void;
  reverse(): void;
  pause(): void;
  /** go to this fraction (0..1) of the whole timeline */
  seekFraction(f: number): void;
};

/** `enter`: plays forward when `el` scrolls into view, rewinds when scrolled back above it. Returns cleanup. */
export function bindEnter(el: Element, d: Pick<ScrollDriver, 'forward' | 'reverse' | 'pause'>): () => void {
  let seen = false;
  const io = new IntersectionObserver(([e]) => {
    if (e.isIntersecting) { seen = true; d.forward(); }
    else if (seen && e.boundingClientRect.top > 0) d.reverse(); // scrolled back up past it: rewind
    else d.pause();
  }, { threshold: 0.4 });
  io.observe(el);
  return () => io.disconnect();
}

/** Scroll progress 0..1 for `el`: its pass through the viewport, or (scrub-root) the pass of that element's own scroll range. */
export function scrubFraction(el: Element, rootSel?: string | null): number {
  const rr = rootSel ? document.querySelector(rootSel)?.getBoundingClientRect() : undefined;
  const r = el.getBoundingClientRect();
  return clamp01(rr ? -rr.top / (rr.height - innerHeight || 1) : (innerHeight - r.top) / (innerHeight + r.height));
}

/** `scrub`: the fraction follows the scroll position (see `scrubFraction`). Returns cleanup. */
export function bindScrub(el: Element, rootSel: string | null, d: Pick<ScrollDriver, 'pause' | 'seekFraction'>): () => void {
  const f = () => { d.pause(); d.seekFraction(scrubFraction(el, rootSel)); };
  addEventListener('scroll', f, { passive: true });
  addEventListener('resize', f);
  f();
  return () => { removeEventListener('scroll', f); removeEventListener('resize', f); };
}

/** play="enter|scrub" modes of a player; returns cleanup. manual = no-op. `reduced` (prefers-reduced-motion): bind nothing, the player sits at its still frame. */
export function bindPlayMode(p: ExplainerPlayer, reduced = false): () => void {
  const mode = p.getAttribute('play');
  if (reduced) return () => {};
  if (mode === 'enter') {
    return bindEnter(p, { forward: () => { p.setRate(1); p.play(); }, reverse: () => { p.setRate(-1); p.play(); }, pause: () => p.pause() });
  }
  if (mode === 'scrub') {
    // scrub-root: progress through that element instead (sticky player inside a tall article)
    return bindScrub(p, p.getAttribute('scrub-root'), { pause: () => p.pause(), seekFraction: (f) => p.seek(f * p.clock.length) });
  }
  return () => {};
}
