# flight (experimental)

Status: **experimental**. Not part of the stable API (see [../README.md](../README.md)); it may change in any minor release.

`explainer/experimental/flight` defines `<explainer-flight>`: **one object** (a logo, a ring and a dot) moves between **anchors** on the page and inside players, on a list of **stops**. Each stop is driven by a player's clock or by the page scroll, and moves the object to an anchor with a named **effect**. Everything reverses with the drivers: scrubbing back runs it back.

The flier is a clone of the object in a fixed page-level layer, so it can leave the video (the stage and the design canvas are `overflow:hidden`). Nothing about the player or the stable engine changes. Demos and findings: [examples/flight/](../../../examples/flight/README.md).

```js
import 'explainer';                                  // players
import { registerFlightEffects } from 'explainer/experimental/flight';   // defines <explainer-flight>, registers cut/glide/fall/pop
```

## Files

| File | |
|---|---|
| `index.ts` | the public surface of the subpath; defines the element and registers the built-ins |
| `types.ts` | `Rect`, `Pose`, `FlightEffect`, `ChainStop`, `FlightBox`, `IDLE` |
| `effect.ts` | the registry: `registerFlightEffects`, `flightEffects(name)`, `getFlightEffect(name)` (unknown name: `cut`, one warning), `listFlightEffects()` |
| `effects/` | the built-ins, one module each: `cut`, `glide`, `fall`, `pop` (tunable constants are named in each: `FALL_SPLIT`, `POP_OVERSHOOT`, ...) |
| `chain.ts` | pure: `chainBoxAt(stops, q, rects)`; names no effect |
| `drivers.ts` | pure: `playerProgress`, `gatePlayerProgress`, `scrollProgress`, `scrollStop`, `settleProgress` |
| `homes.ts` | pure: `homeVisibility`, `toDocRect` / `fromDocRect` |
| `element.ts` | DOM: `<explainer-flight>` |

## Markup

```html
<explainer-flight for="#p2"><script type="application/json">
{ "object": "#logo2",
  "anchors": [ { "selector": "#logo2" }, { "selector": "#bl-a, #bl-b" }, { "canvas": [1136, 576, 96, 96] } ],
  "stops": [ { "segment": "s2", "at": 0, "anchor": 0, "fx": "cut" },
             { "segment": "s2", "at": 0.5, "for": 1.2, "anchor": 1, "fx": "fall" } ] }
</script></explainer-flight>
```

- `object`: the page element that is the thing. It is cloned for the flier (ids, home and stays marks stripped).
- **Anchor** `{selector}`: any element in the document, including one in a scene (light DOM). A comma list takes the first match with a box. `{canvas:[x,y,w,h]}`: design-canvas px of the `for` player, mapped through `[data-canvas]`.
- **Player stop** `{ "player": "#p1", "segment": "s1", "at": 2, "for": 1, "anchor": 1, "fx": "fall" }`. `player` defaults to the element's `for` (the single-player form). Progress q = (t - at) / for in that segment; IDLE (not started) in another segment or before `at`; 1 for an `instant` effect or `for` 0.
- **Scroll stop** `{ "scroll": { "from": "#part1", "to": "#part2" }, "anchor": 2, "fx": "glide" }`. q is 0 when the bottom of `from` is at the viewport middle and 1 when the top of `to` is; not started at 0. Touching or overlapping parts (gap <= 0) are a step.
- `fx` is the name of a registered effect (default `cut`).

## The rule: the last started stop

Stops are in **declared order**. The object is placed by the LAST stop that has started. It moves from where it was at the end of the previous stop to this stop's anchor, with this stop's effect: the previous stop's anchor if that stop is finished or never started (a skipped stop counts as done, so a fast scroll never strands the object), or, if it is still moving, where it is now (recursive). Before any stop has started the object rests at the first stop's anchor, or is absent if that stop is an `enter` effect. Stops that start at the same position chain in declared order (nothing is sorted by `at`). Stops of different drivers can disagree: a later clock stop that has started outranks an earlier scroll stop going back to 0.

## Effects: the contract, and adding one

```ts
type FlightEffect = {
  name: string;
  kind: 'move' | 'enter';   // move: previous pose -> anchor. enter: appears at the anchor from nothing (pop)
  instant?: boolean;        // a jump: finished the moment it starts (cut)
  at(from: Rect, to: Rect, p: number): Pose;   // pose at p in [0,1); pure; p >= 1 is the chain's rest at `to`
};
type Pose = { rect: Rect; rot: number; scale: number; opacity: number };
```

