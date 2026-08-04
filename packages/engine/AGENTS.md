# @lindocara/engine

The platform-free core: pure rules and shared contracts. **Imports nothing from Cloudflare, the
DOM, React or Node.** Valid in a browser *and* in workerd — its tsconfig gives it neither `DOM` nor
`@cloudflare` types, so a leaked platform global fails the typecheck (that is the point).

## Responsibility

- `simulation.ts` — the single source of movement truth: `step(position, input, dt)`. Both the
  server (to decide) and the client (to predict + replay) call the *same* function.
- `prediction.ts` — pure `reconcile()`/`prunePending()`. `death.ts` — the corpse/ghost state machine.
- `game.ts` — map geometry, collision, combat/progression constants. `protocol.ts` — the wire
  format with defensive parsing (`parseClientMessage` returns `null`, never throws).
- `tileset.ts`/`autotile.ts`/`tile-brush.ts`/`tile-layer-codec.ts`/`map-data.ts` — the layered map
  model and paint-time brushes. `zones.ts` — the zone catalogue.
- `i18n/` — FR/EN dictionaries (data only; the server sends codes, never prose). `skills.ts`,
  `combat-actions.ts`, `cooperation.ts`, `resources.ts`, `character.ts`, `adventure*.ts`,
  `event-commands.ts`/`event-interpreter.ts` (the pure, clockless command stepper).
- `hd2d/` — the HD-2D witness's geometry and movement rule, quarantined in its own subfolder
  rather than the flat root above (moved from `apps/lab` across two S2 tasks): `terrain-query.ts`
  (world-space collision queries over a heightmap), `collider-index.ts` (the sparse rect index
  disc queries test against), `map-data.ts` (a map as pure, defensively-parsed data),
  `hero-state.ts` (`HeroState`/`HeroInput`/`HeroSettings`/`HeroEvent`, the data the rule reads and
  writes), `locomotion.ts` (the friction-based movement model — one `pasAmorti` integrator, three
  materials' worth of friction/speed/skid), `thin-ice.ts` (the crack → break → refreeze state
  machine) and `hero-step.ts` (`stepHero`, the per-frame rule that ties the other three together
  and narrates what happened as `HeroEvent`s rather than playing sound or touching a billboard
  itself). These read in **tile units**, unlike `simulation.ts`/`game.ts`/`collider.ts` above,
  which read in **pixels** — the subfolder is the visible fence against importing one unit system
  into the other by accident.

  **`simulation.ts` is in reprieve, not a permanent fixture.** It is the movement truth the live
  game currently ships against — `step()`, called by both server and client, is still the one
  copy client prediction depends on (see "Why `step()` lives in `shared/`" in the root
  `AGENTS.md`) — but `hd2d/`'s pixel-free, tile-unit model is what eventually replaces it, once a
  later task wires `hero-step.ts` into the server's authoritative tick and the client's
  prediction. **Until that wiring lands, write no new code against `simulation.ts`/`game.ts`'s
  movement path** — a change belongs in `hd2d/` if it's about hero movement, so it isn't done
  twice. The two live side by side, deliberately unconnected, for the whole of S2: `hd2d/` is
  proven only inside `apps/lab`, `simulation.ts` is what production actually runs. Wiring them
  together is S3's job, not a natural next step to take here.

## Graph

- **Depends on:** nothing.
- **Depended on by:** everyone (`server`, `renderer`, `client`, `editor`, `testing`) plus
  `apps/lab`, for `hd2d/` only.

## Commands

```bash
npm run typecheck:engine        # tsc, pure ES2022 (no DOM/Workers)
npm test -w @lindocara/engine   # or: npm run test:engine  — Node env, no workerd
```

## Rules

- Keep it pure. If a change needs `document`, `WebSocket`, `DurableObject` or `react`, it belongs in
  a consumer package, not here.
- `step()` has exactly one copy on purpose — client prediction is only correct because both sides
  run the identical function. Never fork it.
- Server events are codes, not sentences: add an `EventCode` + both dictionary entries, never an
  English string. The i18n test enforces FR/EN parity.
- Tests are pure logic and run in Node (`packages/engine/test/`).

See the root [`AGENTS.md`](../../AGENTS.md) for the full architecture and the monorepo layout.
