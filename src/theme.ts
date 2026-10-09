/**
 * The theme contract: the single source of truth for every themeable value in core rendering code.
 *
 * Each token is a CSS `var(--explainer-<name>,<default>)` string, ready to drop into an inline style. The player
 * uses light DOM, so a site themes it with CSS custom properties on the player or any ancestor (see README "Theme").
 * The defaults are the look the player had before the contract existed. Core code (`src/components/`, `src/player.ts`,
 * `src/path-view.ts`) holds no colour, font-family, font-size, font-weight or line-height literal: it uses these.
 * `test/theme-tokens.test.ts` enforces that. Motion tokens are code, not CSS: see `src/motion.ts`.
 *
 * Domain packs may use the tokens too. `TOKENS` at the bottom maps each constant's name to its `var(...)` string,
 * for docs and tooling.
 */

const t = (name: string, dflt: string) => `var(--explainer-${name},${dflt})`;

// ---- Colour roles ----

/** Text and line colour on paper. */
export const INK = t('ink', '#111');
/** The page/stage background. `--explainer-bg` is the older name and still works as a fallback. */
export const PAPER = 'var(--explainer-paper,var(--explainer-bg,#fff))';
/** Emphasis: the active item, the byline, button borders. */
export const ACCENT = t('accent', '#06c');
/** Highlighter colour for marking up text (new; no core component draws it yet). */
export const HIGHLIGHT = t('highlight', '#f2ff36');
/** Secondary text on paper. */
export const MUTED = t('muted', '#666');
/** Hairlines and rules on paper. */
export const LINE = t('line', '#ddd');
/** Background of a card laid over a picture (lower third, side panel): translucent dark by default. */
export const CARD = t('card', 'rgba(12,14,22,.7)');
/** Text on `CARD`. */
export const CARD_INK = t('card-ink', '#fff');
/** Backdrop of a choice held over footage. */
export const SCRIM = t('scrim', 'rgba(8,10,18,.72)');
/** Text on `SCRIM`. */
export const SCRIM_INK = t('scrim-ink', '#fff');
/** Button face on `SCRIM` (buttons on paper use `PAPER`/`INK`). */
export const BUTTON = t('button', 'rgba(255,255,255,.94)');
/** Text on `BUTTON`. */
export const BUTTON_INK = t('button-ink', '#111');
/** Caption strip text. Falls back to `--explainer-ink`, then white (captions default to light on dark). */
export const CAPTION_INK = 'var(--explainer-caption-ink,var(--explainer-ink,#fff))';
/** Caption strip background. Falls back to the paper chain, then black. */
export const CAPTION_PAPER = 'var(--explainer-caption-paper,var(--explainer-paper,var(--explainer-bg,#000)))';
/** The caption strip when it sits over the picture: `CAPTION_PAPER` at 80%. */
export const CAPTION_OVER = `color-mix(in srgb,${CAPTION_PAPER} 80%,transparent)`;
/** Path view text. Own override `--explainer-path-ink`, then ink, then the inherited colour. */
export const PATH_INK = 'var(--explainer-path-ink,var(--explainer-ink,inherit))';
/** Path view emphasis: accent, else the current text colour. */
export const PATH_ACCENT = 'var(--explainer-accent,currentColor)';

// ---- Type ----

/** Body family. */
export const FONT_FAMILY = t('font', 'system-ui,sans-serif');
/** Monospace family (new; no core component uses it yet). */
export const FONT_MONO = t('font-mono', 'ui-monospace,monospace');
/** Path view family: the theme font, else inherited. */
export const PATH_FONT = 'var(--explainer-font,inherit)';

/** Stage-relative sizes (container query units: the stage is a size container, so these scale with it). */
export const SIZE_CARD_TITLE = t('size-card-title', '10cqw');
export const SIZE_CARD_SUB = t('size-card-sub', '7cqw');
export const SIZE_CARD_NOTE = t('size-card-note', '6cqw');
export const SIZE_PANEL_HEADING = t('size-panel-heading', '9cqw');
export const SIZE_PANEL_ITEM = t('size-panel-item', '7.5cqw');
/** Caption strip over the picture: scales with the stage between two rem bounds. */
export const SIZE_CAPTION_OVER = t('size-caption-over', 'clamp(.8rem,2.1cqw + .3rem,1.4rem)');

/** Fixed (rem/em) sizes, for full-stage and in-flow text. */
export const SIZE_TITLE = t('size-title', '2.6rem');
/** Intro minimal title and choice prompt. */
export const SIZE_HEADING = t('size-heading', '1.6rem');
export const SIZE_SECTION = t('size-section', '1.8rem');
export const SIZE_SUBTITLE = t('size-subtitle', '1.2rem');
export const SIZE_ITEM = t('size-item', '1.3rem');
export const SIZE_BYLINE = t('size-byline', '.9rem');
export const SIZE_CAPTION = t('size-caption', '1rem');
export const SIZE_PATH = t('size-path', '.9em');

export const WEIGHT_STRONG = t('weight-strong', '700');
export const WEIGHT_LABEL = t('weight-label', '600');

export const LEADING_TITLE = t('leading-title', '1.15');
export const LEADING_SUB = t('leading-sub', '1.3');
export const LEADING_CAPTION = t('leading-caption', '1.35');
export const LEADING_PATH = t('leading-path', '1.5');

// ---- Stage ----

/** Safe-area inset from the stage edge. */
export const SAFE = t('safe', '2.5%');
/** Width of the side panel column (kept clear of a centred face: x 27-70%). */
export const SIDE_WIDTH = t('side-width', '27%');
/** Width of the lower-third card. */
export const LOWER_WIDTH = t('lower-width', '28%');

/** Every token above, by constant name, for docs and tooling. */
export const TOKENS: Record<string, string> = Object.fromEntries(
  Object.entries({
    INK, PAPER, ACCENT, HIGHLIGHT, MUTED, LINE, CARD, CARD_INK, SCRIM, SCRIM_INK, BUTTON, BUTTON_INK,
    CAPTION_INK, CAPTION_PAPER, PATH_INK, PATH_ACCENT, FONT_FAMILY, FONT_MONO, PATH_FONT,
    SIZE_CARD_TITLE, SIZE_CARD_SUB, SIZE_CARD_NOTE, SIZE_PANEL_HEADING, SIZE_PANEL_ITEM, SIZE_CAPTION_OVER,
    SIZE_TITLE, SIZE_HEADING, SIZE_SECTION, SIZE_SUBTITLE, SIZE_ITEM, SIZE_BYLINE, SIZE_CAPTION, SIZE_PATH,
    WEIGHT_STRONG, WEIGHT_LABEL, LEADING_TITLE, LEADING_SUB, LEADING_CAPTION, LEADING_PATH,
    SAFE, SIDE_WIDTH, LOWER_WIDTH,
  }),
);
