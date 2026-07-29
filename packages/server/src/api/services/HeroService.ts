/**
 * Heroes as stored things on Alepha: create in a party the caller belongs to (capped per player),
 * spawn on the party's adventure's first map, and delete the caller's own hero. Ported from
 * `packages/server/src/heroes.ts`, function-by-function, onto `$repository` calls instead of raw
 * Drizzle/D1 statements.
 *
 * **Spawn simplification, versus legacy `resolveAdventureStart`.** Legacy resolves a hero's start
 * position through three tiers (a spawn event, else the legacy graph start's entry, else the first
 * member map's authored spawn point). The task brief calls for the simpler, fully server-decided
 * rule: "spawn map/position = adventure's first map" — this ports only that third tier (the
 * earliest-created member map, at its authored `spawnCol`/`spawnRow`). Reintroducing the other two
 * tiers is straightforward (their data — map events, the adventure graph — already exists on the
 * Alepha ORM) but is out of this task's stated scope; noted here so a later tranche does not have to
 * rediscover the gap.
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
 */
import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { CLASS_STATS, type PlayerClass } from "@lindocara/engine/game.js";
import { type CreateHeroInput, MAX_HEROES_PER_PARTY } from "@lindocara/engine/hero.js";
import { CLASS_SKILLS, isSkillUnlocked } from "@lindocara/engine/skills.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { $repository } from "alepha/orm";
// Pure, D1-free catalogue reused as-is from the legacy source tree (same-package sibling, not
// `@lindocara/engine` — mirrors `AdventureService`'s own `../../adventure-registry.js` import).
import { HEALTH_POTION_ID, ITEM_DEFINITIONS } from "../../items.js";
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

export class HeroService {
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

    // The adventure's first (earliest-created) member map, at its authored spawn point — see this
    // file's docblock for how this diverges from legacy's full `resolveAdventureStart` tiering.
    const [firstMap] = await this.maps.findMany({
      where: { adventureId: { eq: partyRow.adventureId } },
      orderBy: "createdAt",
      limit: 1,
    });
    if (!firstMap) throw new Error("not_found: party adventure has no map");

    const id = crypto.randomUUID();
    const x = firstMap.spawnCol * TILE_SIZE + TILE_SIZE / 2;
    const y = firstMap.spawnRow * TILE_SIZE + TILE_SIZE / 2;
    await this.heroes.create({
      id,
      partyId,
      userId,
      name: input.name,
      class: input.class,
      mapId: firstMap.id,
      x,
      y,
    });

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
