/**
 * Epoch-fenced hero persistence for the Alepha world room (realtime tranche, Task 6) — the port of
 * `packages/server/src/hero-profile.ts`'s `saveHeroProfile` onto the tranche-1 `heroes`/`heroItems`/
 * `heroEquipment`/`heroSkills`/`heroQuests` entities. `saveHero` writes the hero CORE row (position,
 * level/xp/hp, gold/crystals, class resource, combat cooldowns, timed consumable deadlines, talents,
 * life/corpse) plus its normalized children (consumable quantities, equipped weapon/shield, the
 * built-in quest-chapter row, unlocked/equipped skills) as one sequence of individually fenced D1
 * statements — never one atomic batch, because Alepha's D1 provider reports
 * `supportsTransactions: false` (the same tranche-1 discipline `AdventureStateService` already
 * documents for `claimQuestReward`).
 *
 * **Fence shape.** The core UPDATE carries `WHERE id = ? AND session_epoch = ?` directly (ported
 * verbatim from `hero-profile.ts`) and is the ONLY statement this method ever issues unconditionally
 * — every child write below is gated behind it. If the core UPDATE's `RETURNING id` comes back empty
 * (the epoch has moved on: a second `PresenceRoom.acquire`/`handoff` already raced ahead of this
 * save), `saveHero` returns `"stale"` immediately and issues NO further statements at all, so a stale
 * save changes zero rows anywhere by construction rather than by relying solely on each child
 * statement's own `EXISTS` fence to no-op. Each child statement still carries that `EXISTS (SELECT 1
 * FROM heroes WHERE id = ? AND session_epoch = ?)` fence anyway — defense in depth against the epoch
 * moving on mid-sequence (between the core write and a later child write), exactly like
 * `AdventureStateService.claimQuestReward`'s documented gap.
 *
 * **Not part of this save.** `mapId`/`partyId` never appear here — legacy's own `saveHeroProfile`
 * never touches them either; a map move is exclusively `HeroEpochService.handoffEpoch` (via
 * `PresenceRoom.handoff`), a separate fenced call the map-transition task (Task 8) drives. Writing
 * `mapId` from a periodic save would race a handoff that has already re-homed the row. Authored-quest
 * progress (the 4-digit `AuthoredQuestProgress` records) is `AdventureStateService`'s own fenced
 * write, not this one — only the built-in quest-chapter row (`three_offerings`/`bone_choir`/…) is
 * saved here, matching legacy's `saveHeroProfile` scope exactly.
 */
import {
  type Equipment,
  isEquipmentForClass,
  starterEquipmentFor,
} from "@lindocara/engine/character.js";
import type { ConsumableCounts } from "@lindocara/engine/consumables.js";
import { normalizeConsumables } from "@lindocara/engine/consumables.js";
import { type CombatCooldownState, normalizeCombatCooldowns } from "@lindocara/engine/cooldowns.js";
import type { PlayerClass } from "@lindocara/engine/game.js";
import type { QuestState } from "@lindocara/engine/protocol.js";
import { CLASS_SKILLS, isSkillUnlocked } from "@lindocara/engine/skills.js";
import { normalizeTalentSelection } from "@lindocara/engine/talents.js";
import { z } from "alepha";
import { $repository, sql } from "alepha/orm";
import type { SaveableProfile } from "../../profile-types.ts";
import { heroEquipment } from "../entities/heroEquipment.ts";
import { heroes } from "../entities/heroes.ts";
import { heroItems } from "../entities/heroItems.ts";
import { heroQuests } from "../entities/heroQuests.ts";
import { heroSkills } from "../entities/heroSkills.ts";
import { itemDefinitions } from "../entities/itemDefinitions.ts";

export type HeroSaveResult = "saved" | "stale";

/** The reward payload of a built-in quest-chapter turn-in — mirrors `worldTick.ts`'s
 *  `QuestRewardClaim` minus the epoch (passed alongside). */
