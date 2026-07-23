/**
 * Authored quest language.
 *
 * Quest definitions are adventure-owned data. Runtime progress is kept separately and pins a
 * complete definition snapshot when the quest starts, so editing an adventure cannot silently
 * rewrite the objectives or rewards of a party already in progress. This module is platform-free:
 * the editor and server use the same parser, defaults and semantic validation.
 */
import {
  type EventCommand,
  ITEM_ID_MAX,
  ITEM_ID_PATTERN,
  parseEventCommands,
} from "./event-commands.js";
import { isMonsterSpecies, type MonsterSpecies } from "./game.js";
import { isUuid } from "./identifiers.js";
import { CONDITION_ID_PATTERN } from "./map-events.js";

export const QUEST_SCHEMA_VERSION = 2 as const;
export const MAX_AUTHORED_QUESTS = 64;
export const MAX_QUEST_OBJECTIVES = 16;
export const MAX_QUEST_PREREQUISITES = 8;
export const MAX_QUEST_REWARD_ITEMS = 8;
export const MAX_QUEST_REWARD_CHOICES = 8;
export const MAX_QUEST_MAP_FILTERS = 32;
export const MAX_QUEST_PROCESSED_EVENT_KEYS = 256;
export const QUEST_PROCESSED_EVENT_KEY_MAX = 128;
export const QUEST_TITLE_MAX = 64;
export const QUEST_DESCRIPTION_MAX = 2_000;
export const QUEST_JOURNAL_SUMMARY_MAX = 240;
export const QUEST_DIALOGUE_TEXT_MAX = 2_000;
export const QUEST_OBJECTIVE_LABEL_MAX = 96;
export const QUEST_OBJECTIVE_TARGET_MAX = 9_999;
export const QUEST_REWARD_AMOUNT_MAX = 1_000_000_000;
export const QUEST_RECOMMENDED_LEVEL_MAX = 100;
export const QUEST_STAGE_MAX = 15;

export type QuestScope = "personal" | "party";
export type QuestAcceptanceMode = "manual" | "automatic";
export type QuestCompletionMode = "automatic" | "turn-in";
export type QuestObjectiveMode = "simultaneous" | "sequential";
export type QuestCreditRule = "killer" | "contributors" | "nearby-party";
export type QuestProgressStatus = "active" | "ready" | "completed" | "failed" | "abandoned";
export type QuestRuntimeState = "unavailable" | "available" | QuestProgressStatus;

export interface QuestEventReference {
  readonly mapId: string;
  readonly eventId: string;
}

export type QuestMapScope =
  | { readonly kind: "any" }
  | { readonly kind: "maps"; readonly mapIds: readonly string[] };

interface QuestObjectiveBase {
  /** Stable within the quest. */
  readonly id: string;
  /** Optional author override. Empty means the client generates a localized label from the rule. */
  readonly label: string;
  readonly target: number;
  readonly optional: boolean;
  readonly hidden: boolean;
  /** Sequential quests unlock stages in ascending order; simultaneous quests ignore this value. */
  readonly stage: number;
}

/** Compatibility destination for pre-v2 free-label objectives and advanced scripted objectives. */
export interface ManualQuestObjective extends QuestObjectiveBase {
  readonly type: "manual";
}

export interface KillQuestObjective extends QuestObjectiveBase {
  readonly type: "kill";
  readonly species: MonsterSpecies;
  readonly mapScope: QuestMapScope;
  readonly credit: QuestCreditRule;
}

export interface DefeatTargetQuestObjective extends QuestObjectiveBase {
  readonly type: "defeat-target";
  readonly targetRef: QuestEventReference;
  readonly credit: QuestCreditRule;
}

export interface CollectQuestObjective extends QuestObjectiveBase {
  readonly type: "collect";
  readonly itemId: string;
  /** Inventory is derived from the current stack; acquired is a monotone acquisition counter. */
  readonly counting: "inventory" | "acquired";
}

export interface DeliverQuestObjective extends QuestObjectiveBase {
  readonly type: "deliver";
  readonly itemId: string;
  readonly consume: boolean;
}

export interface InteractQuestObjective extends QuestObjectiveBase {
  readonly type: "interact";
  readonly interaction: "talk" | "interact";
  readonly targetRef: QuestEventReference;
}

export interface ReachQuestObjective extends QuestObjectiveBase {
  readonly type: "reach";
  readonly destination:
    | { readonly kind: "map"; readonly mapId: string }
    | { readonly kind: "area"; readonly mapId: string; readonly areaId: string };
}

export interface UseItemQuestObjective extends QuestObjectiveBase {
  readonly type: "use-item";
  readonly itemId: string;
  readonly context:
    | null
    | { readonly kind: "map"; readonly mapId: string }
    | ({ readonly kind: "event" } & QuestEventReference);
}

