# CLAUDE.md: explainer

This file gives project context for agents working in this repo. Read it before starting work.

## What this is
`<explainer-player>` layers recorded video, audio or pure animation with site-styled text and animated diagrams on **one reversible, rate-safe timeline**. The data for each explainer is held in SRS. The first consumer is mudemocracy.org: explainer videos of roughly 5 minutes for the decision-making guides. The same player is meant for other concepts and sites too.

**Status**
- Issue: the-greenman/semanticops.com#30. Its Answers line is "No affirmed problem yet".
- Repo: the-greenman/explainer, **private** for now.
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
  - Do not touch muDemocracy.org or muSrs until a separate move-over issue.
  - Examples live in `examples/`.

## Decisions after approval
- **Domain packs:** the core pack is `src/components/`. Domain packs (`examples/*`) import the contract and call `registerComponents`.
- **Canvas components** use `canvasComponent` from `src/components/canvas.ts`. Sizing is never hand-rolled per pack.
- **One canvas component per family**, with the scene id as cue data, is fine when scenes share layers (equilibrium `wheel-scene`).
- **One media file per explainer where possible**, with segments as `in`/`out` cuts of it. Separate files still freeze about 300 ms at the boundary; crossing a cut inside one file is seamless (the player skips the re-seek when already at the cut). R2 has no 25 MB per-file limit (that is a Pages/Workers static-asset limit), so the budget is bandwidth: about 2.4 Mbit/s at the current encode, about 90 MB per 5 minutes. A delay after a choice jump (a seek of about 250-320 ms) is accepted.
- **History is the path taken.** History always equals the route from the start to where you are. Default continuation and choices push entries (`{segmentId, t, to, hold?}`); navigation (`jumpTo` and `seek`: markers, prev/next, scroll sections, the `jump` command, scrub) cuts history back when the target is on an earlier span of the route (most recent wins, even before a choice), pushes the default-continuation hops when the target is further along, and leaves history alone only for a branch-only target (`routeSpans` in `clock.ts`, shared with the path view). Reverse unwinds a branch when it crosses where it landed (else, past the segment start, goes to the default predecessor's end, else stops at 0). `back()` pops and, for a choice, re-shows it held.
- **Default path (playthrough).** A choice option can be `default: true` (a field on `choice-option`, to settle before the SRS types). With `playthrough` on (player attribute, `playthrough` command, button), a hold takes its default instead of holding and records it in history like a real choice, marked `auto: true` (the path view shows "(default)"). A choice with no default just continues. The choice overlay is not displayed at all in playthrough. Defaults that loop back loop until stopped: no loop guard, history grows per lap.
- **The capability probes are learning exercises**, not faithful recreations. Record findings rather than polishing.
- **Rendering is offline and frame-stepped,** never recorded in real time: the plan steps the pure clock, chromium paints each `{segment, t}`. **Overlay-only (ProRes 4444 alpha + `cuts.json` + `captions.vtt`) is a first-class output**, not a by-product of the composite.

## Layout
- `src/clock.ts` is the pure clock logic (no DOM). `src/player.ts` is the custom element. `src/triggers.ts` holds buttons, scroll sections and the `play="enter|scrub"` modes. `src/store.ts` holds the variables. `src/path.ts` is the pure path-taken steps (history to spans/choices) and `src/path-view.ts` is `<explainer-path>` (crumbs/tree).
- `src/render-plan.ts` is the pure render plan (frames and source cuts by stepping a `Clock`; captions retiming). `scripts/render.mjs` is the offline renderer CLI; `examples/render/` is its page. See README "Rendering".
- `src/components/` holds the core pack (intro, numbered-list, choice) plus `base.ts` (contract and registry) and `canvas.ts`.
- `schema/explainer.schema.json` is the manifest contract.
- `demo/` is the gallery.
  - `demo/media/` and `demo/video/` are **git-ignored** and hold local clips.
- `examples/creation/` is the the-system-networks scroll steps. `examples/equilibrium/` is the equilibrium.cards opening hero. `examples/video/` is two talking-head clips with overlays, captions and a held choice: the reference for real media. `examples/tarot/` is an audio-only narrated story (chapter cuts of one m4a, card images and diagrams as the picture, the caption strip). Each has its own README with findings.
- `examples/video/prepare.sh` makes the media working copies in `demo/video/` (0.5 s keyframes, faststart, VTT from the embedded subtitles). Run it on a fresh checkout. `examples/video/check.mjs` measures the media sync paths in headless Chromium.
- `examples/tarot/prepare.sh` makes the audio, VTT and card images in `demo/media/tarot/` (git-ignored; takes the card dir as an argument). `examples/tarot/build-manifest.mjs` generates `manifest.json` from the SRT; `check.mjs` measures audio sync, cuts, the caption strip, the spread and the overlay.

## Commands and gates
- `npm run dev`, then open /demo/, /examples/creation/, /examples/equilibrium/, /examples/video/ or /examples/tarot/.
- Gates, judged by exit code: `npm test` (node --test over test/ and examples/), `npx tsc --noEmit`, `npm run build`.
- Headless browser checks use the playwright install at `/home/greenman/dev/semanticops/srs-web/node_modules/playwright/index.mjs` (chromium is installed). Serve with `npx vite --port 5199 --strictPort` from the repo root.

## Process (owner rules)
- **Commits are SSH-signed**: check `ssh-add -l | grep -q "SHA256:vHuO6si5w3RLL4IJZofWbyvEi42WA2fYX7bM"`, and never use `--no-gpg-sign`.
- **Message format:** subject, blank line, body, blank line, `Co-Authored-By:` trailer.
- **Review before PR.** Agents push branches only; the diff is reviewed, then the PR is opened.
- **Merging:** reviewed, green, technical PRs may be auto-merged unless the owner needs to weigh in.
- **Session role:** the session orchestrates, and Sonnet subagents do the unit work. Give each one a precise brief and review its output; never trust its report alone. The gallery 404 and the click-swallowing layer bug were both missed in agent reports.

## Current state
- **Done:** plan step 2. That covers the clock, player, triggers, store, core components and gallery, plus the two capability probes, with their core fixes. Everything is on `main`.
- **Real media:** video is verified with real clips in `examples/video/`: forward, rate, reverse, scrub, segment switch, and hold with `loop_from`. Audio-only segments are verified with a real file in `examples/tarot/` (same measurements, plus the caption strip and the offline render). Safari, Firefox, phones and R2 delivery are also untested.

## Next steps
1. **SRS package (plan step 3).**
   - `srs/` holds the `com.semanticops.explainer` types: segment, marker, component types, choice/choice-option, variable, and the `goes-to` relation type.
   - Add specimen records and a generic `scripts/export.mjs` (srs CLI → manifest), then replace the placeholder `renders` refs.
   - Write only through the srs CLI or MCP and validate after each batch. No CLI or MCP command writes `packageDependencies` yet (srs-rust#1168).
2. **muDemocracy pilot** in `examples/mudemocracy/`, then the move-over issue.
3. **Open gaps** are in `docs/findings.md`. Add them when the pilot needs them.