export interface HeroQuestRewardClaim {
  heroId: string;
  sessionEpoch: number;
  questId: string;
  rewardGold: number;
  rewardPotions: number;
  resultingLevel: number;
  resultingXp: number;
  resultingHp: number;
}

const HEALTH_POTION_ID = "health_potion";

const ID_ROW_SCHEMA = z.object({ id: z.uuid() });
const QUEST_ID_ROW_SCHEMA = z.object({ quest_id: z.string() });
const QUANTITY_ROW_SCHEMA = z.object({ quantity: z.number() });

/** Port of `hero-profile.ts`'s `safeDeadline`: a deadline column never stores a negative or
 *  non-finite value, matching what `AdmissionService.loadHeroProfile` already expects on read. */
function safeDeadline(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Persist only the mutable base; settled harvest claims remain an additive, monotone ledger. */
function baseGoldFromProfile(profile: SaveableProfile): number {
  const visible = Number.isSafeInteger(profile.inventory.gold)
    ? Math.max(0, profile.inventory.gold)
    : 0;
  const ledger = Number.isSafeInteger(profile.harvestGoldLedgerBaseline)
    ? Math.max(0, profile.harvestGoldLedgerBaseline ?? 0)
    : 0;
  const base = visible - ledger;
  return Number.isSafeInteger(base) ? base : 0;
}

const EQUIPMENT_SLOTS = [
  ["main_hand", (equipment: Equipment) => equipment.mainHand],
  ["off_hand", (equipment: Equipment) => equipment.offHand],
] as const;

export class HeroSaveService {
  heroes = $repository(heroes);
  heroItems = $repository(heroItems);
  heroEquipment = $repository(heroEquipment);
  heroSkills = $repository(heroSkills);
  heroQuests = $repository(heroQuests);
  itemDefinitions = $repository(itemDefinitions);

  /**
   * Port of `hero-persistence.ts`'s `consumeHeroOwnedItem` (Task 7 — replaces the in-memory
   * `consumePotion` stub the Task-6 report flagged): one fenced decrement, returning the remaining
   * quantity or `null` when nothing could be spent (no row, empty stack, stale epoch, or the item
   * is not a consumable definition). Never more than one statement — the fence rides the UPDATE.
   */
  async consumeItem(
    heroId: string,
    sessionEpoch: number,
    itemDefinitionId: string,
  ): Promise<number | null> {
    const rows = await this.heroItems.query(
      (table) => sql`
        UPDATE ${table}
        SET quantity = quantity - 1
        WHERE ${table.heroId} = ${heroId} AND ${table.itemDefinitionId} = ${itemDefinitionId}
          AND quantity > 0
          AND EXISTS (
            SELECT 1 FROM ${this.heroes.table}
            WHERE ${this.heroes.table.id} = ${heroId} AND ${this.heroes.table.sessionEpoch} = ${sessionEpoch}
          )
          AND EXISTS (
            SELECT 1 FROM ${this.itemDefinitions.table}
            WHERE ${this.itemDefinitions.table.id} = ${table.itemDefinitionId}
              AND ${this.itemDefinitions.table.type} = 'consumable'
          )
        RETURNING quantity
      `,
      QUANTITY_ROW_SCHEMA,
    );
    return rows[0]?.quantity ?? null;
  }

  /**
   * Port of `hero-persistence.ts`'s `claimHeroQuestReward` (Task 7 — replaces the always-false
   * `claimQuestReward` stub): the idempotent built-in quest-chapter reward claim. The first
   * statement flips the `hero_quest` row `ready -> completed` and stamps a fresh `reward_claim_id`
   * — only when no claim id exists yet, under the epoch fence — and the two grant statements are
   * each gated on THAT exact claim id, so a re-entrant or replayed claim grants nothing twice.
   * Sequential fenced statements, not a batch (Alepha's D1 provider has no transactions); a crash
   * between them under-grants once rather than double-granting, and the claim row records it.
   */
  async claimQuestReward(input: HeroQuestRewardClaim): Promise<boolean> {
    const claimId = crypto.randomUUID();
    const claimed = await this.heroQuests.query(
      (table) => sql`
        UPDATE ${table}
        SET status = 'completed',
            ${sql.raw(table.completedAt.name)} = ${new Date().toISOString()},
            ${sql.raw(table.rewardClaimId.name)} = ${claimId}
        WHERE ${table.heroId} = ${input.heroId} AND ${table.questId} = ${input.questId}
          AND status = 'ready' AND ${sql.raw(table.rewardClaimId.name)} IS NULL
          AND EXISTS (
            SELECT 1 FROM ${this.heroes.table}
            WHERE ${this.heroes.table.id} = ${input.heroId}
              AND ${this.heroes.table.sessionEpoch} = ${input.sessionEpoch}
          )
        RETURNING ${sql.raw(table.questId.name)}
      `,
      QUEST_ID_ROW_SCHEMA,
    );
    if (claimed.length !== 1) return false;
    await this.heroes.query(
      (table) => sql`
        UPDATE ${table}
        SET ${sql.raw(table.gold.name)} = ${sql.raw(table.gold.name)} + ${input.rewardGold},
            ${sql.raw(table.level.name)} = ${input.resultingLevel},
            ${sql.raw(table.xp.name)} = ${input.resultingXp},
            ${sql.raw(table.hp.name)} = ${input.resultingHp},
            ${sql.raw(table.updatedAt.name)} = ${new Date().toISOString()}
        WHERE ${table.id} = ${input.heroId} AND ${table.sessionEpoch} = ${input.sessionEpoch}
          AND EXISTS (
            SELECT 1 FROM ${this.heroQuests.table}
            WHERE ${this.heroQuests.table.heroId} = ${input.heroId}
              AND ${this.heroQuests.table.questId} = ${input.questId}
              AND ${sql.raw(this.heroQuests.table.rewardClaimId.name)} = ${claimId}
          )
      `,
    );
    await this.heroItems.query(
      (table) => sql`
        INSERT INTO ${table}
          (${sql.raw(table.id.name)}, ${sql.raw(table.heroId.name)},
           ${sql.raw(table.itemDefinitionId.name)}, quantity, ${sql.raw(table.createdAt.name)})
        SELECT ${crypto.randomUUID()}, ${input.heroId}, ${HEALTH_POTION_ID}, ${input.rewardPotions},
               ${new Date().toISOString()}
        WHERE EXISTS (
          SELECT 1 FROM ${this.heroQuests.table}
          WHERE ${this.heroQuests.table.heroId} = ${input.heroId}
            AND ${this.heroQuests.table.questId} = ${input.questId}
            AND ${sql.raw(this.heroQuests.table.rewardClaimId.name)} = ${claimId}
        )
          AND EXISTS (
            SELECT 1 FROM ${this.heroes.table}
            WHERE ${this.heroes.table.id} = ${input.heroId}
              AND ${this.heroes.table.sessionEpoch} = ${input.sessionEpoch}
          )
        ON CONFLICT(${sql.raw(table.heroId.name)}, ${sql.raw(table.itemDefinitionId.name)}) DO UPDATE SET
          quantity = quantity + excluded.quantity
      `,
    );
    return true;
  }

  /**
   * Saves one hero under the session epoch the caller currently holds. `"stale"` means the epoch
   * has already moved on (a competing acquire/handoff won the race) — the caller invalidates local
   * authority and closes the socket `PRESENCE_LOST` (the room-level seam, not this method).
   */
  async saveHero(profile: SaveableProfile, sessionEpoch: number): Promise<HeroSaveResult> {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const equipment = isEquipmentForClass(profile.equipment, profile.class)
      ? profile.equipment
      : starterEquipmentFor(profile.class);
    const consumables = normalizeConsumables(
      profile.inventory.consumables,
      profile.inventory.potions,
    );
    const cooldowns = normalizeCombatCooldowns(profile.cooldowns, now);
    const chapter = profile.quest.chapter ?? "three_offerings";

    const coreSaved = await this.saveCore(profile, sessionEpoch, cooldowns, nowIso);
    if (!coreSaved) return "stale";

    await this.saveConsumables(profile.id, sessionEpoch, consumables, nowIso);
    await this.saveEquipment(profile.id, sessionEpoch, equipment, nowIso);
    await this.saveQuest(
      profile.id,
      sessionEpoch,
      chapter,
      profile.quest,
      profile.wardRunExpiresAt,
      nowIso,
    );
    await this.saveSkills(profile.id, sessionEpoch, profile.class, profile.level, nowIso);

    return "saved";
  }

  /** The hero core row. Returns `false` (and writes nothing) the instant the fence fails. */
  protected async saveCore(
    profile: SaveableProfile,
    sessionEpoch: number,
    cooldowns: CombatCooldownState,
    nowIso: string,
  ): Promise<boolean> {
    const talents = JSON.stringify(
      normalizeTalentSelection(profile.class, profile.level, profile.talents),
    );
    const rows = await this.heroes.query(
      (table) => sql`
        UPDATE ${table}
        SET ${sql.raw(table.x.name)} = ${profile.x},
            ${sql.raw(table.y.name)} = ${profile.y},
            ${sql.raw(table.z.name)} = ${profile.z},
            ${sql.raw(table.level.name)} = ${profile.level},
            ${sql.raw(table.xp.name)} = ${profile.xp},
            ${sql.raw(table.hp.name)} = ${profile.hp},
            ${sql.raw(table.gold.name)} = ${baseGoldFromProfile(profile)},
            ${sql.raw(table.crystals.name)} = ${Math.max(0, profile.inventory.crystals)},
            ${sql.raw(table.resourceCurrent.name)} = ${profile.resource?.current ?? null},
            ${sql.raw(table.combatCooldowns.name)} = ${JSON.stringify(cooldowns)},
            ${sql.raw(table.consumableCooldownUntil.name)} = ${safeDeadline(profile.consumableCooldownUntil ?? 0)},
            ${sql.raw(table.damageBoostUntil.name)} = ${safeDeadline(profile.damageBoostUntil ?? 0)},
            ${sql.raw(table.forgottenUntil.name)} = ${safeDeadline(profile.forgottenUntil ?? 0)},
            ${sql.raw(table.invisibleUntil.name)} = ${safeDeadline(profile.invisibleUntil ?? 0)},
            ${sql.raw(table.resurrectionAt.name)} = ${safeDeadline(profile.resurrectionAt ?? 0)},
            ${sql.raw(table.talents.name)} = ${talents},
            ${sql.raw(table.life.name)} = ${profile.life},
            ${sql.raw(table.corpseX.name)} = ${profile.corpse?.x ?? null},
            ${sql.raw(table.corpseY.name)} = ${profile.corpse?.y ?? null},
            ${sql.raw(table.corpseZ.name)} = ${profile.corpse?.z ?? null},
            ${sql.raw(table.updatedAt.name)} = ${nowIso}
        WHERE ${table.id} = ${profile.id} AND ${table.sessionEpoch} = ${sessionEpoch}
        RETURNING ${table.id}
      `,
      ID_ROW_SCHEMA,
    );
    return rows.length > 0;
  }

  /** Every consumable slot (including `health_potion`, whose count also mirrors `inventory.potions`
   *  via `toProfile`/`normalizeConsumables`), upserted by quantity. */
  protected async saveConsumables(
    heroId: string,
    sessionEpoch: number,
    consumables: ConsumableCounts,
    nowIso: string,
  ): Promise<void> {
    for (const [definitionId, quantity] of Object.entries(consumables)) {
      await this.heroItems.query(
        (table) => sql`
          INSERT INTO ${table}
            (${sql.raw(table.id.name)}, ${sql.raw(table.heroId.name)},
             ${sql.raw(table.itemDefinitionId.name)}, quantity, ${sql.raw(table.createdAt.name)})
          SELECT ${crypto.randomUUID()}, ${heroId}, ${definitionId}, ${quantity}, ${nowIso}
          WHERE EXISTS (
            SELECT 1 FROM ${this.heroes.table}
            WHERE ${this.heroes.table.id} = ${heroId} AND ${this.heroes.table.sessionEpoch} = ${sessionEpoch}
          )
          ON CONFLICT(${sql.raw(table.heroId.name)}, ${sql.raw(table.itemDefinitionId.name)}) DO UPDATE SET
            quantity = excluded.quantity
        `,
      );
    }
  }

  /**
   * The two equipment slots. An empty slot (`offHand === null`) deletes its `hero_equipment` row;
   * an occupied slot upserts the owned `hero_item` row first (`RETURNING id` even on conflict, via
   * `DO UPDATE`, so the correct row id comes back whether it was just inserted or already existed —
   * `hero_item.id` is a random uuid here, unlike legacy's deterministic `ownedItemId`), then points
   * `hero_equipment` at that id.
   */
  protected async saveEquipment(
    heroId: string,
    sessionEpoch: number,
    equipment: Equipment,
    nowIso: string,
  ): Promise<void> {
    for (const [slot, pick] of EQUIPMENT_SLOTS) {
      const definitionId = pick(equipment);
      if (definitionId === null) {
        await this.heroEquipment.query(
          (table) => sql`
            DELETE FROM ${table}
            WHERE ${table.heroId} = ${heroId} AND ${table.slot} = ${slot}
              AND EXISTS (
                SELECT 1 FROM ${this.heroes.table}
                WHERE ${this.heroes.table.id} = ${heroId} AND ${this.heroes.table.sessionEpoch} = ${sessionEpoch}
              )
          `,
        );
        continue;
      }
      const itemRows = await this.heroItems.query(
        (table) => sql`
          INSERT INTO ${table}
            (${sql.raw(table.id.name)}, ${sql.raw(table.heroId.name)},
             ${sql.raw(table.itemDefinitionId.name)}, quantity, ${sql.raw(table.createdAt.name)})
          SELECT ${crypto.randomUUID()}, ${heroId}, ${definitionId}, 1, ${nowIso}
          WHERE EXISTS (
            SELECT 1 FROM ${this.heroes.table}
            WHERE ${this.heroes.table.id} = ${heroId} AND ${this.heroes.table.sessionEpoch} = ${sessionEpoch}
          )
          ON CONFLICT(${sql.raw(table.heroId.name)}, ${sql.raw(table.itemDefinitionId.name)}) DO UPDATE SET
            quantity = excluded.quantity
          RETURNING ${table.id}
        `,
        ID_ROW_SCHEMA,
      );
      const heroItemId = itemRows[0]?.id;
      if (heroItemId === undefined) continue; // the fence failed mid-sequence; nothing to equip
      await this.heroEquipment.query(
        (table) => sql`
          INSERT INTO ${table}
            (${sql.raw(table.id.name)}, ${sql.raw(table.heroId.name)}, slot,
             ${sql.raw(table.heroItemId.name)}, ${sql.raw(table.equippedAt.name)})
          SELECT ${crypto.randomUUID()}, ${heroId}, ${slot}, ${heroItemId}, ${nowIso}
          WHERE EXISTS (
            SELECT 1 FROM ${this.heroes.table}
            WHERE ${this.heroes.table.id} = ${heroId} AND ${this.heroes.table.sessionEpoch} = ${sessionEpoch}
          )
          ON CONFLICT(${sql.raw(table.heroId.name)}, slot) DO UPDATE SET
            ${sql.raw(table.heroItemId.name)} = excluded.${sql.raw(table.heroItemId.name)},
            ${sql.raw(table.equippedAt.name)} = excluded.${sql.raw(table.equippedAt.name)}
        `,
      );
    }
  }

  /** The built-in quest-chapter row, port of `hero-profile.ts`'s `hero_quest` upsert including the
   *  reward-claim guard: once a chapter has been claimed (`rewardClaimId` set), only a transition
   *  back to `"completed"` may touch its row again — a stale re-save of an in-flight chapter can
   *  never clobber an already-claimed one. */
  protected async saveQuest(
    heroId: string,
    sessionEpoch: number,
    chapter: string,
    quest: QuestState,
    wardRunExpiresAt: number | null,
    nowIso: string,
  ): Promise<void> {
    const data = wardRunExpiresAt === null ? null : JSON.stringify({ wardRunExpiresAt });
    await this.heroQuests.query(
      (table) => sql`
        INSERT INTO ${table}
          (${sql.raw(table.id.name)}, ${sql.raw(table.heroId.name)}, ${sql.raw(table.questId.name)},
           status, progress, ${sql.raw(table.acceptedAt.name)}, ${sql.raw(table.completedAt.name)}, data)
        SELECT ${crypto.randomUUID()}, ${heroId}, ${chapter}, ${quest.status}, ${quest.progress},
               CASE WHEN ${quest.status} = 'available' THEN NULL ELSE ${nowIso} END,
               CASE WHEN ${quest.status} = 'completed' THEN ${nowIso} ELSE NULL END,
               ${data}
        WHERE EXISTS (
          SELECT 1 FROM ${this.heroes.table}
          WHERE ${this.heroes.table.id} = ${heroId} AND ${this.heroes.table.sessionEpoch} = ${sessionEpoch}
        )
        ON CONFLICT(${sql.raw(table.heroId.name)}, ${sql.raw(table.questId.name)}) DO UPDATE SET
          status = excluded.status,
          progress = excluded.progress,
          ${sql.raw(table.acceptedAt.name)} = COALESCE(${sql.raw(table.acceptedAt.name)}, excluded.${sql.raw(table.acceptedAt.name)}),
          ${sql.raw(table.completedAt.name)} = excluded.${sql.raw(table.completedAt.name)},
          data = excluded.data
        WHERE ${sql.raw(table.rewardClaimId.name)} IS NULL OR excluded.status = 'completed'
      `,
    );
  }

  /** Every class skill's unlocked/equipped/slot state, derived purely from level — port of
   *  `hero-profile.ts`'s `hero_skill` upsert loop. */
  protected async saveSkills(
    heroId: string,
    sessionEpoch: number,
    playerClass: PlayerClass,
    level: number,
    nowIso: string,
  ): Promise<void> {
    for (const skill of CLASS_SKILLS[playerClass]) {
      const unlocked = isSkillUnlocked(level, skill.slot);
      await this.heroSkills.query(
        (table) => sql`
          INSERT INTO ${table}
            (${sql.raw(table.id.name)}, ${sql.raw(table.heroId.name)}, ${sql.raw(table.skillId.name)},
             unlocked, equipped, slot, ${sql.raw(table.unlockedAt.name)})
          SELECT ${crypto.randomUUID()}, ${heroId}, ${skill.id}, ${unlocked ? 1 : 0}, ${unlocked ? 1 : 0},
                 ${unlocked ? skill.slot : null}, ${unlocked ? nowIso : null}
          WHERE EXISTS (
            SELECT 1 FROM ${this.heroes.table}
            WHERE ${this.heroes.table.id} = ${heroId} AND ${this.heroes.table.sessionEpoch} = ${sessionEpoch}
          )
          ON CONFLICT(${sql.raw(table.heroId.name)}, ${sql.raw(table.skillId.name)}) DO UPDATE SET
            unlocked = excluded.unlocked,
            equipped = excluded.equipped,
            slot = excluded.slot,
            ${sql.raw(table.unlockedAt.name)} = COALESCE(${sql.raw(table.unlockedAt.name)}, excluded.${sql.raw(table.unlockedAt.name)})
        `,
      );
    }
  }
}
