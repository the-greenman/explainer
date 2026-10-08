# Plan (approved 2026-10-08)

> Approved plan for the-greenman/semanticops.com#30, copied verbatim from the planning session. Status and progress live in `CLAUDE.md`; this file records the design as approved. Later decisions: see "Decisions after approval" in `CLAUDE.md`.


## Context
mudemocracy.org needs roughly 5-minute explainer videos for the guides (decision steps, boundaries, and so on): recorded talking-head video with overlay text and diagrams that match the site. The same mechanism should serve other concepts and sites later.

**Requirements**
- Layers are linked on a timeline.
- Playback is reversible (scrubbing backwards) and works at any speed, with every layer staying in sync.
- A package can contain several segments, played in sequence or jumped to.
- Triggers can come from scroll, buttons, or arbitrary external events.
- Elements come from a reusable library.
- Data is held in SRS.

**What exists today**
- the-system-networks (`src/lib/creation/js/animator.js`, `steps/base.js`) and equilibrium_cards (`src/lib/viz/runner.js`) both draw by *pure-ish functions of progress/time* (`update(dt, progress)`, `draw(ctx, elapsed, state)`).
- Neither has one shared clock. Their reversal is partial, there is no playback rate, there is no media, and nothing is SRS-driven.
- muDemocracy guides are SRS (`muSrs/package/types/guide-*.json`). They are exported by `scripts/export-srs-guides.mjs` and `projection-to-guide.mjs`, then rendered by `src/components/guide/GuideRenderer.astro`.
- The SRS spec can attach media (RFC-017 `attaches` plus a sidecar) but has **no time-range convention** on records.

**Standards conclusion.** No single standard covers this. We borrow the model from several and use the browser for the runtime:

| Need | Borrowed from |
|---|---|
| Time references | W3C Media Fragments (`t=start,end`) |
| Overlays as targeted annotations | W3C Web Annotation (body = element, target = segment + time range) |
| Sequence of clips | OpenTimelineIO / SMIL `seq` |
| Event-triggered jumps | SMIL `begin=event` |
| Captions and chapters (generated, never the source) | WebVTT |

Rejected: GSAP (licence clause, extra dependency), Lottie (theming), H5P/IIIF viewers (wrong shape), TTML, MSE.

**Decisions (owner, 2026-10-08)**
- A new standalone package.
- Pure-function elements with no animation library.
- An SRS package compiled to JSON.
- Pilot: one muDemocracy guide video.

## Core design rule: one clock, layers are *positioned*, never *played*
The player owns a virtual clock `{segmentId, t, rate, playing}`, with `t` in seconds within the current segment (see Interactivity).

- **Forward at `rate > 0`:** the `<video>` plays natively at `playbackRate = rate`, and the clock *reads* `video.currentTime` via `requestVideoFrameCallback`.
- **Reverse, scrub, or scroll-driven:** the video is paused. The clock advances `t` itself with `requestAnimationFrame`, and *writes* `video.currentTime`. This is needed because browsers refuse negative `playbackRate`.
- **Every frame:** for each cue, `p = clamp01((t - cue.start) / (cue.end - cue.start))`, then `element.render(node, p, params)`. Hide the node when `t` is outside the cue's range.

No layer has its own time source, so reversing and rate changes cannot drift.

## Media: video, audio, or none, all handled one way
**A segment has one optional media source.** Its `kind` is `video`, `audio` or `none`.

`<video>` and `<audio>` share the HTMLMediaElement API (`currentTime`, `playbackRate`, `preservesPitch`), so the clock treats them identically. The only differences:
- **`video`:** the media sits under the overlay. The clock reads time via `requestVideoFrameCallback`, which gives frame accuracy.
- **`audio`:** the overlay fills the stage, making a narrated diagram. The clock reads `audio.currentTime` on each `requestAnimationFrame`.
- **`none`:** a pure animation segment with a fixed `duration`. The clock drives itself, which also covers the segments ported from the-system-networks and equilibrium_cards.

The same holds for every kind:
- Reverse and scrub always mute and pause the media. Audio can't meaningfully play backwards, so overlays reverse silently and sound resumes on forward play.
- Rate changes keep pitch (`preservesPitch`, on by default).

