# Flights: breaking the wall (experiment)

An object (a logo) moves between **anchors** on one reversible timeline. An anchor is a box on the page outside the player, or a box inside
the player's canvas. Scrubbing backwards runs it in reverse. This is a capability probe: it lives in `examples/flight/`, not in `src/`, and
does not change the player. Open `/examples/flight/` (`npm run dev`).

Why it is drawn outside: the stage and the design canvas are `overflow:hidden`, so nothing inside a scene can leave the video. The flier
is a clone of the object in a page-level layer (`position:fixed; inset:0; pointer-events:none; z-index:2147483000`).

## Files

- `flight.ts`: pure. `flightBoxAt(stops, rects, segmentId, T)`, `flightStateAt`, `settledTime`, `fallAt`. No DOM.
- `flight-element.ts`: `<explainer-flight for="#player">`. Measures anchors, listens to `explainer:time`, paints.
- `index.html`, `flight.css`: two players, each with its own flight. `check.mjs`: headless checks. `flight.test.ts`: pure tests.

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
- Only stops of the current segment count: the experiment is single-segment per player. Constants (`FALL_*`, `POP_*`) are named in `flight.ts`.

## Rules

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
