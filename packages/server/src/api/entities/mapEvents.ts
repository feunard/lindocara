import { type Infer, z } from "alepha";
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
 * The physical `kind` column is plain text despite the legacy TypeScript enum annotation. It stays
 * runtime-permissive here because production still contains the retired `spawn` value: reads drop
 * that inert event in `MapService`, while every write still passes `parseMapEvents` and therefore
 * accepts only current kinds. `species`/`monsterRank`/`monsterWeakness`/
 * `monsterSpecialTechnique`/`monsterAttackProfile`/`monsterRespawnMode` are likewise
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
    /** Reciprocal same-map authoring link. Validated as a pair at the wire boundary. */
    linkedEventId: z.uuid().optional(),
    /** Small authored-event ground marker; old rows remain visible. */
    showMarker: db.default(z.boolean(), true),
    /** Current event kind, or a retired stored value tolerated for dual-read compatibility. */
    kind: db.default(z.string(), "normal"),
    /** Monster spawn, set iff `kind = 'monster'`. Typed as `MonsterSpecies` at the app layer. */
    species: z.string().optional(),
    /** Monster patrol radius (px), set iff `kind = 'monster'`. */
    patrolRadius: z.integer().optional(),
    /** Per-spawn tuning. Absent rows are legacy data and fall back to the species defaults. */
    monsterRank: z.string().optional(),
    monsterMaxHp: z.integer().optional(),
    monsterDamage: z.integer().optional(),
    /**
     * Tiles per second, and therefore NOT an integer any more: the bestiary's speeds are exact
     * quotients of the former pixel values (105/64, 88/64, ...). The stored column is `real` as of
     * `20260805034500_monster_speed_real`; no value was converted by that migration, since SQLite's
     * `integer` was an affinity rather than a constraint and existing rows read back unchanged.
     * Every other tuning column beside it is still a whole number.
     */
    monsterSpeed: z.number().optional(),
    monsterXp: z.integer().optional(),
    monsterWeakness: z.string().optional(),
    monsterWeaknessPercent: z.integer().optional(),
    monsterSpecialTechnique: z.string().optional(),
    /** Explicit basic-attack override; absent rows use the species' natural profile. */
    monsterAttackProfile: z.string().optional(),
    monsterRespawnMode: z.string().optional(),
    monsterRespawnDelayMs: z.integer().optional(),
    monsterPursuitMode: z.string().optional(),
    monsterAcceleration: z.number().optional(),
    monsterMaxSpeed: z.number().optional(),
    monsterOneHitKill: db.default(z.boolean(), false),
    /** Validated `HarvestProfile` JSON, present only for `kind = 'harvestable'`. */
    harvestProfile: z.string().optional(),
  }),
  indexes: [
    // One event per cell — the editor moves an event rather than replacing on overlap.
    { columns: ["mapId", "col", "row"], unique: true, name: "map_event_cell_unique" },
    { columns: ["mapId"], name: "map_event_map_idx" },
  ],
});

export type MapEvent = Infer<typeof mapEvents.schema>;
