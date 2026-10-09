# muDemocracy pilot: guide 1.1 explainer

> Tracked in **the-greenman/muDemocracy.org#309** (epic) and its sub-issues, not in this repo. PRs here reference those issues. This file records the design as built. The first plan (generic components re-skinned through theme tokens, text cards over a talking head) was replaced on 2026-10-09 after owner review, because themed approximations could not match the site's styleguide.

## Status
- **Live (unlisted, noindex)** at https://mudemocracy.org/decision-recording, on engine v0.3.0.
- It plays the owner's two recorded clips (1:27) choreographed as eight scenes.
- **Verified in production:** Chromium and Firefox. Safari still needs a real-device check.

## The idea: the page, performed
- **Every scene is the site's own markup and CSS, revealed by motion.** A scene is a `<template data-scene>` rendered by Astro from the site's components (`DecisionRecordCard`, `NumberedList`, `.hl mark`). The engine clones it into the player and only reveals what is there. It never builds or restyles brand markup, so the explainer cannot drift from the site.
- **A scene with no motion is exactly the page,** which covers print, no-JS and reduced motion. The explainer's poster is the opening scene's still, so before play it reads as page copy.
- **The explainer is a page component.** It can sit straight after the hero or anywhere else, and a page can hold several.
- **One edited video per explainer** (the owner's edit). Scenes cover it except where the face shows. The face is used occasionally: hidden for the hook, small in a corner, zoomed to full frame, beside the text like the hero image, or full frame with text over it.

## Engine pieces (this repo, brand-neutral)
| Piece | Since | What |
|---|---|---|
| `scene@1` | 0.2.0 | Clones `<template data-scene>` from inside the player, else the document. Transitions are `cut`, `fade`, `wipe` and `wipe-left`. |
| Choreography | 0.2.0 | Elements carry `data-at`, `data-for` and `data-fx`. The engine sets `--fx-p` (0..1) on each. The built-ins are `fade`, `rise`, `write`, `wipe` and `words`. Any other name is the site's own CSS reading `var(--fx-p, 1)`, e.g. muDemocracy's `hl-draw` highlighter. |
| Design canvas | 0.2.0 | `canvas="1280x720 400x500@<600"`: a fixed layout size, roughly the display size, so the site's px tokens hold. It is scaled to fit and switched by player width. |
| Poster | 0.2.0 | `poster="still"`. Children marked `data-explainer-poster` are the static poster; other children (controls) are kept. |
| Media slots | 0.2.0 | `data-media-slot` boxes in scene markup, timed like the choreography. The video takes the active slot's rect and eases between slots. With no slot the video is hidden while the audio continues; with no scene it fills the canvas. |
| Layers | 0.2.0 | `under` cues (opaque scenes), then the video, then `over` cues (text on the video). |
| Control API | 0.2.0 | `toggle`, `restart`, pointer and keyboard `scrub`, `captions`; `data-state`, `data-captions`, `--explainer-progress`, `explainer:time` and `data-explainer-display` readouts. The site draws the controls. |
| Caption strip | 0.3.0 | With slots, captions show in a strip below the stage, from the clock, so they are readable when the video is small or hidden. It is styled by the site. |
| Offline render | 0.3.0 | `--page` renders the real site page. Overlay mode cuts a transparent hole at the media box and writes `media.json`. Composite mode is drawn in the browser, frame-exact. |

## Site pieces (muDemocracy.org `src/motion/`)
- **`Explainer.astro`:** the player, the poster, the scene templates, the inline manifest, and the controls (disc icons, a hairline progress rule, a mono time readout, CC).
- **`scenes/*.astro`:** one per scene, with timings in `decisionRecording.timeline.ts`, each hung on a caption line.
- **`motion.css`:** site effects (`hl-draw`), slot boxes, the greyscale video and the caption strip, all from `tokens.css`.
- **Overrides of a site component's styles** use a doubled scene class. Bundled CSS order differs between dev and production, so equal specificity is not safe.
- **The `/styleguide` Motion section** shows scene stills.

## Media
- R2 bucket `mudemocracy-video` on `media.mudemocracy.org`, which is separate from the CMS bucket.
- Paths are versioned (`explainers/<slug>/v<N>/`): a new edit is a new `v<N>`, never an overwrite, because objects are cached as immutable for a year.
- Range requests are supported. CORS allows the site and localhost dev.
- The player and the poster video both use `crossorigin="anonymous"`. A non-CORS poster request otherwise poisons the browser cache for the player's request.
- **Installing the engine:** the site installs it as `git+https://github.com/the-greenman/explainer.git#vX.Y.Z`. The lockfile must say `git+https`, because the Cloudflare build has no SSH key. npm 12 needs `allow-git=all` and an `allowScripts` approval, pinned to the tag's commit.

## Workflow for each explainer
1. **Script and page together** (owner). Write the narration as beats against the page's sections.
2. **Scene list.** For each beat: the site component, what moves, the caption line, and the face or the full-frame scene.
3. **Build the scenes** in the site. Each is viewable statically as it is built.
4. **Animatic.** Scratch narration and the scenes, on the real page. The owner reviews pacing here.
5. **The owner's edit:** one video.
6. **Retime** to the edit's captions, then the review cut. Render (composite for YouTube and social, overlay plus `media.json` for an editor) in both canvases.
7. **Publish:** upload the media to a new `v<N>` path, and the page goes live.

## Open
- **Safari** (macOS and iOS) on a real device.
- **The owner's script and scene list** (muDemocracy.org#315) decide the rest of guide 1.1.
- **The copy and CTA** on the page are drafts.
- **SRS types** (plan step 3, muDemocracy.org#318) come once the scene and manifest shapes settle.
