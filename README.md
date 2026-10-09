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
Video: the `captions` WebVTT of a segment is a native `<track>` (browser-rendered). Audio has no native display, so the player renders the cue text itself into a caption strip (`div.explainer-captions`, bottom-centred over the stage and above the overlay, `pointer-events:none`, themed with `--explainer-ink`, `--explainer-bg`, `--explainer-font`). The track is loaded with mode `hidden`; each paint the strip shows the cue active at the media time `in + clock.t`, found by time from `track.cues` (`cueTextAt` in `src/captions.ts`), never from `cuechange`, so it is right in reverse and after a scrub. `textContent` only. `captions="below"` (observed) lays the strip out under the stage instead, with two lines always reserved so the page does not jump between cues: use it on narrow screens, where an overlaid strip covers the picture. Hide it with `captions="off"` on `<explainer-player>` (observed), `player.captionsOn = false`, or `explainer:command {action:'captions', on?}` (no `on` toggles). It is not created in `render` mode (the offline render keeps `captions.vtt` as a soft track).

### The caption strip for video (`captions="strip"`)
The browser draws a video's native cues inside the `<video>`: tiny when the video sits in a small slot, over the play affordance of the poster, and **gone while the video is hidden** (no active slot) although the narration goes on. So the engine's strip can show a video's captions too. The attribute `captions` on `<explainer-player>` is a space-separated list of tokens (observed):
- `strip`: every segment kind with captions (video included) uses the strip. The native `<track>` stays loaded but with `mode="hidden"`, so the browser draws nothing; the strip shows the text of the cue active at the media time `in + clock.t`, found by time from `track.cues` (`cueTextAt`), never from `cuechange`, exactly as for audio. Tags in the cue (`<i>`, `<v Name>`) are dropped, a few entities decoded and line breaks kept (`plainCue`); `textContent` only, never HTML.
- **The default with a canvas whose scenes carry a media slot:** `strip` and `below` are on without writing them. `native` is the explicit opt-out (video keeps the browser's own cue display; audio still uses the strip, an `<audio>` has none). Without a canvas, or with a canvas but no slot, nothing changes (strip for audio only, `strip` asks for it).
- `below` / `over`: the strip lies in flow under the stage, or at the bottom over it. With the strip on a canvas the default is `below` (recommended: the picture stays clear); `over` opts out. Below, two lines of height are always reserved while the segment has captions, so the page does not jump between cues.
- `off`: hide the strip. The `captions` command (`{action:'captions', on?}`, a `data-explainer-action="captions"` button, `player.captionsOn`) adds or removes that token and keeps the others (`captions="strip below off"`).

```html
<explainer-player canvas="1280x720" captions="strip below">…</explainer-player>   <!-- the default with slots, spelled out -->
<explainer-player canvas="1280x720" captions="native">…</explainer-player>        <!-- opt out: the browser's cues -->
```
- **State.** The player reflects `data-captions="on|off"` (default `on`), so a site can style its CC button: `explainer-player[data-captions="off"] .cc { opacity:.5 }`.
- **Styling.** The strip is `div.explainer-captions[data-explainer-captions]`, themed only by the caption tokens (`--explainer-caption-ink`, `--explainer-caption-paper`, `--explainer-size-caption`, `--explainer-size-caption-over`, `--explainer-leading-caption`, and the font), so a site restyles it entirely from CSS (`[data-explainer-captions] { … }`).
- **Screen readers.** `aria-live="off"` by default: the narration is audible, and a live region would announce each cue a second time on top of the audio. A site that wants the live announcement (for instance a muted explainer) sets `captions-live="polite"` on the player (observed).
- **Kept children.** When the site's controls are children of the player (not marked `data-explainer-poster`), the order is: the stage, then the strip (below), then the kept children, so the controls sit under the captions.
- **Offline render.** The player in `render` mode has no strip. `captions.vtt` and `--burn-captions` are unchanged (see "Rendering"); in composite mode burning is still the ffmpeg `subtitles` filter.

## Play modes
`<explainer-player play="manual|enter|scrub">` - manual (default): commands only; enter: plays when scrolled into view, rewinds when scrolled back out below; scrub: scroll position maps to `t` over the current segment.

## Variables
`<explainer-scope persist>` scopes a variable store (default: document). Inputs with `data-explainer-var="name"` write to it. `{name}` in text is filled from it as `textContent`; `when_var`/`when_value` gate a cue.

## Component contract
```ts
{ meta: { renders, name, variants: string[], surfaces: ('web'|'video')[], still? },
  mount(host, data): HTMLElement | SVGElement,   // build once, append to host
  render(node, p, data, vars, items, dur): void } // pure function of its arguments; dur = cue length (s)
```
No accumulated state and no enter/exit hooks: render at p=0.3 must be identical however you got there (`test/purity.test.ts`). Cue layers ignore pointer events; an interactive component sets `pointer-events:auto` on its own node.

**Surfaces and the static frame.** One library serves two surfaces: `web` (in-page animation, `play="enter|scrub"` over a `none` segment) and `video` (overlay cues on video/audio segments, and the offline render). `meta.surfaces` is required, so every pack must declare where its components run. Every component must also have a complete **static frame**, which is what print and `prefers-reduced-motion` show. `meta.still` is the progress p of that frame (a number, or `(data, items, dur) => p`; default 1). Set it when p=1 is not complete, e.g. a variant that fades out at the end (intro `lower-third` stills at 0.5; numbered-list `panel` at `(dur - 0.4) / dur`). The function form sees `data.variant`, `items` and `dur`; read it with `stillP(comp, data, items, dur)`. `test/still.test.ts` renders every registered component and variant at its still and fails if any text is translucent (below 0.99, with a listed allowance for text dimmed on purpose) or hidden.

**Still time of a segment** (`src/still.ts`, pure): the manifest may give `still` (seconds within the segment) on a segment; otherwise it is the max over the segment's cues of `cue.start + stillP * (cue.end - cue.start)`, clamped to the segment length. Hold cues (choices) are left out, since they sit at the very end, unless the segment has no other cue. `player.stillTime(id?)` returns it.
- **Reduced motion.** With `prefers-reduced-motion: reduce`, a player with `play="enter"` or `play="scrub"` does not animate: it pauses at the still time of its first segment and stays (it follows changes of the setting). In every play mode visible cues are rendered at their still p.
- **Print.** On `beforeprint` every player pauses at the still time of its current segment; on `afterprint` it goes back to its position (history untouched) and resumes if it was playing.

Canvas components: `canvasComponent(meta, (ctx, {w, h, changed}, p, data, vars, items, dur) => …)` mounts the canvas, handles devicePixelRatio and resize (`changed` = rebuild size-derived geometry), and hands you a context in CSS pixels. Use `rng(seed)` instead of `Math.random`. `data.variant` carries the cue variant. Theme with `--explainer-ink`, `--explainer-accent`, `--explainer-bg`, `--explainer-font`. Register with `registerComponents(pack)`; duplicate `renders` throws.

## Theme
The contract is `src/theme.ts`: one exported constant per themeable value, each a `var(--explainer-<name>,<default>)` string. The player uses light DOM, so a site sets the custom properties on the player or any ancestor. Core code (`src/components/`, `src/player.ts`, `src/path-view.ts`) holds no colour, font-family, font-size, font-weight or line-height literal; `test/theme-tokens.test.ts` fails on one. Domain packs can import the same constants (`import { INK, ACCENT } from '.../src/theme.ts'`, or `theme` from `explainer`). The defaults are the look the player has with no theme at all.

| Custom property | Role | Default |
|---|---|---|
| `--explainer-ink` | Text and line colour on paper | `#111` |
| `--explainer-paper` | Stage/page background. `--explainer-bg` is the older name and still works as its fallback | `#fff` |
| `--explainer-accent` | Emphasis: active list item, byline, button border | `#06c` |
| `--explainer-highlight` | Highlighter colour (no core component draws it yet) | `#f2ff36` |
| `--explainer-muted` | Secondary text on paper (not used by core yet) | `#666` |
| `--explainer-line` | Hairlines and rules on paper (not used by core yet) | `#ddd` |
| `--explainer-card` | Card laid over a picture (lower third, side panel) | `rgba(12,14,22,.7)` |
| `--explainer-card-ink` | Text on the card | `#fff` |
| `--explainer-scrim` | Backdrop of a choice held over footage | `rgba(8,10,18,.72)` |
| `--explainer-scrim-ink` | Text on the scrim | `#fff` |
| `--explainer-button` | Choice button face on the scrim (buttons on paper use paper/ink) | `rgba(255,255,255,.94)` |
| `--explainer-button-ink` | Text on that button | `#111` |
| `--explainer-caption-ink` | Caption strip text; falls back to `--explainer-ink`, then `#fff` | `#fff` |
| `--explainer-caption-paper` | Caption strip background; falls back to paper (then `--explainer-bg`), then `#000` | `#000` |
| `--explainer-path-ink` | Path view text; falls back to `--explainer-ink`, then the inherited colour | `inherit` |
| `--explainer-font` | Body font family (the path view falls back to the inherited font) | `system-ui,sans-serif` |
| `--explainer-font-mono` | Monospace family (not used by core yet) | `ui-monospace,monospace` |
| `--explainer-size-card-title` | Card title, stage-relative | `10cqw` |
| `--explainer-size-card-sub` | Card subtitle, stage-relative | `7cqw` |
| `--explainer-size-card-note` | Card byline, stage-relative | `6cqw` |
| `--explainer-size-panel-heading` | Side panel heading, stage-relative | `9cqw` |
| `--explainer-size-panel-item` | Side panel list items, stage-relative | `7.5cqw` |
| `--explainer-size-caption-over` | Caption strip over the picture | `clamp(.8rem,2.1cqw + .3rem,1.4rem)` |
| `--explainer-size-title` | Full-stage intro title | `2.6rem` |
| `--explainer-size-heading` | Minimal intro title, choice prompt | `1.6rem` |
| `--explainer-size-section` | Full-stage list heading | `1.8rem` |
| `--explainer-size-subtitle` | Intro subtitle | `1.2rem` |
| `--explainer-size-item` | Full-stage list items | `1.3rem` |
| `--explainer-size-byline` | Intro byline | `.9rem` |
| `--explainer-size-caption` | Caption strip below the stage | `1rem` |
| `--explainer-size-path` | Path view text | `.9em` |
| `--explainer-weight-strong` | Active list item | `700` |
| `--explainer-weight-label` | Path view labels | `600` |
| `--explainer-leading-title` | Card title line height | `1.15` |
| `--explainer-leading-sub` | Card subtitle line height | `1.3` |
| `--explainer-leading-caption` | Caption strip line height | `1.35` |
| `--explainer-leading-path` | Path view line height | `1.5` |
| `--explainer-safe` | Safe-area inset from the stage edge | `2.5%` |
| `--explainer-side-width` | Side panel width (clear of a centred face, x 27-70%) | `27%` |
| `--explainer-lower-width` | Lower-third card width | `28%` |

A site theme is one stylesheet that maps values; it never needs to touch component code:
```css
/* site-theme.css, linked by the page that holds the player */
explainer-player, explainer-path {
  --explainer-paper: #fbfaf6;
  --explainer-ink: #1a1a1a;
  --explainer-accent: #0b5fff;
  --explainer-highlight: #f2ff36;
  --explainer-font: "IBM Plex Sans", system-ui, sans-serif;
  --explainer-font-mono: "IBM Plex Mono", ui-monospace, monospace;
  --explainer-card: #fbfaf6;      /* text over video on a paper card, not a dark scrim */
  --explainer-card-ink: #1a1a1a;
  --explainer-size-title: 3rem;
}
```

Motion is code, because a pure `render` cannot read CSS. `src/motion.ts` holds the named curves (`linear`, `out`, `inOut`, each [0,1] to [0,1]; `ramp` is linear), `fade(o, dy)` and the fade constants (`FADE_OFFSET` 12 px, `FADE_OFFSET_CARD` 10, `FADE_OFFSET_ITEM` 8, `PANEL_OUT_S` and `ITEM_FADE_S` 0.4 s). Components import these; a site cannot override them from CSS.

## Styleguide
`explainer/styleguide` is a harness a site mounts in its own page. It renders every **registered** component and variant (whatever the page imported first) from fixture data. Each card has a scrubber, a "still" button (jumps to `stillP`, the complete frame print and reduced motion show), surface badges and three true-size frames: a 360 px web column, a 640 px 16:9 stage and the same stage at 360 px as a phone embed. There is no transform scaling, so cqw sizing is exercised exactly as in the player. A frame is shown only if `meta.surfaces` declares it (`web` for the column; `video` for the stage and the phone). A registered component with no fixture shows a "no fixture" note.

```js
// the site's styleguide page, client-side
import 'explainer';                       // the core first: it defines the elements and registers the core pack
import './motion/pack.ts';                // the site's own pack: importing it registers its components
import { mountStyleguide, measureSmallestType } from 'explainer/styleguide';
import themeCss from './motion/theme.css?raw';
import { fixtures } from './motion/fixtures.ts';   // { [meta.renders]: { data, items, dur? } }

const unmount = mountStyleguide(document.getElementById('root'), {
  fixtures,
  themes: [{ id: 'default', label: 'default' }, { id: 'site', label: 'site', className: 'theme-site', css: themeCss }],
  intro: rulesPanel,      // optional element or HTML string above the cards
});
```
- **Themes:** the host passes raw stylesheet text. The harness rewrites every `:root` in it to `.<className>` (default `sg-theme-<id>`) and puts that class on the wrapper holding the cards, so a theme applies to the cards only and the switch just toggles the class. Selectors on `html`/`body` are not rewritten. A theme without `css` is the contract defaults. With one theme no switch is shown.
- **URL:** `?theme=<id>` picks the theme, `?only=<slug or slug__variant>[,...]` filters (substring match; `slug` is `renders` without the `com.semanticops.` prefix, `/` and `@` as `-`). The `only` option overrides the URL.
- **Smallest stage type:** `measureSmallestType()` renders each video-surface case at its still on an off-screen 1280 px stage inside the active theme wrapper and returns `{ px, at1920, where }` (smallest computed font size, and that x1.5 for a 1920 render), or `null`. It re-runs on a theme switch and fills any `[data-sg-min-size]` element in `intro`, so a rules panel can show it.
- **Cleanup:** `mountStyleguide` returns a function that removes everything it added. Importing the module has no side effects beyond the core registry.
- **This repo's page:** `/examples/styleguide/` mounts the harness over the core and `examples/video` packs (fixtures in `examples/styleguide/fixtures.ts`, shared with `test/still.test.ts`; a new component here needs a fixture there) with the contract defaults and a neutral sample theme, `examples/styleguide/paper.css` (a demo of theming, no brand).

Review frames: with `npx vite --port 5199 --strictPort` running, `node examples/styleguide/frames.mjs [outDir] [pageUrl] [--theme=<id>] [--only=...]` writes `<renders-slug>__<variant>__<surface>__p{0,0.5,1,still}.png` (default `examples/styleguide/frames/`, ignored by git; needs the playwright install named in CLAUDE.md, or `PLAYWRIGHT=/path/to/playwright/index.mjs`). `pageUrl` is any page that hosts the harness, e.g. a site's own, so a site reviews its own components and theme this way.

## Rendering
Render an explainer to files offline, frame-exact (not recorded in real time): `src/render-plan.ts` steps the pure clock with a fixed `dt = 1/fps` and returns one `{segmentId, t}` per output frame plus the source cuts; `scripts/render.mjs` paints each frame in headless chromium (`examples/render/index.html`, no media, everything transparent) and encodes with ffmpeg. Needs ffmpeg/ffprobe on the path and playwright (`PLAYWRIGHT=/path/to/playwright/index.mjs`, else `playwright` or the srs-web copy); it starts `vite` itself unless one answers at `--url`.

```
node scripts/render.mjs --manifest examples/video/manifest.json [--path default | --choose a,b] [--fps 30] [--scale 1.5]
  [--out dir] [--mode overlay|composite|both] [--format prores|png|webm] [--burn-captions] [--var k=v] [--keep-frames]
  [--pack module] [--css file] [--url http://localhost:5199] [--workers 4] [--max-seconds 3600]
  [--canvas WxH] [--scenes file.html] [--page url [--selector css]]
```
- **Path.** `--path default` (the default) is playthrough: defaults are taken, and it stops at `ends: stop`, or at the first branch that goes back to a position already rendered (a loop: one lap, ending at the choice point). `--choose a,b` is playthrough off: at each choice the next option id is chosen; when the list runs out the render stops at that choice; an unknown id is an error. `--max-seconds` caps the walk. `--var` seeds variables (`sets_variable` options set them along the way, so `when_var` cues follow the path).
- **Resolution.** The CSS stage is 1280x720 unless `--canvas WxH` names another design canvas (so rem/px text keeps its proportions); `--scale` is the device scale factor: 1.5 gives 1920x1080 for 1280x720, 1080x1350 for 720x900. `--page <url>` renders a player on a real page instead; see "Scenes".
- **Theme and components.** The page loads `components.ts` and `theme.css` next to the manifest if present (override with `--pack` / `--css`, repo-relative or absolute). Choice cues are never drawn: a render is a video.

Outputs in `--out` (default `render-out/`):
- `overlay.mov` (`--format prores`: ProRes 4444 with alpha), or `overlay/%05d.png` (`png`), or `overlay.webm` (VP9 alpha). Overlay-only is a first-class output (`--mode overlay`): the layer with alpha, nothing else.
- `cuts.json`: fps, size, duration and the plan's cuts `{segment, src, sourceFile, srcIn, srcOut, outStart, outEnd, frames}` (source times are file seconds, `in + t`), so an editor can line the overlay up against the source. A branch that repeats or skips a span is just another cut.
- `captions.vtt`: the source captions cut and retimed along the cuts (cues outside are dropped, cues across a cut boundary clipped).
- `video.mp4` (`--mode composite|both`): the source trimmed and joined along the cuts (adjacent cuts of one file are joined), scaled to the overlay size, overlay on top, H.264 + AAC, faststart. Captions are a soft `mov_text` track, or burned in with `--burn-captions`. Segments without a picture (`kind: none`, with silence; `kind: audio`, with their audio) get the theme's `--explainer-bg` underneath (`--bg <colour>` overrides; black if neither). Put the theme in a `theme.css` next to the manifest, linked by the page too, so the render matches the live player.

Overlay-only workflow: `node scripts/render.mjs --manifest m.json --mode overlay`, then in the editor put `overlay.mov` on a track above the source, cut the source to `cuts.json` (or just use the composite for a check), and import `captions.vtt`. The overlay frame `n` is output time `n / fps`.

Player API for this: `<explainer-player render>` (set before the manifest) mounts no media and runs no rAF loop; `player.renderFrame(segmentId, t, vars?)` puts the clock there and paints once.

## Commands
`npm run dev` (gallery at /demo/; examples at /examples/video/ and /examples/styleguide/), `npm run build`, `npm test` (includes examples).

Project context, status and next steps: `CLAUDE.md`. Plan: `docs/plan.md`. Capability findings: `docs/findings.md`.

## One component anywhere: `<explainer-motion>`
For a logo in a heading, a highlighter mark in prose, a small card in nav: one registered component mounted in the element itself, with no stage, no manifest and no aspect ratio. It is `display:inline-block; position:relative; container-type:inline-size` by default (via a zero-specificity `:where(explainer-motion)` rule, so any page CSS wins), so **the page sizes it**: give it a `width` and `height` (in `em` to follow the text). `container-type:inline-size` means `cqw` works inside, and also that the element has no intrinsic width of its own.
```html
<p>The page needs
  <explainer-motion renders="com.example/underline@1" dur="1.5" play="enter" style="width:5.4em;height:1.2em">
    <script type="application/json">{"data":{"text":"this phrase"},"items":[]}</script>
  </explainer-motion>
  to draw itself.</p>
```
- **Attributes.** `renders` (the component ref), `variant`, `dur` (seconds, default 1), `play` (`enter` default, `scrub`, `hover`, `manual`), `scrub-root` (as the player's), `rate` (speed multiplier, default 1). They are observed: changing `renders`/`variant` remounts.
- **Data.** From a child `<script type="application/json">` holding `{"data": {...}, "items": [...]}`, or from JS: `el.data = {...}; el.items = [...]` (a property wins over the script). `variant` is merged under `data`, as for a cue. `{name}` text is filled from the page variable store (`scopeFor`: the nearest `<explainer-scope>`, else the document) and the element repaints when a variable changes.
- **One clock, pure render.** The element has its own time `t` over `dur` and every paint calls `render(node, t / dur, data, vars, items, dur)`; a component keeps no state, so `el.seek(0.3)` gives the same DOM however you got there (`test/motion-element.test.ts`). `el.p`, `el.t`, `el.playing` read the clock.
- **Modes.**
  - `enter`: plays forward once when it scrolls into view (40% visible) and reverses when scrolled back above it. Same logic as the player's `play="enter"` (`bindEnter` in `src/triggers.ts`).
  - `scrub`: p follows the scroll position, through the viewport or through `scrub-root` (`bindScrub`, shared with the player).
  - `hover`: plays forward on `pointerenter` or `focusin`, reverses on `pointerleave` or `focusout`. Keyboard users need something focusable: put it in a link or button, or give it `tabindex="0"`.
  - `manual`: `play()`, `pause()`, `seek(p)` (p in 0..1), `setRate(r)` (signed speed, starts playing; 0 pauses). It also takes the player's `explainer:command` events (`play`, `pause`, `seek` with `t` in seconds, `rate`, `set`) dispatched on the element, and `data-explainer-action` buttons with `data-explainer-target` pointing at it.
- **Reduced motion and print.** With `prefers-reduced-motion: reduce` it does not animate: nothing is bound and it shows the component's still (`stillP`, see the component contract), whatever the mode; it follows the setting changing. On `beforeprint` it shows the still, and on `afterprint` it goes back to where it was and resumes if it was playing.
- **Static first (progressive enhancement).** Light-DOM children the element has before it mounts stay visible until the component mounts, and are then replaced. So the site renders the still as plain HTML on the server and the element takes over when the script loads (no flash, and it works without JS). If the component is not registered yet (a pack imported after the core) the children stay and the element mounts when `registerComponents` runs.
  ```astro
  ---
  // Highlight.astro: server-rendered still, enhanced in the browser
  const { text } = Astro.props;
  ---
  <explainer-motion renders="com.example/highlight@1" play="enter" dur="1.2" style="width:6em;height:1.3em">
    <mark class="highlight-still">{text}</mark>
    <script type="application/json" set:html={JSON.stringify({ data: { text } })} />
  </explainer-motion>
  <script>
    await import('explainer');
    await import('../motion/pack.ts');
  </script>
  ```
- **Surfaces.** The component must declare `web` in `meta.surfaces`; if not, the element logs one console warning per component and renders anyway.

Gallery: the `<explainer-motion>` section of `demo/index.html` (inline in a sentence, in a heading, hover, scrub, manual), using the small neutral component in `demo/pack.ts`.

## Scenes: the page, performed
A scene is the site's own server-rendered markup and CSS, placed in the player and revealed by motion. The engine never builds or restyles brand markup; it only reveals what is already there. Most of an explainer can be full-frame scenes, over a video that shows a talking head only now and then. Neutral example: `examples/scenes/` (linked from the gallery).

**Template.** Put `<template data-scene="<id>">…markup…</template>` inside the `<explainer-player>` (preferred) or anywhere in the document. The first match inside the player wins, then the first in the document. Light-DOM children of the player are never removed by it.

**The cue.** `com.semanticops.explainer/scene@1` (core pack, surfaces `web` and `video`):
```json
{ "id": "intro", "segment": "s", "start": 0, "end": 6.4, "renders": "com.semanticops.explainer/scene@1",
  "data": { "template": "intro", "transition": { "in": "cut", "out": "fade", "dur": 0.4 } } }
```
`transition.in` is `cut` (the default), `fade`, `wipe` or `wipe-left`; `transition.out` is `cut` or `fade` (a wipe at the end is a cut). `dur` is the length in seconds (default 0.4). `wipe` keeps the new scene opaque and reveals it with `clip-path: inset(X% 0 0 0)` from the bottom, so the new surface rises like the next page section and never blends with what is under it (no grey crossfade); `wipe-left` reveals it from the right (`inset(0 0 0 X%)`). Once the wipe is done the clip is removed. Give the scene a surface of its own, since the wipe shows whatever is below until it has covered it. `mount` clones the template content into the cue node, which fills the stage (the canvas, see below). **The scene's own root decides its background** (an opaque paper or black surface covers the video); the engine adds none. Give the root `height:100%` to fill the canvas. For a crossfade, overlap two cues and give only the later one `"in": "fade"`: the earlier cue stays opaque underneath until the later one is fully in (a fade-out on the earlier cue would dip to the stage background). The `still` of a scene is the p at which every choreographed element is complete (the max of `at + for` over the cue length), also past the in-fade and before any out-fade.

**Choreography.** On any element inside a scene: `data-at="<seconds from cue start>"`, `data-for="<seconds>"` (default 0.5) and `data-fx="<name>"`. Every render sets the inline custom property `--fx-p` = `clamp01((t - at) / for)` on such an element (t = `p * dur`), and the built-in effects set more from it:

| `data-fx` | sets |
|---|---|
| `fade` | `opacity` |
| `rise` | `opacity`, and `transform: translateY(12px → 0)` |
| `write` | `clip-path: inset(0 X% 0 0)`, a left-to-right reveal |
| `wipe` | `clip-path: inset(0 0 X% 0)`, a top-to-bottom reveal |
| `words` | wraps the words of the element's text in `<span data-w>` once at mount (from the template, so it is still pure), then sets each span's `opacity`: word i of n starts at `--fx-p` = i/n and fades in over the next 1/n. Wrapped multi-line text writes in reading order across lines. `write` stays the left-to-right clip |
| `none` (or no `data-fx`) | only `--fx-p` |

Elements without `data-at` are untouched. The built-in effects overwrite the properties they set (`transform` for `rise`, `clip-path` for `write` and `wipe`), so keep your own values for those on a wrapper. All of it is a pure function of p, so any seek, in any order, gives the same frame (`test/scene.test.ts`).

**Your own effects.** Any other `data-fx` name sets only `--fx-p`; implement the effect in the site's CSS:
```css
.hl[data-fx="hl-draw"] { background: linear-gradient(var(--accent), var(--accent)) no-repeat 0 100%;
  background-size: calc(var(--fx-p, 1) * 100%) var(--hl-height); }
```
**The static page is the fallback.** Outside a player nothing sets `--fx-p`, so `var(--fx-p, 1)` is 1 and the markup is complete: that is what the page shows without JavaScript, in print, and as the poster. Write every scene CSS with the `1` fallback.

**Design canvas.** `canvas="1280x720 720x900@<600"` on the player: a list of `WxH` entries (CSS px), each optionally with `@<N` ("use when the player is narrower than N px"). Conditioned entries are tried in order and the first that holds wins; otherwise the first entry with no condition is the fallback (if there is none, the last entry). The stage then holds a canvas element of exactly W×H CSS px, `transform: scale(stageWidth / W)` from the top-left, and the stage height is `stageWidth * H / W`. All cue layers (and the media element) render inside it; captions and the caption strip stay outside. The canvas element gets `data-canvas="WxH"` and `container-type: size`, so a site restyles per canvas with `[data-canvas="720x900"] .scene { … }` or container queries. It is re-chosen on resize (`ResizeObserver` on the player) and repainted. Changing the attribute re-initialises the player. Without `canvas` the stage is the 16:9 `cqw` stage, as before. Pure parsing and choice: `parseCanvas`, `chooseCanvas` (`src/design-canvas.ts`).

**Media slots: the video's size and position.** One video can be hidden during a hook, small in a corner, zoomed to fill the frame, full-frame under text, then at the side. Any element in a scene template may carry `data-media-slot`, optionally with `data-at` / `data-for` (seconds, default 0 and 0) and `data-media-fit="cover|contain"` (default `cover`). It is an ordinary layout box styled by the site. Needs a design canvas (rects are canvas px).
- **The media rect follows the active slot.** At segment time T the active slot is, among the slots of the visible scene cues, the one with the greatest activation time (`cue.start + at`) that is `<= T` (a tie goes to the later scene, then the later in the document). The `<video>` gets `left/top/width/height` in canvas px and `object-fit` from it: measured with `getBoundingClientRect` relative to the canvas and divided by its scale, once per canvas key (cached, measured again on a canvas or width change and when web fonts load). A scene that was never shown is measured too (unhidden within the same synchronous frame), so a direct seek gives the same frame as playing there. Keep slot boxes untransformed (no `rise` on the slot or its ancestors) and their layout independent of `--fx-p`.
- **Moving.** When a slot activates the rect moves from where the media was just before (the previous slot, possibly in the previous scene, so across a boundary or an overlap) to the new rect over the slot's `data-for` with an ease-in-out. It is a pure function of T (`mediaBoxAt`, `src/media-slots.ts`), computed recursively, so a move interrupted by the next slot stays continuous and any path (seek, reverse, scrub) gives the same box. From a hidden media, or at segment time 0, the change is a cut.
- **Fallbacks.** Scenes visible but none with an active slot: the media is hidden (`opacity:0`; audio plays on, the clock is unaffected). No scene cue visible at all: the media fills the canvas (`contain`). A scene without slots (a hook) therefore hides the video while it is the only scene visible; an overlapping `over` text cue with no slot leaves the active slot alone.
- **Without any slot** in the player the media is as before: under the overlay, full stage.
- The media element has `data-explainer-media`. The engine sets only its position, size, `object-fit` and, when hidden, `opacity:0`; the site styles the rest (`[data-explainer-media] { filter: grayscale(1) }`).

**Layers.** With a canvas the z-order is: cues `"layer": "under"` (the default), then the media, then cues `"layer": "over"` (a field on the cue, in the schema). Ordinary scenes have opaque roots, so they sit below the video and the video in its slot appears on top of them; an `over` scene draws text on the video (give it a transparent root). Without slots the media stays below both layers.

**Controls.** The control API is brand-neutral; the site draws the controls (icons, a hairline progress rule).
- Actions (`command()`, the `explainer:command` event and `data-explainer-action`): `toggle` (play or pause; from the poster or the end it plays from the start; while a choice is held it does nothing), `restart` (to the start of the explainer, history cleared, and play), and `scrub`. An element with `data-explainer-action="scrub"` maps pointer x across its own width to t in the current segment: pointerdown plus drag (pointer capture), and on a focusable element the arrow keys (+/- 5 s), Home and End. It gets `role="slider"`, `aria-valuemin`, `tabindex` if missing, and `aria-valuenow`, `-max` and `-valuetext` kept up to date. Set `touch-action: none` on it in CSS. `{action: 'scrub', f: 0..1}` or `{action: 'scrub', by: seconds}` is the command form.
- State: the player has `data-state="poster|playing|paused|ended|holding"` (poster: never played, seeked or jumped) and the CSS custom property `--explainer-progress` (0..1, t over the segment length) on itself, written when they change.
- Event `explainer:time` `{segmentId, t, duration}` on paint when t changed (it bubbles).
- Elements inside the player with `data-explainer-display="time|duration|remaining"` get their text set as `m:ss` (remaining rounds up).
- **Click to play:** with `play="manual"` or no `play` attribute, a click on the stage toggles, unless it hit a `button`, `a`, `input`, `select`, `textarea` or anything with `data-explainer-action`. `click-to-play="false"` turns it off.
- **Recommended pattern:** put the controls inside the player as light-DOM children that are not marked `data-explainer-poster`. They stay, lie under the stage, inherit `--explainer-progress` and can style off `explainer-player[data-state="playing"] .toggle`. Give the buttons `data-explainer-target="#id"` when the page has more than one player. See `examples/scenes/` (the second player; `prepare.sh` makes its test video).

**Poster.** Two things make the player read as page copy before play:
- `poster="still"`: before the first play, the player paints the first segment at its still time (`player.stillTime()`; set `still` on the segment to choose it). The first play, seek or jump starts from the normal position (t=0 for play); `pause` does not end the poster.
- **Static first:** children marked `data-explainer-poster` are the poster: visible until the manifest has loaded and the first paint has happened, then hidden (`data-explainer-poster="hidden"`, `display:none`), not removed, so they remain for no-JS and print before load. **Other light-DOM children are kept** (a controls row, say) and laid out after the stage. If no child carries `data-explainer-poster`, every child other than `<template>` and `<script>` is the poster (the earlier behaviour).

**Inline manifest.** A child `<script type="application/json" data-manifest>` is used when there is no `src` attribute and no `.manifest` set. (The player waits for `DOMContentLoaded` first when the document is still parsing.)

**Rendering scenes.** `scripts/render.mjs --canvas WxH` renders at that canvas: the output is W×H times `--scale` (the default 1.5 keeps 1280x720 at 1920x1080; 720x900 gives 1080x1350). `--page <url>` renders a player found on any page (`--selector`, default the first `explainer-player`) instead of the render page, so the site's real page, with its CSS and templates, is what is rendered: the player is marked `render` as it is inserted, moved to the top-left at W px, and everything else on the page is hidden. `--manifest` is then optional (the page's player gives it). With `--manifest` and the render page, `--scenes file.html` supplies the templates. See "Rendering".

## Embedding in a site
Install from a git tag (`npm i github:the-greenman/explainer#<tag>`) or `npm pack` a checkout. The export `explainer` is the core: it defines `<explainer-player>`/`<explainer-path>` and needs the DOM. A domain pack imports the contract from it and calls `registerComponents`, so **import `explainer` before the pack**. Client-only (SSR/SvelteKit: do it in `onMount`):
```js
await import('explainer'); await import('./my-pack.ts');
player.manifest = m; // <explainer-player> element
```
`crossorigin` on `<explainer-player>` (e.g. `crossorigin="anonymous"`) is copied to the media element when it is created (not observed; set it before the manifest) and `<track>` inherits it. Needed when the VTT is cross-origin (it then needs CORS headers); a same-origin VTT with cross-origin audio works without it.
Theme: CSS variables on the player or an ancestor; see the Theme section for every token.

## Releases
Releases are tags; see `CHANGELOG.md`. After a PR is merged to `main` and the changelog's "Unreleased" entries are moved under a version heading, the owner tags `vX.Y.Z` on `main`. A site pins the tag: `"explainer": "github:the-greenman/explainer#vX.Y.Z"`. `dist/` is not committed: the package has a `prepare` script (`vite build`), which npm runs after installing a dependency's devDependencies when it is fetched from a repository, so `node_modules/explainer/dist/index.js` exists after `npm i`. A branch or commit works the same way: `github:the-greenman/explainer#<branch-or-sha>`.

**npm 12 and later** refuse git dependencies and their install scripts by default. In the site, allow git sources (`allow-git=all` in `.npmrc`) and approve the build script (`npm install-scripts approve explainer`, which adds an `allowScripts` entry to `package.json`; it pins the commit by default, so re-approve after moving the tag, or approve with `--no-allow-scripts-pin`). Measured with npm 12.0.2; npm 10 and 11 not tested.

## scrub-root
`<explainer-player play="scrub" scrub-root="#article">`: progress is the scroll position through that element (0 when its top reaches the viewport top, 1 when its bottom reaches the viewport bottom), so a sticky player inside a tall article is scrubbed by scrolling the article. Without it, the player's own position through the viewport is used.
