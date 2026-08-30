/**
 * D1 boundary for `PartyRoom` (Task 3, realtime tranche) — the party's live adventure state
 * (switches/variables/self-switches/quests/defeatedMonsters/materials/harvestNodes, the private
 * support-spend journal, plus the monotone push version) and the fenced, epoch-gated writes a quest
 * reward touches on a hero:
 * core stats (gold/level/xp/hp),
 * items, personal quest progress and the reward-claim idempotency row.
 *
 * Every write below is scoped to exactly the row(s) it needs to touch and, wherever it mutates a
 * hero, is gated on `hero.session_epoch` in the SAME statement as the mutation — the repo-wide
 * fencing discipline (`HeroEpochService`'s docblock, the root `CLAUDE.md`'s "Hero presence and save
 * fencing"). `claimQuestReward` additionally checks the hero epoch UP FRONT, before issuing any
 * statement, so a stale-epoch caller mutates nothing at all rather than relying solely on the
 * per-statement fences to no-op.
 *
 * **Not one atomic D1 transaction, and the scope of that gap is wider than `claimQuestReward`
 * alone.** Legacy's `claimAuthoredQuestReward` (`authored-quest-rewards.ts`) issued one
 * `D1Database.batch(...)`, which Cloudflare D1 documents as atomic — either every statement lands
 * or none does. Alepha's D1 provider reports `supportsTransactions: false` (`$transactional()`
 * degrades to a no-op there, per the tranche-1 discipline every other `src/api/` service already
 * follows), and there is no equivalent raw batch primitive exposed through
 * `$repository`/`Repository.query()`. `claimQuestReward` below is therefore a SEQUENCE of
 * individually fenced statements: the claim-row insert first (the idempotency + epoch gate — if
 * this inserts zero rows nothing after it runs), then the hero core update, then one statement per
 * item change — EVERY hero-mutating statement in that sequence, including the item ones, re-checks
 * `hero.session_epoch = ?` in its own `WHERE`/`EXISTS`, not just the leading claim insert, so a
 * reconnect (epoch bump) landing BETWEEN the claim insert and a later statement makes that later
 * statement a no-op instead of a stale-session item mutation. Each statement is therefore safe on
 * its own, but the sequence as a whole is still not all-or-nothing against a mid-sequence crash the
 * way legacy's batch was (e.g. the claim can land and the hero-core update crash before running).
 *
 * That gap is not confined to this method's own internals, either: `PartyRoom.completeAuthoredQuest`
 * (the only caller) issues TWO MORE writes after `claimQuestReward` resolves — the party-state
 * commit (`PartyRoom#commitState`, for a party-scope quest) and the personal-progress save
 * (`savePersonalQuestProgress` below, for a personal-scope quest or a chained next quest) — and
 * NEITHER of those is covered by this method's claim/epoch fencing at all. They are separate calls,
 * separately fenced (the personal-progress save carries its own epoch fence; the party-state commit
 * carries none, since party state is not hero-owned), executing after the reward has already been
 * unrecoverably claimed. A crash between the claim succeeding and either of those two writes leaves
 * the reward granted with the quest's own progress/state not yet reflecting it — recoverable only by
 * a human replaying the write, not by any fence in this file. Documented as a known gap in the task
 * report; revisit if/when Alepha exposes a real D1 batch escape hatch.
 */
import type {
  AdventureRegistry,
  AuthoredQuestProgress,
  PartyAdventureState,
} from "@lindocara/engine/adventure-state.js";
import {
  EMPTY_ADVENTURE_STATE,
  parsePartyAdventureState,
} from "@lindocara/engine/adventure-state.js";
import { HARVEST_PROFILE_LIMITS } from "@lindocara/engine/harvest.js";
import { isUuid } from "@lindocara/engine/identifiers.js";
import { isHarvestNodeId } from "@lindocara/engine/party-harvest-state.js";
import type { QuestItemReward } from "@lindocara/engine/quests.js";
import { z } from "alepha";
import { $repository, sql } from "alepha/orm";

