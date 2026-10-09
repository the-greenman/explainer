# explainer

Video, audio or pure animation plus text and diagrams on **one timeline**, as a single web component `<explainer-player>`. Zero runtime dependencies, vanilla TypeScript.

## The one-clock rule
The player owns a virtual clock `{segmentId, t, rate, playing}` (`t` in seconds within the segment). Layers never have their own time source; each frame every cue gets `p = clamp01((t - start) / (end - start))` and `component.render(node, p, data, vars, items)`.
- Forward with media: media plays natively, the clock *reads* `currentTime`.
- Reverse / scrub / no media: media is paused and muted, the clock advances itself and *writes* `currentTime`.

A segment graph with a history of the *path taken*. History is always the route from the start to where you are. Default continuation and choices (`goes_to`) push an entry `{segmentId, t, to, hold?}`; navigation (`jumpTo`, markers, prev/next, scroll sections, the `jump` command, and `seek` scrubbing) keeps that true: a target on an earlier stretch of the route cuts history back to it (including before a choice, which unwinds the branch), a target further along the default order pushes the continuation entries playing there would have, and only a target the default order cannot reach (a branch-only segment) leaves history as it is. Reversing unwinds a branch when it crosses where that branch landed (any time within the segment; below 0 it also pops a branch into the segment); with none, it goes to the end of the segment that continues into it (`next` or array order); with none, it stops at 0. `back()` pops the last entry and goes there; if it was left from a held choice, the choice is shown again (paused, keys 1-n work).

Segments of one `src` are `in`/`out` cuts: compile an explainer's media to one file where possible, and crossing a cut does not reload or re-seek.

## Manifest
Schema: `schema/explainer.schema.json`.
```json
{ "id": "", "title": "",
  "segments": [{ "id": "", "title": "", "kind": "video|audio|none", "src": "", "in": 0, "out": 12, "captions": "", "next": "segmentOrMarkerId|null", "ends": "continue|stop" }],
  "markers":  [{ "id": "", "segment": "", "t": 0, "label": "" }],
  "cues":     [{ "id": "", "segment": "", "start": 0, "end": 0, "renders": "<typeRef>@1", "variant": "", "data": {}, "items": [], "hold": false, "loop_from": 0, "when_var": "", "when_value": "" }] }
```
Choice options (`items` of a choice cue): `{id, label, goes_to?, sets_variable?, sets_value?, default?}`. For `kind: none`, `out - in` is the duration.

## Commands and events
Public methods: `play pause seek(t) setRate(r) jumpTo(id) back choose(optionId) rewind(depth, atChoice?)` (negative rate = reverse). `jumpTo` (and `seek`) is navigation: it cuts history back or pushes the default continuations so history stays the route to here, and never adds anything playing would not have; `choose` with `goes_to` is a branch and does.
Dispatch `explainer:command` with `detail: {action: play|pause|seek|rate|jump|back|rewind|choose|playthrough|captions|set, to?, rate?, t?, option?, depth?, hold?, on?, var?, value?, target?}` on a player or the document (document: the first player, or those matching `detail.target`; `rate` also starts playback).
Buttons: `[data-explainer-action="play|pause|seek|rate|jump|back|playthrough"]` with `data-explainer-to` / `data-explainer-value`, optional `data-explainer-target="selector"`. Scroll sections: `[data-explainer-seek="markerId"]`.
Emitted (bubbling): `explainer:segment`, `explainer:cueenter`, `explainer:cueexit`, `explainer:choice`, `explainer:path` (history length, segment or held choice changed; `detail: {depth, segment, holding}`).

