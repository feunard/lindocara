/**
 * Heroes as stored things on Alepha: create in a party the caller belongs to (capped per player),
 * spawn on the party's adventure's resolved start (see `resolveHeroStart` below), and delete the
 * caller's own hero. Ported from `packages/server/src/heroes.ts`, function-by-function, onto
 * `$repository` calls instead of raw Drizzle/D1 statements.
 *
 * **Spawn resolution reads `adventures.startMapId` first, else the earliest member map.** Both
 * tiers name a MAP only — coordinates always come from that map's own compiled heightfield spawn
 * (`startOn` below), never from tile-editor content. This replaces the three-tier legacy port
 * (`spawn`-kind event, then COMPAT `graph.start`, then the earliest member map): `startMapId` is now
 * the single authored anchor, backfilled once from those two retired tiers by a migration, and
 * `resolveHeroStart` no longer reads either `mapEvents` or `adventures.graph` at all.
 *
 * `resolveHeroStart` below is the private resolution, re-expressed against `$repository` reads
 * instead of raw Drizzle.
 *
 * **Item-definition catalogue seeding (the carried-over Task 7 gap).** Legacy's PRIMARY hero flow
 * (`heroes.ts::createHero`) never seeds `item_definition` itself — those rows exist because a one-time
 * D1 migration (`migrations/0008_warm_kate_bishop.sql`, `0035_rogue_starter_daggers.sql`) inserted
 * them once, at deploy time. This Alepha tree has no such migration mechanism for the new `api/`
 * entities (they are schema-synced, not migrated), so `ensureItemDefinitionsSeeded` below instead
 * ports the OTHER legacy mechanism that keeps `item_definition` populated on demand —
 * `character-persistence.ts::ensureNormalizedCharacter`'s `INSERT OR IGNORE INTO item_definition`
 * loop over `ITEM_DEFINITIONS` — re-expressed as an idempotent `upsert` per definition, run once
 * before the first hero's starter items are created (the whole call is a no-op read after that,
 * since `count()` short-circuits once the catalogue is fully seeded).
 *
 * **`hero_item`/`hero_equipment` ids are freshly minted uuids, not `ownedItemId(...)`.** Legacy's
 * `hero_item.id` is an unconstrained `text` column, so `ownedItemId(heroId, definitionId)`
 * (`"<heroId>:<definitionId>"`) is a legal literal primary key there. Task 7 ported `heroItems.id`/
 * `heroEquipment.id` as `db.primaryKey(z.uuid())` surrogate keys instead (the same convention every
 * other Task 6/7 entity uses), so a colon-joined string is not a legal value here — this generates a
 * real uuid per row instead, and reuses that same value for `heroEquipment.heroItemId`, honoring the
 * "must reference a `heroItems` row owned by the same hero" service-layer invariant
 * `heroEquipment.ts` documents.
 *
 * **The per-account hero cap is a single-statement conditional INSERT, not a transaction.** A prior
 * pass here relied on `$transactional()` to make a `count()`-then-`create()` sequence race-safe. That
 * is wrong on this app's actual production target: D1's Alepha provider reports
 * `supportsTransactions: false`, so `$transactional()` degrades to a no-op (see its own docs) and two
 * concurrent hero-creates could both pass the `count()` check before either insert lands, blowing
 * past `MAX_HEROES_PER_PARTY`. `createHero` below instead builds the hero row's INSERT as one
 * `INSERT INTO ... SELECT ... WHERE (SELECT count(*) ...) < cap` statement via `Repository.query()` —
 * a SINGLE SQL statement is atomic on SQLite/D1 regardless of whether any transaction wraps it (this
 * is the exact shape legacy's own D1 conditional-INSERT batch relied on, and D1 IS a SQLite dialect).
 * The earlier `count()` check stays as a friendly fast-path (a normal, non-racing caller gets the
 * cheap read-then-clear-error-message experience), but the atomic INSERT is what actually enforces
 * the cap under a race.
 */
