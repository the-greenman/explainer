# Flights: breaking the wall (experiment)

An object (a logo) moves between **anchors** on one reversible timeline. An anchor is a box on the page outside the player, or a box inside
the player's canvas. Scrubbing backwards runs it in reverse. This is a capability probe: it lives in `examples/flight/`, not in `src/`, and
does not change the player. Open `/examples/flight/` (`npm run dev`).

Why it is drawn outside: the stage and the design canvas are `overflow:hidden`, so nothing inside a scene can leave the video. The flier
is a clone of the object in a page-level layer (`position:fixed; inset:0; pointer-events:none; z-index:2147483000`).

## Files

- `flight.ts`: pure, no DOM. The chain (what the element uses): `chainBoxAt(stops, progress[], rects)`, `playerProgress`, `scrollProgress`, `scrollStop`, `settleProgress`, `homeVisibility`. The first single-player form is kept and tested but no longer used by the element: `flightBoxAt(stops, rects, segmentId, T)`, `flightStateAt`, `settledTime`, `fallAt` (shared).
- `flight-element.ts`: `<explainer-flight>`. Measures anchors and scroll stretches, listens to `explainer:time` of every referenced player, paints.
- `index.html`, `flight.css`: three players, each with its own flight (demo 3: a scene logo whose ring stays). `guide.html`: one object through three parts of a page (`?mode=scrub` for scrub mode).
- `check.mjs` (index) and `check-guide.mjs` (guide): headless checks. `flight.test.ts`: pure tests.

## Markup

```html
<explainer-flight for="#p2"><script type="application/json">
{ "object": "#logo2",
  "anchors": [ { "selector": "#logo2" }, { "selector": "#bl-a, #bl-b" }, { "canvas": [1136, 576, 96, 96] } ],
  "stops": [ { "segment": "s2", "at": 0, "anchor": 0, "fx": "cut" }, { "segment": "s2", "at": 0.5, "for": 1.2, "anchor": 1, "fx": "fall" } ] }
</script></explainer-flight>
```

- `object`: the page element that is the thing. It is cloned for the flier (ids and `data-flight-home` stripped).
- Anchor `{selector}`: any element in the document, including one inside a scene (scenes are light DOM). A comma list takes the first match that has a box.
  Anchor `{canvas:[x,y,w,h]}`: design-canvas px of the player, mapped to the screen through `[data-canvas]` (its width over the `WxH` in the attribute).
- Stop: from `at` the object goes to `anchor` over `for` seconds with `fx`: `cut` (jump), `glide` (ease-in-out), `fall` (gravity: x eases, y accelerates, a wobble, a damped bounce under the landing line, exact landing), `pop` (appears at its anchor: scale 0 to 1 with overshoot, opacity in).
- Only stops of the segment the player is in count. Constants (`FALL_*`, `POP_*`) are named in `flight.ts`.

## Stops, drivers, and the last-started rule

`for` is now optional. A stop has a *driver* and a progress q:

