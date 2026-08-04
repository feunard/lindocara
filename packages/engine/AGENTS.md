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
- `hd2d/` — the HD-2D witness's geometry, quarantined in its own subfolder rather than the flat
  root above (Task 11, moved from `apps/lab`): `terrain-query.ts` (world-space collision queries
  over a heightmap), `collider-index.ts` (the sparse rect index disc queries test against) and
  `map-data.ts` (a map as pure, defensively-parsed data). These read in **tile units**, unlike
  `simulation.ts`/`game.ts`/`collider.ts` above, which read in **pixels** — the subfolder is the
  visible fence against importing one unit system into the other by accident. It is a reprieve,
  not a permanent home: a later task retires the old pixel-based collision path in `hd2d`'s favor,
  at which point this boundary goes away too.

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