**Where media lives**
- **Cloudflare R2** (`media.mudemocracy.org`, or a shared SemanticOps bucket), served as plain progressive files, never in git.
  - Video is MP4 (H.264), encoded with short keyframe intervals so backward seeking stays responsive: `ffmpeg -g 15 -keyint_min 15 -movflags +faststart`. Offer two renditions, 720p and 1080p.
  - Audio is AAC/M4A, or Opus.
  - Masters are kept in a separate R2 prefix.
- **Not Cloudflare Stream/HLS.** Adaptive streaming needs hls.js in non-Safari browsers and seeks backwards poorly. It's worth revisiting only if bandwidth on mobile becomes a problem.
- **Records hold the URL** (`media_url`) plus `kind`. Large media is not attached via RFC-017: the `.srs` archive would carry gigabytes. A small sidecar-only reference (title, description, contentType) is fine if provenance matters.
- **Captions** are WebVTT files next to the media in R2. They work for audio too: the player renders cues from the TextTrack into a caption strip, since `<audio>` has no native caption display.

Deferred: several simultaneous media tracks per segment (for example a separate music bed). Add that when a script needs it.

## Interactivity: a timeline is a graph of segments
**Position.** A package is a graph: segments are the nodes, and the default path plus choices are the edges. The clock's position is therefore `{segmentId, t}`, not one global time. The player keeps a **history stack** of visited segments, which serves "return" and reverse.

**Edges**
- **Default continuation:** the next segment in the explainer outline, unless the segment has a `com.semanticops.explainer/goes-to` relation to another segment or marker. That relation type is installed in the package.
- **Ending:** a segment's `ends` field (`continue|stop`) can end playback.
- **Branch-only segments** sit in the outline but are reached only through a choice. Their own `goes-to` rejoins the main path.

**Choice**
- **`choice` is a core component.** Its record holds the `prompt` and `hold` (boolean). Its options are child `choice-option` records, each with a `label` and a `goes-to` relation to the target segment or marker.
- **Holding.** When `t` reaches the end of a cue with `hold: true`, the clock pauses there. The talking head can sit on a held last frame, or loop a short idle range named by `loop_from_seconds`. The options stay shown until something chooses.
- **Choosing.** Any input can pick an option:
  - Clicking an option. The component renders real `<button>`s, which keeps keyboard and screen-reader access.
  - Keys 1–n.
  - External: `explainer:command {action: "choose", option}` or `{action: "jumpTo", to}`, from a page button, a scroll section, or any other source.
- **Effect of a choice:** it pushes the current position onto the history stack and jumps to the target.

**Reverse and return**
- Reversing past the start of a segment returns to the previous entry in the history, at that entry's exit time, not to the previous segment in the outline. `back()` does the same as a discrete step.
- A choice is history, not component state. Scrubbing back over a choice simply shows it again, so the purity rule still holds.

**Outbound events.** The player emits `explainer:segment`, `explainer:cueenter`, `explainer:cueexit` and `explainer:choice`. The host page can then sync anything else to them, such as highlighting the matching guide section or analytics later.

**Scrub bar.** It shows the current segment, with a breadcrumb of the visited path.

## Page scope: many players, shared variables
**Separate clocks, shared state.** A long page holds many `<explainer-player>`s, one per in-place animation. Each one keeps its own clock, so they are separate animations.

**Play modes.** How a player is driven on a page is a host-page attribute, not data. Each mode is only a clock input:
- `play="enter"` plays forward when the player scrolls into view and reverses when you scroll back above it.
- `play="scrub"` maps the player's position through the viewport to `t`, like a CSS ViewTimeline but computed in JS so it works in Firefox too.
- `play="manual"` responds to buttons and commands only.

**What links the players.** The players are connected through a **page-scoped variable store**:
- **Store.** A tiny observable map (`get`/`set`/`subscribe`), one per `<explainer-scope>` element. When no scope element is present, the default scope is the document.
  - It persists to `sessionStorage` only if the scope says so.
  - Values never leave the browser.
