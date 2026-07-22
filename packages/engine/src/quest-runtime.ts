/** Pure authored-quest runtime: business events, objective indexes and progress transitions. */
import type {
  AdventureRegistry,
  AuthoredQuestProgress,
  PartyAdventureState,
} from "./adventure-state.js";
import type {
  AuthoredQuestDefinition,
  AuthoredQuestObjective,
  QuestCreditRule,
  QuestEventReference,
} from "./quests.js";
import { MAX_QUEST_PROCESSED_EVENT_KEYS, requiredQuestObjectivesComplete } from "./quests.js";

export interface QuestActor {
  readonly heroId: string;
  readonly sessionEpoch: number;
  readonly level: number;
}

interface QuestBusinessEventBase {
  /** Server-minted idempotency id. A client never supplies it. */
  readonly id: string;
  readonly mapId: string;
}

export type QuestBusinessEvent =
  | (QuestBusinessEventBase & {
      readonly type: "monsterKilled";
      readonly monsterId: string;
      readonly species: string;
      readonly killer: QuestActor;
      readonly contributors: readonly QuestActor[];
      readonly nearbyParty: readonly QuestActor[];
    })
  | (QuestBusinessEventBase & {
      readonly type: "bossDefeated";
      readonly targetEventId: string;
      readonly killer: QuestActor;
      readonly contributors: readonly QuestActor[];
      readonly nearbyParty: readonly QuestActor[];
    })
  | (QuestBusinessEventBase & {
      readonly type: "itemAcquired";
      readonly actor: QuestActor;
      readonly itemId: string;
      readonly amount: number;
      readonly inventoryQuantity: number;
    })
  | (QuestBusinessEventBase & {
      readonly type: "itemRemoved";
      readonly actor: QuestActor;
      readonly itemId: string;
      readonly amount: number;
      readonly inventoryQuantity: number;
    })
  | (QuestBusinessEventBase & {
      readonly type: "itemUsed";
      readonly actor: QuestActor;
      readonly itemId: string;
      readonly amount: number;
      readonly targetEventId?: string;
    })
  | (QuestBusinessEventBase & {
      readonly type: "objectInteracted";
      readonly actor: QuestActor;
      readonly targetEventId: string;
    })
  | (QuestBusinessEventBase & {
      readonly type: "npcTalked";
      readonly actor: QuestActor;
      readonly targetEventId: string;
    })
  | (QuestBusinessEventBase & {
      readonly type: "mapEntered";
      readonly actor: QuestActor;
    })
  | (QuestBusinessEventBase & {
      readonly type: "areaEntered";
      readonly actor: QuestActor;
      readonly areaId: string;
    })
  | (QuestBusinessEventBase & {
      readonly type: "activityCompleted";
      readonly actor: QuestActor;
      readonly activityId: string;
      readonly amount: number;
    });

export interface QuestObjectiveReference {
  readonly questId: string;
  readonly objectiveId: string;
}

export interface QuestObjectiveIndex {
  readonly definitions: ReadonlyMap<string, AuthoredQuestDefinition>;
  readonly killBySpecies: ReadonlyMap<string, readonly QuestObjectiveReference[]>;
  readonly defeatByEvent: ReadonlyMap<string, readonly QuestObjectiveReference[]>;
  readonly acquisitionByItem: ReadonlyMap<string, readonly QuestObjectiveReference[]>;
  readonly inventoryByItem: ReadonlyMap<string, readonly QuestObjectiveReference[]>;
  readonly useByItem: ReadonlyMap<string, readonly QuestObjectiveReference[]>;
  readonly interactionByEvent: ReadonlyMap<string, readonly QuestObjectiveReference[]>;
  readonly talkByEvent: ReadonlyMap<string, readonly QuestObjectiveReference[]>;
  readonly reachByMap: ReadonlyMap<string, readonly QuestObjectiveReference[]>;
  readonly reachByArea: ReadonlyMap<string, readonly QuestObjectiveReference[]>;
  readonly activityById: ReadonlyMap<string, readonly QuestObjectiveReference[]>;
}

function eventKey(reference: QuestEventReference): string {
  return `${reference.mapId}:${reference.eventId}`;
}

function areaKey(mapId: string, areaId: string): string {
  return `${mapId}:${areaId}`;
}

function addReference(
  index: Map<string, QuestObjectiveReference[]>,
  key: string,
  reference: QuestObjectiveReference,
): void {
  const current = index.get(key);
  if (current) current.push(reference);
  else index.set(key, [reference]);
}