export interface ActivityQuestObjective extends QuestObjectiveBase {
  readonly type: "activity";
  readonly activityId: string;
}

export type AuthoredQuestObjective =
  | ManualQuestObjective
  | KillQuestObjective
  | DefeatTargetQuestObjective
  | CollectQuestObjective
  | DeliverQuestObjective
  | InteractQuestObjective
  | ReachQuestObjective
  | UseItemQuestObjective
  | ActivityQuestObjective;

export type QuestPrerequisiteCondition =
  | { readonly type: "switch"; readonly switchId: string; readonly value: boolean }
  | { readonly type: "variable"; readonly variableId: string; readonly min: number }
  | { readonly type: "quest"; readonly questId: string };

export interface QuestPrerequisites {
  readonly minLevel: number | null;
  readonly previousQuestId: string | null;
  readonly mode: "all" | "any";
  readonly conditions: readonly QuestPrerequisiteCondition[];
}

export interface QuestDialogues {
  readonly offer: string;
  readonly accepted: string;
  readonly refused: string;
  readonly reminder: string;
  readonly ready: string;
  readonly turnIn: string;
  readonly completed: string;
  readonly unavailable: string;
}

export interface QuestItemReward {
  readonly itemId: string;
  readonly quantity: number;
}

/** One option in the single reward choice shown at turn-in. Exactly one option may be selected. */
export interface QuestRewardChoice {
  readonly id: string;
  readonly label: string;
  readonly experience: number;
  readonly gold: number;
  readonly items: readonly QuestItemReward[];
}

export type QuestStateReward =
  | { readonly type: "switch"; readonly switchId: string; readonly value: boolean }
  | {
      readonly type: "variable";
      readonly variableId: string;
      readonly op: "set" | "add";
      readonly value: number;
    };

export interface QuestRewards {
  readonly experience: number;
  readonly gold: number;
  readonly items: readonly QuestItemReward[];
  readonly choices: readonly QuestRewardChoice[];
  readonly nextQuestId: string | null;
  readonly stateChanges: readonly QuestStateReward[];
  readonly customCommands: readonly EventCommand[];
}

export interface AuthoredQuestDefinition {
  readonly schemaVersion: typeof QUEST_SCHEMA_VERSION;
  /** Monotone authoring version. Existing runtime progress keeps the snapshot it accepted. */
  readonly version: number;
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly journalSummary: string;
  readonly recommendedLevel: number | null;
  readonly scope: QuestScope;
  readonly repeatable: boolean;
  readonly abandonable: boolean;
  readonly acceptance: QuestAcceptanceMode;
  readonly completion: QuestCompletionMode;
  readonly giver: QuestEventReference | null;
  readonly turnInTarget: QuestEventReference | null;
  readonly prerequisites: QuestPrerequisites;
  readonly objectiveMode: QuestObjectiveMode;
  readonly objectives: readonly AuthoredQuestObjective[];
  readonly rewards: QuestRewards;
  readonly dialogues: QuestDialogues;
}

export function emptyQuestDialogues(): QuestDialogues {
  return {
    offer: "",
    accepted: "",
    refused: "",
    reminder: "",
    ready: "",
    turnIn: "",
    completed: "",
    unavailable: "",
  };
}

export function emptyQuestRewards(): QuestRewards {
  return {
    experience: 0,
    gold: 0,
    items: [],
    choices: [],
    nextQuestId: null,
    stateChanges: [],
    customCommands: [],
  };
}

export function createManualQuestObjective(
  id: string,
  label = "",
  target = 1,
): ManualQuestObjective {
  return { id, type: "manual", label, target, optional: false, hidden: false, stage: 0 };
}