import { decodeStoredAdventureRegistry } from "../../adventure-registry.js";
import { adventures } from "../entities/adventures.ts";
import { authoredQuestRewardClaims } from "../entities/authoredQuestRewardClaims.ts";
import { type HarvestGoldClaim, harvestGoldClaims } from "../entities/harvestGoldClaims.ts";
import { heroes } from "../entities/heroes.ts";
import { heroItems } from "../entities/heroItems.ts";
import { heroQuests } from "../entities/heroQuests.ts";
import { parties } from "../entities/parties.ts";
import { partyAdventureStates } from "../entities/partyAdventureStates.ts";
import { parseSupportSpendJournal, type SupportSpendJournal } from "./supportSpendJournal.ts";

export interface PartyContext {
  adventureId: string;
  status: "open" | "completed";
}

export interface VersionedPartyAdventureState {
  state: PartyAdventureState;
  version: number;
}

/** Coordinator-only state. `supportSpends` must never cross into engine or wire contracts. */
export interface CoordinatorPartyAdventureState extends VersionedPartyAdventureState {
  supportSpends: SupportSpendJournal;
}

export interface HarvestGoldReconciliationContext extends VersionedPartyAdventureState {
  registry: AdventureRegistry;
  partyCompleted: boolean;
  supportSpends: SupportSpendJournal;
}

export interface ClaimQuestRewardInput {
  ownerKind: "party" | "personal";
  ownerId: string;
  heroId: string;
  sessionEpoch: number;
  questId: string;
  attempt: number;
  resultingLevel: number;
  resultingXp: number;
  resultingHp: number;
  gold: number;
  items: readonly QuestItemReward[];
  consumeItems: readonly QuestItemReward[];
}

export interface HarvestGoldClaimIdentity {
  partyId: string;
  heroId: string;
  nodeId: string;
  generation: number;
  amount: number;
}

export interface PrepareHarvestGoldClaimInput extends HarvestGoldClaimIdentity {
  sessionEpoch: number;
}

interface StoredPartyAdventureStateFields {
  switches: string;
  variables: string;
  selfSwitches: string;
  quests: string;
  defeatedMonsters: string;
  materials: string;
  harvestNodes: string;
  teleporterUses: string;
  supportSpends: string;
  version: number;
}

type DecodedPartyAdventureState =
  | { ok: true; value: VersionedPartyAdventureState }
  | { ok: false; reason: "invalid_json" | "malformed_state" };

function warnCorruptPartyState(partyId: string, reason: string): void {
  console.warn(JSON.stringify({ event: "party_adventure_state_corrupt", partyId, reason }));
}

/** Aggregate objective progress, matching legacy `authored-quest-rewards.ts`'s `aggregateProgress`
 *  (a single integer column mirrors the JSON detail, for anything that only reads the coarse
 *  number). */
function aggregateProgress(progress: AuthoredQuestProgress): number {
  return Object.values(progress.objectives).reduce((total, value) => total + value, 0);
}

/** Row-shape schema for `Repository.query()`'s narrow `RETURNING` clauses below — the tranche-1
 *  convention every raw-SQL escape hatch in `src/api/services/` already follows. */
const QUEST_ID_ROW_SCHEMA = z.object({ questId: z.string() });
const ID_ROW_SCHEMA = z.object({ id: z.uuid() });

function validHarvestGoldClaim(input: PrepareHarvestGoldClaimInput): boolean {
  return (
    isUuid(input.partyId) &&
    isUuid(input.heroId) &&
    isHarvestNodeId(input.nodeId) &&
    Number.isSafeInteger(input.generation) &&
    input.generation >= 0 &&
    Number.isSafeInteger(input.sessionEpoch) &&
    input.sessionEpoch >= 0 &&
    Number.isSafeInteger(input.amount) &&
    input.amount >= 1 &&
    input.amount <= HARVEST_PROFILE_LIMITS.goldValue.max
  );
}