import {
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  starterEquipmentFor,
  type BodyVariant,
} from "@lindocara/engine/character.js";
import { CLASS_STATS, type PlayerClass } from "@lindocara/engine/game.js";
import type { WorldPosition } from "@lindocara/engine/ground.js";
import { decodeMap } from "@lindocara/engine/hd2d/map-data.js";
import { type CreateHeroInput, MAX_HEROES_PER_PARTY } from "@lindocara/engine/hero.js";
import { CLASS_SKILLS, isSkillUnlocked } from "@lindocara/engine/skills.js";
import { z } from "alepha";
import { $repository, sql } from "alepha/orm";

// Pure, D1-free catalogue reused as-is from the legacy source tree (same-package sibling, not
// `@lindocara/engine` — mirrors `AdventureService`'s own `../../adventure-registry.js` import).
import { HEALTH_POTION_ID, ITEM_DEFINITIONS } from "../../items.js";
import { adventures } from "../entities/adventures.ts";
import { heroEquipment } from "../entities/heroEquipment.ts";
import { type Hero, heroes } from "../entities/heroes.ts";
import { heroItems } from "../entities/heroItems.ts";
import { heroQuests } from "../entities/heroQuests.ts";
import { heroSkills } from "../entities/heroSkills.ts";
import { itemDefinitions } from "../entities/itemDefinitions.ts";
import { maps } from "../entities/maps.ts";
import { parties } from "../entities/parties.ts";
import { partyMembers } from "../entities/partyMembers.ts";

export interface StoredHero {
  id: string;
  partyId: string;
  /**
   * The legacy wire name for the owning account (`heroes.ts`'s `StoredHero.accountId`). The
   * client matches "my hero in this party" by it (`LaunchScreens.tsx`), so the payload keeps the
   * legacy key even though this app's column is `userId`.
   */
  accountId: string;
  name: string;
  class: PlayerClass;
  body: BodyVariant;
  mapId: string;
  x: number;
  y: number;
  z: number;
  level: number;
  xp: number;
  hp: number;
  life: "alive" | "corpse" | "ghost";
}

/** Row-shape schema for `Repository.query()`'s `RETURNING id` — see this file's docblock. */
const ID_ROW_SCHEMA = z.object({ id: z.uuid() });

function toStored(row: Hero): StoredHero {
  return {
    id: row.id,
    partyId: row.partyId,
    accountId: row.userId,
    name: row.name,
    class: row.class,
    body: normalizeAppearance({ body: row.body }).body,
    mapId: row.mapId,
    x: row.x,
    y: row.y,
    z: row.z,
    level: row.level,
    xp: row.xp,
    hp: row.hp,
    life: row.life,
  };
}

/** Where a hero starts: a member map, and a standing position inside that map's own grid. */
export interface HeroStart {
  mapId: string;
  position: WorldPosition;
}

/**
 * A member map, read as a starting point.
 *
 * Both tiers above only choose the MAP — `adventures.startMapId` or the earliest member map — and
 * neither can name a position at all: `startMapId` is a bare map id, not a cell. So the position
 * always comes from the map's OWN heightfield spawn, the only anchor stated in the destination's
 * own units, and the grid centre when it has none — where admission's `mapEntryPosition` will find
 * real ground for it.
 */
function startOn(map: { id: string; heightfield: string } | undefined): HeroStart | null {
  if (!map) return null;
  const decoded = map.heightfield === "" ? null : decodeMap(map.heightfield);
  const spawn = decoded?.spawns[0];
  return {
    mapId: map.id,
    position: spawn ? { x: spawn.x, y: 0, z: spawn.z } : { x: 0, y: 0, z: 0 },
  };
}

export class HeroService {
  adventures = $repository(adventures);
  parties = $repository(parties);
  partyMembers = $repository(partyMembers);
  maps = $repository(maps);
  heroes = $repository(heroes);
  heroItems = $repository(heroItems);
  heroEquipment = $repository(heroEquipment);
  heroQuests = $repository(heroQuests);
  heroSkills = $repository(heroSkills);
  itemDefinitions = $repository(itemDefinitions);