export function createAuthoredQuestDefinition(id: string, title = ""): AuthoredQuestDefinition {
  return {
    schemaVersion: QUEST_SCHEMA_VERSION,
    version: 1,
    id,
    title,
    description: "",
    journalSummary: "",
    recommendedLevel: null,
    scope: "party",
    repeatable: false,
    abandonable: true,
    acceptance: "manual",
    completion: "turn-in",
    giver: null,
    turnInTarget: null,
    prerequisites: { minLevel: null, previousQuestId: null, mode: "all", conditions: [] },
    objectiveMode: "simultaneous",
    objectives: [],
    rewards: emptyQuestRewards(),
    dialogues: emptyQuestDialogues(),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length <= max ? text : null;
}

function boundedInteger(value: unknown, min: number, max: number): number | null {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
    ? (value as number)
    : null;
}

function isRegistryId(value: unknown): value is string {
  return typeof value === "string" && CONDITION_ID_PATTERN.test(value);
}

function isSlug(value: unknown): value is string {
  return typeof value === "string" && value.length <= ITEM_ID_MAX && ITEM_ID_PATTERN.test(value);
}

function parseEventReference(value: unknown): QuestEventReference | null {
  if (!isPlainObject(value) || !isUuid(value.mapId) || !isUuid(value.eventId)) return null;
  return { mapId: value.mapId, eventId: value.eventId };
}

function parseMapScope(value: unknown): QuestMapScope | null {
  if (!isPlainObject(value)) return null;
  if (value.kind === "any") return { kind: "any" };
  if (
    value.kind !== "maps" ||
    !Array.isArray(value.mapIds) ||
    value.mapIds.length === 0 ||
    value.mapIds.length > MAX_QUEST_MAP_FILTERS
  ) {
    return null;
  }
  const mapIds = value.mapIds.filter(isUuid);
  if (mapIds.length !== value.mapIds.length || new Set(mapIds).size !== mapIds.length) return null;
  return { kind: "maps", mapIds };
}

function parseObjectiveBase(raw: Record<string, unknown>): QuestObjectiveBase | null {
  if (!isRegistryId(raw.id)) return null;
  const label = boundedText(raw.label, QUEST_OBJECTIVE_LABEL_MAX);
  const target = boundedInteger(raw.target, 1, QUEST_OBJECTIVE_TARGET_MAX);
  const stage = boundedInteger(raw.stage, 0, QUEST_STAGE_MAX);
  if (
    label === null ||
    target === null ||
    stage === null ||
    typeof raw.optional !== "boolean" ||
    typeof raw.hidden !== "boolean"
  ) {
    return null;
  }
  return { id: raw.id, label, target, optional: raw.optional, hidden: raw.hidden, stage };
}

export function parseAuthoredQuestObjective(raw: unknown): AuthoredQuestObjective | null {
  if (!isPlainObject(raw)) return null;
  const base = parseObjectiveBase(raw);
  if (!base) return null;
  switch (raw.type) {
    case "manual":
      return { ...base, type: "manual" };
    case "kill": {
      const mapScope = parseMapScope(raw.mapScope);
      if (
        !isMonsterSpecies(raw.species) ||
        !mapScope ||
        (raw.credit !== "killer" && raw.credit !== "contributors" && raw.credit !== "nearby-party")
      ) {
        return null;
      }
      return { ...base, type: "kill", species: raw.species, mapScope, credit: raw.credit };
    }
    case "defeat-target": {
      const targetRef = parseEventReference(raw.targetRef);
      if (
        !targetRef ||
        base.target !== 1 ||
        (raw.credit !== "killer" && raw.credit !== "contributors" && raw.credit !== "nearby-party")
      ) {
        return null;
      }
      return { ...base, type: "defeat-target", targetRef, credit: raw.credit };
    }
    case "collect":
      if (!isSlug(raw.itemId) || (raw.counting !== "inventory" && raw.counting !== "acquired")) {
        return null;
      }
      return { ...base, type: "collect", itemId: raw.itemId, counting: raw.counting };
    case "deliver":
      if (!isSlug(raw.itemId) || typeof raw.consume !== "boolean") return null;
      return { ...base, type: "deliver", itemId: raw.itemId, consume: raw.consume };
    case "interact": {
      const targetRef = parseEventReference(raw.targetRef);
      if (!targetRef || (raw.interaction !== "talk" && raw.interaction !== "interact")) return null;
      return { ...base, type: "interact", interaction: raw.interaction, targetRef };
    }
    case "reach": {
      if (!isPlainObject(raw.destination) || !isUuid(raw.destination.mapId)) return null;
      if (raw.destination.kind === "map" && base.target === 1) {
        return {
          ...base,
          type: "reach",
          destination: { kind: "map", mapId: raw.destination.mapId },
        };
      }
      if (raw.destination.kind === "area" && base.target === 1 && isSlug(raw.destination.areaId)) {
        return {
          ...base,
          type: "reach",
          destination: {
            kind: "area",
            mapId: raw.destination.mapId,
            areaId: raw.destination.areaId,
          },
        };
      }
      return null;
    }
    case "use-item": {
      if (!isSlug(raw.itemId)) return null;
      if (raw.context === null)
        return { ...base, type: "use-item", itemId: raw.itemId, context: null };
      if (!isPlainObject(raw.context) || !isUuid(raw.context.mapId)) return null;
      if (raw.context.kind === "map") {
        return {
          ...base,
          type: "use-item",
          itemId: raw.itemId,
          context: { kind: "map", mapId: raw.context.mapId },
        };
      }
      if (raw.context.kind === "event" && isUuid(raw.context.eventId)) {
        return {
          ...base,
          type: "use-item",
          itemId: raw.itemId,
          context: { kind: "event", mapId: raw.context.mapId, eventId: raw.context.eventId },
        };
      }
      return null;
    }
    case "activity":
      return isSlug(raw.activityId)
        ? { ...base, type: "activity", activityId: raw.activityId }
        : null;
    default:
      return null;
  }
}

function parsePrerequisites(value: unknown): QuestPrerequisites | null {
  if (!isPlainObject(value)) return null;
  const minLevel =
    value.minLevel === null ? null : boundedInteger(value.minLevel, 1, QUEST_RECOMMENDED_LEVEL_MAX);
  const previousQuestId = value.previousQuestId === null ? null : value.previousQuestId;
  if (
    (minLevel === null && value.minLevel !== null) ||
    (previousQuestId !== null && !isRegistryId(previousQuestId)) ||
    (value.mode !== "all" && value.mode !== "any") ||
    !Array.isArray(value.conditions) ||
    value.conditions.length > MAX_QUEST_PREREQUISITES
  ) {
    return null;
  }
  const conditions: QuestPrerequisiteCondition[] = [];
  for (const raw of value.conditions) {
    if (!isPlainObject(raw)) return null;
    if (raw.type === "switch" && isRegistryId(raw.switchId) && typeof raw.value === "boolean") {
      conditions.push({ type: "switch", switchId: raw.switchId, value: raw.value });
    } else if (
      raw.type === "variable" &&
      isRegistryId(raw.variableId) &&
      Number.isSafeInteger(raw.min)
    ) {
      conditions.push({ type: "variable", variableId: raw.variableId, min: raw.min as number });
    } else if (raw.type === "quest" && isRegistryId(raw.questId)) {
      conditions.push({ type: "quest", questId: raw.questId });
    } else {
      return null;
    }
  }
  return { minLevel, previousQuestId, mode: value.mode, conditions };
}

function parseDialogues(value: unknown): QuestDialogues | null {
  if (!isPlainObject(value)) return null;
  const fields = [
    "offer",
    "accepted",
    "refused",
    "reminder",
    "ready",
    "turnIn",
    "completed",
    "unavailable",
  ] as const;
  const parsed = {} as Record<(typeof fields)[number], string>;
  for (const field of fields) {
    const text = boundedText(value[field], QUEST_DIALOGUE_TEXT_MAX);
    if (text === null) return null;
    parsed[field] = text;
  }
  return parsed;
}

function parseItemReward(value: unknown): QuestItemReward | null {
  if (!isPlainObject(value) || !isSlug(value.itemId)) return null;
  const quantity = boundedInteger(value.quantity, 1, QUEST_OBJECTIVE_TARGET_MAX);
  return quantity === null ? null : { itemId: value.itemId, quantity };
}

function parseItemRewards(value: unknown): QuestItemReward[] | null {
  if (!Array.isArray(value) || value.length > MAX_QUEST_REWARD_ITEMS) return null;
  const rewards: QuestItemReward[] = [];
  const ids = new Set<string>();
  for (const raw of value) {
    const reward = parseItemReward(raw);
    if (!reward || ids.has(reward.itemId)) return null;
    ids.add(reward.itemId);
    rewards.push(reward);
  }
  return rewards;
}

function parseRewards(value: unknown): QuestRewards | null {
  if (!isPlainObject(value)) return null;
  const experience = boundedInteger(value.experience, 0, QUEST_REWARD_AMOUNT_MAX);
  const gold = boundedInteger(value.gold, 0, QUEST_REWARD_AMOUNT_MAX);
  const items = parseItemRewards(value.items);
  if (
    experience === null ||
    gold === null ||
    !items ||
    !Array.isArray(value.choices) ||
    value.choices.length > MAX_QUEST_REWARD_CHOICES
  ) {
    return null;
  }
  const choices: QuestRewardChoice[] = [];
  const choiceIds = new Set<string>();
  for (const raw of value.choices) {
    if (!isPlainObject(raw) || !isRegistryId(raw.id) || choiceIds.has(raw.id)) return null;
    const label = boundedText(raw.label, QUEST_OBJECTIVE_LABEL_MAX);
    const choiceExperience = boundedInteger(raw.experience, 0, QUEST_REWARD_AMOUNT_MAX);
    const choiceGold = boundedInteger(raw.gold, 0, QUEST_REWARD_AMOUNT_MAX);
    const choiceItems = parseItemRewards(raw.items);
    if (label === null || choiceExperience === null || choiceGold === null || !choiceItems)
      return null;
    choiceIds.add(raw.id);
    choices.push({
      id: raw.id,
      label,
      experience: choiceExperience,
      gold: choiceGold,
      items: choiceItems,
    });
  }
  const nextQuestId = value.nextQuestId === null ? null : value.nextQuestId;
  if (nextQuestId !== null && !isRegistryId(nextQuestId)) return null;
  if (!Array.isArray(value.stateChanges) || value.stateChanges.length > MAX_QUEST_PREREQUISITES) {
    return null;
  }
  const stateChanges: QuestStateReward[] = [];
  for (const raw of value.stateChanges) {
    if (!isPlainObject(raw)) return null;
    if (raw.type === "switch" && isRegistryId(raw.switchId) && typeof raw.value === "boolean") {
      stateChanges.push({ type: "switch", switchId: raw.switchId, value: raw.value });
    } else if (
      raw.type === "variable" &&
      isRegistryId(raw.variableId) &&
      (raw.op === "set" || raw.op === "add") &&
      Number.isSafeInteger(raw.value)
    ) {
      stateChanges.push({
        type: "variable",
        variableId: raw.variableId,
        op: raw.op,
        value: raw.value as number,
      });
    } else {
      return null;
    }
  }
  const customCommands = parseEventCommands(value.customCommands);
  if (!customCommands) return null;
  return {
    experience,
    gold,
    items,
    choices,
    nextQuestId,
    stateChanges,
    customCommands,
  };
}

/** Explicit compatibility conversion for the former `{id,label,target}` objective format. */
export function migrateLegacyQuestDefinition(raw: unknown): AuthoredQuestDefinition | null {
  if (!isPlainObject(raw) || !isRegistryId(raw.id)) return null;
  const title = boundedText(raw.title, QUEST_TITLE_MAX);
  const description = boundedText(raw.description, QUEST_DESCRIPTION_MAX);
  if (
    title === null ||
    description === null ||
    !Array.isArray(raw.objectives) ||
    raw.objectives.length > MAX_QUEST_OBJECTIVES
  ) {
    return null;
  }
  const objectives: ManualQuestObjective[] = [];
  const ids = new Set<string>();
  for (const objective of raw.objectives) {
    if (!isPlainObject(objective) || !isRegistryId(objective.id) || ids.has(objective.id))
      return null;
    const label = boundedText(objective.label, QUEST_OBJECTIVE_LABEL_MAX);
    const target = boundedInteger(objective.target, 1, QUEST_OBJECTIVE_TARGET_MAX);
    if (label === null || target === null) return null;
    ids.add(objective.id);
    objectives.push(createManualQuestObjective(objective.id, label, target));
  }
  return {
    ...createAuthoredQuestDefinition(raw.id, title),
    description,
    journalSummary: description.slice(0, QUEST_JOURNAL_SUMMARY_MAX),
    abandonable: false,
    objectives,
  };
}

/** Total parser for one v2 definition, with an explicit v1 conversion path. */
export function parseAuthoredQuestDefinition(raw: unknown): AuthoredQuestDefinition | null {
  if (!isPlainObject(raw)) return null;
  if (raw.schemaVersion === undefined) return migrateLegacyQuestDefinition(raw);
  if (raw.schemaVersion !== QUEST_SCHEMA_VERSION || !isRegistryId(raw.id)) return null;
  const version = boundedInteger(raw.version, 1, Number.MAX_SAFE_INTEGER);
  const title = boundedText(raw.title, QUEST_TITLE_MAX);
  const description = boundedText(raw.description, QUEST_DESCRIPTION_MAX);
  const journalSummary = boundedText(raw.journalSummary, QUEST_JOURNAL_SUMMARY_MAX);
  const recommendedLevel =
    raw.recommendedLevel === null
      ? null
      : boundedInteger(raw.recommendedLevel, 1, QUEST_RECOMMENDED_LEVEL_MAX);
  const giver = raw.giver === null ? null : parseEventReference(raw.giver);
  const turnInTarget = raw.turnInTarget === null ? null : parseEventReference(raw.turnInTarget);
  const prerequisites = parsePrerequisites(raw.prerequisites);
  const rewards = parseRewards(raw.rewards);
  const dialogues = parseDialogues(raw.dialogues);
  if (
    version === null ||
    title === null ||
    description === null ||
    journalSummary === null ||
    (recommendedLevel === null && raw.recommendedLevel !== null) ||
    (giver === null && raw.giver !== null) ||
    (turnInTarget === null && raw.turnInTarget !== null) ||
    (raw.scope !== "personal" && raw.scope !== "party") ||
    typeof raw.repeatable !== "boolean" ||
    typeof raw.abandonable !== "boolean" ||
    (raw.acceptance !== "manual" && raw.acceptance !== "automatic") ||
    (raw.completion !== "automatic" && raw.completion !== "turn-in") ||
    !prerequisites ||
    (raw.objectiveMode !== "simultaneous" && raw.objectiveMode !== "sequential") ||
    !Array.isArray(raw.objectives) ||
    raw.objectives.length > MAX_QUEST_OBJECTIVES ||
    !rewards ||
    !dialogues
  ) {
    return null;
  }
  const objectives: AuthoredQuestObjective[] = [];
  const ids = new Set<string>();
  for (const rawObjective of raw.objectives) {
    const objective = parseAuthoredQuestObjective(rawObjective);
    if (!objective || ids.has(objective.id)) return null;
    ids.add(objective.id);
    objectives.push(objective);
  }
  return {
    schemaVersion: QUEST_SCHEMA_VERSION,
    version,
    id: raw.id,
    title,
    description,
    journalSummary,
    recommendedLevel,
    scope: raw.scope,
    repeatable: raw.repeatable,
    abandonable: raw.abandonable,
    acceptance: raw.acceptance,
    completion: raw.completion,
    giver,
    turnInTarget,
    prerequisites,
    objectiveMode: raw.objectiveMode,
    objectives,
    rewards,
    dialogues,
  };
}

export function parseAuthoredQuests(value: unknown): AuthoredQuestDefinition[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_AUTHORED_QUESTS) return null;
  const quests: AuthoredQuestDefinition[] = [];
  const ids = new Set<string>();
  for (const raw of value) {
    const quest = parseAuthoredQuestDefinition(raw);
    if (!quest || ids.has(quest.id)) return null;
    ids.add(quest.id);
    quests.push(quest);
  }
  return quests;
}