/** Build once when an adventure (or a pinned definition version) is loaded. */
export function buildQuestObjectiveIndex(
  definitions: readonly AuthoredQuestDefinition[],
): QuestObjectiveIndex {
  const killBySpecies = new Map<string, QuestObjectiveReference[]>();
  const defeatByEvent = new Map<string, QuestObjectiveReference[]>();
  const acquisitionByItem = new Map<string, QuestObjectiveReference[]>();
  const inventoryByItem = new Map<string, QuestObjectiveReference[]>();
  const useByItem = new Map<string, QuestObjectiveReference[]>();
  const interactionByEvent = new Map<string, QuestObjectiveReference[]>();
  const talkByEvent = new Map<string, QuestObjectiveReference[]>();
  const reachByMap = new Map<string, QuestObjectiveReference[]>();
  const reachByArea = new Map<string, QuestObjectiveReference[]>();
  const activityById = new Map<string, QuestObjectiveReference[]>();
  for (const definition of definitions) {
    for (const objective of definition.objectives) {
      const reference = { questId: definition.id, objectiveId: objective.id };
      switch (objective.type) {
        case "kill":
          addReference(killBySpecies, objective.species, reference);
          break;
        case "defeat-target":
          addReference(defeatByEvent, eventKey(objective.targetRef), reference);
          break;
        case "collect":
          addReference(
            objective.counting === "acquired" ? acquisitionByItem : inventoryByItem,
            objective.itemId,
            reference,
          );
          break;
        case "deliver":
          addReference(inventoryByItem, objective.itemId, reference);
          break;
        case "interact":
          addReference(
            objective.interaction === "talk" ? talkByEvent : interactionByEvent,
            eventKey(objective.targetRef),
            reference,
          );
          break;
        case "reach":
          if (objective.destination.kind === "map") {
            addReference(reachByMap, objective.destination.mapId, reference);
          } else {
            addReference(
              reachByArea,
              areaKey(objective.destination.mapId, objective.destination.areaId),
              reference,
            );
          }
          break;
        case "use-item":
          addReference(useByItem, objective.itemId, reference);
          break;
        case "activity":
          addReference(activityById, objective.activityId, reference);
          break;
        case "manual":
          break;
      }
    }
  }
  return {
    definitions: new Map(definitions.map((definition) => [definition.id, definition])),
    killBySpecies,
    defeatByEvent,
    acquisitionByItem,
    inventoryByItem,
    useByItem,
    interactionByEvent,
    talkByEvent,
    reachByMap,
    reachByArea,
    activityById,
  };
}

function append(
  target: QuestObjectiveReference[],
  source: readonly QuestObjectiveReference[] | undefined,
): void {
  if (source) target.push(...source);
}