  /**
   * Realtime seam (task brief): a later tranche overrides this to revoke the hero's `HeroPresence`
   * lease, exactly like legacy's `env.HERO_PRESENCE.getByName(heroId).revoke(...)` fan-out. There is
   * no presence layer yet in tranche 1, so the default is a no-op — `deleteHero` and
   * `PartyService.deleteParty` (which deletes every hero in a party) both call this for each hero id
   * they remove, so wiring the seam later needs no service-layer edit here.
   */
  onHeroDeleted: (heroId: string) => void | Promise<void> = () => {};

  /** Ported from `createHero`. */
  async createHero(userId: string, partyId: string, input: CreateHeroInput): Promise<StoredHero> {
    const partyRow = await this.parties.findById(partyId);
    if (!partyRow) throw new Error("not_found: no such party");

    const membership = await this.partyMembers.findOne({
      where: { partyId: { eq: partyId }, userId: { eq: userId } },
    });
    if (!membership) throw new Error("not_member: not a member of this party");

    // Friendly fast-path only — see this file's docblock. The atomic INSERT below is the real guard.
    const existingCount = await this.heroes.count({
      partyId: { eq: partyId },
      userId: { eq: userId },
    });
    if (existingCount >= MAX_HEROES_PER_PARTY) {
      throw new Error("cap: too many heroes in this party");
    }

    // Class validation reads CLASS_STATS, per the task brief — `parseCreateHeroInput` (the
    // controller's body parser) already screens the class against `HERO_CLASSES`, so this is a
    // defensive belt-and-suspenders check against the OTHER class catalogue engine exposes, not the
    // primary gate.
    if (!(input.class in CLASS_STATS)) {
      throw new Error("not_found: unsupported class");
    }

    const start = await this.resolveHeroStart(partyRow.adventureId);
    if (!start) throw new Error("not_found: party adventure has no map");
    const body = input.body ?? DEFAULT_APPEARANCE.body;

    const id = crypto.randomUUID();
    // Single-statement conditional INSERT: atomic on SQLite/D1 even with no surrounding transaction
    // (see this file's docblock — `$transactional()` short-circuits on D1). Every other hero column
    // is omitted so the table's own SQL-level defaults apply, exactly like the plain `.create()` this
    // replaces.
    const inserted = await this.heroes.query(
      // `${table.col}` inside an INSERT column list prints a TABLE-QUALIFIED identifier
      // (`"heroes"."party_id"`), which SQLite's parser rejects there (valid in SELECT/WHERE, not in
      // `INSERT INTO t (...)`) — confirmed empirically. `sql.raw(table.col.name)` embeds the bare
      // physical column name for the multi-word columns; single-word columns (name/class/x/y) are
      // spelled literally since camelCase and the physical snake_case name coincide for them.
      (table) => sql`
        INSERT INTO ${table}
          (${sql.raw(table.id.name)}, ${sql.raw(table.partyId.name)}, ${sql.raw(table.userId.name)},
           name, class, body, ${sql.raw(table.mapId.name)}, x, y, z)
        SELECT ${id}, ${partyId}, ${userId}, ${input.name}, ${input.class}, ${body},
               ${start.mapId}, ${start.position.x}, ${start.position.y}, ${start.position.z}
        WHERE (SELECT count(*) FROM ${table}
               WHERE ${table.partyId} = ${partyId} AND ${table.userId} = ${userId}) < ${MAX_HEROES_PER_PARTY}
        RETURNING ${table.id}
      `,
      ID_ROW_SCHEMA,
    );
    if (inserted.length === 0) throw new Error("cap: too many heroes in this party");

    await this.ensureItemDefinitionsSeeded();

    const equipment = starterEquipmentFor(input.class);
    await this.heroItems.create({
      id: crypto.randomUUID(),
      heroId: id,
      itemDefinitionId: HEALTH_POTION_ID,
      quantity: 2,
    });
    const mainHandItemId = crypto.randomUUID();
    await this.heroItems.create({
      id: mainHandItemId,
      heroId: id,
      itemDefinitionId: equipment.mainHand,
      quantity: 1,
    });
    await this.heroEquipment.create({
      id: crypto.randomUUID(),
      heroId: id,
      slot: "main_hand",
      heroItemId: mainHandItemId,
    });
    if (equipment.offHand !== null) {
      const offHandItemId = crypto.randomUUID();
      await this.heroItems.create({
        id: offHandItemId,
        heroId: id,
        itemDefinitionId: equipment.offHand,
        quantity: 1,
      });
      await this.heroEquipment.create({
        id: crypto.randomUUID(),
        heroId: id,
        slot: "off_hand",
        heroItemId: offHandItemId,
      });
    }

    await this.heroQuests.create({
      id: crypto.randomUUID(),
      heroId: id,
      questId: "three_offerings",
      status: "available",
      progress: 0,
    });

    const now = new Date().toISOString();
    for (const skill of CLASS_SKILLS[input.class]) {
      const unlocked = isSkillUnlocked(1, skill.slot);
      await this.heroSkills.create({
        id: crypto.randomUUID(),
        heroId: id,
        skillId: skill.id,
        unlocked,
        equipped: unlocked,
        ...(unlocked ? { slot: skill.slot, unlockedAt: now } : {}),
      });
    }

    const created = await this.heroes.findById(id);
    if (!created) throw new Error("not_found: hero vanished mid-create");
    return toStored(created);
  }

