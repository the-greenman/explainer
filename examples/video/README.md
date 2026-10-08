# Video example: decision records (first real-media run, issue semanticops.com#30)

Two real talking-head clips as `video` segments (`intro` then `purpose`) with overlay cues, captions, a held choice, and rate/reverse/scrub controls. This is the first time the media sync paths ran against files. They work; numbers below.

Run: `sh prepare.sh` once (re-encodes the `demo/video/` sources with a keyframe every 0.5 s and extracts the embedded subtitles to WebVTT; outputs are git-ignored), then `npx vite` and open `/examples/video/`. Measure: `npx vite --port 5199 --strictPort &` then `node examples/video/check.mjs [shotDir]` (headless Chromium via the playwright install in CLAUDE.md; prints the table below and saves screenshots). Unit tests: `node --test examples/video/`.

## What is in it
- `manifest.json`: segments `intro` (38.6 s) and `purpose` (48.7 s, `ends: stop`), markers `start`, `four-questions` (intro 15), `purpose`, `record` (purpose 20.4). Cues:
  - intro `lower-third` title at 1.0-6.6 (left, above the native captions, clear of the face).
  - the four questions as a numbered-list `panel` (right), items timed to speech (`at` = 0.1, 4.5, 5.7, 7.5 s from cue start, i.e. 15.1, 19.5, 20.7, 22.5), up until 28.2.
  - `cycle` diagram (local component, `components.ts`) on purpose 1.3-16: Debate, Decide?, Forget, Repeat; arcs draw in with `p`.
  - `emphasis` (local): clear / visible / useful at purpose 40.2, 41.0, 41.8. **These times are estimated from the line's word pacing (15 words over 5.9 s in the VTT), not checked by listening.**
  - `choice` (variant `scrim`) with `hold: true`, 47.0-48.6, `loop_from: 47.0`. Options: Watch again (goes_to `start`), Replay the four questions (goes_to `four-questions`), Jump to the decision record (goes_to `record` and sets `revisit=yes`, which reveals a gated lower-third at purpose 20.6-26).
- Core additions (small): intro variant `lower-third`; numbered-list variant `panel` and optional per-item `at`; choice variant `scrim`. All named variants, no free-form params. Tests in `test/purity.test.ts` and `components.test.ts`.
- Layout rule found by looking at the frames: the speaker's face fills x 27-70% of the frame and native captions are bottom-centre, so overlays live in the left/right 27% columns. Cards are translucent dark with white text so they read over a white wall and the painting.