- **Writers.** Anything can set a variable:
  - A form field with `data-explainer-var="name"` (a plain `<input>`/`<select>` in page HTML, or the core `input` component inside a player).
  - A `choice-option` that sets a value instead of, or as well as, jumping.
  - `explainer:command {action: "set", var, value}` from any source.
- **Readers.** Components receive variables as an input: `render(node, p, data, vars)`. Output is still a pure function of its inputs, and a variable change simply re-renders at the current `p`.
  - **Text interpolation:** `{name}` in a text field is filled from vars, always as `textContent`, never HTML.
  - **Conditions:** a component record's `when_var` and `when_value` fields show that cue only when the variable matches. This is how a scenario chosen at the top selects which variant of an animation plays further down.

**In SRS**
- `variable` records (`name`, `kind`: text|choice, `options` as child records, `default`) sit in a **page container** that groups the explainers placed on one page.
- `choice-option` gains `sets_variable` and `sets_value`.
- The exporter checks that every `{name}`, `when_var` and `sets_variable` names a declared variable.
- The page container's outline lists its explainers in page order, so the site page can be generated from it or hand-placed, whichever the site prefers.

## 1. New repo `explainer` (framework-free, zero runtime deps)
Vanilla TypeScript, built as a library with Vite. The output is one web component, `<explainer-player>`, which works in Astro and SvelteKit alike.

- `src/clock.ts`: play, pause, seek(t), setRate(r), jumpTo(id), back() and choose(option). It holds the position `{segmentId, t}` and the history stack, and resolves the next segment from `next`/`goes-to`. Crossing a boundary swaps the `src` of a second, preloaded media element.
- `src/player.ts`: the custom element. It loads the manifest JSON (`src` attribute or `.manifest` property) and mounts every cue's element once into an overlay `<div>` stacked over the video.
- **Commands.** Public methods `play/pause/seek/setRate/jumpTo(markerOrSegmentId)`. It also listens for the `explainer:command` CustomEvent (`{action, to?, rate?}`), which is the hook for arbitrary external sources.
- `src/triggers.ts`, two small adapters:
  - **Buttons:** `[data-explainer-action="play|pause|seek|rate"][data-explainer-to]`, handled by delegated click listening.
  - **Scroll:** an `IntersectionObserver` on `[data-explainer-seek="markerId"]`. A section entering the view seeks to its marker, whether you are scrolling down or up. This file also implements the player's own `play="enter|scrub"` modes.
- `src/store.ts`: the scoped variable store plus the `data-explainer-var` form binding, about 40 lines.
- **Component library.** `src/components/` (contract in section 1b). Theming is CSS custom properties only (`--explainer-ink`, `--explainer-accent`, `--explainer-font`, …), mapped to the site's tokens.
  Pilot set: intro, ending, numbered-list (highlights item *n*), boundary (a ring that draws in and labels inside/outside), callout.
  The contract matches the-system-networks' `update(progress)`, so steps from there port directly later.
- `schema/explainer.schema.json` is the manifest contract. It mirrors the guide.schema.json pattern:

  ```json
  { "id": "", "title": "",
    "segments": [{ "id": "", "kind": "video|audio|none", "src": "", "in": 0, "out": 0, "captions": "", "next": "segmentOrMarkerId|null" }],
    "markers":  [{ "id": "", "segment": "", "t": 0, "label": "" }],
    "cues":     [{ "id": "", "segment": "", "start": 0, "end": 0, "renders": "<typeId>@1", "variant": "", "data": {}, "items": [] }] }
  ```
  - Times are seconds relative to the segment, equivalent to a Media Fragment `#t=start,end` on the segment's media.
  - `captions` is a WebVTT URL used as a native `<track>`.
- `test/clock.test.ts` is a Node test with no framework: it covers default continuation, a `goes-to` override, a hold at a choice, choose → jump → reverse back across the boundary into the history entry, `back()`, and `ends: stop`. Include one cue-progress assertion at different rates. `test/store.test.ts` covers set → subscriber fires, `{name}` interpolation that escapes markup, and `when_var` gating.
- `demo/index.html`: a sample clip, rate buttons (0.5/1/1.5/2), a reverse-scrub slider, and scroll sections.

