# Experimental modules

Code in `src/experimental/` is **experimental**: a capability we want to be able to use and manage, but that is less standard than the engine.

What that means here:

- **Not exported from the main entry.** `src/index.ts` (`explainer`) never imports it. Each module has its own subpath export (`explainer/experimental/<name>`, built to `dist/experimental/<name>.js`) and its own build entry in `vite.config.ts`. Importing the main entry does not pull any of it in (the build is checked for that).
- **The API may change in any minor release**, or the module be removed. It is **not covered by the compatibility promises** in `CHANGELOG.md`; its changes are listed there under "Experimental".
- **Each module states its status and known limits** in its own README, and exports `status = 'experimental'`.
- **Tests run in `npm test`** like everything else (`test/<name>-*.test.ts`), and the browser checks have a script (`npm run check:flight`).
- Examples of use live in `examples/<name>/`.
- A module may import from the rest of `src/`; nothing in `src/` outside `experimental/` imports a module here.

## Modules

| Module | Subpath | Status |
|---|---|---|
| [flight](flight/README.md): one object flying between anchors inside and outside players, with effects as pluggable modules; the in-video karaoke marker (a scene extension) and phrase timing from the narration VTT | `explainer/experimental/flight` (elements, registers the marker); `explainer/experimental/flight/pure` (no side effects: types, effects, chain, drivers, phrases, contract; usable at build time in node) | experimental |

The marker plugs into scenes through `registerSceneExtension` (src/components/scene.ts). That extension point is a **stable, generic** part of the engine, not experimental: it knows nothing about flights.

## Promoting a module to stable

All of these, decided by the owner:

1. A real page needs it and the alternative (scrub mode, a site pack) does not serve. Two consumers are better than one.
2. The known limits in its README are fixed, or accepted and documented as part of the stable behaviour.
3. Accessibility is tried with assistive technology, and Safari, Firefox and touch are checked.
4. The public surface is small and named: the config/markup shape is settled (and has a schema, or SRS types if it belongs in a manifest).
5. Tests cover the contract (pure parts and the element), and the browser checks pass.
6. Then: move the export to the main entry or keep a stable subpath, drop the "experimental" flag, remove `status`, and write a CHANGELOG "Added" entry with the compatibility promise starting from that release.