/**
 * Server-side version reconciliation for an authored registry write. The client may send a stale,
 * forged or simply unchanged `version`; identity and content decide the result. New quests start at
 * 1, unchanged quests retain their stored version, and any material edit advances exactly once.
 */
export function reconcileAuthoredQuestVersions(
  current: readonly AuthoredQuestDefinition[],
  proposed: readonly AuthoredQuestDefinition[],
): AuthoredQuestDefinition[] {
  const currentById = new Map(current.map((quest) => [quest.id, quest]));
  return proposed.map((quest) => {
    const previous = currentById.get(quest.id);
    if (!previous) return { ...quest, version: 1 };
    const previousContent = JSON.stringify({ ...previous, version: 0 });
    const proposedContent = JSON.stringify({ ...quest, version: 0 });
    return {
      ...quest,
      version: previousContent === proposedContent ? previous.version : previous.version + 1,
    };
  });
}

export interface QuestValidationContext {
  readonly mapIds?: ReadonlySet<string>;
  readonly eventIdsByMap?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Authored monster species available on each map, used to reject impossible kill objectives. */
  readonly monsterSpeciesByMap?: ReadonlyMap<string, ReadonlySet<MonsterSpecies>>;
  /** Event ids that are still authored monsters/bosses rather than another interactive event. */
  readonly monsterEventIdsByMap?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Area ids emitted by `enterArea` commands, grouped by the map that owns the trigger. */
  readonly areaIdsByMap?: ReadonlyMap<string, ReadonlySet<string>>;
  readonly itemIds?: ReadonlySet<string>;
  readonly activityIds?: ReadonlySet<string>;
  readonly switchIds?: ReadonlySet<string>;
  readonly variableIds?: ReadonlySet<string>;
  /** Quest ids found in explicit event bindings, in addition to definition-level giver/turn-in. */
  readonly offeredQuestIds?: ReadonlySet<string>;
  readonly turnInQuestIds?: ReadonlySet<string>;
}