## Measurements (headless Chromium, localhost, H.264/AAC `canPlayType` = "probably")
| Path | Result |
|---|---|
| Forward 1x | clock.t 0.996 s per wall s; currentTime 0.996; abs(currentTime - clock.t) max 0.0004 s; 0 stalled samples of 361; 30.0 frames/s presented |
| Forward 2x | clock.t 1.993 per wall s; abs diff max 0.0005 s; 0 stalls of 360; 56.5 frames/s |
| Reverse (-1) | clock.t -1.000 per wall s; abs(currentTime - clock.t) 0.000 (the clock writes it each frame); 39.6 frames/s presented; video is `seeking` in 100% of samples (498 seeking vs 94 seeked events in 5 s: most seeks are superseded); presented frame vs clock offset p50 0.016 s, p95 0.017 s |
| Scrub | 40 inputs in 2.1 s: currentTime always equals clock.t; seeking in 25% of samples; isolated paused seek to first presented frame 15-33 ms (the 0.5 s keyframes help) |
| Overlay DOM at 3 t per segment, reached by seek / forward play / reverse play | identical in 6 of 6 (t pinned exactly after pausing; media state does not affect overlay markup) |
| Boundary intro to purpose (playing) | last intro frame (mediaTime 38.57) to first purpose frame: **117-133 ms gap** (normal frame interval 33 ms), about 3 dropped frames; swap to first frame 33-48 ms; loadstart 1 ms, loadedmetadata 11, canplay/playing 22 ms after the swap; clock.t goes 38.585 to 0.000 with no jump, then stalls 83-140 ms until the new file's first frame; afterwards abs(currentTime - clock.t) max 0.002 s. Captions switch correctly: one track, `purpose.vtt`, 10 cues, showing, right cue active. Best case: localhost, file in cache. |
| Reverse across boundary purpose to intro | clock.t 0.002 to 38.599 (history entry), first intro frame 32 ms later at mediaTime 38.57, seeked 24 ms, then -1.000 per wall s with abs diff 0.000 |
| Hold at the choice | clock stops exactly at 48.600 (constant over 4.5 s); media loops 47.0-48.6, muted, playing (2 wraps in 4.5 s; each wrap is a seek); 3 buttons render; click on option 2 lands in intro at t 16.2 after 1.5 s (startup lag ~0.3 s); key `1` goes to intro; key `3` goes to purpose 21.3 with `revisit=yes` and the gated card visible; cross-segment `goes_to` loads the right file each time |
| `ended` | purpose (out == file duration): clock t 48.700, `playing` false, `video.ended` true, ended event at 48.700. Intro: **no `ended` event observed**; the player sees the end and swaps `src` first, which drops it. The clock does not depend on the event. |
| Errors | 0 console/page errors; 3 swallowed `play()` AbortErrors (interrupted by `pause()` / a new load), benign; the browser cancels media range requests (ERR_ABORTED) on src swap, expected |

Caveats: 1x measured 0.996 not 1.000 (headless rAF timing over 6 s, not investigated). Reverse and scrub numbers are for the 0.5 s keyframe encode; the original clips (2.2 s keyframes) were not measured.

## Bugs found and fixed in core
1. **Stale caption after a segment swap** (`src/player.ts` `loadSegment`). Removing the old `<track>` while one of its cues was displayed left that cue painted over the new video ("And when to revisit?" from intro under the purpose captions). Fix: set old tracks to `mode = 'disabled'` before `replaceChildren()`. Evidence: screenshot before the fix vs after (`shot-purpose-8s.png`).
2. Trap rather than core bug: default `choice` buttons take `--explainer-bg` / `--explainer-ink`; on a dark page theme they rendered black on black over video. The `scrim` variant sets its own colours.

## Findings and open issues
- **Boundary gap is about 120 ms locally**: a visible freeze of about 4 frames, with the clock and audio paused for the same time. It is the single-element design (`ponytail:` in `player.ts`). A second preloaded element was not built. Over R2 the gap will be network latency (first byte plus moov of the next MP4). A second element preloading the default `next` and swapping at the boundary would remove it for default continuation; `goes_to` jumps would still gap. Owner call. Cheaper first: choose cut points where a hard cut is natural, or author continuous takes as one file.
- Reverse is correct but not smooth: a stream of superseded seeks (about 40 frames/s presented; the picture can lag the clock by a frame). Fine with 0.5 s keyframes; 2.2 s originals will be worse (not measured).
- `back()` after a held choice returns to the end of the segment (48.6) without re-holding, so playback runs to 48.7 and stops. Probably wants to re-trigger the hold. Not changed.
- The hold loop wraps with a seek, so there is a small hitch on every loop.
- Intro `ended` never fires (above), harmless.
- Not verified: Safari/Firefox, phones, real network or R2, audio audibility (headless), the captions on/off button (written, not driven), `play="enter|scrub"` with video, emphasis word timing against the voice. Scrub input is dispatched as an `input` event rather than a mouse drag.

## Screenshots
`shot-intro-3s.png`, `shot-intro-23s.png`, `shot-purpose-8s.png`, `shot-purpose-44s.png`, `shot-choice-hold.png`, `shot-gated-record.png` (written by `check.mjs`, 960x540 stage). The held choice dims and covers the whole frame including the face (scrim, centred prompt); the other overlays stay in the side columns.
