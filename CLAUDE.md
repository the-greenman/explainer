# CLAUDE.md: explainer

This file gives project context for agents working in this repo. Read it before starting work.

## What this is
`<explainer-player>` layers recorded video, audio or pure animation with site-styled text and animated diagrams on **one reversible, rate-safe timeline**. The data for each explainer is held in SRS. The first consumer is mudemocracy.org: explainer videos of roughly 5 minutes for the decision-making guides. The same player is meant for other concepts and sites too.

**Status**
- Issue: the-greenman/semanticops.com#30. Its Answers line is "No affirmed problem yet".
- Repo: the-greenman/explainer, **public**, MIT. The private workshop (old PRs #1–#15, private examples) is the-greenman/explainer-workshop.
- Default branch: `main`.
- Approved plan: `docs/plan.md`.
- Capability findings: `docs/findings.md`.
- Usage reference: `README.md`.

## Design rules (from the plan, owner-approved)
- **One clock.**
  - Layers are *positioned* every frame and never played on their own.
  - Playing forward with media, the media drives the clock.
  - In reverse, scrub, or with no media, the clock drives and writes `media.currentTime`, because browsers refuse a negative `playbackRate`.
  - Segment kinds `video | audio | none` are all handled the same way.
- **Components must be pure.**
  - `render(node, p, data, vars, items, dur)` depends only on its arguments.
  - There are no enter/exit hooks and no state across calls. No `Math.random` (use `rng(seed)`), no `Date.now`, no `time += dt`.
  - `test/purity.test.ts` and `examples/*/*.test.ts` enforce this.
- **Components are code, and their data shape is an SRS Type.**
  - Each component is one SRS Type plus one code module, joined by `meta.renders = "<typeId>@<version>"`.
  - Visual detail lives in code as named `variant`s, never as free-form parameters in records.
  - Records hold only timing, content and the variant.
  - The `renders` refs are placeholders until step 3.
- **The timeline is a graph.**
  - Segments are joined by default continuation, `next`/`goes-to`, choices (`hold`), and a history stack for reverse and `back()`.
- **Page scope.**
  - A page holds many players, each with its own clock.
  - They share a variable store (`<explainer-scope>`, `data-explainer-var`, `{name}`, `when_var`).
- **SRS package `com.semanticops.explainer`** goes in `srs/` in this repo. The namespace is semanticops, not mudemocracy: that was an owner correction.
- **Media is hosted on Cloudflare R2** as progressive MP4/M4A, not HLS. Records hold URLs, never binaries.
- **Dogfood here first.**
  - This repo is the brand-neutral engine. Brand packs live in their sites (see "Engine and site packs" below).
  - Examples live in `examples/`.

## Decisions after approval
- **Domain packs:** the core pack is `src/components/`. Domain packs (`examples/*`) import the contract and call `registerComponents`.
- **Canvas components** use `canvasComponent` from `src/components/canvas.ts`. Sizing is never hand-rolled per pack.
- **One canvas component per family**, with the scene id as cue data, is fine when scenes share layers (e.g. a wheel scene whose layers persist).
- **One media file per explainer where possible**, with segments as `in`/`out` cuts of it. Separate files still freeze about 300 ms at the boundary; crossing a cut inside one file is seamless (the player skips the re-seek when already at the cut). R2 has no 25 MB per-file limit (that is a Pages/Workers static-asset limit), so the budget is bandwidth: about 2.4 Mbit/s at the current encode, about 90 MB per 5 minutes. A delay after a choice jump (a seek of about 250-320 ms) is accepted.
- **History is the path taken.** History always equals the route from the start to where you are. Default continuation and choices push entries (`{segmentId, t, to, hold?}`); navigation (`jumpTo` and `seek`: markers, prev/next, scroll sections, the `jump` command, scrub) cuts history back when the target is on an earlier span of the route (most recent wins, even before a choice), pushes the default-continuation hops when the target is further along, and leaves history alone only for a branch-only target (`routeSpans` in `clock.ts`, shared with the path view). Reverse unwinds a branch when it crosses where it landed (else, past the segment start, goes to the default predecessor's end, else stops at 0). `back()` pops and, for a choice, re-shows it held.
- **Default path (playthrough).** A choice option can be `default: true` (a field on `choice-option`, to settle before the SRS types). With `playthrough` on (player attribute, `playthrough` command, button), a hold takes its default instead of holding and records it in history like a real choice, marked `auto: true` (the path view shows "(default)"). A choice with no default just continues. The choice overlay is not displayed at all in playthrough. Defaults that loop back loop until stopped: no loop guard, history grows per lap.
- **Engine and site packs** (owner, 2026-10-09). This repo is the engine and stays brand-neutral: clock, player, triggers, store, path view, the component contract, neutral mechanisms themed only by tokens, and the tooling (styleguide harness, review frames, offline render). Everything that only makes sense in one brand lives in that site's repo as a domain pack. For muDemocracy that means `muDemocracy.org/src/motion/`: the theme (mapping `tokens.css` onto `--explainer-*` directly, so nothing is copied), brand elements such as the logo, decision-record card and debate cycle, and explainer manifests. Brand elements are not only for video: they run in pages too. The site depends on this repo by git tag (`github:the-greenman/explainer#vX.Y.Z`). The test for which side a component belongs on: a mechanism a theme can dress goes here; a thing that only makes sense in one brand's look goes in the site.
- **The capability probes are learning exercises**, not faithful recreations. Record findings rather than polishing.
- **Rendering is offline and frame-stepped,** never recorded in real time: the plan steps the pure clock, chromium paints each `{segment, t}`. **Overlay-only (ProRes 4444 alpha + `cuts.json` + `captions.vtt`) is a first-class output**, not a by-product of the composite.

## Layout
- `src/clock.ts` is the pure clock logic (no DOM). `src/player.ts` is the custom element. `src/triggers.ts` holds buttons, scroll sections and the `play="enter|scrub"` modes. `src/store.ts` holds the variables. `src/motion-element.ts` is `<explainer-motion>` (one component anywhere, own clock, `enter|scrub|hover|manual`); it shares `bindEnter`/`bindScrub` with the player. `src/path.ts` is the pure path-taken steps (history to spans/choices) and `src/path-view.ts` is `<explainer-path>` (crumbs/tree).
- `src/render-plan.ts` is the pure render plan (frames and source cuts by stepping a `Clock`; captions retiming). `scripts/render.mjs` is the offline renderer CLI; `examples/render/` is its page. See README "Rendering".
- `src/components/` holds the core pack (intro, numbered-list, choice) plus `base.ts` (contract and registry) and `canvas.ts`.
- `src/styleguide.ts` is the styleguide harness (package export `explainer/styleguide`); `examples/styleguide/` is this repo's thin host page (fixtures, neutral `paper.css` sample theme, `frames.mjs` review frames). See README "Styleguide".
- `schema/explainer.schema.json` is the manifest contract.
- `demo/` is the gallery.
  - `demo/media/` and `demo/video/` are **git-ignored** and hold local clips.
- `examples/video/` is two talking-head clips with overlays, captions and a held choice: the reference for real media. It has its own README with findings.
- **Private examples live in the-greenman/explainer-workshop**, not here: `creation` (the-system-networks scroll steps), `equilibrium` (equilibrium.cards hero) and `tarot` (the owner's audio-only narrated story). They adapt code from private repos or hold the owner's narration, so they never come into this public repo. A test that needs their shape uses a synthetic manifest.
- `examples/video/prepare.sh` makes the media working copies in `demo/video/` (0.5 s keyframes, faststart, VTT from the embedded subtitles). Run it on a fresh checkout. `examples/video/check.mjs` measures the media sync paths in headless Chromium.

## Commands and gates
- `npm run dev`, then open /demo/ or /examples/video/.
- Gates, judged by exit code: `npm test` (node --test over test/ and examples/), `npx tsc --noEmit`, `npm run build`.
- Headless browser checks use the playwright install at `/home/greenman/dev/semanticops/srs-web/node_modules/playwright/index.mjs` (chromium is installed). Serve with `npx vite --port 5199 --strictPort` from the repo root.

## Process (owner rules)
- **Commits are SSH-signed**: check `ssh-add -l | grep -q "SHA256:vHuO6si5w3RLL4IJZofWbyvEi42WA2fYX7bM"`, and never use `--no-gpg-sign`.
- **Message format:** subject, blank line, body, blank line, `Co-Authored-By:` trailer.
- **Review before PR.** Agents push branches only; the diff is reviewed, then the PR is opened.
- **Merging:** reviewed, green, technical PRs may be auto-merged unless the owner needs to weigh in.
- **Session role:** the session orchestrates, and Sonnet subagents do the unit work. Give each one a precise brief and review its output; never trust its report alone. The gallery 404 and the click-swallowing layer bug were both missed in agent reports.

## Current state
- **Released v0.3.0** (2026-10-09), after v0.2.0 the same day: theme and component contracts, `<explainer-motion>`, the styleguide harness, scenes (site markup revealed by motion), the design canvas, the poster still, media slots, over layers and the control API. See `CHANGELOG.md`.
- **Plan revised** (owner, 2026-10-09; muDemocracy.org#309): an explainer is the page, performed. Scenes are the site's own markup and CSS, revealed by choreography (`data-at`/`data-for`/`data-fx`, `--fx-p`); the video's size and position follow `data-media-slot` boxes. The engine never builds or restyles brand markup.
- **First playable page:** `/decision-recording` in muDemocracy.org (branch `feat/328-decision-recording-page`), with the owner's two recorded clips choreographed across 1:27.
- **Real media:** video is verified with real clips, in `examples/video/` and on the site page. Audio-only is verified in the workshop's `tarot` example. Safari, Firefox, phones and R2 delivery are untested.

## Next steps
1. **muDemocracy pilot: guide 1.1.** Tracking is in **the-greenman/muDemocracy.org#309** and its sub-issues; PRs here reference those (`Refs the-greenman/muDemocracy.org#N`).
   - Live (unlisted) at https://mudemocracy.org/decision-recording; media on R2 `media.mudemocracy.org` (bucket `mudemocracy-video`, versioned paths). v0.3.0 adds the caption strip for video and slot-aware offline renders.
   - The owner's script and scene list (#315) decide the remaining scenes.
2. **SRS package (plan step 3, #318)**, after the pilot's scene and manifest shapes settle.
   - `srs/` holds the `com.semanticops.explainer` types: segment, marker, cue (scene, layer), choice/choice-option, variable, and the `goes-to` relation type.
   - Add specimen records and a generic `scripts/export.mjs` (srs CLI → manifest), then replace the placeholder `renders` refs.
   - Write only through the srs CLI or MCP and validate after each batch. No CLI or MCP command writes `packageDependencies` yet (srs-rust#1168).
3. **Open gaps** are in `docs/findings.md`. Add them when the pilot needs them.