## Playthrough (default path)
Mark one option of a choice cue `default: true` and an explainer can play straight through like a video.
- Switch on with the boolean `playthrough` attribute on `<explainer-player>` (observed, so it can change live; also the `playthrough` property), the command `{action: 'playthrough', on?: boolean}` (no `on` toggles), or a button `data-explainer-action="playthrough"` with optional `data-explainer-value="on|off"` (otherwise it toggles).
- At a hold the clock takes the default option instead of holding: `sets_variable` applies, `goes_to` branches, playback keeps going. The history entry is the same as for a real choice (`hold`, `option`) plus `auto: true`; the path view tree shows "(default)" after it. A choice with no default just continues past.
- The choice overlay is not displayed at all in playthrough and keys 1-n do nothing.
- Turning it on while holding takes the default at once and plays. Turning it off: later holds hold as normal.
- `back()` / `rewind(depth, true)` pop the entry and go to the choice point without showing the choice; playing on from there takes the default again (if playing, straight away). Reverse unwinds an auto branch like a chosen one.
- A default that loops back (e.g. "Watch again" to the start) loops until stopped; there is no loop guard and history grows per lap.
- The player re-seeks the media after every default branch (clock hook `jump`), including same-segment ones.

## Path view
`<explainer-path for="playerId" mode="crumbs|tree">` shows the branching path the viewer has taken, rebuilt from the player's history on `explainer:path` (the segment graph loops, so it is never drawn; `pathSteps` in `src/path.ts` unrolls history into spans and choices, with untaken options listed under each choice).
- `crumbs`: `Intro > Purpose > <> What next? > The four questions ▸ 0:16`. `tree`: the same as a nested list, untaken options greyed.
- Clicking a past span rewinds to where it began; clicking a choice rewinds to it, held, like `back()` (`player.rewind(depth, atChoice)` / `explainer:command {action:'rewind', depth, hold}`). Untaken options and the current step are not buttons.
- Labels: the marker label where a branch landed, else the segment `title`, else its id. Times are segment-relative.
- Themed with `--explainer-ink` (override just here with `--explainer-path-ink`), `--explainer-accent`, `--explainer-font`. Only the "now" time updates per frame.
- Limits: the spans come from `routeSpans` in `src/clock.ts`, shared with the clock. Only a jump to a branch-only segment (rare) leaves the route; that span is then labelled by the segment it is in, from 0, and rewinding to the first span always goes to the first segment's start.

## Captions
Video: the `captions` WebVTT of a segment is a native `<track>` (browser-rendered). Audio has no native display, so the player renders the cue text itself into a caption strip (`div.explainer-captions`, bottom-centred over the stage and above the overlay, `pointer-events:none`, themed with `--explainer-ink`, `--explainer-bg`, `--explainer-font`). The track is loaded with mode `hidden`; each paint the strip shows the cue active at the media time `in + clock.t`, found by time from `track.cues` (`cueTextAt` in `src/captions.ts`), never from `cuechange`, so it is right in reverse and after a scrub. `textContent` only. Hide it with `captions="off"` on `<explainer-player>` (observed), `player.captionsOn = false`, or `explainer:command {action:'captions', on?}` (no `on` toggles). It is not created in `render` mode (the offline render keeps `captions.vtt` as a soft track).

## Play modes
`<explainer-player play="manual|enter|scrub">` - manual (default): commands only; enter: plays when scrolled into view, rewinds when scrolled back out below; scrub: scroll position maps to `t` over the current segment.

## Variables
`<explainer-scope persist>` scopes a variable store (default: document). Inputs with `data-explainer-var="name"` write to it. `{name}` in text is filled from it as `textContent`; `when_var`/`when_value` gate a cue.

## Component contract
```ts
{ meta: { renders, name, variants: string[] },
  mount(host, data): HTMLElement | SVGElement,   // build once, append to host
  render(node, p, data, vars, items, dur): void } // pure function of its arguments; dur = cue length (s)
```
No accumulated state and no enter/exit hooks: render at p=0.3 must be identical however you got there (`test/purity.test.ts`). Cue layers ignore pointer events; an interactive component sets `pointer-events:auto` on its own node.

Canvas components: `canvasComponent(meta, (ctx, {w, h, changed}, p, data, vars, items, dur) => …)` mounts the canvas, handles devicePixelRatio and resize (`changed` = rebuild size-derived geometry), and hands you a context in CSS pixels. Use `rng(seed)` instead of `Math.random`. `data.variant` carries the cue variant. Theme with `--explainer-ink`, `--explainer-accent`, `--explainer-bg`, `--explainer-font`. Register with `registerComponents(pack)`; duplicate `renders` throws.

