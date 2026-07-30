/**
 * Heroes as stored things on Alepha: create in a party the caller belongs to (capped per player),
 * spawn on the party's adventure's resolved start (full legacy tiering — see below), and delete the
 * caller's own hero. Ported from `packages/server/src/heroes.ts`, function-by-function, onto
 * `$repository` calls instead of raw Drizzle/D1 statements.
 *
 * **Spawn resolution ports legacy `resolveAdventureStart` in full** (`adventures.ts:350-387`), not
 * just its third tier — both `graph.start` and `spawn`-kind map events are reachable today through
 * the shipped API (`AdventureController` accepts a graph, `MapController` persists spawn events), so
 * a Task 10 first-pass that only read the fallback tier was silently wrong for any adventure that
 * actually authored either. In legacy's own precedence (`adventures.ts`'s docblock, verified against
 * its code, NOT the order a prior review comment paraphrased it in):
 *
 *  1. **Spawn event** — the earliest-created member map carrying a `kind: "spawn"` event; the hero
 *     spawns on that event's cell (ties on one map broken by row then col, matching legacy).
 *  2. **Graph start** — COMPAT: `adventure.graph.start` names a member map + entry-event id; the
 *     hero spawns on that entry's cell, or the map's own default spawn if the entry event is gone.
 *  3. **Map default** — the earliest-created member map, at its own authored `spawnCol`/`spawnRow`.
 *
 * `resolveHeroStart` below is the private port of `resolveAdventureStart`, re-expressed against
 * `$repository` reads instead of raw Drizzle. Coordinate math reuses the same pure helpers legacy
 * does (`eventCellCentre`, and the `spawnCol`/`spawnRow -> {x,y}` arithmetic `mapSpawnPoint` encodes
 * — inlined as `mapDefaultSpawn` here since `mapSpawnPoint` takes a full `MapData`, not a bare row).
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
import { type AdventureGraph, parseAdventureGraph } from "@lindocara/engine/adventure.js";
import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { CLASS_STATS, type PlayerClass } from "@lindocara/engine/game.js";
import { type CreateHeroInput, MAX_HEROES_PER_PARTY } from "@lindocara/engine/hero.js";
import { eventCellCentre } from "@lindocara/engine/map-events.js";
import { CLASS_SKILLS, isSkillUnlocked } from "@lindocara/engine/skills.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
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
import { mapEvents } from "../entities/mapEvents.ts";
import { maps } from "../entities/maps.ts";
import { parties } from "../entities/parties.ts";
import { partyMembers } from "../entities/partyMembers.ts";

export interface StoredHero {
  id: string;
  partyId: string;
  userId: string;
  name: string;
  class: PlayerClass;
  mapId: string;
  x: number;
  y: number;
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
    userId: row.userId,
    name: row.name,
    class: row.class,
    mapId: row.mapId,
    x: row.x,
    y: row.y,
    level: row.level,
    xp: row.xp,
    hp: row.hp,
    life: row.life,
  };
}

/** The `spawnCol`/`spawnRow -> {x,y}` arithmetic `@lindocara/engine/map-data.js`'s `mapSpawnPoint`
 *  encodes, applied to a bare map row instead of a full `MapData` (this service never materializes
 *  one). Kept in lock-step with that function by construction — same formula, same `TILE_SIZE`. */
function mapDefaultSpawn(row: { spawnCol: number; spawnRow: number }): { x: number; y: number } {
  return {
    x: row.spawnCol * TILE_SIZE + TILE_SIZE / 2,
    y: row.spawnRow * TILE_SIZE + TILE_SIZE / 2,
  };
}

export class HeroService {
  adventures = $repository(adventures);
  parties = $repository(parties);
  partyMembers = $repository(partyMembers);
  maps = $repository(maps);
  mapEvents = $repository(mapEvents);
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
           name, class, ${sql.raw(table.mapId.name)}, x, y)
        SELECT ${id}, ${partyId}, ${userId}, ${input.name}, ${input.class},
               ${start.mapId}, ${start.x}, ${start.y}
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
   * The full port of `resolveAdventureStart` (`adventures.ts:350-387`) — see this file's docblock
   * for the three tiers and their exact precedence. Returns `null` only when the adventure has no
   * maps at all. Public since the realtime tranche: world admission (`AdmissionService`) re-runs
   * exactly this resolution when a hero's stored map is gone, the same way legacy `handleJoinHero`
   * called `resolveAdventureStart` directly.
   */
  async resolveHeroStart(
    adventureId: string,
  ): Promise<{ mapId: string; x: number; y: number } | null> {
    const memberMaps = await this.maps.findMany({
      where: { adventureId: { eq: adventureId } },
      orderBy: "createdAt",
    });
    if (memberMaps.length === 0) return null;
    const mapIds = memberMaps.map((row) => row.id);

    // Tier 1: the earliest-created member map carrying a `spawn`-kind event.
    const spawnRows = await this.mapEvents.findMany({
      where: { mapId: { inArray: mapIds }, kind: { eq: "spawn" } },
    });
    if (spawnRows.length > 0) {
      for (const mapId of mapIds) {
        // Deterministic pick if an author placed more than one spawn on a single map.
        const chosen = spawnRows
          .filter((row) => row.mapId === mapId)
          .sort((a, b) => a.row - b.row || a.col - b.col)[0];
        if (chosen) return { mapId, ...eventCellCentre(chosen) };
      }
    }

    // Tier 2: the legacy graph start (an entry event on a member map).
    const adventureRow = await this.adventures.findById(adventureId);
    const graph: AdventureGraph | null = adventureRow
      ? parseAdventureGraph(JSON.parse(adventureRow.graph))
      : null;
    const start = graph?.start;
    if (start && mapIds.includes(start.mapId)) {
      const startMap = memberMaps.find((row) => row.id === start.mapId);
      if (startMap) {
        const entry = await this.mapEvents.findOne({
          where: { id: { eq: start.entryId }, mapId: { eq: start.mapId }, kind: { eq: "entry" } },
        });
        return {
          mapId: startMap.id,
          ...(entry ? eventCellCentre(entry) : mapDefaultSpawn(startMap)),
        };
      }
    }

    // Tier 3: the first member map at its own authored spawn point.
    const firstMap = memberMaps[0];
    if (!firstMap) return null;
    return { mapId: firstMap.id, ...mapDefaultSpawn(firstMap) };
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