/**
 * Find classic event-command acceptance and turn-in bindings for semantic validation.
 *
 * This belongs beside the validator so the editor and the server agree even when a binding is
 * nested inside a condition, loop or choice branch.
 */
export function collectQuestCommandBindings(
  commands: readonly EventCommand[],
  offeredQuestIds: Set<string>,
  turnInQuestIds: Set<string>,
  activityIds?: Set<string>,
  areaIds?: Set<string>,
): void {
  for (const command of commands) {
    if (command.t === "startQuest") offeredQuestIds.add(command.questId);
    if (command.t === "completeQuest") turnInQuestIds.add(command.questId);
    if (command.t === "completeActivity") activityIds?.add(command.activityId);
    if (command.t === "enterArea") areaIds?.add(command.areaId);
    if (command.t === "if") {
      collectQuestCommandBindings(
        command.then,
        offeredQuestIds,
        turnInQuestIds,
        activityIds,
        areaIds,
      );
      collectQuestCommandBindings(
        command.else,
        offeredQuestIds,
        turnInQuestIds,
        activityIds,
        areaIds,
      );
    }
    if (command.t === "loop") {
      collectQuestCommandBindings(
        command.body,
        offeredQuestIds,
        turnInQuestIds,
        activityIds,
        areaIds,
      );
    }
    if (command.t === "choices") {
      for (const option of command.options) {
        collectQuestCommandBindings(
          option.body,
          offeredQuestIds,
          turnInQuestIds,
          activityIds,
          areaIds,
        );
      }
    }
  }
}