- **Player stop** `{ "player": "#p1", "segment": "s1", "at": 2, "for": 1, "anchor": 1, "fx": "fall" }` (`player` defaults to the element's `for`, so old configs work). q = (t - at) / for in that segment (1 for `cut` or `for` 0). Not started (IDLE) while the player is in another segment or t < at.
- **Scroll stop** `{ "scroll": { "from": "#part1", "to": "#part2" }, "anchor": 2, "fx": "glide" }`. q = (line - fromBottom) / (toTop - fromBottom), clamped to 0..1, where `line` is the viewport middle (`innerHeight / 2`), `fromBottom` the bottom edge of `from` and `toTop` the top edge of `to`, all from `getBoundingClientRect`. So q is 0 when the `from` part's bottom crosses the middle of the screen and 1 when the `to` part's top reaches it: the gap between two parts scrolling past the middle. Not started while q <= 0. If the parts touch or overlap (gap <= 0) it is a step at the line. Needs room to scroll: if the `to` element is near the bottom of the page its top may never reach the middle (found in `guide.html`, see Findings).
- **The rule.** Stops are in declared order. The object is placed by the LAST stop that has started. It moves from where it was at the end of the previous stop to this stop's anchor, with this stop's `fx` and q. "Where it was" is the previous stop's anchor if that stop is finished or never started (a stop that was skipped counts as done, so a fast scroll never leaves the object stranded at an older anchor), or, if the previous stop is still moving, where it is now (recursive). Before any stop has started the object rests at the first stop's anchor (absent if that stop is a `pop`). All of it is `chainBoxAt(stops, progress, rects)`, a pure function of the per-stop progress values the element computes; it is tested for order independence, continuity at every start and end, the fast-scroll case and reverse (values going down undo the moves).
- This replaces the single-player rule for interrupted moves: the earlier stop's progress keeps running, so the "from" point can drift while the later stop is under way. Within one player and with non-overlapping stops it is identical.
- **Consequence of "last started wins".** Stops of different drivers can disagree: if a player-clock stop later in the list has started (a player that has reached its end), a scroll stop earlier in the list going back to 0 does not move the object until that player's clock goes back below the later stop. See Findings.

## Homes inside a scene, and a piece that stays behind

- The object and homes are looked up on every paint, not at connect. A scene's markup is cloned into the player's light DOM when the scene mounts, which can be after this element connects. If `object` matches nothing live, the first match inside a `<template>`'s content is used for the flier clone; the live element becomes a home when it appears. Homes that leave the document are forgotten.
- `data-flight-stays` on descendants of a home: while the object is not at that home, the home is `visibility:hidden` and each `[data-flight-stays]` descendant is `visibility:visible` (a child can override an inherited `hidden`), so that part stays. The flier clone is the home without its stays parts, with ids, home and stays marks and inline style removed (scene choreography sets `opacity`, `--fx-p` on a live element), so the clone must not depend on scene-scoped CSS: use presentation attributes (demo 3's SVG does). At the home both are restored to what they were. Everything is restored on disconnect.
- A flier whose rect has no size (a home that is not mounted yet) is not drawn.
- **Render mode** stays inert: flights do not render offline. In a video the scene element simply stays whole. That is the intended behaviour: it falls out on the page, and stays in the video. (Checked: with `render` on a referenced player there is no layer and no home gets an inline visibility. Not checked with `scripts/render.mjs` itself.)
- Demo 3: the logo (ring + dot) in the scene is the object and home at rest, `data-at`/`data-fx="fade"` on it brings it in. At 6 s the dot falls to the page block; the page block has the same logo markup, so it shows an empty ring (the stays part) until the dot lands in it.

## The guide page

`guide.html` (`?mode=scrub` for scrub mode): header circle (sticky header, the object's first home), three players, a page home at the end. Stops: (1) header, (2) p1 clock 0.5 s: falls into part 1, (3) scroll stop part 1 to part 2: carried down the gap, (4) p2 clock 2.5 s: glides to a second anchor inside part 2, (5) p2 clock 8.5 s: falls out of part 2 into part 3's anchor, (6) scroll stop part 3 to the end block. Stop 6 is a scroll stop on purpose: the end block is far below part 3 and a clock stop would land the circle there while the reader is still watching part 3; a scroll stop is paced by the reader and reversible by scrolling. Stop 5 is a clock stop as asked: the circle lands in part 3 when part 2 ends, even with part 3 below the fold. `?mode=scrub` makes every part `play="scrub"` with `scrub-root="#partN"`, parts 230vh tall and the players sticky.


- Before the first stop the object rests at the first stop's anchor, or does not exist if that stop is a `pop` (absent). Start with a `cut` stop at 0 for "starts here".
- A stop that begins while the previous is still moving starts from where the object was just before (recursive, like `mediaBoxAt`), so the path is continuous.
- The box is a pure function of `(segmentId, T, measured rects)`; any order of seeks gives the same result.
- Homes: `data-flight-home` marks a real page element that shows the object (the object itself is one; so is any selector anchor you mark). While the object rests at a home, that element shows and the flier is hidden. At every other time all homes of the flight are `visibility:hidden` (layout kept), restored on disconnect. Without JavaScript every home shows (two logos in example 2): acceptable here.
- Player with the `render` attribute: the element does nothing (no layer, homes untouched). Flights do not render offline.
- `prefers-reduced-motion: reduce`: the move is a cut; the rest state of the latest activated stop is shown.
- Anchors are measured with `getBoundingClientRect` at every paint, in viewport space, so the page can scroll during a flight. Repaint on `explainer:time`, `explainer:segment`, window scroll (capture, passive), resize and a ResizeObserver on the player.

## Findings

Observed with `check.mjs` in headless Chromium (1100x800), unless marked otherwise.

- **It works as a layer.** The flier straddles the bottom edge of the stage (t=8.55 in example 1), which the stage's own `overflow:hidden` makes impossible for anything inside it. It also draws over the controls row between the player and the footer (pointer-events none, so the controls still click, not tested by hand).
- **Order independence and reverse hold.** Same flier rect, home visibility and style for the same t in forward, shuffled and reverse call order (15 times, both players). Playing in reverse from 9.8 to 9.1 gave exactly the style of a seek to 9.1.
- **Selector anchor in a scene that is not shown:** the scene's wrapper is `hidden`, so `getBoundingClientRect` is all zero (`#bl-a` at t=7.5 was 0x0). The element falls back to the last good rect for that anchor. That fallback is untested in the browser: the example avoids it with a comma list (`#bl-a, #bl-b`), and with a single selector a cold seek straight into a time when the scene is hidden (nothing measured yet) would give a zero rect and an invisible flier. Prefer a canvas anchor, or one anchor element per scene in a comma list.
- **Scene crossfade:** at t=4.9 both scenes have a box; the comma list takes the first in document order. They were at the same place so the logo did not move. With different places it would jump when the first scene's wrapper hides (not tried).
- **Scroll during a flight:** with the page scrolled 150 px mid-fall the flier moved with the page exactly (dy -150, 1.5 px tolerance); a scroll with no `explainer:time` (paused) repaints from the scroll listener alone.
- **Off-screen targets:** before the check scrolled players into view their anchors were 1000+ px below the viewport; the rects and the order-independence results were the same as on screen. Whether anything misbehaves in a real browser at extreme offsets is not observed.
- **Paint cost:** 180 paints in 3 s of play with both players running: average 0.12 to 0.2 ms, max 0.8 ms (measured around `paint()`, including the anchor measures; not including the browser's own layout/composite afterwards). It forces layout reads each paint (`getBoundingClientRect` on each anchor), so a page with heavy layout would pay more. No attempt was made to cache.
- **Reduced motion:** with `reducedMotion: reduce` the flier shows at the stop's anchor from the stop's `at` (cut), and lands at once at the last stop.
- **Render attribute:** `?render` gives no flight layer and untouched homes.
- **A bug found by the checks:** after the flier was hidden, an unchanged style string made the next show a no-op (it stayed `display:none`). Fixed by clearing the cached style when hiding.
- **Not observed:** layering against a site's sticky header (this page has none; the layer has `z-index:2147483000` so it would be above it, and over a modal too), Safari/Firefox, touch devices, a real narrow viewport (the portrait canvas), fullscreen (a fixed layer on `body` would not be inside a fullscreen player), multi-segment explainers, and how the bounce looks to a human (only screenshots at single frames were looked at).
- The `explainer:time` event only fires when `t` or the segment changes, so a player that is idle gives no repaint on its own; the element paints once on connect from the player's clock if there is one.

### Findings from the three-part guide (Chromium 1100x800, `check-guide.mjs`; "observed" unless marked)

- **Scroll-back equals scroll-forward when the clocks are equal.** 28 positions in enter mode with four fixed sets of clocks (paused and seeked), and 46 positions in scrub mode (clocks set by the scroll itself): same flier rect, home visibility and anchor at each position in both directions.
- **Enter mode and scroll stops disagree (observed, real run).** After part 2 has played to its end, the object is at part 3's anchor. Scrolling back up to part 2 shows part 2's end with the circle off screen below in part 3, and scrolling up through the gap does not carry it back: the scroll stop is outranked by the later clock stop, until part 2 rewinds. The page rewinds a part only when it leaves the viewport below it, at rate -1, taking its length (part 2: 10 s). Observed: 3.1 s of rewind after scrolling to the top gave the object at part 2's second anchor; 11.5 s gave part 1. Scrub mode has none of this, since the clocks are functions of the same scroll.
- **Fast scroll.** Pure function: never strands (tested over all 64 started/not-started patterns of 6 stops). In the browser: jumping straight from the top to part 3 in enter mode (no clock has moved) leaves the object visible but at part 2's anchor, which is off screen above (the scroll stop to part 2 finished, the clock stop that would carry it to part 3 never started). In scrub mode the same jump puts it on screen at part 3's anchor, because scrubbing seeks part 2 to its end. Jumping to the end block puts it at the end home in both modes (after the padding fix below).
- **Last scroll stretch needs room.** The end block was near the bottom of the page, so its top never reached the viewport middle and the object stayed mid-flight at the bottom of the page (seen in the scroll-back filmstrip). Fixed in the page with bottom padding. Any scroll stop whose `to` is at the end of the document has this.
- **Clock stop below the fold.** When part 2 ends, the circle falls to part 3's anchor, which is below the screen: the circle leaves the visible page at the bottom edge and is not seen again until part 3 scrolls in. Seen in the filmstrip (frame 8, forward) as a circle half cut at the bottom of the screen.
- **Resize.** 1100x800 to 800x700: the object stayed on part 3's anchor (flier 74.5 px to 57.5 px, as the anchor box scaled with the canvas).
- **Sticky header.** The flier is above the sticky header (z-index 2147483000): at p1 t=0.58 it straddles the header's bottom edge as it falls out of it (`g-over-sticky-header.png`). A site header with a higher z-index than that, or a modal, would be drawn over by the flier, not under.
- **Reduced motion.** At 53 scroll positions the object was always at an anchor or a home, never between.
- **Not observed:** a real scroll with momentum/smooth-scroll, touch, Safari/Firefox, a part taller than the viewport with a sticky player in enter mode, a sticky header with a different stacking context, and screen reader behaviour.

## Evaluation (cost)

For the owner deciding whether to adopt this into the engine. Marked [observed] or [not observed].

**Size.** `flight.ts` 160 lines pure (about 58 for the chain, about 100 for the earlier single-player form, which the element no longer calls: it can be deleted, leaving about 100 pure lines). `flight-element.ts` 183 lines DOM (measurement, listeners, lazy lookup, stays, flier layer). `flight.test.ts` 207 lines (20 tests, including the chain). `check.mjs` + `check-guide.mjs` about 380 lines of browser checks. Page markup for the guide: one JSON block of 6 stops and 6 anchors, plus the anchor boxes in the scenes. `src/` is unchanged.

**Per-paint cost.** [observed] Demo page, two players playing at once: 180 paints in 3 s, 0.1 to 0.15 ms average, 0.4 ms max (around `paint()`, anchor measures included; before the chain change the figures were similar). The guide has one flight, three players and scrolling: not separately measured, but each paint reads the rects of up to 6 anchors and of 2 elements per scroll stop (roughly 10 `getBoundingClientRect` calls), plus a `querySelectorAll` for the object, the homes and the stays parts, so it should be a few times the demo figure. [not observed] on a heavy page: every call forces layout if anything is dirty, and the scroll listener repaints on every scroll event (capture, passive), which can be every frame.

**Failure modes.** [observed] enter-mode clock stops vs scroll stops disagree on scroll-back, and a fast jump in enter mode leaves the object at an off-screen anchor (see above): these come from "last started wins" across independent drivers, and are inherent unless a scroll stop is allowed to override a clock stop (it would need a rule for which driver is the truth: not designed). [observed] a scroll stretch to an element at the end of the page never completes. [observed] a scene that is hidden has no box, so its anchor falls back to the last good rect (zero if never measured): a flier with a zero rect is now not drawn. [observed] resize works; [not observed] a layout that shifts after fonts load or images arrive (anchors are re-measured on every paint, so it should self-correct on the next scroll or time event, but an idle page does not repaint on layout shift: only the player's ResizeObserver does). Flights in a rendered video do nothing [observed in the harness], so a page and its video differ by design.

**Accessibility.** The flier layer is `aria-hidden` and `pointer-events:none`. Because the real element goes `visibility:hidden` while the object is away, a home with an accessible name (`role=img`, `aria-label`) disappears from the accessibility tree except for its stays parts, and exactly one place in the page has the logo at a time (the home where it rests). [not observed] with a screen reader. Focusable content inside a home would become unfocusable while the object is away. Reduced motion shows only rest states [observed]. A page without JavaScript shows every home, so several logos [observed in the demos, intended].

**Layering.** [observed] above a sticky header; the layer is the highest z-index possible and sits in `body`, so it is also above modals and, [not observed] but by construction, not inside a fullscreen player (a fullscreen element hides the rest of the page). The page cannot choose to put it under something.

**What moving it into `src/` would take.** (1) API: an element `<explainer-flight>` with the JSON config above, or, better, attributes on the page markup (`data-flight-home`, `data-flight-stays`, a `data-flight="part1:0.5 for 1.2 fall"`-style line) so the page needs no JSON block. (2) Manifest/schema: the clock stops belong to a player and could live in its manifest (a `flights` list: object, anchors by selector or canvas, stops with segment/at/for/fx), which would let `render` skip them knowingly and a page-level tool read them; the scroll stops and the homes are page facts and cannot be in a player's manifest. A page-level config is therefore needed in any case, and the SRS types (plan step 3) would need a flight/stop type with a driver choice. (3) The pure module and its tests move over as they are, about 100 lines plus the tests. (4) The element needs the lazy-lookup and stays logic hardened and a decision on how a scroll stop and a clock stop of one player arbitrate (see Failure modes). (5) The render path: today inert; a composite render of a flight that stays in the video would need the chain plus real rects, which the offline render does not have.

**Recommendation.** As a capability it is cheap and it works: it is a small pure core and one 183-line element with no change to the player, and both owner stories are met (a piece that stays behind; one circle carried through three parts). It is not yet something to ship in `src/`. Main risks: (1) enter mode with scroll stops gives a surprising result on scroll-back and on fast jumps, so the guide pattern is only reliable with `play="scrub"` (or all-clock stops); (2) a fixed top-of-everything layer cannot respect a site's own stacking; (3) accessibility rests on a decorative flier and on hiding the real element, which has not been tried with assistive technology; (4) paint is driven by scroll events and forces layout. A reasonable next step is to keep it in `examples/` (or a site pack) behind the muDemocracy pilot's needs, and move it only if a page needs it that scrub mode cannot serve.