## 1b. Components: code in the library, variable data in SRS
Reusable components (intro, ending, numbered list, callout, boundary, …) are written once as code. Each use of a component is an SRS record holding only its variable data and timing.

**One component = one SRS Type + one code module, joined by the type ref.**
- **The SRS Type is the single source of the data shape.**
  - Examples: `com.semanticops.explainer/intro` (title, subtitle, presenter), `/ending` (heading, call_to_action, link), `/numbered-list` (heading; its items are child records).
  - Every component type also reuses the shared fields `start_seconds`, `end_seconds` and `variant`. Fields are reusable atoms, so they are defined once.
- **The code module** exports `meta.renders = "<typeId>@<version>"` plus `mount(host, data)` and `render(node, p, data)`.
  - It reads `data` keyed by Field.name, the same keys `record_create` uses.
  - Visual detail (layout, motion, colours) lives in code as named `variant`s, never in records.
- **A "cue" is not its own type.** It is any record whose type is a component type, placed under a segment in the explainer's outline.
- **List-like data uses child records.** Each `list-item` record (text, optional `derived-from` → guide step) sits at depth +1 under its list, so items reuse the guide wording and stay in a real structure, not a text blob.
- **The exporter is generic.** For each record under a segment, it emits `{renders, start, end, variant, data: fieldValues, items: children}`. Adding a component never touches the exporter.
  - The export fails if a record's type has no registered component.
  - The player fails loudly if a pack registers two components for one type.

**Where components live**

| Pack | Code | SRS Types |
|---|---|---|
| Core pack | `explainer/src/components/` | Package `com.semanticops.explainer` in `explainer/srs/`: intro, ending, numbered-list, callout, arrow, boundary ring, progress |
| Domain packs | The consuming repo, e.g. muDemocracy `src/explainer-components/` (decision-flow, consent-round) | That domain's own package, e.g. muSrs, which depends on the core package for the shared fields |

Site packs import the contract type from `explainer` and call `registerComponents(pack)`.

**Purity rule.** Inside a component anything goes: SVG, canvas, three.js. The output must be a function of `(p, data)` alone. State such as trails is recomputed from `p`, never accumulated frame to frame, which is exactly what breaks reverse in equilibrium_cards `circle.js` today.

**How components are maintained**
- **Specimens are records.** `explainer/srs/` holds the types plus one specimen record per component and variant. The gallery (`demo/`) renders exactly those through the real exporter, with a scrub slider and p=0 / 0.5 / 1 snapshots. The same specimens feed a muDemocracy styleguide entry. Designers review here, and the data path is tested at the same time.
- **Generic purity test.** One test, run over every registered component and every specimen, renders p=0.3 directly, via 1→0.3 and via 0→0.3, and asserts identical output.
- **Coverage check.** Every component type in the package has a registered module and at least one specimen, and vice versa. The check is a lookup by type ref, not a comparison of two copies of the shape.
- **Versioning.** Changing a component's data shape is a new Type version, and the module's `renders` moves with it. Visual-only changes are code releases (semver) and leave the records untouched.

