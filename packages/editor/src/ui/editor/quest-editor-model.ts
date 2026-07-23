import type { AdventureRegistry } from "@lindocara/engine/adventure-state.js";
import { CONSUMABLE_IDS } from "@lindocara/engine/consumables.js";
import { CURATED_MONSTER_SPECIES } from "@lindocara/engine/game.js";
import type { MapEvent } from "@lindocara/engine/map-events.js";
import type {
  AuthoredQuestDefinition,
  AuthoredQuestObjective,
  QuestEventReference,
  QuestValidationContext,
} from "@lindocara/engine/quests.js";
import { collectQuestCommandBindings } from "@lindocara/engine/quests.js";
import type { ElementEventBinding } from "../../game/editor-state.js";

export type StructuredObjectiveType = Exclude<AuthoredQuestObjective["type"], "manual">;

export const STRUCTURED_OBJECTIVE_TYPES: readonly StructuredObjectiveType[] = [
  "kill",
  "defeat-target",
  "collect",
  "deliver",
  "interact",
  "reach",
  "use-item",
  "activity",
];

export interface QuestMapCatalog {
  readonly mapId: string;
  readonly name: string;
  readonly cols: number;
  readonly rows: number;
  readonly events: readonly MapEvent[];
}

export interface QuestEventOption {
  readonly reference: QuestEventReference;
  readonly mapName: string;
  readonly event: MapEvent;
}

export function questEventLabel(option: QuestEventOption): string {
  const fallback = `EV${String(option.event.ordinal).padStart(3, "0")}`;
  return `${option.mapName} · ${option.event.name || fallback}`;
}

const OBJECTIVE_BASE = {
  label: "",
  target: 1,
  optional: false,
  hidden: false,
  stage: 0,
} as const;

export function questEventOptions(
  maps: readonly QuestMapCatalog[],
  monstersOnly = false,
): QuestEventOption[] {
  return maps.flatMap((map) =>
    map.events.flatMap((event) =>
      !monstersOnly || event.kind === "monster"
        ? [{ reference: { mapId: map.mapId, eventId: event.id }, mapName: map.name, event }]
        : [],
    ),
  );
}

export function eventReferenceValue(reference: QuestEventReference | null): string {
  return reference ? `${reference.mapId}:${reference.eventId}` : "";
}

export function eventReferenceFromValue(value: string): QuestEventReference | null {
  const separator = value.indexOf(":");
  if (separator < 1 || separator >= value.length - 1) return null;
  return { mapId: value.slice(0, separator), eventId: value.slice(separator + 1) };
}

export function createStructuredQuestObjective(
  id: string,
  type: StructuredObjectiveType,
  maps: readonly QuestMapCatalog[],
): AuthoredQuestObjective | null {
  const base = { id, ...OBJECTIVE_BASE };
  switch (type) {
    case "kill":
      return {
        ...base,
        type,
        species: CURATED_MONSTER_SPECIES[0] ?? "spear_goblin",
        mapScope: { kind: "any" },
        credit: "contributors",
      };
    case "defeat-target": {
      const target = questEventOptions(maps, true)[0];
      return target ? { ...base, type, targetRef: target.reference, credit: "contributors" } : null;
    }
    case "collect":
      return {
        ...base,
        type,
        itemId: CONSUMABLE_IDS[0],
        counting: "inventory",
      };
    case "deliver":
      return { ...base, type, itemId: CONSUMABLE_IDS[0], consume: true };
    case "interact": {
      const target = questEventOptions(maps)[0];
      return target ? { ...base, type, targetRef: target.reference, interaction: "talk" } : null;
    }
    case "reach": {
      const map = maps[0];
      return map ? { ...base, type, destination: { kind: "map", mapId: map.mapId } } : null;
    }
    case "use-item":
      return { ...base, type, itemId: CONSUMABLE_IDS[0], context: null };
    case "activity":
      return { ...base, type, activityId: "activity" };
  }
}

export function changeQuestObjectiveType(
  objective: AuthoredQuestObjective,
  type: StructuredObjectiveType,
  maps: readonly QuestMapCatalog[],
): AuthoredQuestObjective | null {
  const created = createStructuredQuestObjective(objective.id, type, maps);
  if (!created) return null;
  return {
    ...created,
    label: objective.label,
    target: type === "defeat-target" || type === "reach" ? 1 : objective.target,
    optional: objective.optional,
    hidden: objective.hidden,
    stage: objective.stage,
  };
}

export function creatorSlug(value: string, fallback = "activity"): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return slug || fallback;
}

