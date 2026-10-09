# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Releases are git tags `vX.Y.Z` on `main` (see README, "Releases"); nothing has been tagged yet.

## [Unreleased]

### Added
- Scenes: the page, performed. `com.semanticops.explainer/scene@1` (core pack) clones a site's own `<template data-scene="<id>">` (inside the player first, then the document) and reveals it by choreography: `data-at`, `data-for` (default 0.5 s), `data-fx` set the inline `--fx-p` on each element, and the built-ins `fade`, `rise`, `write`, `wipe`, `none` set properties from it; any other name sets only `--fx-p` for the site's CSS. `transition` `in`/`out` `cut|fade` with `dur` (default 0.4 s). Its still is the p where all choreography is complete. Outside a player nothing sets `--fx-p`, so the markup is the complete static page. Example `examples/scenes/` and a gallery link. (the-greenman/muDemocracy.org#327)
- Player `canvas="1280x720 720x900@<600"`: a W×H CSS px design canvas scaled to the stage width, chosen by player width and re-chosen on resize; `data-canvas` and `container-type: size` on it; `parseCanvas`/`chooseCanvas` (`src/design-canvas.ts`). Without the attribute the stage is unchanged. (the-greenman/muDemocracy.org#327)
- Player `poster="still"` (first paint at the first segment's still time until the first play, seek or jump), static-first light-DOM children (kept, hidden after the first paint), and an inline `<script type="application/json" data-manifest>`. (the-greenman/muDemocracy.org#327)
- `scripts/render.mjs`: `--canvas WxH`, `--scenes file.html` (templates for the render page) and `--page <url> [--selector css]` to render a player on a real page with its own CSS. (the-greenman/muDemocracy.org#327)
- `<explainer-motion>`: mounts one registered component anywhere in a page, with no stage or manifest, on its own clock. Modes `enter`, `scrub`, `hover`, `manual`. Shows the component's still under `prefers-reduced-motion` and in print. Keeps server-rendered children until it mounts. A pack imported after the element upgrades still mounts it (`onRegister`). Warns once if a component does not declare the `web` surface. Gallery section and a neutral demo pack (`demo/pack.ts`). (the-greenman/muDemocracy.org#324)
- `prepare` script (`vite build`) so the package can be installed from a git tag, branch or commit: `npm i github:the-greenman/explainer#vX.Y.Z`. (the-greenman/muDemocracy.org#323)
- Component contract: required `meta.surfaces` (`web`, `video`), `meta.still` (the progress p of a component's complete static frame), `stillP()`, `stillTime()` (`src/still.ts`), and `test/still.test.ts`. Print and `prefers-reduced-motion` show the still frame in the player. (PR #2)
- Theme contract: `src/theme.ts` (one `var(--explainer-*, default)` constant per themeable value) and `src/motion.ts` (named easing curves and motion constants); `test/theme-tokens.test.ts` forbids colour, font and size literals in core. (PR #1)
- Public engine under the MIT licence.
- Embedding: library build (`dist/index.js`), `crossorigin` on the player, manifest options, caption strip below the stage (`captions="below"`).
- Offline render: frame-exact overlay layer (ProRes 4444 alpha, `cuts.json`, `captions.vtt`) and composite video (`scripts/render.mjs`, `src/render-plan.ts`).
- Default path: `playthrough` mode plays an explainer like a video by taking each choice's default.
- Path view: `<explainer-path>` breadcrumbs and tree of the branches taken.
- Audio-only segments with a caption strip; reverse across a cut inside one media file.
- Player core: one reversible, rate-safe clock; `<explainer-player>`; triggers (buttons, scroll sections, `play="enter|scrub"`); page-scope variable store; core components (intro, numbered-list, choice); canvas components; gallery; manifest schema; video example.

### Changed
- The player's `enter` and `scrub` mode logic moved to shared `bindEnter`, `bindScrub` and `scrubFraction` in `src/triggers.ts`, used by both the player and `<explainer-motion>`. Behaviour of the player is unchanged. Delegated `data-explainer-action` buttons and `explainer:command` events can also target an `<explainer-motion>`.
- One media file per explainer where possible, with segments as `in`/`out` cuts; history is the path taken (navigation cuts it back, branches push).
- The repository is the brand-neutral engine: brand packs, themes and the private examples live with their sites or in the private workshop.

- The player no longer removes its light-DOM children when it initialises: only the stage and caption strip it made. (Needed so templates, poster markup and the inline manifest survive.)

### Fixed
- Reverse across a media cut inside one file.