## 2. SRS package `com.semanticops.explainer` (reusable, other repos can depend on it)
- **Namespace:** `com.semanticops.explainer`, a SemanticOps package rather than a muDemocracy one.
- **Location:** an SRS repository inside the explainer repo (`explainer/srs/`), so the types ship alongside the player that renders them.
- **Distribution:** published as a `.srspkg` with `srs package export`. muSrs (and later other sites) list it in `packageDependencies`, keyed by `packageId`.
  No CLI or MCP command writes `packageDependencies` yet (srs-rust#1168). Until it lands, check the mounted MCP tool `package_dependency_set` first. If that can't do it either, record the gap as a finding before hand-editing anything.
- **Instances:** explainer records live in the consuming site's SRS repo. During dogfooding that is `examples/mudemocracy/`; after the move-over it is muSrs.
- **Authoring rule:** all writes go through the srs CLI/MCP (`record_create`, `relation_create`, `container_member_add`). Run `srs repo validate` after each batch.
- **Types:**
  - `explainer`: the container anchor. Fields: title, summary, and the guide it explains (via a relation, below).
  - `segment`: title, `kind` (select: video|audio|none), `media_url` (url, R2), `in_seconds`, `out_seconds` (number; for `none`, `out_seconds` is the duration), `captions_url`.
  - Component types, one per core component (section 1b). Each carries the shared `start_seconds`, `end_seconds` and `variant` fields plus its own data fields. `list-item` is for child items.
  - `marker`: `at_seconds`, `label`.
- **Structure:**
  - Each explainer is one container. Its `memberInstanceIds` outline gives the segment order (depth 0), with cues and markers at depth 1 under their segment, so the segment for each cue is derived and needs no extra field.
  - A cue links to the guide content it illustrates using the existing `derived-from` relation (cue `derived-from` guide section/step record). The exporter fills the cue text from that record when the cue's own text is empty, so the guide stays the single source of the wording.
- **No spec change.** Times are plain number fields. A first-class time-range or Media Fragment field type stays a separate RFC, and only if a second consumer needs it.

## 3. Dogfood the muDemocracy pilot inside the explainer repo
The muDemocracy repo is not touched until the mechanisms are ready.

- `explainer/examples/mudemocracy/` is its own small SRS repository. It depends on the `com.semanticops.explainer` package, which exercises the dependency path the real move will use.
  - It holds the pilot page container, its variables and the pilot explainer.
  - The guide text is copied from muSrs for now, with a `processingNote` naming the source guide. At the move, the copies become `derived-from` links to the real guide records.
- `explainer/scripts/export.mjs --repo <srs> --container <id>` is the generic exporter (srs CLI → manifest JSON, validated against the schema). muDemocracy will call this same script later rather than writing its own.
- `explainer/demo/mudemocracy/` is the pilot page.
  - It uses a copy of muDemocracy's `tokens.css` mapped to `--explainer-*`.
  - It has a name/scenario form at the top and several in-place scroll animations reading those variables.
  - It also holds the guide video with scroll-linked sections (`data-explainer-seek`), ending on a `choice`: "Replay a step", "Next: boundaries" or "Read the guide".
  - Until the real recording exists, the video is a placeholder clip.
- **Media hosting:** R2, as described in the "Media" section above. A local `demo/media/` directory, git-ignored, holds clips during dogfooding.

**Move-over (later, a separate issue).**
- muSrs adds the package dependency, the explainer records move into muSrs with `derived-from` → guide records, and muDemocracy gets `Explainer.astro` plus a styleguide specimen and calls `export.mjs` in its prebuild.
- Follow muDemocracy's owner rules at that point: styleguide specimen first, and a fresh worktree off origin.

## Order of work
1. File the issue in the programme (Answers: SP-nn, or "No affirmed problem yet: …"), after a duplicate search. Create the `explainer` repo (the-greenman/explainer).
2. Clock + history + tests → player → triggers/play modes → store → 2 core components (intro, numbered-list) → gallery.
3. The `com.semanticops.explainer` types plus specimen records in `explainer/srs/`, and the generic exporter.
4. `examples/mudemocracy`: the pilot records and page, adding the choice, boundary, ending and input components as the pilot needs them.
5. Move-over to muSrs/muDemocracy once the owner is happy with the mechanisms.

## Verification
- `node --test` in explainer: the clock tests pass.
- Demo page in a browser: play at 0.5×/2×, then scrub backwards. Overlays must land at identical positions for the same `t` in both directions. Scroll sections seek correctly, and a `explainer:command` dispatched from the console works.
- `srs repo validate` reports 0 errors on both `explainer/srs` and `examples/mudemocracy`. The exporter output validates against the schema.
- Pilot page (`npm run dev` in explainer):
  - Enter a name and pick a scenario, and both appear in the animations further down.
  - Scroll down and back up, and the in-place animations reverse cleanly.
  - The video choice jumps, `back()` returns, and reversing crosses the jump correctly.
  - With `prefers-reduced-motion` set, each cue renders its end state (p=1).

## Deferred (add when needed)
- Choice timeouts and default options, `goes-to` edges conditioned on variables, and variables shared across pages beyond `sessionStorage`.
- Generated WebVTT chapters from markers, xAPI analytics, and a visual authoring UI.
- A time-range RFC for the spec.