/** O(number of objectives indexed under this event target), never O(all authored quests). */
export function questObjectiveCandidates(
  index: QuestObjectiveIndex,
  event: QuestBusinessEvent,
): QuestObjectiveReference[] {
  const candidates: QuestObjectiveReference[] = [];
  switch (event.type) {
    case "monsterKilled":
      append(candidates, index.killBySpecies.get(event.species));
      append(candidates, index.defeatByEvent.get(`${event.mapId}:${event.monsterId}`));
      break;
    case "bossDefeated":
      append(candidates, index.defeatByEvent.get(`${event.mapId}:${event.targetEventId}`));
      break;
    case "itemAcquired":
      append(candidates, index.acquisitionByItem.get(event.itemId));
      append(candidates, index.inventoryByItem.get(event.itemId));
      break;
    case "itemRemoved":
      append(candidates, index.inventoryByItem.get(event.itemId));
      break;
    case "itemUsed":
      append(candidates, index.useByItem.get(event.itemId));
      break;
    case "objectInteracted":
      append(candidates, index.interactionByEvent.get(`${event.mapId}:${event.targetEventId}`));
      break;
    case "npcTalked":
      append(candidates, index.talkByEvent.get(`${event.mapId}:${event.targetEventId}`));
      break;
    case "mapEntered":
      append(candidates, index.reachByMap.get(event.mapId));
      break;
    case "areaEntered":
      append(candidates, index.reachByArea.get(areaKey(event.mapId, event.areaId)));
      break;
    case "activityCompleted":
      append(candidates, index.activityById.get(event.activityId));
      break;
  }
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.questId}:${candidate.objectiveId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueActors(actors: readonly QuestActor[]): QuestActor[] {
  const byId = new Map<string, QuestActor>();
  for (const actor of actors) byId.set(actor.heroId, actor);
  return [...byId.values()];
}

function creditedMonsterActors(
  credit: QuestCreditRule,
  event: Extract<QuestBusinessEvent, { type: "monsterKilled" | "bossDefeated" }>,
): QuestActor[] {
  if (credit === "killer") return [event.killer];
  return uniqueActors(credit === "contributors" ? event.contributors : event.nearbyParty);
}

export function questEventActors(
  objective: AuthoredQuestObjective,
  event: QuestBusinessEvent,
): QuestActor[] {
  if (event.type === "monsterKilled" || event.type === "bossDefeated") {
    if (objective.type !== "kill" && objective.type !== "defeat-target") return [];
    return creditedMonsterActors(objective.credit, event);
  }
  return [event.actor];
}

function objectiveMatchesEvent(
  objective: AuthoredQuestObjective,
  event: QuestBusinessEvent,
): boolean {
  switch (objective.type) {
    case "kill":
      return (
        event.type === "monsterKilled" &&
        event.species === objective.species &&
        (objective.mapScope.kind === "any" || objective.mapScope.mapIds.includes(event.mapId))
      );
    case "defeat-target":
      return (
        ((event.type === "monsterKilled" && event.monsterId === objective.targetRef.eventId) ||
          (event.type === "bossDefeated" && event.targetEventId === objective.targetRef.eventId)) &&
        event.mapId === objective.targetRef.mapId
      );
    case "collect":
      return (
        objective.itemId ===
          (event.type === "itemAcquired" || event.type === "itemRemoved" ? event.itemId : "") &&
        (objective.counting === "inventory" || event.type === "itemAcquired")
      );
    case "deliver":
      return (
        (event.type === "itemAcquired" || event.type === "itemRemoved") &&
        event.itemId === objective.itemId
      );
    case "interact":
      return (
        ((objective.interaction === "talk" && event.type === "npcTalked") ||
          (objective.interaction === "interact" && event.type === "objectInteracted")) &&
        event.mapId === objective.targetRef.mapId &&
        event.targetEventId === objective.targetRef.eventId
      );
    case "reach":
      return objective.destination.kind === "map"
        ? event.type === "mapEntered" && event.mapId === objective.destination.mapId
        : event.type === "areaEntered" &&
            event.mapId === objective.destination.mapId &&
            event.areaId === objective.destination.areaId;
    case "use-item":
      if (event.type !== "itemUsed" || event.itemId !== objective.itemId) return false;
      if (objective.context === null) return true;
      if (objective.context.kind === "map") return event.mapId === objective.context.mapId;
      return (
        event.mapId === objective.context.mapId && event.targetEventId === objective.context.eventId
      );
    case "activity":
      return event.type === "activityCompleted" && event.activityId === objective.activityId;
    case "manual":
      return false;
  }
}

type ObjectiveChange =
  | { readonly kind: "add"; readonly value: number }
  | { readonly kind: "set"; readonly value: number };

function objectiveChange(
  objective: AuthoredQuestObjective,
  event: QuestBusinessEvent,
): ObjectiveChange | null {
  if (!objectiveMatchesEvent(objective, event)) return null;
  if (objective.type === "collect" && objective.counting === "inventory") {
    if (event.type !== "itemAcquired" && event.type !== "itemRemoved") return null;
    return { kind: "set", value: event.inventoryQuantity };
  }
  if (objective.type === "deliver") {
    if (event.type !== "itemAcquired" && event.type !== "itemRemoved") return null;
    return { kind: "set", value: event.inventoryQuantity };
  }
  if (
    event.type === "itemAcquired" ||
    event.type === "itemUsed" ||
    event.type === "activityCompleted"
  ) {
    return { kind: "add", value: event.amount };
  }
  return { kind: "add", value: 1 };
}

export function createAuthoredQuestProgress(
  definition: AuthoredQuestDefinition,
  completionCount = 0,
): AuthoredQuestProgress {
  return {
    status: "active",
    objectives: {},
    definitionSnapshot: definition,
    definitionVersion: definition.version,
    rewardClaimed: false,
    completionCount,
    processedEventKeys: [],
  };
}

function currentSequentialStage(
  definition: AuthoredQuestDefinition,
  progress: Readonly<Record<string, number>>,
): number | null {
  const incomplete = definition.objectives.filter(
    (objective) => !objective.optional && (progress[objective.id] ?? 0) < objective.target,
  );
  if (incomplete.length === 0) return null;
  return Math.min(...incomplete.map((objective) => objective.stage));
}

export interface QuestProgressEventResult {
  readonly progress: AuthoredQuestProgress;
  readonly changedObjectiveIds: readonly string[];
  /** True exactly when this quest accepted this event id into its idempotency ledger. */
  readonly eventConsumed: boolean;
  readonly becameReady: boolean;
  readonly becameCompleted: boolean;
}

/** Apply every matching objective in one quest before deriving ready/completed state. */
export function applyQuestBusinessEvent(
  definition: AuthoredQuestDefinition,
  current: AuthoredQuestProgress,
  event: QuestBusinessEvent,
  objectiveIds: readonly string[],
): QuestProgressEventResult {
  if (
    current.status === "completed" ||
    current.status === "failed" ||
    current.status === "abandoned"
  ) {
    return {
      progress: current,
      changedObjectiveIds: [],
      eventConsumed: false,
      becameReady: false,
      becameCompleted: false,
    };
  }
  if (
    current.processedEventKeys.includes(event.id) ||
    // Compatibility with the short-lived objective-suffixed representation.
    current.processedEventKeys.some((key) => key.startsWith(`${event.id}:`))
  ) {
    return {
      progress: current,
      changedObjectiveIds: [],
      eventConsumed: false,
      becameReady: false,
      becameCompleted: false,
    };
  }
  const activeStage =
    definition.objectiveMode === "sequential"
      ? currentSequentialStage(definition, current.objectives)
      : null;
  const objectives = { ...current.objectives };
  let processedEventKeys = [...current.processedEventKeys];
  const changedObjectiveIds: string[] = [];
  let eventConsumed = false;
  for (const objectiveId of new Set(objectiveIds)) {
    const objective = definition.objectives.find((candidate) => candidate.id === objectiveId);
    if (!objective) continue;
    const change = objectiveChange(objective, event);
    if (!change) continue;
    // Consume before the stage gate: a replay of this historical fact must never become credit for
    // a later sequential stage merely because the first delivery arrived too early.
    eventConsumed = true;
    if (
      definition.objectiveMode === "sequential" &&
      activeStage !== null &&
      objective.stage !== activeStage
    ) {
      continue;
    }
    const before = objectives[objective.id] ?? 0;
    const after = Math.min(
      objective.target,
      Math.max(0, change.kind === "set" ? change.value : before + change.value),
    );
    if (after === before) continue;
    objectives[objective.id] = after;
    changedObjectiveIds.push(objective.id);
  }
  if (!eventConsumed) {
    return {
      progress: current,
      changedObjectiveIds,
      eventConsumed: false,
      becameReady: false,
      becameCompleted: false,
    };
  }
  processedEventKeys.push(event.id);
  processedEventKeys = processedEventKeys.slice(-MAX_QUEST_PROCESSED_EVENT_KEYS);
  const complete = requiredQuestObjectivesComplete(definition, objectives);
  const previousReady = current.status === "ready";
  const status = complete
    ? definition.completion === "automatic"
      ? "completed"
      : "ready"
    : "active";
  const becameCompleted = status === "completed";
  return {
    progress: {
      ...current,
      status,
      objectives,
      processedEventKeys,
      completionCount: current.completionCount + (becameCompleted ? 1 : 0),
    },
    changedObjectiveIds,
    eventConsumed: true,
    becameReady: status === "ready" && !previousReady,
    becameCompleted,
  };
}

export interface QuestPrerequisiteContext {
  readonly level: number;
  readonly completedQuestIds: ReadonlySet<string>;
  readonly adventureState: PartyAdventureState;
}

export function questPrerequisitesHold(
  definition: AuthoredQuestDefinition,
  context: QuestPrerequisiteContext,
): boolean {
  const prerequisites = definition.prerequisites;
  if (prerequisites.minLevel !== null && context.level < prerequisites.minLevel) return false;
  if (
    prerequisites.previousQuestId !== null &&
    !context.completedQuestIds.has(prerequisites.previousQuestId)
  ) {
    return false;
  }
  if (prerequisites.conditions.length === 0) return true;
  const values = prerequisites.conditions.map((condition) => {
    switch (condition.type) {
      case "switch":
        return (context.adventureState.switches[condition.switchId] ?? false) === condition.value;
      case "variable":
        return (context.adventureState.variables[condition.variableId] ?? 0) >= condition.min;
      case "quest":
        return context.completedQuestIds.has(condition.questId);
    }
    return false;
  });
  return prerequisites.mode === "all" ? values.every(Boolean) : values.some(Boolean);
}

export function completedQuestIds(
  progress: Readonly<Record<string, AuthoredQuestProgress>> | undefined,
): ReadonlySet<string> {
  return new Set(
    Object.entries(progress ?? {})
      .filter(([, value]) => value.status === "completed" || value.completionCount > 0)
      .map(([questId]) => questId),
  );
}

/** Resolve the pinned definition when present, otherwise the current adventure definition. */
export function progressDefinition(
  index: QuestObjectiveIndex,
  questId: string,
  progress: AuthoredQuestProgress | undefined,
): AuthoredQuestDefinition | undefined {
  return progress?.definitionSnapshot ?? index.definitions.get(questId);
}

export function registryQuestIndex(registry: AdventureRegistry): QuestObjectiveIndex {
  return buildQuestObjectiveIndex(registry.quests ?? []);
}
