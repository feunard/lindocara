# @lindocara/server

The Cloudflare Worker: the authoritative game server. Runs in **workerd**. **The server decides
outcomes** — clients send movement and action *intent*, never positions, damage, health, inventory,
XP, deaths, loot or quest completion. This package owns everything that must be trusted.

## Responsibility

- `index.ts` — Worker entry (`/api/*` only; assets never reach it). The primary WS route is
  `/api/ws?party=<partyId>&hero=<heroId>`; it verifies account/membership/ownership and reads the
  authoritative map+position from D1. No client message may select a destination.
- `world.ts` — the Durable Object and room owner: admission, socket lifecycle, tick order.
  `world/` — the explicit-dependency systems (movement, combat, monsters, projectiles, quests, loot,
  navigation, interest/snapshot, persistence, event-run). No module-level mutable room state.
- `game-session.ts` — the party coordinator (room routing, cross-map broadcast, adventure state, the
  single writer of switches/variables). `hero-presence.ts`/`hero-profile.ts` — leases + fenced saves.
- `accounts.ts`/`session.ts`/`password.ts` — auth. `maps.ts`/`adventures.ts`/`parties.ts`/`heroes.ts`
  — the primary authored/save flow. `db/` — the D1 schema (Drizzle). `wrangler.jsonc` + `migrations/`
  — this Worker's deploy config and D1 schema history; `.dev.vars` holds `SESSION_SECRET` locally.

## Graph

- **Depends on:** `engine` (+ `drizzle-orm`).
- **Depended on by:** the deployable `apps/main` (via `wrangler.jsonc` `main`); the client only over
  the wire.

## Commands

```bash
npm run typecheck:server        # tsc, Workers types
npm test -w @lindocara/server   # or: npm run test:server — real workerd + D1 + Durable Objects
npm run cf-typegen              # regenerate src/worker-configuration.d.ts from wrangler.jsonc
npm run db:generate             # (root) diff db/schema.ts -> migrations/*.sql
npm run db:migrate              # apply migrations to the local D1 (reads this package's wrangler)
```

## Rules

- Never trust a client message: `parseClientMessage` returns `null` and the frame is dropped.
- Add a mechanic in the narrowest existing `world/` system; pass its dependencies from `World`; add
  it to the readable tick/action order. Never hide room state in a module global.
- Every hero child-table write includes an `EXISTS` fence against `hero.session_epoch`.
- Server events are codes, not sentences (add an `EventCode` + both dictionaries in `engine`).
- Tests run against the **real** Durable Object in workerd (`vitest.config.ts` = cloudflare pool,
  reading `./wrangler.jsonc`). Prefer a test that drives the real DO over a mock.

See the root [`AGENTS.md`](../../AGENTS.md) for the full server-systems map and the DO gotchas.
