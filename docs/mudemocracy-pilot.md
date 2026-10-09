# muDemocracy pilot: guide 1.1 explainer, theme and component library

> Decided by the owner on 2026-10-09. The work is tracked in **the-greenman/muDemocracy.org#309** (epic) and its sub-issues #310–#322, not in this repo. PRs here reference those issues. The workflow, gates and definition of done are in the epic. This file records the design.

## Decisions
- **The first explainer is guide 1.1, Decision Recording** (`guide-1ff0ab83`, slug `decision-recording`).
- **The two clips in `examples/video/` are its opening segments.** `intro` (38.6 s) is the hook and the four questions. `purpose` (48.7 s) is debate → decide → forget → repeat, and "clear, visible, useful".
- **The remaining segments (about 3.5 min) follow the guide sections:**
  - Process
  - How to do this in a meeting
  - What to record
  - Example
  - What makes this example work
  - Things to watch out for

  The script and storyboard are #315.
- **muDemocracy.org's `src/styles/tokens.css` is the brand authority.** This repo maps onto it and never defines brand values. A value the contract needs that tokens.css lacks, such as motion tokens, is proposed for tokens.css.
- **Tracking lives in muDemocracy.org.** Code stays here until the publish issue (#322), which is the move-over.

## One library, two surfaces
- **Components are the existing pure `render(node, p, data, vars, items, dur)` functions with named variants.** They read only theme tokens.
- **The same component serves both surfaces:**
  - **Website:** an `<explainer-player play="enter|scrub">` with a `none` segment. It's in-place animation, not a video.
  - **Video:** an overlay cue on a `video` or `audio` segment, and in the offline render.
- **`meta.surfaces`** is `web`, `video` or both (#313). Video-only elements, such as burned-in captions, title cards and layouts tied to the speaker's frame, are `video`-only components, not a separate library.
- **p=1 is a complete static frame.** It is what print, no-JS and `prefers-reduced-motion` show (#313).

## Theme contract (#310, #311)
- **These are CSS custom properties.** The player uses light DOM, so the host page's CSS reaches it. The core already reads `--explainer-ink`, `--explainer-accent`, `--explainer-bg` and `--explainer-font`. The contract formalises and extends them:
  - **Colour roles:** ink, paper, accent, highlight, muted, line, card, card-ink. `card` and `card-ink` are for text over a picture.
  - **Type:** family, mono, and a stage scale in container units.
  - **Stage:** safe-area insets, and the side columns that keep overlays clear of the speaker's face (x 27–70 %).
  - **Motion:** named durations and easings. Pure renders need curves as JS functions, so the theme names the curve and the code holds the function.
- **No literals in core components.** For example, `intro.ts` hard-codes `rgba(12,14,22,.7)` and `#fff` today.
- **The muDemocracy theme is one file that only maps values:** paper, ink, highlighter `#f2ff36`, IBM Plex Sans and Mono.

## Packs
- **Core** (`src/components/`): brand-neutral primitives. The likely additions from the storyboard are a highlighter stroke, a table reveal, an example card and a callout (#317).
- **muDemocracy pack** (`examples/mudemocracy/`): the theme mapping, domain diagrams (for example the debate cycle that is local to `examples/video/` today) and the manifest. Where it lives long-term is decided in #322.

## Styleguide (#312, #314)
- **`/styleguide/` in the gallery** shows every component and variant with a scrubber, in a web column and on the 16:9 stage. It uses the muDemocracy theme, with a switch to the default.
- **A script writes the review frames:** p = 0, 0.5 and 1 on both surfaces. The owner approves components from these frames.
- **The style rules** cover:
  - colour roles
  - the smallest type size on stage
  - text over video on a paper card, not a dark scrim
  - motion principles, proposed as: ink writes, the highlighter draws on, motion explains or else stays still, and entrances follow the speech

## Order
1. Theme contract, then the muDemocracy theme, then the styleguide. The script and storyboard run alongside.
2. Restyle the two segments (#316).
3. Build the storyboard's components.
4. SRS types for the settled components (plan step 3, #318). This comes after real use has settled the components' shapes, and that is why it now follows the pilot work instead of preceding it.
5. Animatic, then recording, then the review cut, then publishing.
