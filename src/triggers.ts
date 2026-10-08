import { clamp01 } from './clock.ts';
import type { Command, ExplainerPlayer } from './player.ts';

const target = (sel?: string | null) =>
  (sel ? [...document.querySelectorAll(sel)] : [document.querySelector('explainer-player')]).filter(
    (e): e is ExplainerPlayer => e?.localName === 'explainer-player',
  );

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
  // commands dispatched on a player are handled by it; those on the document go to detail.target or the first player
  document.addEventListener('explainer:command', (e) => {
    if ((e.target as Element).closest?.('explainer-player')) return;
    const d = (e as CustomEvent<Command & { target?: string }>).detail;
    target(d.target).forEach((p) => p.command(d));
  });
  // ponytail: sections present at init only, no MutationObserver
  const io = new IntersectionObserver(
    (es) => es.forEach((en) => {
      const el = en.target as HTMLElement;
      if (en.isIntersecting) target(el.dataset.explainerTarget).forEach((p) => p.jumpTo(el.dataset.explainerSeek!));
    }),
    { rootMargin: '-45% 0px -45% 0px' }, // fires as a section crosses mid-viewport, scrolling either way
  );
  document.querySelectorAll('[data-explainer-seek]').forEach((el) => io.observe(el));
}

/** play="enter|scrub" modes of a player; returns cleanup. manual = no-op. */
export function bindPlayMode(p: ExplainerPlayer): () => void {
  const mode = p.getAttribute('play');
  if (mode === 'enter') {
    let seen = false;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { seen = true; p.setRate(1); p.play(); }
      else if (seen && e.boundingClientRect.top > 0) { p.setRate(-1); p.play(); } // scrolled back up past it: rewind
      else p.pause();
    }, { threshold: 0.4 });
    io.observe(p);
    return () => io.disconnect();
  }
  if (mode === 'scrub') {
    const f = () => {
      // scrub-root: progress through that element instead (sticky player inside a tall article)
      const root = p.getAttribute('scrub-root');
      const rr = root && document.querySelector(root)?.getBoundingClientRect();
      const r = p.getBoundingClientRect();
      p.pause();
      p.seek(clamp01(rr ? -rr.top / (rr.height - innerHeight || 1) : (innerHeight - r.top) / (innerHeight + r.height)) * p.clock.length);
    };
    addEventListener('scroll', f, { passive: true });
    addEventListener('resize', f);
    f();
    return () => { removeEventListener('scroll', f); removeEventListener('resize', f); };
  }
  return () => {};
}
