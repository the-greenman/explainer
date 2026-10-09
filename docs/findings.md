# Capability findings (2026-10-08)

There were two probes. Each one ported an existing animation onto the player to test whether the model fits. Neither tried to recreate its original exactly. The probes and their detailed findings, with file:line references into the source repos, live in the private workshop repo (the-greenman/explainer-workshop, `examples/creation/` and `examples/equilibrium/`), because they adapt code from private repos.

## Verified in headless Chromium
In each probe, the frames were identical at the same time whether it was reached forwards or backwards.

| Capability | creation (the-system-networks) | equilibrium (equilibrium.cards hero) |
|---|---|---|
| Canvas animation as a library component | ✓ | ✓ |
| Text layer and visual layer as separate cues on one clock | | ✓ |
| Reverse, rate and scrub with no drift | ✓ (by scroll) | ✓ (2× measured 2.01×, reverse −1.00×) |
| Scroll-driven, reversing when you scroll up (`scrub-root`) | ✓ | |
| Markers, jump, back, prev/next | | ✓ |
| Hold, then choice, then branch | | ✓ |
| Variables (`{name}`, `when_var`) | | ✓ |

## Porting cost depends on how much state the old code keeps between frames
- **equilibrium:** 0 lines changed in the scene bodies. Every scene already redraws all earlier layers from scratch.
- **the-system-networks taiji:** 1 line.
- **starfield:** about 25 lines, to replace randomness and accumulated time.
- **eight-trigrams:** about 120 lines, to replace wall-clock transitions and phases that depended on the previous phase. It failed every reverse and skip path.

These patterns broke the model: `Math.random`, accumulating time (`time += dt`), `Date.now()`, enter/exit hooks that reset state, geometry built in the constructor, and timers driving text (`setTimeout` narration).

## Fixed in the core (commit 9201792)
1. Cue layers ignore pointer events. A later non-interactive cue had been swallowing clicks on the choice buttons.
2. A cue is now un-hidden before it renders. It had been measuring 0×0 on its first frame.
3. `render` now receives the cue duration as `dur`.
4. A canvas base and seeded random were added: `canvasComponent` and `rng(seed)` in `src/components/canvas.ts`.

## Still open (add when the muDemocracy pilot needs them)
- Crossfades and overlap between adjacent cues.
- Built-in prev/next and "which marker am I in". Today these are page code.
- Asset preloading. The equilibrium card images were dropped because `img.complete` changes over time.
- A text equivalent per marker or stage for accessibility, as equilibrium's StudyDiagram stages have.
- Theme colours read once at import, in equilibrium's `config.js`.
