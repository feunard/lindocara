import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db, sql } from "alepha/orm";
import { adventures } from "./adventures.ts";

/**
 * Authoring entity for `map` (`packages/server/src/db/schema.ts:273`), ported column-for-column.
 *
 * `accountId` becomes a required `userId` (see `adventures.ts`'s docblock — no legacy quarantine
 * story applies to a fresh table). `layers` stays an opaque JSON string (three run-length encoded
 * tile layers, ground first); this entity does not parse it — `shared/tile-layer-codec.ts` does.
 *
 * `map_account_first_unique` — "exactly one owned map carries `isFirst` per account" — is ported as
 * a genuine SQLite partial unique index (`where: is_first = 1`), not the controller-transaction
 * fallback the task brief pre-authorized: `ModelBuilder.buildTableConfig` plumbs a column-level
 * index's `where: SQL` straight through to drizzle's `.where()`, and SQLite supports partial unique
 * indexes natively. The legacy index also required `account_id IS NOT NULL`; that clause is dropped
 * because `userId` is NOT NULL here, so it can never be true. This is dialect-specific: `is_first`
 * is stored as a SQLite integer (0/1) by `SqliteModelBuilder`'s boolean customType. Cloudflare D1
 * (this project's only production target) is a SQLite dialect too, so the predicate is portable
 * across both this test harness and prod — but it would need `= true` if this entity ever ran
 * against the framework's Postgres backend.
 */
export const maps = $entity({
  name: "maps",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    userId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    /** The one adventure that owns this map. A map is created inside an adventure and never moves. */
    adventureId: db.ref(z.uuid(), () => adventures.cols.id, { onDelete: "cascade" }),
    name: z.string().min(1).max(48),
    cols: z.integer(),
    rows: z.integer(),
    /** Tileset the layer ids index into. */
    tilesetId: db.default(z.string(), "tiny-swords"),
    /** JSON array of exactly three run-length encoded tile layers. Ground first. */
    layers: z.string(),
    spawnCol: z.integer(),
    spawnRow: z.integer(),
    /** JSON MapMarkers (entries/exits/monster spawns); absent for maps saved before markers existed. */
    markers: z.string().optional(),
    /** JSON MapAudioConfig. Empty string is the default/legacy sentinel. */
    audio: db.default(z.string(), ""),
    /** JSON MapHeroSettings. Empty string makes pre-feature maps inherit current defaults. */
    heroSettings: db.default(z.string(), ""),
    /**
     * JSON-encoded `MapData` (`engine/hd2d/map-data.ts`) — the terrain as a heightfield, in tile
     * units. Empty string is the "no heightfield" sentinel, same convention as `audio` above.
     * Compiled by map create/update/import, backfilled at startup, and writable through the
     * owner-fenced remote terrain endpoint.
     */
    heightfield: db.default(z.string(), ""),
    /** Monotone authored-content revision. Cache identity is `(mapId, revision)`. */
    revision: db.default(z.integer().min(1), 1),
    /** Internal compare-and-swap token for a whole-map rewrite, never exposed on the authoring API. */
    writeToken: db.default(z.string(), ""),
    /** Exactly one owned map carries this per account (enforced by `map_account_first_unique`). */
    isFirst: db.default(z.boolean(), false),
  }),
  indexes: [
    { columns: ["userId"], name: "map_account_idx" },
    { columns: ["adventureId"], name: "map_adventure_idx" },
    {
      column: "userId",
      unique: true,
      name: "map_account_first_unique",
      where: sql`is_first = 1`,
    },
  ],
  constraints: [{ columns: ["revision"], check: sql`revision >= 1` }],
});

export type MapRow = Infer<typeof maps.schema>;
