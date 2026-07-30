import { EVENT_KINDS } from "@lindocara/engine/map-events.js";
import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { maps } from "./maps.ts";

/**
 * Authoring entity for `map_event` (`packages/server/src/db/schema.ts:358`).
 *
 * `id` is client-minted and stable across edits (the referenceable identity tranche 5's commands
 * point at) — legacy declares it with no DB default, so an insert that omits it fails loudly.
 * `db.primaryKey(z.uuid())` cannot express "no default": the uuid branch of Alepha's
 * `DatabaseTypeProvider.primaryKey` always attaches `PG_DEFAULT` (`.vendor/alepha/src/orm/core/
 * providers/DatabaseTypeProvider.ts`), so `SqliteModelBuilder` generates a `$defaultFn(() =>
 * randomUUID())` fallback. In practice every caller supplies its own id (the whole point of a
 * client-minted id), so the fallback never fires — but this is a real, harmless divergence from
 * legacy's "must supply id or fail" behaviour, worth knowing about.
 *
 * Only `kind` is a DB-enforced enum in the legacy column (`text("kind", { enum: EVENT_KINDS })`).
 * `species`/`monsterRank`/`monsterWeakness`/`monsterSpecialTechnique`/`monsterRespawnMode` are all
 * legacy `.$type<T>()` — TypeScript-only typing over a plain unconstrained TEXT column, no runtime
 * enum. That laxity is preserved here as `z.string()` rather than `z.enum(...)`: `MonsterSpecies`
 * has no exported `as const` literal tuple to build a real Zod enum from (only `CURATED_MONSTER_
 * SPECIES`, a `readonly MonsterSpecies[]`, which zod's `enum()` cannot accept as a tuple type).
 */
export const mapEvents = $entity({
  name: "mapEvents",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    mapId: db.ref(z.uuid(), () => maps.cols.id, { onDelete: "cascade" }),
    col: z.integer(),
    row: z.integer(),
    /** Doubles as the entry/exit marker label for functional kinds; decorative for `normal`. */
    name: z.string(),
    /** Creation order, per map. Display only. */
    ordinal: z.integer(),
    /** `normal` is the scripted event; entry/exit/monster/guard/spawn are the reborn markers. */
    kind: db.default(z.enum(EVENT_KINDS), "normal"),
    /** Monster spawn, set iff `kind = 'monster'`. Typed as `MonsterSpecies` at the app layer. */
    species: z.string().optional(),
    /** Monster patrol radius (px), set iff `kind = 'monster'`. */
    patrolRadius: z.integer().optional(),
    /** Per-spawn tuning. Absent rows are legacy data and fall back to the species defaults. */
    monsterRank: z.string().optional(),
    monsterMaxHp: z.integer().optional(),
    monsterDamage: z.integer().optional(),
    monsterSpeed: z.integer().optional(),
    monsterDetectionRange: z.integer().optional(),
    monsterXp: z.integer().optional(),
    monsterWeakness: z.string().optional(),
    monsterWeaknessPercent: z.integer().optional(),
    monsterSpecialTechnique: z.string().optional(),
    monsterRespawnMode: z.string().optional(),
  }),
  indexes: [
    // One event per cell — the editor moves an event rather than replacing on overlap.
    { columns: ["mapId", "col", "row"], unique: true, name: "map_event_cell_unique" },
    { columns: ["mapId"], name: "map_event_map_idx" },
  ],
});

export type MapEvent = Static<typeof mapEvents.schema>;
