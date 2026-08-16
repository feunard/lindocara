# Database, entities and migrations

The alepha ORM, how a migration is produced, and the D1 compatibility discipline the code still
keeps even though production is SQLite.

## Database

The **alepha ORM**. `packages/server/src/api/entities/*.ts` are the `$entity` definitions â€” one
file per table, the single source of truth â€” and services access them through `$repository`. Both
dev and the Bay production process use SQLite; dev auto-syncs while production uses migrations.
Migrations live in `apps/main/migrations/sqlite/`:

```bash

# edit packages/server/src/api/entities/*.ts

# BROKEN as of 2026-08-04 and not yet fixed: a top-level `await` inside an `if` in

# apps/main/src/main.ts defeats drizzle-kit's esbuild bundling, and every `alepha db` command boots

# that entry. `yarn check:migrations` (the drift check) is unaffected. Writing a migration by

# hand, or hoisting that await, are the two ways round it until someone fixes the entry.
yarn workspace @lindocara/main run db:generate        # alepha db migrations create â€” commit the output
yarn workspace @lindocara/main run check:migrations   # entity/migration drift check (also inside `yarn v`)
```

`alepha platform up` packs the migrations with the Bay artifact; the production app applies them
at boot before it begins serving traffic.

**D1 compatibility discipline** â€” the current production is SQLite, but the ORM code remains
portable and these adapter constraints stay load-bearing:

- `repo.transaction()` throws on D1 â€” use the `$transactional()` middleware instead, and know it
  degrades to a no-op there (the D1 provider reports `supportsTransactions: false`), so it never
  serializes a read-then-write sequence against a concurrent request.
- Bulk writes/deletes are chunked under D1's ~100 bound-parameter cap per statement â€” see
  `MapService`'s chunked element/layer writes.
- A count-then-insert invariant (party size cap, unique colour slot) cannot rely on a transaction
  to serialize it. Build the guarded row as **one single-statement conditional
  `INSERT ... SELECT ... WHERE (SELECT count(*) ...) < cap`** via `Repository.query()` and
  classify a zero-row result against a follow-up read â€” never a `count()` read followed by a
  separate `create()` call.

Objects, equipment, skills and multi-quest progression use separate normalized ownership tables
documented in [`docs/persistence-model.md`](./persistence-model.md) (written pre-migration;
its `hero_*` model carried over, its `character_*` rollback family did not). Hero inventory,
equipment, currencies, class resource, skills, quest rows, talents, bounded cooldowns and timed
consumable effects are durable alongside its map, position, core stats, life, corpse and fencing
epoch. Every hero child-table mutation must include an `EXISTS` fence against
`hero.session_epoch` (or be a server-side create before a session exists).

Accounts are Alepha's own `users` (username+password credentials realm â€” see
`api/providers/AppSecurityProvider.ts`). The primary post-login screen lists persistent parties as
resumable saves. Each `hero` belongs to one user and one party and is selected inside that party.
Dirty hero profiles are saved every five seconds, on disconnect and at map transitions.
