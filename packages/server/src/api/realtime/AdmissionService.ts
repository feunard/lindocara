/**
 * The admission reads behind both `GET /api/join` (`JoinController.resolveJoin`) and the world
 * room's `onJoin` — one implementation so the HTTP hint and the socket's re-validation cannot
 * drift. Ported from legacy `handleJoinHero` (`packages/server/src/index.ts:392-505`) plus the
 * profile assembly of `hero-profile.ts`'s `loadHeroProfile`/`hero-persistence.ts`'s
 * `loadNormalizedHeroState`, re-expressed against the tranche-1 repositories and services.
 *
 * Nothing here acquires presence or writes a row: resolution is pure reads. The one legacy write
 * on this path — relocating a hero whose stored map vanished onto the adventure's resolved start —
 * happens in `WorldRoom.onJoin` AFTER the presence acquire, under the freshly acquired epoch
 * (`HeroEpochService.relocate`), exactly like legacy's `relocateHero` ran after
 * `HERO_PRESENCE.acquire`.
 */

import {
  normalizeAppearance,
  normalizeEquipment,
  type PrimaryColor,
  starterEquipmentFor,
} from "@lindocara/engine/character.js";
import {
  CONSUMABLE_IDS,
  type ConsumableCounts,
  emptyConsumables,
} from "@lindocara/engine/consumables.js";
import { emptyCombatCooldowns, normalizeCombatCooldowns } from "@lindocara/engine/cooldowns.js";
import { isLifeState, type LifeState } from "@lindocara/engine/death.js";
import { maxHpForLevel, type QuestChapter, questDefinition } from "@lindocara/engine/game.js";
import type { GroundVector, WorldPosition } from "@lindocara/engine/ground.js";
import { isUuid } from "@lindocara/engine/identifiers.js";
import type { PartyColor } from "@lindocara/engine/party.js";
import { initialResource } from "@lindocara/engine/resources.js";
import { normalizeTalentSelection } from "@lindocara/engine/talents.js";
import {
  BODY_RADIUS,
  canStand,
  groundUnder,
  restoreStandablePosition,
  type ZoneTerrain,
} from "@lindocara/engine/terrain-access.js";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

// Pure item catalogue reused as-is from the legacy source tree (same-package sibling — the same
// sanctioned import `HeroService` already makes).
import { HEALTH_POTION_ID, isMainHandItem, isOffHandItem } from "../../items.js";
import type { PlayerProfile } from "../../profile-types.js";
import { adventureTestSessions } from "../entities/adventureTestSessions.ts";
import { heroEquipment } from "../entities/heroEquipment.ts";
import { type Hero, heroes } from "../entities/heroes.ts";
import { heroItems } from "../entities/heroItems.ts";
import { heroQuests } from "../entities/heroQuests.ts";
import { maps } from "../entities/maps.ts";
import { parties } from "../entities/parties.ts";
import { partyMembers } from "../entities/partyMembers.ts";
import { AdventureService, type StoredAdventure } from "../services/AdventureService.ts";
import { AdventureStateService } from "../services/AdventureStateService.ts";
import { HeroService } from "../services/HeroService.ts";
import { TestSessionService } from "../services/TestSessionService.ts";

/** The legacy `handleJoinHero` error vocabulary, verbatim. */
export type AdmissionErrorCode = "missing_hero" | "invalid_hero" | "forbidden" | "not_found";

export interface AdmittedJoin {
  partyId: string;
  heroId: string;
  /** The map the hero must be admitted on — their stored map, or the resolved adventure start. */
  mapId: string;
  adventure: StoredAdventure;
  /** Set exactly when the hero's stored map was unusable: the start position the room must
   *  epoch-fence-relocate them to after acquiring presence. */
  /**
   * Where the row must be moved to before it is read, or `null` when the hero's stored map is still
   * a member of its adventure and nothing has to move.
   *
   * All three axes travel together, in the DESTINATION's own units: the re-derived start names its
   * map from tile-editor content and its position from that map's own heightfield spawn
   * (`HeroService.resolveHeroStart`). Admission then seats the body on real ground from there
   * (`mapEntryPosition`), exactly as an ordinary reconnect is seated.
   */
  relocatedTo: WorldPosition | null;
}

export type AdmissionResolution =
  | { ok: true; join: AdmittedJoin }
  | { ok: false; error: AdmissionErrorCode };

/** Port of legacy `hero-profile.ts`'s `COLOR_TO_APPEARANCE`. */
const COLOR_TO_APPEARANCE: Record<PartyColor, PrimaryColor> = {
  blue: "azure",
  red: "ember",
  yellow: "moss",
  purple: "violet",
};

/** Port of legacy `hero-persistence.ts`'s `QUEST_ORDER`. */
const QUEST_ORDER: readonly QuestChapter[] = [
  "three_offerings",
  "bone_choir",
  "mire_runes",
  "ward_run",
];

function isQuestChapter(value: string | undefined): value is QuestChapter {
  return value !== undefined && (QUEST_ORDER as readonly string[]).includes(value);
}