Rules, written as a check in `contract.ts` (`effectProblems(fx)` returns the broken rules as sentences, `[]` when kept) and run over every registered effect by `test/flight-effects.test.ts`. A site pack tests its own effects the same way: `for (const fx of myEffects) assert.deepEqual(effectProblems(fx), [])`. The rules: at p = 0 a `move` is exactly `from` (rot 0, scale 1, opacity 1) and an `enter` has scale or opacity 0; poses are finite on [0,1); the result depends only on the arguments (no `Math.random`, `Date.now`, state), whatever the order of calls; the input rects are not mutated and not returned; and unless `instant`, the pose approaches `to` (rot 0, scale 1, opacity 1) as p -> 1.

A site pack adds one and uses it by name:

```js
import { registerFlightEffects } from 'explainer/experimental/flight';
registerFlightEffects([{
  name: 'drift', kind: 'move',
  at: (from, to, p) => ({ rect: { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p, w: from.w, h: from.h }, rot: 0, scale: 1, opacity: 1 }),
}]);
// { "anchor": 2, "fx": "drift" }
```

A duplicate name throws. An unknown `fx` is a `cut` with a console warning (once per name).

## Homes and stays

- `data-flight-home` marks a real page element that shows the object (the `object` match is one; so is any selector anchor you mark). While the object rests at a home that element shows and the flier is hidden; at every other time all homes are `visibility:hidden` (layout kept) and are restored on disconnect. Without JavaScript every home shows.
- `data-flight-stays` on a descendant of a home: while the object is away the home is hidden but that part stays visible (a ring that stays behind while the dot flies). The flier is the home without its stays parts, so it must not depend on scene-scoped CSS (use presentation attributes).
- The object is looked up each paint (a scene mounts later than the element connects); until the flier is built, the first match inside a `<template>` is used. After that templates are not scanned.

## Render is inert

A referenced player with the `render` attribute: no layer, no listeners, homes untouched. Flights do not render offline: in a video the scene element stays whole.

## Reduced motion

`prefers-reduced-motion: reduce` settles every started stop to its rest (the move is a cut). Plus this rule for players:

- Under reduced motion a player with `play="enter|scrub"` does not play; it sits at its **still time**, usually the end of its segment, and emits `explainer:time` with that clock (`src/player.ts`, `showStill`). Read naively, every clock stop would count as started at load, and the object would sit at the last player stop (part 2 or 3 at the top of the page).
- So such a player counts only once the reader has **reached** it: its top edge at or above the viewport middle (the same line as scroll stops). Scrolling back above it un-starts it. A player with another `play` mode keeps its real clock.
- A player whose `data-state` is `poster` (not yet started) never counts.
- It is `gatePlayerProgress(q, { state, playMode, top }, reduced, line)` in `drivers.ts`.

## Painting

Events (`explainer:time`, `explainer:segment`, scroll, resize, load, `document.fonts.ready`, a `ResizeObserver` over the document element, the players and every measured anchor and scroll-stop element, a reduced-motion change) only mark the element dirty. One paint runs per frame, in one `requestAnimationFrame` (one pending at a time). `flush()` paints now if dirty (tests, check scripts). The first paint at connect is not deferred. Consequence: the flier can lag a player's own paint by **at most one frame**. Measured (`check.mjs`): an anchor moving at 300 px/s trails by about 5 px (one frame at 60 Hz); at a scene `rise` (12 px over half a second) that is about 0.4 px. Each paint makes one DOM query per selector. Fallback rects for an anchor that is not shown (a hidden scene) are kept in document coordinates, so they stay right after scrolling.

## Known limits

- **Enter mode vs scroll stops.** Clock stops and scroll stops of different drivers disagree on scroll-back and on fast jumps (the object can be left at an off-screen anchor). Reliable with `play="scrub"` or with all-clock stops.
- **A scroll stop whose `to` is at the end of the page** never completes (its top never reaches the middle); give the page room.
- **The layer is above everything** (z-index 2147483000, fixed in `body`): above a site's sticky header or modal, and not inside a fullscreen player.
- **Accessibility is untested** with assistive technology. The flier is `aria-hidden`; hiding a home hides its accessible name and any focusable content while the object is away.
- Not tried: Safari, Firefox, touch, smooth-scroll momentum, a sticky player taller than the viewport.
- Flights are not part of a manifest or the SRS types.
