import { LIFE_STATES } from "@lindocara/engine/death.js";
import { HERO_CLASSES } from "@lindocara/engine/hero.js";
import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";
import { parties } from "./parties.ts";

/**
 * Runtime entity for `hero` (`packages/server/src/db/schema.ts:527`), ported column-for-column.
 *
 * `accountId` becomes `userId` (same rename convention as `parties.hostUserId`). Every column name
 * below is the exact contract the realtime tranche's epoch fencing will reuse — none are renamed
 * beyond camelCasing per the task brief.
 *
 * `mapId` stays a **plain, unconstrained string** exactly like legacy's `text("map_id").notNull()`
 * with no `.references()` — this is a deliberate legacy divergence from every other id column in
 * this file, not an omission: the hero's current map is looked up dynamically against whichever
 * maps table governs the running adventure, not enforced as a hard FK at this layer.
 *
 * `class` reuses `HERO_CLASSES` (`@lindocara/engine/hero.ts`), a real `as const` literal tuple, so
 * it stays a genuine DB-enforced enum like legacy's `text("class", {enum: [...]})`. `life` reuses
 * `LIFE_STATES` (`@lindocara/engine/death.ts`) the same way.
 */
export const heroes = $entity({
  name: "heroes",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    partyId: db.ref(z.uuid(), () => parties.cols.id, { onDelete: "cascade" }),
    userId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    name: z.string(),
    class: db.default(z.enum(HERO_CLASSES), "warrior"),
    /** The D1 map the hero is on; starts at the adventure's start map. No FK — see docblock. */
    mapId: z.string(),
    /**
     * Where the hero stands, in TILE units with the grid centre as origin — the same three axes
     * every runtime and the wire now use: `x` and `z` are the GROUND, `y` is ELEVATION.
     *
     * `y` was the second ground axis in the pixel world, and the migration that added `z` reset all
     * three to `0` for every existing row rather than converting them: a stored `2176` read as
     * tiles is 2176 TILES, which is 34 times the width of the largest grid. `0,0,0` is the grid
     * centre, and admission places the body on real ground from there (`mapEntryPosition`).
     */
    x: z.number(),
    y: z.number(),
    z: db.default(z.number(), 0),
    level: db.default(z.integer(), 1),
    xp: db.default(z.integer(), 0),
    hp: db.default(z.integer(), 100),
    gold: db.default(z.integer(), 0),
    crystals: db.default(z.integer(), 0),
    resourceCurrent: z.number().optional(),
    /** JSON CombatCooldownState. Deadlines are normalized against server time on restore. */
    combatCooldowns: db.default(z.string(), "{}"),
    consumableCooldownUntil: db.default(z.integer(), 0),
    damageBoostUntil: db.default(z.integer(), 0),
    forgottenUntil: db.default(z.integer(), 0),
    invisibleUntil: db.default(z.integer(), 0),
    resurrectionAt: db.default(z.integer(), 0),
    /** JSON array of server-validated talent ids. Roots are derived and never stored. */
    talents: db.default(z.string(), "[]"),
    sessionEpoch: db.default(z.integer(), 0),
    /** Death is persistent, mirroring `character`. The three corpse axes are set exactly when life
     *  is not alive, and follow the same convention as the position above: `x`/`z` ground, `y`
     *  elevation. */
    life: db.default(z.enum(LIFE_STATES), "alive"),
    corpseX: z.number().optional(),
    corpseY: z.number().optional(),
    corpseZ: z.number().optional(),
  }),
  indexes: [{ columns: ["partyId", "userId"], name: "hero_party_account_idx" }],
});

export type Hero = Infer<typeof heroes.schema>;