interface HeroQuestRow {
  questId: string;
  status: "available" | "active" | "ready" | "completed";
  progress: number;
  data?: Record<string, unknown>;
}

/** Port of legacy `selectPrimaryQuest`: the earliest uncompleted chapter, else the latest known. */
function selectPrimaryQuest(quests: readonly HeroQuestRow[]): HeroQuestRow | undefined {
  for (const questId of QUEST_ORDER) {
    const quest = quests.find((candidate) => candidate.questId === questId);
    if (quest && quest.status !== "completed") return quest;
  }
  for (let index = QUEST_ORDER.length - 1; index >= 0; index -= 1) {
    const quest = quests.find((candidate) => candidate.questId === QUEST_ORDER[index]);
    if (quest) return quest;
  }
  return undefined;
}

function numberFromData(data: Record<string, unknown> | undefined, key: string): number | null {
  const value = data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeDeadline(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Port of legacy `hero-profile.ts`'s `restoredLife`: a dead row must carry a walkable body, or it
 *  repairs to alive rather than stranding a ghost with nothing to walk back to. */
function restoredLife(
  row: Hero,
  terrain: ZoneTerrain | undefined,
): { life: LifeState; corpse: WorldPosition | null } {
  const life = isLifeState(row.life) ? row.life : "alive";
  if (
    life === "alive" ||
    row.corpseX === undefined ||
    row.corpseY === undefined ||
    row.corpseZ === undefined
  ) {
    return { life: "alive", corpse: null };
  }
  const corpse: WorldPosition = { x: row.corpseX, y: row.corpseY, z: row.corpseZ };
  if (!terrain) return { life, corpse };
  if (!canStand(terrain, corpse.x, corpse.z, BODY_RADIUS, groundUnder(terrain, corpse.x, corpse.z)))
    return { life: "alive", corpse: null };
  return { life, corpse: { ...corpse, y: groundUnder(terrain, corpse.x, corpse.z) } };
}

export class AdmissionService {
  heroService = $inject(HeroService);
  adventureService = $inject(AdventureService);
  adventureStateService = $inject(AdventureStateService);
  testSessionService = $inject(TestSessionService);

  parties = $repository(parties);
  partyMembers = $repository(partyMembers);
  heroes = $repository(heroes);
  maps = $repository(maps);
  adventureTestSessions = $repository(adventureTestSessions);
  heroItems = $repository(heroItems);
  heroEquipment = $repository(heroEquipment);
  heroQuests = $repository(heroQuests);

  /**
   * The 13-step legacy admission, reads only. `cleanupExpiredTest` mirrors legacy's join-time
   * disposal of an expired playtest envelope (`deleteAdventureTestSession` before refusing) — the
   * HTTP `resolveJoin` passes `true`; the room's `onJoin` re-validation passes `false` and simply
   * refuses, since a socket callback must not cascade party deletion.
   */
  async resolveAdmission(
    userId: string,
    partyId: string | null,
    heroId: string | null,
    options: { cleanupExpiredTest?: boolean } = {},
  ): Promise<AdmissionResolution> {
    if (!partyId || !heroId) return { ok: false, error: "missing_hero" };
    if (!isUuid(partyId) || !isUuid(heroId)) return { ok: false, error: "invalid_hero" };

    const membership = await this.partyMembers.findOne({
      where: { partyId: { eq: partyId }, userId: { eq: userId } },
    });
    if (!membership) return { ok: false, error: "forbidden" };

    // An expired test is disposable by definition (legacy `adventureTestPartyAccess`).
    const testSession = await this.adventureTestSessions.findOne({
      where: { partyId: { eq: partyId } },
    });
    if (
      testSession &&
      (testSession.userId !== userId || new Date(testSession.expiresAt).getTime() <= Date.now())
    ) {
      if (options.cleanupExpiredTest) {
        try {
          await this.testSessionService.deleteTestSession(userId, testSession.id);
        } catch {
          // Another account's session: the ownership fence refuses the delete; refusal stands.
        }
      }
      return { ok: false, error: "forbidden" };
    }

    const hero = await this.heroes.findOne({
      where: { id: { eq: heroId }, partyId: { eq: partyId }, userId: { eq: userId } },
    });
    if (!hero) return { ok: false, error: "forbidden" };

    const party = await this.parties.findById(partyId);
    if (!party) return { ok: false, error: "forbidden" };
    // By id, not owner-fenced: the party may run anyone's adventure (membership checked above).
    let adventure: StoredAdventure;
    try {
      adventure = await this.adventureService.getAdventure(party.adventureId);
    } catch {
      return { ok: false, error: "not_found" };
    }

    let mapId = hero.mapId;
    let relocatedTo: WorldPosition | null = null;
    const storedMap = adventure.mapIds.includes(mapId) ? await this.maps.findById(mapId) : null;
    if (!storedMap) {
      // The hero's stored map is gone (deleted, or never a member). Re-derive the adventure's
      // start; only a mapless adventure has no room to admit the hero into.
      const start = await this.heroService.resolveHeroStart(adventure.id);
      if (!start) return { ok: false, error: "not_found" };
      mapId = start.mapId;
      relocatedTo = start.position;
    }

    return { ok: true, join: { partyId, heroId, mapId, adventure, relocatedTo } };
  }

  /**
   * Port of legacy `loadHeroProfile` + `loadNormalizedHeroState`, against the tranche-1
   * repositories. `terrain` is the admitting room's baked geometry, used to clamp the restored
   * position and validate a persisted corpse — the caller already holds it, so this never loads a
   * map of its own (unlike legacy, which re-read the map from D1).
   */
  async loadHeroProfile(
    heroId: string,
    terrain: ZoneTerrain | undefined,
    spawn: GroundVector = { x: 0, z: 0 },
  ): Promise<PlayerProfile | null> {
    const row = await this.heroes.findById(heroId);
    if (!row) return null;
    const membership = await this.partyMembers.findOne({
      where: { partyId: { eq: row.partyId }, userId: { eq: row.userId } },
    });
    if (!membership) return null;

    const [items, equipped, questRows, harvestGoldLedgerBaseline] = await Promise.all([
      this.heroItems.findMany({ where: { heroId: { eq: row.id } } }),
      this.heroEquipment.findMany({ where: { heroId: { eq: row.id } } }),
      this.heroQuests.findMany({ where: { heroId: { eq: row.id } } }),
      this.adventureStateService.harvestGoldLedgerTotal(row.id),
    ]);

    const consumables: ConsumableCounts = emptyConsumables();
    for (const item of items) {
      if ((CONSUMABLE_IDS as readonly string[]).includes(item.itemDefinitionId)) {
        consumables[item.itemDefinitionId as keyof ConsumableCounts] = Math.max(0, item.quantity);
      }
    }

    const itemById = new Map(items.map((item) => [item.id, item.itemDefinitionId]));
    let mainHand: string | undefined;
    let offHand: string | null = null;
    for (const slot of equipped) {
      const definitionId = itemById.get(slot.heroItemId);
      if (definitionId === undefined) continue;
      if (slot.slot === "main_hand") mainHand = definitionId;
      if (slot.slot === "off_hand") offHand = definitionId;
    }
    const equipment =
      mainHand && isMainHandItem(mainHand) && (offHand === null || isOffHandItem(offHand))
        ? normalizeEquipment(row.class, mainHand, offHand)
        : starterEquipmentFor(row.class);

    const selected = selectPrimaryQuest(questRows);
    const chapter = isQuestChapter(selected?.questId) ? selected.questId : "three_offerings";

    const position = restoreStandablePosition(terrain, { x: row.x, y: row.y, z: row.z }, spawn);
    const level = Math.max(1, row.level);
    const life = restoredLife(row, terrain);

    const resource = initialResource(row.class);
    if (resource && row.resourceCurrent !== undefined && Number.isFinite(row.resourceCurrent)) {
      resource.current = Math.max(0, Math.min(resource.max, row.resourceCurrent));
    }

    let talents: readonly string[];
    try {
      talents = normalizeTalentSelection(row.class, level, JSON.parse(row.talents));
    } catch {
      talents = [];
    }
    let cooldowns: ReturnType<typeof emptyCombatCooldowns>;
    try {
      cooldowns = normalizeCombatCooldowns(JSON.parse(row.combatCooldowns), Date.now());
    } catch {
      cooldowns = emptyCombatCooldowns();
    }

    return {
      id: row.id,
      nick: row.name,
      ...position,
      level,
      xp: Math.max(0, row.xp),
      hp: Math.min(maxHpForLevel(level), Math.max(life.life === "alive" ? 1 : 0, row.hp)),
      appearance: normalizeAppearance({
        body: row.body,
        primaryColor: COLOR_TO_APPEARANCE[membership.color],
      }),
      class: row.class,
      equipment,
      inventory: {
        potions: consumables[HEALTH_POTION_ID as keyof ConsumableCounts] ?? 0,
        gold: Math.max(0, row.gold + harvestGoldLedgerBaseline),
        crystals: Math.max(0, row.crystals),
        consumables,
      },
      harvestGoldLedgerBaseline,
      quest: {
        chapter,
        status: selected?.status ?? "available",
        progress: Math.max(0, selected?.progress ?? 0),
        target: questDefinition(chapter).target,
      },
      zoneId: row.mapId,
      instanceId: "main",
      sessionEpoch: Math.max(0, row.sessionEpoch),
      wardRunExpiresAt: numberFromData(selected?.data, "wardRunExpiresAt"),
      ...life,
      ...(resource ? { resource } : {}),
      talents,
      cooldowns,
      consumableCooldownUntil: safeDeadline(row.consumableCooldownUntil),
      damageBoostUntil: safeDeadline(row.damageBoostUntil),
      forgottenUntil: safeDeadline(row.forgottenUntil),
      invisibleUntil: safeDeadline(row.invisibleUntil),
      resurrectionAt: safeDeadline(row.resurrectionAt),
    };
  }
}