  /** Ported from `listHeroes`: scoped to the caller's own heroes in this party. */
  async listHeroes(userId: string, partyId: string): Promise<StoredHero[]> {
    const rows = await this.heroes.findMany({
      where: { partyId: { eq: partyId }, userId: { eq: userId } },
      orderBy: "createdAt",
    });
    return rows.map(toStored);
  }

  /** Ported from `deleteHero`: only the caller's own hero. */
  async deleteHero(userId: string, partyId: string, heroId: string): Promise<void> {
    const row = await this.heroes.findOne({
      where: { id: { eq: heroId }, partyId: { eq: partyId }, userId: { eq: userId } },
    });
    if (!row) throw new Error("not_found: no such hero");
    await this.heroes.deleteById(row.id);
    await this.onHeroDeleted(row.id);
  }

  // ---------------------------------------------------------------------------------------------

  /**
   * The two-tier start resolution — see this file's docblock for the precedence. Returns `null`
   * only when the adventure has no maps at all. Public since the realtime tranche: world admission
   * (`AdmissionService`) re-runs exactly this resolution when a hero's stored map is gone, the same
   * way legacy `handleJoinHero` called `resolveAdventureStart` directly.
   */
  async resolveHeroStart(adventureId: string): Promise<HeroStart | null> {
    const memberMaps = await this.maps.findMany({
      where: { adventureId: { eq: adventureId } },
      orderBy: "createdAt",
    });
    if (memberMaps.length === 0) return null;

    const adventureRow = await this.adventures.findById(adventureId);

    // Tier 1: the adventure's authored start map, when it still names a member. `startMapId`
    // carries no foreign key (see the `adventures` entity docblock), so a deleted or foreign id
    // falls through to tier 2 rather than failing — the same degrade `MapService.deleteMap` backs
    // up at the source by clearing the column when its target map goes away.
    if (adventureRow?.startMapId) {
      const chosen = memberMaps.find((row) => row.id === adventureRow.startMapId);
      if (chosen) return startOn(chosen);
    }

    // Tier 2: the earliest-created member map. This is what a null column MEANS — an adventure that
    // never chose is playable from its first map, exactly as before.
    return startOn(memberMaps[0]);
  }

  /** Ported from `character-persistence.ts::ensureNormalizedCharacter`'s `item_definition` seeding
   *  loop — see this file's docblock for why this runs on demand instead of via a migration. Cheap
   *  no-op once the catalogue is fully seeded (a single `count()` read). */
  private async ensureItemDefinitionsSeeded(): Promise<void> {
    const existing = await this.itemDefinitions.count();
    if (existing >= ITEM_DEFINITIONS.length) return;
    for (const definition of ITEM_DEFINITIONS) {
      await this.itemDefinitions.upsert({
        id: definition.id,
        type: definition.type,
        stackable: definition.stackable,
        maxStack: definition.maxStack,
        ...(definition.equipmentSlot !== null ? { equipmentSlot: definition.equipmentSlot } : {}),
        ...(definition.allowedClass !== null ? { allowedClass: definition.allowedClass } : {}),
      });
    }
  }
}