export function questValidationContext(
  registry: AdventureRegistry,
  maps: readonly QuestMapCatalog[],
): QuestValidationContext {
  const offeredQuestIds = new Set<string>();
  const turnInQuestIds = new Set<string>();
  const activityIds = new Set<string>();
  const areaIdsByMap = new Map<string, Set<string>>();
  for (const map of maps) {
    const areaIds = new Set<string>();
    areaIdsByMap.set(map.mapId, areaIds);
    for (const event of map.events) {
      for (const page of event.pages) {
        collectQuestCommandBindings(
          page.commands,
          offeredQuestIds,
          turnInQuestIds,
          activityIds,
          page.trigger === "player-touch" ? areaIds : undefined,
        );
      }
    }
  }
  return {
    mapIds: new Set(maps.map((map) => map.mapId)),
    eventIdsByMap: new Map(
      maps.map((map) => [map.mapId, new Set(map.events.map((event) => event.id))]),
    ),
    monsterSpeciesByMap: new Map(
      maps.map((map) => [
        map.mapId,
        new Set(
          map.events.flatMap((event) =>
            event.kind === "monster" && event.species ? [event.species] : [],
          ),
        ),
      ]),
    ),
    monsterEventIdsByMap: new Map(
      maps.map((map) => [
        map.mapId,
        new Set(map.events.flatMap((event) => (event.kind === "monster" ? [event.id] : []))),
      ]),
    ),
    areaIdsByMap,
    itemIds: new Set(CONSUMABLE_IDS),
    activityIds,
    switchIds: new Set(registry.switches.map((entry) => entry.id)),
    variableIds: new Set(registry.variables.map((entry) => entry.id)),
    offeredQuestIds,
    turnInQuestIds,
  };
}

export function duplicateAuthoredQuest(
  quest: AuthoredQuestDefinition,
  id: string,
  title: string,
): AuthoredQuestDefinition {
  return {
    ...quest,
    id,
    title,
    version: 1,
    objectives: quest.objectives.map((objective) => ({ ...objective })),
    rewards: {
      ...quest.rewards,
      items: quest.rewards.items.map((item) => ({ ...item })),
      choices: quest.rewards.choices.map((choice) => ({
        ...choice,
        items: choice.items.map((item) => ({ ...item })),
      })),
      stateChanges: quest.rewards.stateChanges.map((change) => ({ ...change })),
      customCommands: structuredClone(quest.rewards.customCommands),
    },
    dialogues: { ...quest.dialogues },
    prerequisites: {
      ...quest.prerequisites,
      conditions: quest.prerequisites.conditions.map((condition) => ({ ...condition })),
    },
  };
}

/** Apply the friendly "make interactive" choice once the promoted event owns a stable id. */
export function bindQuestTarget(
  registry: AdventureRegistry,
  binding: ElementEventBinding["questBinding"],
  reference: QuestEventReference,
): AdventureRegistry | null {
  if (!binding) return registry;
  const quests = registry.quests ?? [];
  const index = quests.findIndex((quest) => quest.id === binding.questId);
  const quest = quests[index];
  if (!quest) return null;
  let updated: AuthoredQuestDefinition;
  if (binding.kind === "giver") {
    updated = { ...quest, version: quest.version + 1, acceptance: "manual", giver: reference };
  } else if (binding.kind === "turn-in") {
    updated = {
      ...quest,
      version: quest.version + 1,
      completion: "turn-in",
      turnInTarget: reference,
    };
  } else if (binding.kind === "objective") {
    const objectiveIndex = quest.objectives.findIndex(
      (objective) => objective.id === binding.objectiveId && objective.type === "interact",
    );
    const objective = quest.objectives[objectiveIndex];
    if (objective?.type !== "interact") return null;
    const objectives = [...quest.objectives];
    objectives[objectiveIndex] = {
      ...objective,
      interaction: binding.interaction,
      targetRef: reference,
    };
    updated = { ...quest, version: quest.version + 1, objectives };
  } else {
    const objectiveIndex = quest.objectives.findIndex(
      (objective) =>
        objective.id === binding.objectiveId &&
        objective.type === "reach" &&
        objective.destination.kind === "area",
    );
    const objective = quest.objectives[objectiveIndex];
    if (objective?.type !== "reach" || objective.destination.kind !== "area") return null;
    const objectives = [...quest.objectives];
    objectives[objectiveIndex] = {
      ...objective,
      destination: { ...objective.destination, mapId: reference.mapId },
    };
    updated = { ...quest, version: quest.version + 1, objectives };
  }
  const next = [...quests];
  next[index] = updated;
  return { ...registry, quests: next };
}
