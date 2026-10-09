# Render page

The page `scripts/render.mjs` loads in headless chromium: a 1280x720 stage with a transparent background and `<explainer-player render>` (no media, no rAF loop). Query: `manifest=<url>`, `pack=<module url>` (repeatable, loaded before the manifest), `css=<stylesheet url>` (repeatable). When ready it resolves `window.__ready` and exposes `window.__frame(segmentId, t, vars)`, which calls `player.renderFrame`.

Not for browsing; see README.md "Rendering" for the CLI and its outputs. Open it by hand to debug a frame: `/examples/render/index.html?manifest=/examples/video/manifest.json&pack=/examples/video/components.ts&css=/examples/video/theme.css`, then `__frame('intro', 22)` in the console.
