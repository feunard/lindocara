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

## Graph

- **Depends on:** nothing.
- **Depended on by:** everyone (`server`, `renderer`, `client`, `editor`, `testing`).

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