function decodePartyAdventureStateRow(
  row: StoredPartyAdventureStateFields,
): DecodedPartyAdventureState {
  let raw: unknown;
  try {
    raw = {
      switches: JSON.parse(row.switches),
      variables: JSON.parse(row.variables),
      selfSwitches: JSON.parse(row.selfSwitches),
      quests: JSON.parse(row.quests),
      defeatedMonsters: JSON.parse(row.defeatedMonsters),
      materials: JSON.parse(row.materials),
      harvestNodes: JSON.parse(row.harvestNodes),
      teleporterUses: JSON.parse(row.teleporterUses),
    };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  const state = parsePartyAdventureState(raw);
  return state
    ? { ok: true, value: { state, version: row.version } }
    : { ok: false, reason: "malformed_state" };
}

function decodeSupportSpendJournalRow(row: StoredPartyAdventureStateFields): SupportSpendJournal {
  let raw: unknown;
  try {
    raw = JSON.parse(row.supportSpends);
  } catch {
    throw new Error("cannot load invalid support-spend JSON");
  }
  const journal = parseSupportSpendJournal(raw);
  if (!journal) throw new Error("cannot load malformed support-spend journal");
  return journal;
}

export class AdventureStateService {
  parties = $repository(parties);
  adventures = $repository(adventures);
  partyAdventureStates = $repository(partyAdventureStates);
  heroes = $repository(heroes);
  heroItems = $repository(heroItems);
  heroQuests = $repository(heroQuests);
  authoredQuestRewardClaims = $repository(authoredQuestRewardClaims);
  harvestGoldClaims = $repository(harvestGoldClaims);

  /** The party's adventure id + completion status, or `null` for an unknown party. */
  async loadParty(partyId: string): Promise<PartyContext | null> {
    const row = await this.parties.findById(partyId).catch(() => undefined);
    if (!row) return null;
    return { adventureId: row.adventureId, status: row.status };
  }

  /** Degrades to `EMPTY_REGISTRY` for any adventure id this party context cannot resolve, matching
   *  legacy's own posture ("a hero's connection must never fail because authored content is
   *  missing"). */
  async loadRegistry(adventureId: string): Promise<AdventureRegistry> {
    const row = await this.adventures.findById(adventureId).catch(() => undefined);
    if (!row) return { switches: [], variables: [] };
    return decodeStoredAdventureRegistry(row.registry);
  }

  /**
   * Reads the party's live state + version. A missing row (no party has ever touched state) and a
   * corrupt row both degrade to `{ state: EMPTY_ADVENTURE_STATE, version: 0 }`, never throwing —
   * the same posture `adventure-state-store.ts`'s `loadPartyAdventureState` documents.
   */
  async load(partyId: string): Promise<VersionedPartyAdventureState> {
    const row = await this.partyAdventureStates.findById(partyId).catch(() => undefined);
    if (!row) return { state: EMPTY_ADVENTURE_STATE, version: 0 };
    const decoded = decodePartyAdventureStateRow(row);
    if (!decoded.ok) {
      warnCorruptPartyState(partyId, decoded.reason);
      return { state: EMPTY_ADVENTURE_STATE, version: 0 };
    }
    return decoded.value;
  }

  /**
   * Strict coordinator load for the private support-spend journal. Legacy rows decode from the
   * column default `{}`. Invalid JSON or an invalid entry fails closed: replacing uncertainty with
   * an empty journal could refund or charge the same action twice.
   */
  async loadCoordinatorState(partyId: string): Promise<CoordinatorPartyAdventureState> {
    const row = await this.partyAdventureStates.findById(partyId);
    if (!row) return { state: EMPTY_ADVENTURE_STATE, version: 0, supportSpends: {} };
    const supportSpends = decodeSupportSpendJournalRow(row);
    const decoded = decodePartyAdventureStateRow(row);
    if (!decoded.ok) {
      throw new Error(`cannot load coordinator from ${decoded.reason} party state`);
    }
    return { ...decoded.value, supportSpends };
  }

  /**
   * Strict durable read used only to decide a prepared gold claim. Unlike the ordinary gameplay
   * loader, repository errors and corrupt JSON are not allowed to masquerade as an empty party:
   * uncertainty must leave the claim pending for a later retry.
   */
  async loadForHarvestGoldReconciliation(
    partyId: string,
  ): Promise<HarvestGoldReconciliationContext> {
    if (!isUuid(partyId)) throw new Error("invalid party id for harvest gold reconciliation");
    const party = await this.parties.findById(partyId);
    if (!party) throw new Error("cannot reconcile harvest gold for an unknown party");
    const adventure = await this.adventures.findById(party.adventureId);
    if (!adventure) throw new Error("cannot reconcile harvest gold for an unknown adventure");
    const registry = decodeStoredAdventureRegistry(adventure.registry);
    const row = await this.partyAdventureStates.findById(partyId);
    if (!row) {
      return {
        state: EMPTY_ADVENTURE_STATE,
        version: 0,
        registry,
        partyCompleted: party.status === "completed",
        supportSpends: {},
      };
    }
    const decoded = decodePartyAdventureStateRow(row);
    if (!decoded.ok) {
      throw new Error(`cannot reconcile harvest gold from ${decoded.reason} party state`);
    }
    return {
      ...decoded.value,
      registry,
      partyCompleted: party.status === "completed",
      supportSpends: decodeSupportSpendJournalRow(row),
    };
  }

  /**
   * Write-through: upserts the whole state row (every column, `version` included) in ONE
   * statement, so a caller that immediately reads the row back (no clock advance, no debounce)
   * always sees it — the invariant the realtime tranche's write-through design replaces the legacy
   * 5s alarm debounce with.
   */
  async save(partyId: string, state: PartyAdventureState, version: number): Promise<void> {
    await this.partyAdventureStates.upsert({
      partyId,
      switches: JSON.stringify(state.switches),
      variables: JSON.stringify(state.variables),
      selfSwitches: JSON.stringify(state.selfSwitches),
      quests: JSON.stringify(state.quests ?? {}),
      defeatedMonsters: JSON.stringify(state.defeatedMonsters ?? {}),
      materials: JSON.stringify(state.materials ?? {}),
      harvestNodes: JSON.stringify(state.harvestNodes ?? {}),
      teleporterUses: JSON.stringify(state.teleporterUses ?? {}),
      version,
    });
  }

  /**
   * One-row atomic transition for material spending/refunding and its private idempotency journal.
   * Ordinary state saves omit `supportSpends`, so their conflict update preserves this column.
   */
  async saveWithSupportSpends(
    partyId: string,
    state: PartyAdventureState,
    version: number,
    supportSpends: SupportSpendJournal,
  ): Promise<void> {
    await this.partyAdventureStates.upsert({
      partyId,
      switches: JSON.stringify(state.switches),
      variables: JSON.stringify(state.variables),
      selfSwitches: JSON.stringify(state.selfSwitches),
      quests: JSON.stringify(state.quests ?? {}),
      defeatedMonsters: JSON.stringify(state.defeatedMonsters ?? {}),
      materials: JSON.stringify(state.materials ?? {}),
      harvestNodes: JSON.stringify(state.harvestNodes ?? {}),
      teleporterUses: JSON.stringify(state.teleporterUses ?? {}),
      supportSpends: JSON.stringify(supportSpends),
      version,
    });
  }

  /** Every authored-quest progress row for one hero, decoded the same way legacy
   *  `hero-persistence.ts`'s `authoredProgressFromRows` does (reusing `parsePartyAdventureState`'s
   *  own quest-progress parser rather than a second copy of its validation). */
  async loadPersonalQuestProgress(heroId: string): Promise<Record<string, AuthoredQuestProgress>> {
    const rows = await this.heroQuests.findMany({ where: { heroId: { eq: heroId } } });
    const progress: Record<string, AuthoredQuestProgress> = {};
    for (const row of rows) {
      if (!/^\d{4}$/.test(row.questId)) continue;
      const raw = (row.data as { authoredProgress?: unknown } | undefined)?.authoredProgress;
      const parsed = parsePartyAdventureState({
        switches: {},
        variables: {},
        selfSwitches: {},
        quests: { [row.questId]: raw },
      });
      const entry = parsed?.quests?.[row.questId];
      if (entry) progress[row.questId] = entry;
    }
    return progress;
  }

  /**
   * Fenced upsert of one hero's personal quest progress row, port of legacy
   * `hero-persistence.ts`'s `saveHeroAuthoredQuestProgress`: a single INSERT ... SELECT ... WHERE
   * the hero's CURRENT `session_epoch` still matches `sessionEpoch`, falling to an ON CONFLICT
   * UPDATE under the same fence. Returns `false` (and changes nothing) when the fence fails.
   */
  async savePersonalQuestProgress(input: {
    heroId: string;
    sessionEpoch: number;
    questId: string;
    progress: AuthoredQuestProgress;
  }): Promise<boolean> {
    const now = new Date().toISOString();
    const data = { authoredProgress: input.progress };
    const rows = await this.heroQuests.query(
      (table) => sql`
        INSERT INTO ${table}
          (${sql.raw(table.id.name)}, ${sql.raw(table.heroId.name)}, ${sql.raw(table.questId.name)},
           status, progress, ${sql.raw(table.acceptedAt.name)}, ${sql.raw(table.completedAt.name)}, data)
        SELECT ${crypto.randomUUID()}, ${input.heroId}, ${input.questId}, ${input.progress.status},
               ${aggregateProgress(input.progress)}, ${now},
               ${input.progress.status === "completed" ? now : null}, ${JSON.stringify(data)}
        WHERE EXISTS (
          SELECT 1 FROM ${this.heroes.table}
          WHERE ${this.heroes.table.id} = ${input.heroId}
            AND ${this.heroes.table.sessionEpoch} = ${input.sessionEpoch}
        )
        ON CONFLICT(${sql.raw(table.heroId.name)}, ${sql.raw(table.questId.name)}) DO UPDATE SET
          status = excluded.status,
          progress = excluded.progress,
          ${sql.raw(table.acceptedAt.name)} = COALESCE(${sql.raw(table.acceptedAt.name)}, excluded.${sql.raw(table.acceptedAt.name)}),
          ${sql.raw(table.completedAt.name)} = excluded.${sql.raw(table.completedAt.name)},
          data = excluded.data
        RETURNING ${table.questId}
      `,
      QUEST_ID_ROW_SCHEMA,
    );
    return rows.length > 0;
  }

  /**
   * The reward-claim idempotency fence + hero core stats + item grants/consumption. See this
   * file's docblock for why this is a sequence of fenced statements rather than one atomic batch.
   * Returns `false` — with NOTHING mutated — as soon as any precondition fails: an unknown/stale
   * hero epoch, an already-claimed `(ownerKind, ownerId, questId, attempt)` tuple, or insufficient
   * inventory for a consumed item.
   */
  async claimQuestReward(input: ClaimQuestRewardInput): Promise<boolean> {
    const hero = await this.heroes.findById(input.heroId).catch(() => undefined);
    if (!hero || hero.sessionEpoch !== input.sessionEpoch) return false;

    if (input.consumeItems.length > 0) {
      const owned = await this.heroItems.findMany({
        where: {
          heroId: { eq: input.heroId },
          itemDefinitionId: { inArray: input.consumeItems.map((item) => item.itemId) },
        },
      });
      const quantities = new Map(owned.map((row) => [row.itemDefinitionId, row.quantity]));
      for (const item of input.consumeItems) {
        if ((quantities.get(item.itemId) ?? 0) < item.quantity) return false;
      }
    }

    const claimId = crypto.randomUUID();
    const claimed = await this.authoredQuestRewardClaims.query(
      (table) => sql`
        INSERT INTO ${table}
          (${sql.raw(table.id.name)}, ${sql.raw(table.ownerKind.name)}, ${sql.raw(table.ownerId.name)},
           ${sql.raw(table.recipientHeroId.name)}, ${sql.raw(table.questId.name)}, attempt)
        SELECT ${claimId}, ${input.ownerKind}, ${input.ownerId}, ${input.heroId}, ${input.questId},
               ${input.attempt}
        WHERE EXISTS (
          SELECT 1 FROM ${this.heroes.table}
          WHERE ${this.heroes.table.id} = ${input.heroId}
            AND ${this.heroes.table.sessionEpoch} = ${input.sessionEpoch}
        )
        ON CONFLICT(${sql.raw(table.ownerKind.name)}, ${sql.raw(table.ownerId.name)},
                    ${sql.raw(table.questId.name)}, attempt)
          DO NOTHING
        RETURNING ${table.id}
      `,
      ID_ROW_SCHEMA,
    );
    if (claimed.length === 0) return false;

    await this.heroes.query(
      (table) => sql`
        UPDATE ${table}
        SET gold = gold + ${input.gold}, level = ${input.resultingLevel}, xp = ${input.resultingXp},
            hp = ${input.resultingHp}
        WHERE ${table.id} = ${input.heroId} AND ${table.sessionEpoch} = ${input.sessionEpoch}
      `,
    );

    // Every statement below re-fences on `hero.session_epoch` itself, exactly like the hero-core
    // update just above — NOT only on the claim row's existence. The claim persists once inserted
    // regardless of what happens to the hero afterward, so an EXISTS-on-claim-only gate would NOT
    // catch a reconnect (epoch bump) landing between the claim insert and these statements; the
    // repeated epoch check does. See this file's docblock for the fuller picture (this still isn't
    // one atomic sequence with the claim insert or the hero-core update above).
    for (const item of input.consumeItems) {
      await this.heroItems.query(
        (table) => sql`
          UPDATE ${table}
          SET quantity = quantity - ${item.quantity}
          WHERE ${table.heroId} = ${input.heroId} AND ${table.itemDefinitionId} = ${item.itemId}
            AND quantity >= ${item.quantity}
            AND EXISTS (
              SELECT 1 FROM ${this.heroes.table}
              WHERE ${this.heroes.table.id} = ${input.heroId}
                AND ${this.heroes.table.sessionEpoch} = ${input.sessionEpoch}
            )
        `,
      );
    }
    for (const item of input.items) {
      await this.heroItems.query(
        (table) => sql`
          INSERT INTO ${table}
            (${sql.raw(table.id.name)}, ${sql.raw(table.heroId.name)},
             ${sql.raw(table.itemDefinitionId.name)}, quantity, ${sql.raw(table.createdAt.name)})
          SELECT ${crypto.randomUUID()}, ${input.heroId}, ${item.itemId}, ${item.quantity}, ${Date.now()}
          WHERE EXISTS (
            SELECT 1 FROM ${this.heroes.table}
            WHERE ${this.heroes.table.id} = ${input.heroId}
              AND ${this.heroes.table.sessionEpoch} = ${input.sessionEpoch}
          )
          ON CONFLICT(${sql.raw(table.heroId.name)}, ${sql.raw(table.itemDefinitionId.name)}) DO UPDATE SET
            quantity = quantity + excluded.quantity
        `,
      );
    }
    return true;
  }

  /** Prepare the idempotency row under the currently-owned hero epoch, before node depletion. */
  async prepareHarvestGoldClaim(
    input: PrepareHarvestGoldClaimInput,
  ): Promise<HarvestGoldClaim | null> {
    if (!validHarvestGoldClaim(input)) return null;
    const claimId = crypto.randomUUID();
    const claimed = await this.harvestGoldClaims.query(
      (table) => sql`
        INSERT INTO ${table}
          (${sql.raw(table.id.name)}, ${sql.raw(table.partyId.name)},
           ${sql.raw(table.nodeId.name)}, generation,
           ${sql.raw(table.recipientHeroId.name)},
           ${sql.raw(table.earnedSessionEpoch.name)}, amount,
           ${sql.raw(table.ledgerAmount.name)}, ${sql.raw(table.ledgerStatus.name)},
           ${sql.raw(table.settledAt.name)})
        SELECT ${claimId}, ${input.partyId}, ${input.nodeId}, ${input.generation},
               ${input.heroId}, ${input.sessionEpoch}, ${input.amount}, 0, 'prepared', NULL
        WHERE EXISTS (
          SELECT 1 FROM ${this.heroes.table}
          WHERE ${this.heroes.table.id} = ${input.heroId}
            AND ${this.heroes.table.partyId} = ${input.partyId}
            AND ${this.heroes.table.sessionEpoch} = ${input.sessionEpoch}
        )
        ON CONFLICT(${sql.raw(table.partyId.name)}, ${sql.raw(table.nodeId.name)}, generation)
          DO NOTHING
        RETURNING ${table.id}
      `,
      ID_ROW_SCHEMA,
    );
    if (claimed.length === 1) return (await this.harvestGoldClaims.findById(claimId)) ?? null;
    const existing = await this.harvestGoldClaims.findOne({
      where: {
        partyId: { eq: input.partyId },
        nodeId: { eq: input.nodeId },
        generation: { eq: input.generation },
      },
    });
    return existing?.recipientHeroId === input.heroId &&
      existing.earnedSessionEpoch === input.sessionEpoch &&
      existing.amount === input.amount
      ? existing
      : null;
  }

  /**
   * One exactly-once ledger transition. The visible balance is the hero base plus this additive
   * ledger, so no separately ordered hero UPDATE exists for a crash or absolute save to lose.
   */
  async settleHarvestGoldClaim(
    input: HarvestGoldClaimIdentity & { claimId: string },
  ): Promise<boolean> {
    if (!isUuid(input.claimId) || !validHarvestGoldClaim({ ...input, sessionEpoch: 0 }))
      return false;
    const settled = await this.harvestGoldClaims.query(
      (table) => sql`
        UPDATE ${table}
        SET ${sql.raw(table.ledgerAmount.name)} = amount,
            ${sql.raw(table.ledgerStatus.name)} = 'settled',
            ${sql.raw(table.settledAt.name)} = ${new Date().toISOString()}
        WHERE ${table.id} = ${input.claimId}
          AND ${table.partyId} = ${input.partyId}
          AND ${table.nodeId} = ${input.nodeId}
          AND generation = ${input.generation}
          AND ${table.recipientHeroId} = ${input.heroId}
          AND amount = ${input.amount}
          AND ${sql.raw(table.ledgerAmount.name)} = 0
          AND ${sql.raw(table.ledgerStatus.name)} = 'prepared'
          AND ${sql.raw(table.settledAt.name)} IS NULL
        RETURNING ${table.id}
      `,
      ID_ROW_SCHEMA,
    );
    if (settled.length === 1) return true;
    const existing = await this.harvestGoldClaims.findById(input.claimId);
    return Boolean(
      existing &&
      existing.partyId === input.partyId &&
      existing.nodeId === input.nodeId &&
      existing.generation === input.generation &&
      existing.recipientHeroId === input.heroId &&
      existing.amount === input.amount &&
      existing.ledgerAmount === input.amount &&
      existing.ledgerStatus === "settled" &&
      existing.settledAt !== undefined,
    );
  }

  /** Remove only an uncommitted preparation after the party state proves no depletion landed. */
  async abortHarvestGoldClaim(claimId: string): Promise<boolean> {
    if (!isUuid(claimId)) return false;
    const deleted = await this.harvestGoldClaims.query(
      (table) => sql`
        DELETE FROM ${table}
        WHERE ${table.id} = ${claimId}
          AND ${sql.raw(table.ledgerAmount.name)} = 0
          AND ${sql.raw(table.ledgerStatus.name)} = 'prepared'
          AND ${sql.raw(table.settledAt.name)} IS NULL
        RETURNING ${table.id}
      `,
      ID_ROW_SCHEMA,
    );
    return deleted.length === 1;
  }

  async loadPendingHarvestGoldClaims(partyId: string): Promise<HarvestGoldClaim[]> {
    if (!isUuid(partyId)) return [];
    return this.harvestGoldClaims.findMany({
      where: {
        partyId: { eq: partyId },
        ledgerStatus: { eq: "prepared" },
        settledAt: { isNull: true },
      },
    });
  }

  /** Additive ledger baseline used by admission and absolute hero saves. */
  async harvestGoldLedgerTotal(heroId: string): Promise<number> {
    if (!isUuid(heroId)) return 0;
    const rows = await this.harvestGoldClaims.aggregate({
      select: { ledgerAmount: { sum: true } },
      where: { recipientHeroId: { eq: heroId }, ledgerStatus: { eq: "settled" } },
    });
    const total = rows[0]?.ledgerAmount.sum ?? 0;
    if (!Number.isSafeInteger(total) || total < 0) throw new Error("invalid harvest gold ledger");
    return total;
  }
}
