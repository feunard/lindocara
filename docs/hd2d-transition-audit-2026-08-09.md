# HD-2D transition audit - 2026-08-09

## Status

The playable game and the adventure editor now use the same HD-2D terrain, actor, content and
movement path. No known migration blocker remains in the audited scope.

Final local verification:

- `npm run v`: passed in 123.8 seconds.
- Lint: passed.
- Typecheck: passed for engine, hd2d, lab, server, renderer, client, editor, ui, testing, catalog,
  main and tooling programs.
- Tests: 264 files and 2,345 tests passed.
- Migration drift: passed.
- Catalog and authored-map checks: passed.
- Production build: passed.

## Editor parity

| Surface | Result |
| --- | --- |
| Existing maps | Owned maps reopen in the embedded stage; the false "map no longer exists" path is removed. |
| Terrain | Grass, sand, snow, ice and volcanic material authoring use the production HD-2D mesh. |
| Elevation | Levels 0 through 3 are authorable. Tall sides are continuous cliff faces rather than stacked boxes. |
| Stairs | East/west stair stamps show a cursor ghost, compile to ramps, render as 3D stairs and are traversable by the shared movement rule. |
| Pointer | Picking raycasts the visible terrain, so the pointer tip selects the cell under it on raised ground. |
| Camera/editor post-fx | Authoring keeps pan/zoom and disables tilt-shift only in the editor. Gameplay keeps the effect. |
| Decorations | Catalog props place with exact anchors/offsets, animated props advance frames and overlapping props use stable depth ordering. |
| Events | Every event kind has an HD-2D preview. Action, player-touch, event-touch, auto and parallel triggers execute in rooms. |
| NPCs and guards | Authored models are preserved; mobile NPCs interpolate between authoritative cells and use idle/run strips. |
| Harvest | Intact, hit, fade/replace/hide, respawn and live collider states share the production event path. |
| Quests | Definitions, prerequisites, objectives, dialogues, rewards, bindings, markers and play-test launch remain editable. |
| Preview | The sandbox uses the compiled heightfield and the real client movement controller without discarding unsaved edits. |

## Gameplay parity

| Surface | Result |
| --- | --- |
| Hero movement | Walk, jump, fall, glide, swim, drowning, ice sliding and thin-ice failure use `stepHero` on the client. |
| Movement presentation | Footsteps, surface traces, breath puffs, water entry/exit, swim ripples/strokes, skid, crack, shatter and landing feedback are consumed in the game. |
| Breath/UI | The HUD exposes the rounded underwater countdown; the scripting self view exposes raw breath, max breath and vertical velocity. |
| Glider | The lab canopy is present in the game with open/close state, facing, elevation and sound. |
| Water pose | Swimmers are lowered 0.5 tile below the waterline, matching the lab witness, while the authoritative position remains unchanged. |
| Camera | Right-mouse drag and controller right stick orbit the camera; movement rotates with the view and controls are documented in both locales. |
| Actors | Heroes, monsters, guards and authored NPCs select idle/run/attack state from live movement/action facts. Airborne stretch/squash and remote locomotion state are preserved. |
| Skills | The renderer has an exhaustive visual profile for every one of the 25 catalog skills across warrior, ranger, priest, rogue and peasant. Server timelines remain authoritative. |
| Projectiles | All 10 protocol projectile kinds have explicit oriented 3D forms, colors, accents and applicable trails/spin/pulse instead of one generic sphere. |
| Scenery | Static and animated authored assets use the same catalog geometry in the game and editor. Stable depth removes overlap flicker. |
| Authored monsters | Species remains the combat model; authored `graphicAssetId` now selects the visible idle/run model with safe fallback. |

## Authority and regression fences

- The server still decides damage, healing, resources, cooldowns, loot, XP, quests, death,
  projectiles, monster AI and event effects.
- Client-owned movement remains bounded by room terrain and coordinate limits.
- Mobility distance exhaustion, deadline expiry and server-side debit are covered.
- Corpse, transition and disconnect move reports cannot overwrite room-owned positions.
- Tile-unit Sacred Passage trail frames round-trip through the protocol parser.
- Authored monster speed migration distinguishes legacy pixel values from current tile values.

## Product decision outside the migration

Authenticated map CRUD remains intentionally collaborative across accounts, as existing service
tests specify. Heightfield replacement is owner-fenced, but list/read/rewrite/first/delete are not.
This is a product/security decision, not an HD-2D regression, and should not be changed silently.

## Deployment boundary

This audit certifies the repository and production build shape. Deployment state is certified
separately by the GitHub push/check run; no workstation shutdown is part of this work.