export type QuestDiagnosticSeverity = "error" | "warning";

export interface QuestDiagnostic {
  readonly severity: QuestDiagnosticSeverity;
  readonly code: string;
  readonly questId: string;
  readonly objectiveId?: string;
  readonly reference?: string;
}

function eventReferenceExists(
  reference: QuestEventReference,
  context: QuestValidationContext,
): boolean {
  if (context.mapIds && !context.mapIds.has(reference.mapId)) return false;
  if (!context.eventIdsByMap) return true;
  return context.eventIdsByMap.get(reference.mapId)?.has(reference.eventId) ?? false;
}

/** Cross-definition/reference validation shared by publication, test mode and the editor. */
export function validateAuthoredQuests(
  quests: readonly AuthoredQuestDefinition[],
  context: QuestValidationContext = {},
): QuestDiagnostic[] {
  const diagnostics: QuestDiagnostic[] = [];
  const byId = new Map(quests.map((quest) => [quest.id, quest]));
  const add = (
    severity: QuestDiagnosticSeverity,
    code: string,
    questId: string,
    objectiveId?: string,
    reference?: string,
  ): void => {
    diagnostics.push({
      severity,
      code,
      questId,
      ...(objectiveId ? { objectiveId } : {}),
      ...(reference ? { reference } : {}),
    });
  };

  const checkEvent = (
    questId: string,
    code: string,
    reference: QuestEventReference | null,
    objectiveId?: string,
  ): void => {
    if (reference && !eventReferenceExists(reference, context)) {
      add("error", code, questId, objectiveId, `${reference.mapId}:${reference.eventId}`);
    }
  };

  for (const quest of quests) {
    if (quest.title.length === 0) add("error", "quest.title.empty", quest.id);
    if (quest.objectives.length === 0) add("error", "quest.objectives.empty", quest.id);
    if (quest.objectives.length > 0 && quest.objectives.every((objective) => objective.optional)) {
      add("error", "quest.objectives.only_optional", quest.id);
    }
    checkEvent(quest.id, "quest.giver.missing", quest.giver);
    checkEvent(quest.id, "quest.turn_in_target.missing", quest.turnInTarget);
    if (
      quest.acceptance === "manual" &&
      quest.giver === null &&
      !context.offeredQuestIds?.has(quest.id)
    ) {
      add("error", "quest.acceptance.unbound", quest.id);
    }
    if (
      quest.completion === "turn-in" &&
      quest.turnInTarget === null &&
      !context.turnInQuestIds?.has(quest.id)
    ) {
      add("error", "quest.turn_in.unbound", quest.id);
    }
    const prerequisiteIds = [
      quest.prerequisites.previousQuestId,
      ...quest.prerequisites.conditions
        .filter(
          (condition): condition is Extract<QuestPrerequisiteCondition, { type: "quest" }> =>
            condition.type === "quest",
        )
        .map((condition) => condition.questId),
    ].filter((id): id is string => id !== null);
    for (const id of prerequisiteIds) {
      if (id === quest.id) add("error", "quest.prerequisite.self", quest.id, undefined, id);
      else if (!byId.has(id)) add("error", "quest.prerequisite.missing", quest.id, undefined, id);
    }
    if (quest.rewards.nextQuestId !== null) {
      if (quest.rewards.nextQuestId === quest.id) {
        add("error", "quest.next.self", quest.id, undefined, quest.rewards.nextQuestId);
      } else if (!byId.has(quest.rewards.nextQuestId)) {
        add("error", "quest.next.missing", quest.id, undefined, quest.rewards.nextQuestId);
      }
    }
    if (quest.completion === "automatic" && quest.rewards.choices.length > 0) {
      add("error", "quest.reward.choices_require_turn_in", quest.id);
    }
    if (quest.completion === "automatic" && quest.rewards.customCommands.length > 0) {
      add("error", "quest.reward.commands_require_turn_in", quest.id);
    }
    for (const condition of quest.prerequisites.conditions) {
      if (
        condition.type === "switch" &&
        context.switchIds &&
        !context.switchIds.has(condition.switchId)
      ) {
        add("error", "quest.switch.missing", quest.id, undefined, condition.switchId);
      }
      if (
        condition.type === "variable" &&
        context.variableIds &&
        !context.variableIds.has(condition.variableId)
      ) {
        add("error", "quest.variable.missing", quest.id, undefined, condition.variableId);
      }
    }
    for (const change of quest.rewards.stateChanges) {
      if (
        change.type === "switch" &&
        context.switchIds &&
        !context.switchIds.has(change.switchId)
      ) {
        add("error", "quest.reward.switch_missing", quest.id, undefined, change.switchId);
      }
      if (
        change.type === "variable" &&
        context.variableIds &&
        !context.variableIds.has(change.variableId)
      ) {
        add("error", "quest.reward.variable_missing", quest.id, undefined, change.variableId);
      }
    }
    for (const reward of [
      ...quest.rewards.items,
      ...quest.rewards.choices.flatMap((choice) => choice.items),
    ]) {
      if (context.itemIds && !context.itemIds.has(reward.itemId)) {
        add("error", "quest.reward.item_missing", quest.id, undefined, reward.itemId);
      }
    }
    if (quest.objectiveMode === "sequential" && quest.objectives.length > 0) {
      const stages = [...new Set(quest.objectives.map((objective) => objective.stage))].sort(
        (a, b) => a - b,
      );
      if (stages[0] !== 0 || stages.some((stage, index) => stage !== index)) {
        add("error", "quest.objectives.stage_gap", quest.id);
      }
    }
    for (const objective of quest.objectives) {
      switch (objective.type) {
        case "kill":
          if (objective.mapScope.kind === "maps" && context.mapIds) {
            for (const mapId of objective.mapScope.mapIds) {
              if (!context.mapIds.has(mapId))
                add("error", "quest.objective.map_missing", quest.id, objective.id, mapId);
            }
          }
          if (context.monsterSpeciesByMap) {
            const eligibleMaps =
              objective.mapScope.kind === "maps"
                ? objective.mapScope.mapIds
                : [...context.monsterSpeciesByMap.keys()];
            if (
              !eligibleMaps.some((mapId) =>
                context.monsterSpeciesByMap?.get(mapId)?.has(objective.species),
              )
            ) {
              add(
                "error",
                "quest.objective.monster_missing",
                quest.id,
                objective.id,
                objective.species,
              );
            }
          }
          break;
        case "defeat-target":
          checkEvent(quest.id, "quest.objective.event_missing", objective.targetRef, objective.id);
          if (
            context.monsterEventIdsByMap &&
            context.eventIdsByMap
              ?.get(objective.targetRef.mapId)
              ?.has(objective.targetRef.eventId) === true &&
            !context.monsterEventIdsByMap
              .get(objective.targetRef.mapId)
              ?.has(objective.targetRef.eventId)
          ) {
            add(
              "error",
              "quest.objective.target_not_monster",
              quest.id,
              objective.id,
              objective.targetRef.eventId,
            );
          }
          break;
        case "interact":
          checkEvent(quest.id, "quest.objective.event_missing", objective.targetRef, objective.id);
          break;
        case "collect":
        case "deliver":
        case "use-item":
          if (context.itemIds && !context.itemIds.has(objective.itemId)) {
            add("error", "quest.objective.item_missing", quest.id, objective.id, objective.itemId);
          }
          if (objective.type === "use-item" && objective.context?.kind === "event") {
            checkEvent(quest.id, "quest.objective.event_missing", objective.context, objective.id);
          } else if (
            objective.type === "use-item" &&
            objective.context?.kind === "map" &&
            context.mapIds &&
            !context.mapIds.has(objective.context.mapId)
          ) {
            add(
              "error",
              "quest.objective.map_missing",
              quest.id,
              objective.id,
              objective.context.mapId,
            );
          }
          break;
        case "reach":
          if (context.mapIds && !context.mapIds.has(objective.destination.mapId)) {
            add(
              "error",
              "quest.objective.map_missing",
              quest.id,
              objective.id,
              objective.destination.mapId,
            );
          } else if (
            objective.destination.kind === "area" &&
            context.areaIdsByMap &&
            !context.areaIdsByMap
              .get(objective.destination.mapId)
              ?.has(objective.destination.areaId)
          ) {
            add(
              "error",
              "quest.objective.area_missing",
              quest.id,
              objective.id,
              objective.destination.areaId,
            );
          }
          break;
        case "activity":
          if (context.activityIds && !context.activityIds.has(objective.activityId)) {
            add(
              "error",
              "quest.objective.activity_missing",
              quest.id,
              objective.id,
              objective.activityId,
            );
          }
          break;
        case "manual":
          add("warning", "quest.objective.manual", quest.id, objective.id);
          break;
      }
    }
  }

  // Prerequisites form a directed graph. Any back edge is a creation blocker, not a runtime guess.
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (questId: string): void => {
    if (visited.has(questId)) return;
    if (visiting.has(questId)) {
      add("error", "quest.prerequisite.cycle", questId);
      return;
    }
    visiting.add(questId);
    const quest = byId.get(questId);
    if (quest) {
      const dependencies = [
        quest.prerequisites.previousQuestId,
        ...quest.prerequisites.conditions
          .filter(
            (condition): condition is Extract<QuestPrerequisiteCondition, { type: "quest" }> =>
              condition.type === "quest",
          )
          .map((condition) => condition.questId),
      ];
      for (const dependency of dependencies)
        if (dependency && byId.has(dependency)) walk(dependency);
    }
    visiting.delete(questId);
    visited.add(questId);
  };
  for (const quest of quests) walk(quest.id);
  return diagnostics;
}

export function requiredQuestObjectivesComplete(
  definition: AuthoredQuestDefinition,
  progress: Readonly<Record<string, number>>,
): boolean {
  const required = definition.objectives.filter((objective) => !objective.optional);
  return (
    required.length > 0 &&
    required.every((objective) => (progress[objective.id] ?? 0) >= objective.target)
  );
}
