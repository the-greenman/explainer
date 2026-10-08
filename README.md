# explainer

Video, audio or pure animation plus text and diagrams on **one timeline**, as a single web component `<explainer-player>`. Zero runtime dependencies, vanilla TypeScript.

## The one-clock rule
The player owns a virtual clock `{segmentId, t, rate, playing}` (`t` in seconds within the segment). Layers never have their own time source; each frame every cue gets `p = clamp01((t - start) / (end - start))` and `component.render(node, p, data, vars, items)`.
- Forward with media: media plays natively, the clock *reads* `currentTime`.
- Reverse / scrub / no media: media is paused and muted, the clock advances itself and *writes* `currentTime`.

A segment graph with a history stack: reversing past a segment start returns to the previous *history* entry at its exit time; `back()` does the same as a step.

## Manifest
Schema: `schema/explainer.schema.json`.
```json
{ "id": "", "title": "",
  "segments": [{ "id": "", "kind": "video|audio|none", "src": "", "in": 0, "out": 12, "captions": "", "next": "segmentOrMarkerId|null", "ends": "continue|stop" }],
  "markers":  [{ "id": "", "segment": "", "t": 0, "label": "" }],
  "cues":     [{ "id": "", "segment": "", "start": 0, "end": 0, "renders": "<typeRef>@1", "variant": "", "data": {}, "items": [], "hold": false, "loop_from": 0, "when_var": "", "when_value": "" }] }
```
Choice options (`items` of a choice cue): `{id, label, goes_to?, sets_variable?, sets_value?}`. For `kind: none`, `out - in` is the duration.

## Commands and events
Public methods: `play pause seek(t) setRate(r) jumpTo(id) back choose(optionId)` (negative rate = reverse).
Dispatch `explainer:command` with `detail: {action: play|pause|seek|rate|jump|back|choose|set, to?, rate?, t?, option?, var?, value?, target?}` on a player or the document (document: the first player, or those matching `detail.target`; `rate` also starts playback).
Buttons: `[data-explainer-action="play|pause|seek|rate|jump|back"]` with `data-explainer-to` / `data-explainer-value`, optional `data-explainer-target="selector"`. Scroll sections: `[data-explainer-seek="markerId"]`.
Emitted (bubbling): `explainer:segment`, `explainer:cueenter`, `explainer:cueexit`, `explainer:choice`.

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

## Commands
`npm run dev` (gallery at /demo/; examples at /examples/creation/ and /examples/equilibrium/), `npm run build`, `npm test` (includes examples).

Project context, status and next steps: `CLAUDE.md`. Plan: `docs/plan.md`. Capability findings: `docs/findings.md`.

## scrub-root
`<explainer-player play="scrub" scrub-root="#article">`: progress is the scroll position through that element (0 when its top reaches the viewport top, 1 when its bottom reaches the viewport bottom), so a sticky player inside a tall article is scrubbed by scrolling the article. Without it, the player's own position through the viewport is used. See `examples/creation/`.