## Rendering
Render an explainer to files offline, frame-exact (not recorded in real time): `src/render-plan.ts` steps the pure clock with a fixed `dt = 1/fps` and returns one `{segmentId, t}` per output frame plus the source cuts; `scripts/render.mjs` paints each frame in headless chromium (`examples/render/index.html`, no media, everything transparent) and encodes with ffmpeg. Needs ffmpeg/ffprobe on the path and playwright (`PLAYWRIGHT=/path/to/playwright/index.mjs`, else `playwright` or the srs-web copy); it starts `vite` itself unless one answers at `--url`.

```
node scripts/render.mjs --manifest examples/video/manifest.json [--path default | --choose a,b] [--fps 30] [--scale 1.5]
  [--out dir] [--mode overlay|composite|both] [--format prores|png|webm] [--burn-captions] [--var k=v] [--keep-frames]
  [--pack module] [--css file] [--url http://localhost:5199] [--workers 4] [--max-seconds 3600]
```
- **Path.** `--path default` (the default) is playthrough: defaults are taken, and it stops at `ends: stop`, or at the first branch that goes back to a position already rendered (a loop: one lap, ending at the choice point). `--choose a,b` is playthrough off: at each choice the next option id is chosen; when the list runs out the render stops at that choice; an unknown id is an error. `--max-seconds` caps the walk. `--var` seeds variables (`sets_variable` options set them along the way, so `when_var` cues follow the path).
- **Resolution.** The CSS stage is always 1280x720 (so rem/px text keeps its proportions); `--scale` is the device scale factor: 1.5 gives 1920x1080.
- **Theme and components.** The page loads `components.ts` and `theme.css` next to the manifest if present (override with `--pack` / `--css`, repo-relative or absolute). Choice cues are never drawn: a render is a video.

Outputs in `--out` (default `render-out/`):
- `overlay.mov` (`--format prores`: ProRes 4444 with alpha), or `overlay/%05d.png` (`png`), or `overlay.webm` (VP9 alpha). Overlay-only is a first-class output (`--mode overlay`): the layer with alpha, nothing else.
- `cuts.json`: fps, size, duration and the plan's cuts `{segment, src, sourceFile, srcIn, srcOut, outStart, outEnd, frames}` (source times are file seconds, `in + t`), so an editor can line the overlay up against the source. A branch that repeats or skips a span is just another cut.
- `captions.vtt`: the source captions cut and retimed along the cuts (cues outside are dropped, cues across a cut boundary clipped).
- `video.mp4` (`--mode composite|both`): the source trimmed and joined along the cuts (adjacent cuts of one file are joined), scaled to the overlay size, overlay on top, H.264 + AAC, faststart. Captions are a soft `mov_text` track, or burned in with `--burn-captions`. Segments without a picture (`kind: none`, with silence; `kind: audio`, with their audio) get the theme's `--explainer-bg` underneath (`--bg <colour>` overrides; black if neither). Put the theme in a `theme.css` next to the manifest, linked by the page too, so the render matches the live player.

Overlay-only workflow: `node scripts/render.mjs --manifest m.json --mode overlay`, then in the editor put `overlay.mov` on a track above the source, cut the source to `cuts.json` (or just use the composite for a check), and import `captions.vtt`. The overlay frame `n` is output time `n / fps`.

Player API for this: `<explainer-player render>` (set before the manifest) mounts no media and runs no rAF loop; `player.renderFrame(segmentId, t, vars?)` puts the clock there and paints once.

## Commands
`npm run dev` (gallery at /demo/; examples at /examples/creation/, /examples/equilibrium/, /examples/video/ and /examples/tarot/), `npm run build`, `npm test` (includes examples).

Project context, status and next steps: `CLAUDE.md`. Plan: `docs/plan.md`. Capability findings: `docs/findings.md`.

## scrub-root
`<explainer-player play="scrub" scrub-root="#article">`: progress is the scroll position through that element (0 when its top reaches the viewport top, 1 when its bottom reaches the viewport bottom), so a sticky player inside a tall article is scrubbed by scrolling the article. Without it, the player's own position through the viewport is used. See `examples/creation/`.
