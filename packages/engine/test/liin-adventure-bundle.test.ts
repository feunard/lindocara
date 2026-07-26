import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type AdventureBundle,
  type AdventureBundleMap,
  parseAdventureBundle,
} from "../src/adventure-bundle.js";
import { colliderIndexFrom } from "../src/collider.js";
import { COMMAND_TEXT_MAX, type EventCommand, type EventCondition } from "../src/event-commands.js";
import { isWalkable, type MonsterSpecies, type TerrainGeometry } from "../src/game.js";
import { bakeCollision, elementColliders, parseMapData } from "../src/map-data.js";
import type { MapEvent, MapEventPage } from "../src/map-events.js";
import {
  applyQuestBusinessEvent,
  buildQuestObjectiveIndex,
  createAuthoredQuestProgress,
  type QuestActor,
  type QuestBusinessEvent,
  questObjectiveCandidates,
} from "../src/quest-runtime.js";
import { collectQuestCommandBindings, validateAuthoredQuests } from "../src/quests.js";
import { PLAYER_SIZE } from "../src/simulation.js";
import { TILE_SIZE } from "../src/tilemap.js";

const BUNDLE_URL = new URL("../../../adventures/liin-adventure-ia.json", import.meta.url);
const parsedBundle = parseAdventureBundle(JSON.parse(readFileSync(BUNDLE_URL, "utf8")));
if (!parsedBundle) throw new Error("The generated Liin bundle is invalid");
const BUNDLE: AdventureBundle = parsedBundle;

const MAP_NAMES = [
  "Route des Bornes arrachées",
  "Aubeval — Les Digues hautes",
  "Faubourg de la Porte",
  "Relais des Quatre Dettes",
  "Bois des Murmures — Clairécorce",
  "Sanctuaire des Racines",
  "Marais de Verre — Les Saules",
  "Archives sous la Vase",
  "Citadelle — Les Trois Cours",
  "Fort des Serments",
  "Sanctuaire de l’Aube",
  "Crypte d’Eryndor",
  "Guerre de l’Aube",
  "Galeries de la Source",
  "Cœur du Pacte",
  "Plaine des Liin",
] as const;

const MAIN_QUEST_IDS = ["0001", "0002", "0003", "0004", "0005", "0006", "0007"] as const;
const SIDE_QUEST_IDS = [
  "0010",
  "0011",
  "0012",
  "0013",
  "0014",
  "0015",
  "0016",
  "0017",
  "0018",
  "0019",
  "0020",
  "0021",
  "0022",
  "0023",
  "0024",
  "0025",
  "0026",
  "0027",
] as const;
const ENDING_SWITCHES = ["0051", "0052", "0053", "0054", "0055", "0056"] as const;

type ChoiceCommand = Extract<EventCommand, { t: "choices" }>;
type TeleportCommand = Extract<EventCommand, { t: "teleport" }>;
type UnstampedQuestEvent<T> = T extends QuestBusinessEvent ? Omit<T, "id" | "mapId"> : never;

function visitCommands(
  commands: readonly EventCommand[],
  visit: (command: EventCommand) => void,
): void {
  for (const command of commands) {
    visit(command);
    if (command.t === "if") {
      visitCommands(command.then, visit);
      visitCommands(command.else, visit);
    } else if (command.t === "choices") {
      for (const option of command.options) visitCommands(option.body, visit);
    } else if (command.t === "loop") {
      visitCommands(command.body, visit);
    }
  }
}

function flattenedCommands(commands: readonly EventCommand[]): EventCommand[] {
  const result: EventCommand[] = [];
  visitCommands(commands, (command) => result.push(command));
  return result;
}

function allCommands(bundle = BUNDLE): EventCommand[] {
  return bundle.maps.flatMap((map) =>
    map.events.flatMap((event) =>
      event.pages.flatMap((eventPage) => flattenedCommands(eventPage.commands)),
    ),
  );
}

function mapNamed(name: (typeof MAP_NAMES)[number]): AdventureBundleMap {
  const map = BUNDLE.maps.find((candidate) => candidate.name === name);
  if (!map) throw new Error(`Missing Liin map: ${name}`);
  return map;
}

function eventNamed(mapName: (typeof MAP_NAMES)[number], name: string): MapEvent {
  const event = mapNamed(mapName).events.find((candidate) => candidate.name === name);
  if (!event) throw new Error(`Missing Liin event: ${mapName}/${name}`);
  return event;
}

function pageCommands(event: MapEvent, index = 0): readonly EventCommand[] {
  const eventPage = event.pages[index];
  if (!eventPage) throw new Error(`Missing page ${index} on ${event.name}`);
  return eventPage.commands;
}

function choicesWithPrompt(prompt: string): ChoiceCommand[] {
  return allCommands().filter(
    (command): command is ChoiceCommand => command.t === "choices" && command.prompt === prompt,
  );
}

function geometryFor(map: AdventureBundleMap): TerrainGeometry {
  const data = parseMapData(map);
  if (!data) throw new Error(`Invalid map payload: ${map.name}`);
  return {
    width: data.cols * TILE_SIZE,
    height: data.rows * TILE_SIZE,
    obstacles: [],
    spawnPoints: [],
    safeZone: null,
    tiles: bakeCollision(data),
    colliders: colliderIndexFrom(elementColliders(data.elements), data.cols, data.rows),
  };
}

function walkable(geometry: TerrainGeometry, col: number, row: number): boolean {
  return isWalkable(
    {
      x: col * TILE_SIZE + TILE_SIZE / 2,
      y: row * TILE_SIZE + TILE_SIZE / 2,
    },
    PLAYER_SIZE,
    geometry,
  );
}

function reachableCells(
  map: AdventureBundleMap,
  geometry: TerrainGeometry,
  starts: readonly { col: number; row: number }[],
): Set<string> {
  const key = (col: number, row: number) => `${col},${row}`;
  const seen = new Set<string>();
  const queue: { col: number; row: number }[] = [];
  for (const start of starts) {
    if (!walkable(geometry, start.col, start.row)) continue;
    const startKey = key(start.col, start.row);
    if (seen.has(startKey)) continue;
    seen.add(startKey);
    queue.push(start);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (!current) continue;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const col = current.col + dc;
      const row = current.row + dr;
      const cellKey = key(col, row);
      if (
        col < 0 ||
        row < 0 ||
        col >= map.cols ||
        row >= map.rows ||
        seen.has(cellKey) ||
        !walkable(geometry, col, row)
      ) {
        continue;
      }
      seen.add(cellKey);
      queue.push({ col, row });
    }
  }
  return seen;
}

interface LocatedTeleport {
  readonly sourceMap: AdventureBundleMap;
  readonly sourceEvent: MapEvent;
  readonly sourcePage: MapEventPage;
  readonly command: TeleportCommand;
}

function locatedTeleports(): LocatedTeleport[] {
  const result: LocatedTeleport[] = [];
  for (const sourceMap of BUNDLE.maps) {
    for (const sourceEvent of sourceMap.events) {
      for (const sourcePage of sourceEvent.pages) {
        visitCommands(sourcePage.commands, (command) => {
          if (command.t === "teleport") {
            result.push({ sourceMap, sourceEvent, sourcePage, command });
          }
        });
      }
    }
  }
  return result;
}

interface SimState {
  readonly switches: Set<string>;
  readonly variables: Map<string, number>;
  readonly selfSwitches: Set<string>;
  readonly activities: Set<string>;
  readonly teleports: TeleportCommand[];
  readonly visitedMaps: Set<string>;
  readonly questEvents: QuestBusinessEvent[];
  currentMapId: string | null;
  questEventOrdinal: number;
  ended: boolean;
}

const SIM_ACTOR: QuestActor = { heroId: "liin-simulation", sessionEpoch: 1, level: 12 };

function simulationState(options?: {
  readonly switches?: readonly string[];
  readonly variables?: Readonly<Record<string, number>>;
}): SimState {
  return {
    switches: new Set(options?.switches ?? []),
    variables: new Map(Object.entries(options?.variables ?? {})),
    selfSwitches: new Set(),
    activities: new Set(),
    teleports: [],
    visitedMaps: new Set(),
    questEvents: [],
    currentMapId: null,
    questEventOrdinal: 0,
    ended: false,
  };
}

function recordQuestEvent(
  state: SimState,
  event: UnstampedQuestEvent<QuestBusinessEvent>,
  mapId = state.currentMapId ?? BUNDLE.maps[0]?.id ?? "",
): void {
  state.questEventOrdinal += 1;
  state.questEvents.push({
    ...event,
    id: `liin-simulation-${state.questEventOrdinal}`,
    mapId,
  } as QuestBusinessEvent);
}

function conditionIsTrue(condition: EventCondition, state: SimState): boolean {
  if (condition.type === "switch") return state.switches.has(condition.switchId);
  if (condition.type === "variable") {
    return (state.variables.get(condition.variableId) ?? 0) >= condition.min;
  }
  return state.selfSwitches.has(condition.selfSwitch);
}

function runCommands(
  commands: readonly EventCommand[],
  state: SimState,
  selections: Readonly<Record<string, string>> = {},
): void {
  for (const command of commands) {
    switch (command.t) {
      case "setSwitch":
        if (command.value) state.switches.add(command.switchId);
        else state.switches.delete(command.switchId);
        break;
      case "setVariable": {
        const current = state.variables.get(command.variableId) ?? 0;
        state.variables.set(
          command.variableId,
          command.op === "set" ? command.value : current + command.value,
        );
        break;
      }
      case "setSelfSwitch":
        if (command.value) state.selfSwitches.add(command.selfSwitch);
        else state.selfSwitches.delete(command.selfSwitch);
        break;
      case "completeActivity":
        state.activities.add(command.activityId);
        recordQuestEvent(state, {
          type: "activityCompleted",
          actor: SIM_ACTOR,
          activityId: command.activityId,
          amount: 1,
        });
        break;
      case "teleport":
        state.teleports.push(command);
        break;
      case "endAdventure":
        state.ended = true;
        break;
      case "if":
        runCommands(
          conditionIsTrue(command.cond, state) ? command.then : command.else,
          state,
          selections,
        );
        break;
      case "choices": {
        const selectedLabel = selections[command.prompt];
        const option = command.options.find((candidate) => candidate.label === selectedLabel);
        if (!option) {
          throw new Error(
            `No simulated selection "${selectedLabel ?? ""}" for choice "${command.prompt}"`,
          );
        }
        runCommands(option.body, state, selections);
        break;
      }
      case "loop":
        runCommands(command.body, state, selections);
        break;
      default:
        break;
    }
  }
}

function runEvent(
  mapName: (typeof MAP_NAMES)[number],
  eventName: string,
  state: SimState,
  selections: Readonly<Record<string, string>> = {},
  pageIndex = 0,
): void {
  const map = mapNamed(mapName);
  state.currentMapId = map.id;
  if (!state.visitedMaps.has(map.id)) {
    state.visitedMaps.add(map.id);
    recordQuestEvent(
      state,
      {
        type: "mapEntered",
        actor: SIM_ACTOR,
      },
      map.id,
    );
  }
  runCommands(pageCommands(eventNamed(mapName, eventName), pageIndex), state, selections);
}

function completedQuestsFor(events: readonly QuestBusinessEvent[]): Set<string> {
  const definitions = BUNDLE.adventure.registry.quests ?? [];
  const index = buildQuestObjectiveIndex(definitions);
  const progress = new Map<string, ReturnType<typeof createAuthoredQuestProgress>>();

  for (const event of events) {
    const candidates = questObjectiveCandidates(index, event);
    for (const definition of definitions) {
      let current = progress.get(definition.id);
      if (!current) {
        const previousQuestId = definition.prerequisites.previousQuestId;
        if (previousQuestId !== null && progress.get(previousQuestId)?.status !== "completed") {
          continue;
        }
        current = createAuthoredQuestProgress(definition);
      }
      const objectiveIds = candidates
        .filter((candidate) => candidate.questId === definition.id)
        .map((candidate) => candidate.objectiveId);
      const applied = applyQuestBusinessEvent(definition, current, event, objectiveIds);
      progress.set(definition.id, applied.progress);
    }
  }

  return new Set(
    [...progress].flatMap(([questId, current]) =>
      current.status === "completed" ? [questId] : [],
    ),
  );
}

function endingReached(state: SimState): string[] {
  return ENDING_SWITCHES.filter((switchId) => state.switches.has(switchId));
}

function mapText(map: AdventureBundleMap): string {
  const values: string[] = [];
  for (const event of map.events) {
    values.push(event.name);
    for (const eventPage of event.pages) {
      visitCommands(eventPage.commands, (command) => {
        if (command.t === "say") {
          if (command.name) values.push(command.name);
          values.push(command.text);
        } else if (command.t === "choices") {
          values.push(command.prompt, ...command.options.map((option) => option.label));
        }
      });
    }
  }
  return values.join("\n");
}

describe("Liin — Les Dettes de l’Aube", () => {
  it("exports the complete, reproducible campaign envelope", () => {
    expect(BUNDLE.adventure.title).toBe("Liin — Les Dettes de l’Aube");
    expect(BUNDLE.adventure.maxPlayers).toBe(4);
    expect(BUNDLE.maps.map((map) => map.name)).toEqual(MAP_NAMES);
    expect(BUNDLE.maps).toHaveLength(16);
    expect(BUNDLE.graph).toEqual({ start: null, links: [] });
    expect(BUNDLE.adventure.registry.switches).toHaveLength(79);
    expect(BUNDLE.adventure.registry.variables).toHaveLength(20);
    expect(BUNDLE.maps.reduce((count, map) => count + map.events.length, 0)).toBe(250);

    const quests = BUNDLE.adventure.registry.quests ?? [];
    expect(quests).toHaveLength(25);
    expect(quests.slice(0, MAIN_QUEST_IDS.length).map((quest) => quest.id)).toEqual(MAIN_QUEST_IDS);
    expect(quests.slice(MAIN_QUEST_IDS.length).map((quest) => quest.id)).toEqual(SIDE_QUEST_IDS);

    const eventIds = BUNDLE.maps.flatMap((map) => map.events.map((event) => event.id));
    expect(new Set(eventIds).size).toBe(eventIds.length);
    const spawns = BUNDLE.maps.flatMap((map) =>
      map.events
        .filter((event) => event.kind === "spawn")
        .map((event) => ({ map: map.name, event })),
    );
    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.map).toBe(MAP_NAMES[0]);
  });

  it("keeps every map, event and teleport on reachable collision-safe cells", () => {
    const mapsById = new Map(BUNDLE.maps.map((map) => [map.id, map]));
    const geometries = new Map(BUNDLE.maps.map((map) => [map.id, geometryFor(map)]));
    const teleports = locatedTeleports();
    expect(teleports.length).toBeGreaterThanOrEqual(90);

    const arrivalsByMap = new Map<string, { col: number; row: number }[]>(
      BUNDLE.maps.map((map) => [map.id, [{ ...map.spawn }]]),
    );
    for (const { command } of teleports) {
      arrivalsByMap.get(command.mapId)?.push({ col: command.col, row: command.row });
    }

    expect(new Set(BUNDLE.maps.map((map) => map.layers.join("|"))).size).toBe(BUNDLE.maps.length);
    for (const map of BUNDLE.maps) {
      expect(map.cols, map.name).toBe(60);
      expect(map.rows, map.name).toBe(45);
      expect(map.elements.length, `${map.name}: environmental detail`).toBeGreaterThanOrEqual(20);
      const geometry = geometries.get(map.id);
      if (!geometry) throw new Error(`Missing geometry for ${map.name}`);
      const reachable = reachableCells(
        map,
        geometry,
        arrivalsByMap.get(map.id) ?? [{ ...map.spawn }],
      );
      expect(reachable.size, `${map.name}: traversable field`).toBeGreaterThanOrEqual(
        Math.floor(map.cols * map.rows * 0.45),
      );
      for (const event of map.events) {
        expect(
          reachable.has(`${event.col},${event.row}`),
          `${map.name}: unreachable ${event.name} at ${event.col},${event.row}`,
        ).toBe(true);
        for (const eventPage of event.pages) {
          expect(
            ["auto", "parallel", "event-touch"].includes(eventPage.trigger),
            `${map.name}/${event.name}: executable trigger`,
          ).toBe(false);
        }
      }
    }

    for (const { sourceMap, sourceEvent, sourcePage, command } of teleports) {
      const destination = mapsById.get(command.mapId);
      const geometry = geometries.get(command.mapId);
      expect(destination, `${sourceMap.name}/${sourceEvent.name}: destination map`).toBeDefined();
      expect(geometry).toBeDefined();
      if (!destination || !geometry) continue;
      expect(command.col).toBeGreaterThanOrEqual(0);
      expect(command.row).toBeGreaterThanOrEqual(0);
      expect(command.col).toBeLessThan(destination.cols);
      expect(command.row).toBeLessThan(destination.rows);
      expect(
        walkable(geometry, command.col, command.row),
        `${sourceMap.name}/${sourceEvent.name}: unsafe arrival in ${destination.name}`,
      ).toBe(true);
      expect(sourcePage.trigger).not.toBe("player-touch");
      expect(
        destination.events.some(
          (event) =>
            event.pages.some((eventPage) => eventPage.trigger === "player-touch") &&
            Math.abs(event.col - command.col) + Math.abs(event.row - command.row) <= 1,
        ),
        `${sourceMap.name}/${sourceEvent.name}: touch-loop arrival`,
      ).toBe(false);
    }
  });

  it("connects all sixteen regions through story-gated travel and four return shortcuts", () => {
    const teleports = locatedTeleports();
    const edges = new Map<string, Set<string>>();
    for (const { sourceMap, command } of teleports) {
      const destinations = edges.get(sourceMap.id) ?? new Set<string>();
      destinations.add(command.mapId);
      edges.set(sourceMap.id, destinations);
    }

    const reached = new Set<string>([BUNDLE.maps[0]?.id ?? ""]);
    const queue = [...reached];
    for (let head = 0; head < queue.length; head += 1) {
      const source = queue[head];
      if (!source) continue;
      for (const destination of edges.get(source) ?? []) {
        if (reached.has(destination)) continue;
        reached.add(destination);
        queue.push(destination);
      }
    }
    expect(reached.size).toBe(BUNDLE.maps.length);

    const hasBothDirections = (
      left: (typeof MAP_NAMES)[number],
      right: (typeof MAP_NAMES)[number],
    ): boolean => {
      const leftMap = mapNamed(left);
      const rightMap = mapNamed(right);
      return (
        (edges.get(leftMap.id)?.has(rightMap.id) ?? false) &&
        (edges.get(rightMap.id)?.has(leftMap.id) ?? false)
      );
    };
    expect(hasBothDirections(MAP_NAMES[1], MAP_NAMES[3])).toBe(true);
    expect(hasBothDirections(MAP_NAMES[4], MAP_NAMES[6])).toBe(true);
    expect(hasBothDirections(MAP_NAMES[6], MAP_NAMES[8])).toBe(true);
    expect(hasBothDirections(MAP_NAMES[10], MAP_NAMES[12])).toBe(true);

    const shortcutSwitches = new Set(["0058", "0059", "0060", "0061"]);
    const pageConditions = new Set(
      BUNDLE.maps.flatMap((map) =>
        map.events.flatMap((event) =>
          event.pages.flatMap((eventPage) =>
            eventPage.condSwitchId ? [eventPage.condSwitchId] : [],
          ),
        ),
      ),
    );
    for (const switchId of shortcutSwitches) expect(pageConditions.has(switchId)).toBe(true);
    expect(
      BUNDLE.maps
        .flatMap((map) => map.events)
        .some((event) => event.name.toLowerCase().includes("route vers la prochaine")),
    ).toBe(false);
  });

  it("keeps registry, command and quest references complete and acyclic", () => {
    const quests = BUNDLE.adventure.registry.quests ?? [];
    const switchIds = new Set(BUNDLE.adventure.registry.switches.map((entry) => entry.id));
    const variableIds = new Set(BUNDLE.adventure.registry.variables.map((entry) => entry.id));
    const eventIdsByMap = new Map<string, ReadonlySet<string>>();
    const monsterSpeciesByMap = new Map<string, ReadonlySet<MonsterSpecies>>();
    const monsterEventIdsByMap = new Map<string, ReadonlySet<string>>();
    const activityIds = new Set<string>();
    const offeredQuestIds = new Set<string>();
    const turnInQuestIds = new Set<string>();

    for (const map of BUNDLE.maps) {
      eventIdsByMap.set(map.id, new Set(map.events.map((event) => event.id)));
      monsterSpeciesByMap.set(
        map.id,
        new Set(
          map.events.flatMap((event) =>
            event.kind === "monster" && event.species ? [event.species] : [],
          ),
        ),
      );
      monsterEventIdsByMap.set(
        map.id,
        new Set(map.events.flatMap((event) => (event.kind === "monster" ? [event.id] : []))),
      );
      for (const event of map.events) {
        for (const eventPage of event.pages) {
          if (eventPage.condSwitchId) expect(switchIds.has(eventPage.condSwitchId)).toBe(true);
          if (eventPage.condVariableId)
            expect(variableIds.has(eventPage.condVariableId)).toBe(true);
          collectQuestCommandBindings(
            eventPage.commands,
            offeredQuestIds,
            turnInQuestIds,
            activityIds,
          );
          visitCommands(eventPage.commands, (command) => {
            if (command.t === "setSwitch") expect(switchIds.has(command.switchId)).toBe(true);
            if (command.t === "setVariable") expect(variableIds.has(command.variableId)).toBe(true);
            if (command.t === "if" && command.cond.type === "switch") {
              expect(switchIds.has(command.cond.switchId)).toBe(true);
            }
            if (command.t === "if" && command.cond.type === "variable") {
              expect(variableIds.has(command.cond.variableId)).toBe(true);
            }
          });
        }
      }
    }

    const diagnostics = validateAuthoredQuests(quests, {
      mapIds: new Set(BUNDLE.maps.map((map) => map.id)),
      eventIdsByMap,
      monsterSpeciesByMap,
      monsterEventIdsByMap,
      activityIds,
      switchIds,
      variableIds,
      offeredQuestIds,
      turnInQuestIds,
    });
    expect(diagnostics).toEqual([]);

    for (const [index, questId] of MAIN_QUEST_IDS.entries()) {
      const quest = quests.find((candidate) => candidate.id === questId);
      expect(quest?.prerequisites.previousQuestId).toBe(
        index === 0 ? null : MAIN_QUEST_IDS[index - 1],
      );
      expect(quest?.rewards.nextQuestId).toBe(
        index === MAIN_QUEST_IDS.length - 1 ? null : MAIN_QUEST_IDS[index + 1],
      );
      expect(quest?.acceptance).toBe("automatic");
      expect(quest?.completion).toBe("automatic");
      expect(quest?.scope).toBe("party");
      expect(quest?.objectiveMode).toBe("sequential");
    }
    expect(
      new Set(quests.flatMap((quest) => quest.objectives.map((objective) => objective.type))),
    ).toEqual(new Set(["activity", "reach", "defeat-target"]));
    expect(
      quests
        .filter((quest) => SIDE_QUEST_IDS.includes(quest.id as (typeof SIDE_QUEST_IDS)[number]))
        .every((quest) => quest.prerequisites.previousQuestId !== null),
    ).toBe(true);
    const simultaneousSideQuests = new Set(["0012", "0013", "0015", "0017", "0024"]);
    for (const quest of quests.filter((candidate) =>
      SIDE_QUEST_IDS.includes(candidate.id as (typeof SIDE_QUEST_IDS)[number]),
    )) {
      expect(quest.objectiveMode, quest.id).toBe(
        simultaneousSideQuests.has(quest.id) ? "simultaneous" : "sequential",
      );
    }
  });

  it("gates sequential story facts and leaves order-free investigations simultaneous", () => {
    expect(
      (BUNDLE.adventure.registry.quests ?? [])
        .find((quest) => quest.id === "0001")
        ?.objectives.map((objective) => objective.stage),
    ).toEqual([0, 0, 1]);

    const source = eventNamed(MAP_NAMES[0], "Éclat d’Aube");
    expect(source.pages[1]).toMatchObject({
      condSwitchId: "0001",
      condVariableId: "0009",
      condVariableMin: 1,
    });
    expect(
      flattenedCommands(source.pages[1]?.commands ?? []).some(
        (command) => command.t === "completeActivity" && command.activityId === "source_reconnait",
      ),
    ).toBe(true);

    const convoyYardCommands = flattenedCommands(
      pageCommands(eventNamed(MAP_NAMES[2], "Cour des chariots")),
    );
    expect(
      convoyYardCommands.some(
        (command) => command.t === "completeActivity" && command.activityId === "preuve_varkesh",
      ),
    ).toBe(false);
    expect(
      convoyYardCommands.some(
        (command) => command.t === "setSwitch" && command.switchId === "0009",
      ),
    ).toBe(false);

    const dossierCommands = flattenedCommands(
      pageCommands(eventNamed(MAP_NAMES[2], "Dossier de Varkesh")),
    );
    expect(
      dossierCommands.some(
        (command) => command.t === "completeActivity" && command.activityId === "preuve_varkesh",
      ),
    ).toBe(true);
    expect(
      dossierCommands.some((command) => command.t === "setSwitch" && command.switchId === "0009"),
    ).toBe(true);
    expect(
      BUNDLE.maps.flatMap((map) =>
        map.events.flatMap((event) =>
          event.pages.some((eventPage) =>
            flattenedCommands(eventPage.commands).some(
              (command) => command.t === "setSwitch" && command.switchId === "0009",
            ),
          )
            ? [`${map.name}/${event.name}`]
            : [],
        ),
      ),
    ).toEqual([`${MAP_NAMES[2]}/Dossier de Varkesh`]);
    expect(eventNamed(MAP_NAMES[2], "Porte de Varkesh").pages[1]?.condSwitchId).toBe("0009");

    const sanctuaryOffer = eventNamed(MAP_NAMES[10], "Varos");
    expect(sanctuaryOffer.pages[1]?.condSwitchId).toBe("0039");
    expect(
      new Set(
        eventNamed(MAP_NAMES[10], "Crypte du premier roi").pages.flatMap((eventPage) =>
          eventPage.condSwitchId ? [eventPage.condSwitchId] : [],
        ),
      ),
    ).toEqual(new Set(["0036", "0037"]));
  });

  it("authors distinct consequences for every campaign-defining decision", () => {
    const expectedChoices = new Map<string, number>([
      ["Quel sort réserver à Varkesh ?", 3],
      ["Quel clan aider d’abord ?", 2],
      ["Que faire de Morvane ?", 4],
      ["Quel sort pour les Archives ?", 3],
      ["Que demander à Talen ?", 2],
      ["Quelle ligne Serah doit-elle tenir ?", 2],
      ["Qui contrôlera la Citadelle ?", 4],
      ["Accepter la trêve logistique ?", 2],
      ["Quelle famille de solution choisir ?", 4],
    ]);
    for (const [prompt, optionCount] of expectedChoices) {
      const choice = choicesWithPrompt(prompt)[0];
      expect(choice, prompt).toBeDefined();
      if (!choice) continue;
      expect(choice.options, prompt).toHaveLength(optionCount);
      const signatures = choice.options.map((option) =>
        JSON.stringify(
          flattenedCommands(option.body)
            .filter((command) =>
              ["setSwitch", "setVariable", "completeActivity", "teleport"].includes(command.t),
            )
            .map((command) => command),
        ),
      );
      expect(new Set(signatures).size, `${prompt}: distinct effects`).toBe(signatures.length);
    }

    const varkeshChoice = choicesWithPrompt("Quel sort réserver à Varkesh ?")[0];
    expect(
      varkeshChoice?.options.map((option) =>
        flattenedCommands(option.body)
          .filter(
            (command): command is Extract<EventCommand, { t: "setSwitch" }> =>
              command.t === "setSwitch",
          )
          .map((command) => command.switchId),
      ),
    ).toEqual([["0075"], ["0076"], ["0077", "0008", "0041"]]);

    const downstreamConditions = new Set(
      BUNDLE.maps.flatMap((map) =>
        map.events.flatMap((event) =>
          event.pages.flatMap((eventPage) =>
            eventPage.condSwitchId ? [eventPage.condSwitchId] : [],
          ),
        ),
      ),
    );
    for (const switchId of ["0006", "0007", "0008", "0014", "0015", "0016", "0017"]) {
      expect(downstreamConditions.has(switchId), `delayed consequence ${switchId}`).toBe(true);
    }

    for (const decision of ["Rompre leur serment", "Reporter la rupture après la guerre"]) {
      const state = simulationState();
      runEvent(MAP_NAMES[9], "Cour des anciens morts", state, {
        "Que faire de la garde morte ?": decision,
      });
      expect(state.activities.has("delivrer_morts"), decision).toBe(true);
    }
  });

  it("carries each Varkesh sentence into an exclusive outcome and Serah page", () => {
    const cases = [
      {
        option: "L’affronter pour l’exécuter",
        outcome: "0006",
        serahPageIndex: 1,
        epiloguePageIndex: 0,
        resolveBoss: true,
      },
      {
        option: "Le vaincre et le capturer",
        outcome: "0007",
        serahPageIndex: 2,
        epiloguePageIndex: 1,
        resolveBoss: true,
      },
      {
        option: "Négocier une trêve limitée",
        outcome: "0008",
        serahPageIndex: 3,
        epiloguePageIndex: 2,
        resolveBoss: false,
      },
    ] as const;

    for (const scenario of cases) {
      const state = simulationState({ switches: ["0009"] });
      runEvent(
        MAP_NAMES[2],
        "Porte de Varkesh",
        state,
        { "Quel sort réserver à Varkesh ?": scenario.option },
        1,
      );
      if (scenario.resolveBoss) runEvent(MAP_NAMES[2], "Varkesh", state);

      expect(
        ["0006", "0007", "0008"].filter((switchId) => state.switches.has(switchId)),
        scenario.option,
      ).toEqual([scenario.outcome]);
      expect(state.activities.has("sort_varkesh"), scenario.option).toBe(true);
      expect(state.switches.has("0041"), scenario.option).toBe(true);

      const serahPage = eventNamed(MAP_NAMES[8], "Serah").pages[scenario.serahPageIndex];
      expect(serahPage?.condSwitchId, scenario.option).toBe(scenario.outcome);
      expect(
        flattenedCommands(serahPage?.commands ?? []).some(
          (command) => command.t === "choices" && command.prompt.includes("Serah"),
        ),
        scenario.option,
      ).toBe(true);

      const epiloguePage = eventNamed(MAP_NAMES[15], "Registre de Varkesh").pages[
        scenario.epiloguePageIndex
      ];
      expect(epiloguePage?.condSwitchId, scenario.option).toBe(scenario.outcome);
      expect(
        flattenedCommands(epiloguePage?.commands ?? []).some(
          (command) => command.t === "say" && command.text.includes("Varkesh"),
        ),
        scenario.option,
      ).toBe(true);
    }
  });

  it("makes both spatial riddles deducible, recoverable and solvable by one player", () => {
    const rootsMap = mapNamed(MAP_NAMES[5]);
    const wrongRoot = simulationState();
    runCommands(pageCommands(eventNamed(MAP_NAMES[5], "Salle de la demande")), wrongRoot, {
      "Quel mot ouvre le Pacte ?": "Le nom du souverain",
    });
    expect(wrongRoot.variables.get("0012")).toBe(0);
    expect(wrongRoot.teleports.at(-1)).toMatchObject({
      mapId: rootsMap.id,
      col: 9,
      row: 36,
    });

    const solvedRoot = simulationState();
    runCommands(pageCommands(eventNamed(MAP_NAMES[5], "Salle de la demande")), solvedRoot, {
      "Quel mot ouvre le Pacte ?": "Le bienfait demandé",
    });
    runCommands(pageCommands(eventNamed(MAP_NAMES[5], "Salle du refus")), solvedRoot, {
      "Qui peut refuser le prix ?": "Chaque personne appelée",
    });
    runCommands(pageCommands(eventNamed(MAP_NAMES[5], "Salle des témoins")), solvedRoot, {
      "Comment le prix devient-il une dette commune ?": "Il est réparti et rendu public",
    });
    expect(solvedRoot.variables.get("0012")).toBe(3);
    expect(solvedRoot.switches.has("0069")).toBe(true);
    expect(solvedRoot.activities.has("rite_racines")).toBe(true);
    const resetRoot = simulationState({ variables: { "0012": 3 } });
    runCommands(pageCommands(eventNamed(MAP_NAMES[5], "Bassin de retour")), resetRoot);
    expect(resetRoot.variables.get("0012")).toBe(0);

    const archivesMap = mapNamed(MAP_NAMES[7]);
    const wrongArchive = simulationState({ variables: { "0013": 1 } });
    runCommands(pageCommands(eventNamed(MAP_NAMES[7], "Porte du convoi")), wrongArchive, {
      "Quelle mémoire suit la fondation ?": "Le relevé après l’effondrement",
    });
    expect(wrongArchive.variables.get("0013")).toBe(0);
    expect(wrongArchive.teleports.at(-1)).toMatchObject({
      mapId: archivesMap.id,
      col: 8,
      row: 36,
    });

    const solvedArchive = simulationState();
    runCommands(pageCommands(eventNamed(MAP_NAMES[7], "Porte de fondation")), solvedArchive, {
      "Quelle mémoire vient en premier ?": "Le pacte avant la grande crue",
    });
    runCommands(pageCommands(eventNamed(MAP_NAMES[7], "Porte du convoi")), solvedArchive, {
      "Quelle mémoire suit la fondation ?": "Le passage du neuvième convoi",
    });
    runCommands(pageCommands(eventNamed(MAP_NAMES[7], "Porte des ruines")), solvedArchive, {
      "Quelle mémoire ferme la série ?": "Le relevé actuel des ruines",
    });
    expect(solvedArchive.variables.get("0013")).toBe(3);
    expect(solvedArchive.switches.has("0070")).toBe(true);
    expect(solvedArchive.activities.has("ordre_archives")).toBe(true);
    const resetArchive = simulationState({ variables: { "0013": 3 } });
    runCommands(pageCommands(eventNamed(MAP_NAMES[7], "Bassin d’entrée")), resetArchive);
    expect(resetArchive.variables.get("0013")).toBe(0);

    expect(mapText(rootsMap)).toContain("nommer le bienfait demandé");
    expect(mapText(archivesMap)).toContain("fondation avant la crue");
    expect(
      allCommands().some((command) => command.t === "if" && command.cond.type === "selfSwitch"),
    ).toBe(false);
  });

  it("requires all three consented anchors before the final mechanism opens", () => {
    const state = simulationState();
    runCommands(pageCommands(eventNamed(MAP_NAMES[13], "Ancre du grain")), state, {
      "Quel prix inscrire ?": "Donner les réserves de marche",
    });
    runCommands(pageCommands(eventNamed(MAP_NAMES[13], "Ancre de la garde")), state, {
      "Quel prix inscrire ?": "Limiter le serment à une année",
    });
    runCommands(pageCommands(eventNamed(MAP_NAMES[13], "Ancre du nom")), state, {
      "Quel prix inscrire ?": "Porter les noms comme Liin",
    });
    expect(state.variables.get("0015")).toBe(3);
    expect(state.variables.get("0020")).toBe(3);
    expect([...state.switches].filter((id) => ["0071", "0072", "0073"].includes(id))).toHaveLength(
      3,
    );

    runCommands(pageCommands(eventNamed(MAP_NAMES[13], "Mécanisme originel")), state);
    expect(state.switches.has("0074")).toBe(true);
    expect(state.activities.has("ouvrir_mecanisme")).toBe(true);
    expect(state.teleports.at(-1)?.mapId).toBe(mapNamed(MAP_NAMES[14]).id);

    const incomplete = simulationState({ variables: { "0015": 2 } });
    runCommands(pageCommands(eventNamed(MAP_NAMES[13], "Mécanisme originel")), incomplete);
    expect(incomplete.switches.has("0074")).toBe(false);
    expect(incomplete.teleports).toHaveLength(0);
  });

  it("turns prior alliances into active battle forces and caps scarce reserves at two fronts", () => {
    const battle = mapNamed(MAP_NAMES[12]);
    const guards = battle.events.filter((event) => event.kind === "guard");
    const enemies = battle.events.filter((event) => event.kind === "monster");
    expect(guards).toHaveLength(15);
    expect(enemies).toHaveLength(9);
    expect(
      new Set(
        guards.flatMap((guard) =>
          guard.pages.flatMap((eventPage) =>
            eventPage.condSwitchId ? [eventPage.condSwitchId] : [],
          ),
        ),
      ),
    ).toEqual(new Set(["0027", "0028", "0029", "0030", "0041", "0042", "0043", "0044", "0045"]));
    expect(
      guards.filter((guard) => guard.pages.some((eventPage) => eventPage.condSwitchId === null)),
    ).toHaveLength(1);

    const state = simulationState();
    for (const eventName of ["Capitaine Orve", "Haran", "Sœur Ane"]) {
      runCommands(pageCommands(eventNamed(MAP_NAMES[12], eventName)), state, {
        "Engager les réserves sur ce secteur ?": "Oui, tenir ce secteur",
      });
    }
    expect(state.variables.get("0018")).toBe(2);
    expect(["0046", "0047", "0048"].filter((switchId) => state.switches.has(switchId))).toEqual([
      "0046",
      "0047",
    ]);

    runCommands(pageCommands(eventNamed(MAP_NAMES[12], "Conduit des serviteurs")), state);
    expect(state.switches.has("0049")).toBe(true);
    expect(state.activities.has("passage_serviteurs")).toBe(true);
    expect(state.teleports.at(-1)?.mapId).toBe(mapNamed(MAP_NAMES[13]).id);

    const reports = eventNamed(MAP_NAMES[13], "Tube de commandement");
    expect(
      new Set(
        reports.pages.flatMap((eventPage) =>
          eventPage.condSwitchId ? [eventPage.condSwitchId] : [],
        ),
      ),
    ).toEqual(new Set(["0046", "0047", "0048"]));
  });

  it("makes all six endings reachable from explicit, non-perfect state profiles", () => {
    const finalCommands = pageCommands(eventNamed(MAP_NAMES[14], "Cœur du Pacte"));
    const cases = [
      {
        ending: "0051",
        variables: {
          "0001": 6,
          "0004": 6,
          "0007": 5,
          "0008": 4,
          "0011": 4,
          "0016": 2,
          "0020": 3,
        },
        switches: [] as string[],
        choices: { "Quelle famille de solution choisir ?": "Restaurer le Pacte collectif" },
      },
      {
        ending: "0052",
        variables: { "0007": 3, "0008": 3 },
        switches: [] as string[],
        choices: {
          "Quelle famille de solution choisir ?": "Rompre ou sceller la dépendance",
          "Quelle rupture assumer ?": "Détruire la Couronne maintenant",
        },
      },
      {
        ending: "0053",
        variables: { "0001": 4, "0008": 4, "0015": 3 },
        switches: [] as string[],
        choices: {
          "Quelle famille de solution choisir ?": "Rompre ou sceller la dépendance",
          "Quelle rupture assumer ?": "Sceller la Source et laisser décliner la magie",
        },
      },
      {
        ending: "0054",
        variables: { "0002": 6, "0004": 4, "0008": 5 },
        switches: ["0027"],
        choices: { "Quelle famille de solution choisir ?": "Réformer la Couronne sous contrôle" },
      },
      {
        ending: "0055",
        variables: {},
        switches: [] as string[],
        choices: { "Quelle famille de solution choisir ?": "Accepter la solution de Varos" },
      },
      {
        ending: "0056",
        variables: {},
        switches: [] as string[],
        choices: { "Quelle famille de solution choisir ?": "Restaurer le Pacte collectif" },
      },
    ] as const;

    for (const scenario of cases) {
      const state = simulationState({
        variables: scenario.variables,
        switches: scenario.switches,
      });
      runCommands(finalCommands, state, scenario.choices);
      expect(endingReached(state), scenario.ending).toEqual([scenario.ending]);
      expect(state.switches.has("0079"), scenario.ending).toBe(true);
      expect(state.activities.has("choisir_aube"), scenario.ending).toBe(true);
      expect(state.teleports.at(-1)?.mapId, scenario.ending).toBe(mapNamed(MAP_NAMES[15]).id);
    }

    const endingBook = eventNamed(MAP_NAMES[15], "Livre des Liin");
    for (const endingSwitch of ENDING_SWITCHES) {
      const eventPage = endingBook.pages.find(
        (candidate) => candidate.condSwitchId === endingSwitch,
      );
      expect(eventPage, endingSwitch).toBeDefined();
      if (!eventPage) continue;
      const commands = flattenedCommands(eventPage.commands);
      expect(
        commands.some((command) => command.t === "endAdventure"),
        endingSwitch,
      ).toBe(true);
      expect(
        commands.some(
          (command) => command.t === "setSwitch" && command.switchId === "0057" && command.value,
        ),
        endingSwitch,
      ).toBe(true);
    }
  });

  it("derives liberty, order and memory conclusions from authored decisions", () => {
    const openMechanism = (
      state: SimState,
      prices: {
        grain: string;
        guard: string;
        name: string;
      },
    ): void => {
      runEvent(MAP_NAMES[13], "Ancre du grain", state, {
        "Quel prix inscrire ?": prices.grain,
      });
      runEvent(MAP_NAMES[13], "Ancre de la garde", state, {
        "Quel prix inscrire ?": prices.guard,
      });
      runEvent(MAP_NAMES[13], "Ancre du nom", state, {
        "Quel prix inscrire ?": prices.name,
      });
      runEvent(MAP_NAMES[13], "Mécanisme originel", state);
      expect(state.switches.has("0074")).toBe(true);
    };

    const liberty = simulationState();
    runEvent(MAP_NAMES[0], "Iven", liberty);
    runEvent(MAP_NAMES[0], "Registre fendu", liberty);
    runEvent(
      MAP_NAMES[0],
      "Éclat d’Aube",
      liberty,
      { "Que faire de l’éclat ?": "Refuser le prélèvement" },
      1,
    );
    runEvent(MAP_NAMES[1], "Livre des convois", liberty, {
      "Que faire de la copie vérifiée ?": "La publier au marché",
    });
    runEvent(MAP_NAMES[1], "Vanne des Tisserands", liberty, {
      "Comment sauver la digue ?": "Organiser les ouvriers et évacuer",
    });
    runEvent(MAP_NAMES[2], "Dossier de Varkesh", liberty);
    runEvent(
      MAP_NAMES[2],
      "Porte de Varkesh",
      liberty,
      { "Quel sort réserver à Varkesh ?": "Négocier une trêve limitée" },
      1,
    );
    runEvent(MAP_NAMES[5], "Salle de la demande", liberty, {
      "Quel mot ouvre le Pacte ?": "Le bienfait demandé",
    });
    runEvent(MAP_NAMES[5], "Salle du refus", liberty, {
      "Qui peut refuser le prix ?": "Chaque personne appelée",
    });
    runEvent(MAP_NAMES[5], "Salle des témoins", liberty, {
      "Comment le prix devient-il une dette commune ?": "Il est réparti et rendu public",
    });
    runEvent(
      MAP_NAMES[5],
      "Morvane",
      liberty,
      { "Que faire de Morvane ?": "Le libérer et partager sa charge" },
      1,
    );
    openMechanism(liberty, {
      grain: "Promettre une part des récoltes",
      guard: "Rompre les anciens serments maintenant",
      name: "Rendre les noms aux communautés",
    });
    expect(liberty.variables.get("0003") ?? 0).toBeGreaterThanOrEqual(6);
    runEvent(MAP_NAMES[14], "Cœur du Pacte", liberty, {
      "Quelle famille de solution choisir ?": "Rompre ou sceller la dépendance",
      "Quelle rupture assumer ?": "Détruire la Couronne maintenant",
    });
    expect(endingReached(liberty)).toEqual(["0052"]);

    const order = simulationState();
    runEvent(MAP_NAMES[0], "Iven", order);
    runEvent(MAP_NAMES[0], "Registre fendu", order);
    runEvent(
      MAP_NAMES[0],
      "Éclat d’Aube",
      order,
      { "Que faire de l’éclat ?": "Le toucher malgré le risque" },
      1,
    );
    runEvent(MAP_NAMES[1], "Livre des convois", order, {
      "Que faire de la copie vérifiée ?": "La confier à Lyra",
    });
    runEvent(MAP_NAMES[1], "Vanne des Tisserands", order, {
      "Comment sauver la digue ?": "Accepter le prix proposé par la Source",
    });
    runEvent(MAP_NAMES[2], "Dossier de Varkesh", order);
    runEvent(
      MAP_NAMES[2],
      "Porte de Varkesh",
      order,
      { "Quel sort réserver à Varkesh ?": "Le vaincre et le capturer" },
      1,
    );
    runEvent(MAP_NAMES[2], "Varkesh", order);
    runEvent(MAP_NAMES[4], "Assemblée de Clairécorce", order, {
      "Quel clan aider d’abord ?": "La Sève et ses arbres nourriciers",
    });
    runEvent(MAP_NAMES[5], "Salle de la demande", order, {
      "Quel mot ouvre le Pacte ?": "Le bienfait demandé",
    });
    runEvent(MAP_NAMES[5], "Salle du refus", order, {
      "Qui peut refuser le prix ?": "Chaque personne appelée",
    });
    runEvent(MAP_NAMES[5], "Salle des témoins", order, {
      "Comment le prix devient-il une dette commune ?": "Il est réparti et rendu public",
    });
    runEvent(
      MAP_NAMES[5],
      "Morvane",
      order,
      { "Que faire de Morvane ?": "L’apaiser sans rompre tous les liens" },
      1,
    );
    runEvent(MAP_NAMES[9], "Table de commandement", order, {
      "Qui contrôlera la Citadelle ?": "Lyra et un commandement réformateur",
    });
    openMechanism(order, {
      grain: "Donner les réserves de marche",
      guard: "Limiter le serment à une année",
      name: "Rendre les noms aux communautés",
    });
    expect(order.variables.get("0002") ?? 0).toBeGreaterThanOrEqual(6);
    expect(order.variables.get("0004") ?? 0).toBeGreaterThanOrEqual(4);
    expect(order.variables.get("0008") ?? 0).toBeGreaterThanOrEqual(5);
    runEvent(MAP_NAMES[14], "Cœur du Pacte", order, {
      "Quelle famille de solution choisir ?": "Réformer la Couronne sous contrôle",
    });
    expect(endingReached(order)).toEqual(["0054"]);

    const memory = simulationState();
    runEvent(MAP_NAMES[0], "Iven", memory);
    runEvent(MAP_NAMES[0], "Registre fendu", memory);
    runEvent(
      MAP_NAMES[0],
      "Éclat d’Aube",
      memory,
      { "Que faire de l’éclat ?": "Le toucher malgré le risque" },
      1,
    );
    runEvent(MAP_NAMES[1], "Livre des convois", memory, {
      "Que faire de la copie vérifiée ?": "La publier au marché",
    });
    runEvent(MAP_NAMES[4], "Écorce de l’hiver", memory);
    runEvent(MAP_NAMES[4], "Assemblée de Clairécorce", memory, {
      "Quel clan aider d’abord ?": "La Sève et ses arbres nourriciers",
    });
    runEvent(MAP_NAMES[6], "Digue des Saules", memory, {
      "Quelle réparation engager ?": "Fermer immédiatement la vanne royale",
    });
    runEvent(MAP_NAMES[7], "Porte de fondation", memory, {
      "Quelle mémoire vient en premier ?": "Le pacte avant la grande crue",
    });
    runEvent(MAP_NAMES[7], "Porte du convoi", memory, {
      "Quelle mémoire suit la fondation ?": "Le passage du neuvième convoi",
    });
    runEvent(MAP_NAMES[7], "Porte des ruines", memory, {
      "Quelle mémoire ferme la série ?": "Le relevé actuel des ruines",
    });
    openMechanism(memory, {
      grain: "Donner les réserves de marche",
      guard: "Limiter le serment à une année",
      name: "Porter les noms comme Liin",
    });
    expect(memory.variables.get("0001") ?? 0).toBeGreaterThanOrEqual(4);
    expect(memory.variables.get("0008") ?? 0).toBeGreaterThanOrEqual(4);
    runEvent(MAP_NAMES[14], "Cœur du Pacte", memory, {
      "Quelle famille de solution choisir ?": "Rompre ou sceller la dépendance",
      "Quelle rupture assumer ?": "Sceller la Source et laisser décliner la magie",
    });
    expect(endingReached(memory)).toEqual(["0053"]);
  });

  it("reaches the restored Pact through one complete high-cooperation authored route", () => {
    const state = simulationState();

    runEvent(MAP_NAMES[0], "Iven", state);
    runEvent(MAP_NAMES[0], "Registre fendu", state);
    runEvent(
      MAP_NAMES[0],
      "Éclat d’Aube",
      state,
      { "Que faire de l’éclat ?": "Refuser le prélèvement" },
      1,
    );

    runEvent(MAP_NAMES[1], "Livre des convois", state, {
      "Que faire de la copie vérifiée ?": "La confier à Lyra",
    });
    runEvent(MAP_NAMES[1], "Vanne des Tisserands", state, {
      "Comment sauver la digue ?": "Organiser les ouvriers et évacuer",
    });
    runEvent(MAP_NAMES[1], "Plan des maisons saisies", state);
    runEvent(MAP_NAMES[1], "Courrier de Varos", state, {
      "Répondre au courrier ?": "Exiger le registre du prix",
    });

    runEvent(MAP_NAMES[2], "Cour des chariots", state);
    runEvent(MAP_NAMES[2], "Maison du Four", state, {
      "Comment évacuer la rue ?": "Ouvrir la brèche malgré le risque",
    });
    runEvent(MAP_NAMES[2], "Dossier de Varkesh", state);
    runEvent(
      MAP_NAMES[2],
      "Porte de Varkesh",
      state,
      { "Quel sort réserver à Varkesh ?": "Négocier une trêve limitée" },
      1,
    );
    runEvent(MAP_NAMES[2], "Trois portes murées", state);

    for (const table of [
      "Table du grain",
      "Table du passage",
      "Table des noms",
      "Table de la veille",
    ]) {
      runEvent(MAP_NAMES[3], table, state);
    }

    runEvent(MAP_NAMES[4], "Assemblée de Clairécorce", state, {
      "Quel clan aider d’abord ?": "L’Écorce et ses routes",
    });
    runEvent(MAP_NAMES[4], "Écorce de l’hiver", state);
    runEvent(MAP_NAMES[4], "Arbres marqués", state);

    runEvent(MAP_NAMES[5], "Salle de la demande", state, {
      "Quel mot ouvre le Pacte ?": "Le bienfait demandé",
    });
    runEvent(MAP_NAMES[5], "Salle du refus", state, {
      "Qui peut refuser le prix ?": "Chaque personne appelée",
    });
    runEvent(MAP_NAMES[5], "Salle des témoins", state, {
      "Comment le prix devient-il une dette commune ?": "Il est réparti et rendu public",
    });
    runEvent(
      MAP_NAMES[5],
      "Morvane",
      state,
      { "Que faire de Morvane ?": "Le libérer et partager sa charge" },
      1,
    );

    runEvent(MAP_NAMES[6], "Digue des Saules", state, {
      "Quelle réparation engager ?": "Répartir les équipes sur les deux rives",
    });
    runEvent(MAP_NAMES[6], "Mila", state);
    for (const memory of ["Mémoire du semeur", "Mémoire du garde", "Mémoire sans nom"]) {
      runEvent(MAP_NAMES[6], memory, state);
    }
    runEvent(MAP_NAMES[6], "Reflet de Nhalgor", state);

    runEvent(MAP_NAMES[7], "Porte de fondation", state, {
      "Quelle mémoire vient en premier ?": "Le pacte avant la grande crue",
    });
    runEvent(MAP_NAMES[7], "Porte du convoi", state, {
      "Quelle mémoire suit la fondation ?": "Le passage du neuvième convoi",
    });
    runEvent(MAP_NAMES[7], "Porte des ruines", state, {
      "Quelle mémoire ferme la série ?": "Le relevé actuel des ruines",
    });
    runEvent(
      MAP_NAMES[7],
      "Nhalgor",
      state,
      { "Quel sort pour les Archives ?": "Préserver les mémoires avec Nhalgor" },
      1,
    );
    runEvent(
      MAP_NAMES[7],
      "Talen",
      state,
      { "Que demander à Talen ?": "Qu’il répare les registres sous contrôle" },
      1,
    );

    runEvent(
      MAP_NAMES[8],
      "Serah",
      state,
      { "Quelle ligne Serah doit-elle tenir ?": "Justice, preuves et prisonniers" },
      3,
    );
    runEvent(MAP_NAMES[8], "Grille des conscrits", state, {
      "Que faire des conscrits ?": "Les libérer et leur laisser le choix",
    });
    runEvent(MAP_NAMES[8], "Dépôt inquisitorial", state);
    runEvent(MAP_NAMES[8], "Sac postal militaire", state);
    runEvent(MAP_NAMES[8], "Poterne des digues", state);

    runEvent(MAP_NAMES[9], "Table de commandement", state, {
      "Qui contrôlera la Citadelle ?": "Maëlys et les communes",
    });
    runEvent(MAP_NAMES[9], "Cour des anciens morts", state, {
      "Que faire de la garde morte ?": "Rompre leur serment",
    });
    runEvent(MAP_NAMES[9], "Bureau des courriers", state);

    runEvent(MAP_NAMES[10], "Conduit des prélèvements", state);
    runEvent(MAP_NAMES[10], "Jardins nourriciers", state, {
      "Que faire des jardins ?": "Réduire le canal et organiser les réserves",
    });
    runEvent(MAP_NAMES[10], "Bibliothèques jumelles", state);
    runEvent(
      MAP_NAMES[10],
      "Varos",
      state,
      { "Accepter la trêve logistique ?": "Refuser et préparer nos propres relais" },
      1,
    );

    for (const fragment of ["Eryndor — année 0", "Eryndor — année 9", "Eryndor — année 14"]) {
      runEvent(MAP_NAMES[11], fragment, state);
    }
    runEvent(MAP_NAMES[11], "Le neuvième chariot", state);
    runEvent(MAP_NAMES[11], "Mémoire d’Eryndor", state, {}, 1);

    for (const front of ["Capitaine Orve", "Haran"]) {
      runEvent(MAP_NAMES[12], front, state, {
        "Engager les réserves sur ce secteur ?": "Oui, tenir ce secteur",
      });
    }
    runEvent(MAP_NAMES[12], "Conduit des serviteurs", state);

    runEvent(MAP_NAMES[13], "Ancre du grain", state, {
      "Quel prix inscrire ?": "Promettre une part des récoltes",
    });
    runEvent(MAP_NAMES[13], "Ancre de la garde", state, {
      "Quel prix inscrire ?": "Limiter le serment à une année",
    });
    runEvent(MAP_NAMES[13], "Ancre du nom", state, {
      "Quel prix inscrire ?": "Porter les noms comme Liin",
    });
    runEvent(MAP_NAMES[13], "Mécanisme originel", state);

    for (const [variableId, minimum] of Object.entries({
      "0001": 6,
      "0004": 6,
      "0007": 5,
      "0008": 4,
      "0011": 4,
      "0016": 2,
    })) {
      expect(state.variables.get(variableId) ?? 0, variableId).toBeGreaterThanOrEqual(minimum);
    }
    expect(state.variables.get("0015")).toBe(3);
    expect(state.variables.get("0018")).toBe(2);
    expect(state.switches.has("0074")).toBe(true);

    runEvent(MAP_NAMES[14], "Cœur du Pacte", state, {
      "Quelle famille de solution choisir ?": "Restaurer le Pacte collectif",
    });
    expect(endingReached(state)).toEqual(["0051"]);
    expect(state.teleports.at(-1)?.mapId).toBe(mapNamed(MAP_NAMES[15]).id);
    expect(completedQuestsFor(state.questEvents)).toEqual(
      new Set([...MAIN_QUEST_IDS, ...SIDE_QUEST_IDS]),
    );
  });

  it("keeps a low-preparation main route completable and lets it cause the New Eclipse", () => {
    const state = simulationState();

    runEvent(MAP_NAMES[0], "Iven", state);
    runEvent(MAP_NAMES[0], "Registre fendu", state);
    runEvent(
      MAP_NAMES[0],
      "Éclat d’Aube",
      state,
      { "Que faire de l’éclat ?": "Le toucher malgré le risque" },
      1,
    );

    runEvent(MAP_NAMES[1], "Livre des convois", state, {
      "Que faire de la copie vérifiée ?": "La publier au marché",
    });
    runEvent(MAP_NAMES[2], "Dossier de Varkesh", state);
    runEvent(
      MAP_NAMES[2],
      "Porte de Varkesh",
      state,
      { "Quel sort réserver à Varkesh ?": "L’affronter pour l’exécuter" },
      1,
    );
    runEvent(MAP_NAMES[2], "Varkesh", state);

    runEvent(MAP_NAMES[4], "Assemblée de Clairécorce", state, {
      "Quel clan aider d’abord ?": "La Sève et ses arbres nourriciers",
    });
    runEvent(MAP_NAMES[5], "Salle de la demande", state, {
      "Quel mot ouvre le Pacte ?": "Le bienfait demandé",
    });
    runEvent(MAP_NAMES[5], "Salle du refus", state, {
      "Qui peut refuser le prix ?": "Chaque personne appelée",
    });
    runEvent(MAP_NAMES[5], "Salle des témoins", state, {
      "Comment le prix devient-il une dette commune ?": "Il est réparti et rendu public",
    });
    runEvent(
      MAP_NAMES[5],
      "Morvane",
      state,
      { "Que faire de Morvane ?": "Le tuer pour arrêter les prélèvements" },
      1,
    );
    runEvent(MAP_NAMES[5], "Morvane déchaîné", state);

    runEvent(MAP_NAMES[6], "Reflet de Nhalgor", state);
    runEvent(MAP_NAMES[7], "Porte de fondation", state, {
      "Quelle mémoire vient en premier ?": "Le pacte avant la grande crue",
    });
    runEvent(MAP_NAMES[7], "Porte du convoi", state, {
      "Quelle mémoire suit la fondation ?": "Le passage du neuvième convoi",
    });
    runEvent(MAP_NAMES[7], "Porte des ruines", state, {
      "Quelle mémoire ferme la série ?": "Le relevé actuel des ruines",
    });
    runEvent(
      MAP_NAMES[7],
      "Nhalgor",
      state,
      { "Quel sort pour les Archives ?": "Brûler ce que Varos pourrait saisir" },
      1,
    );
    runEvent(
      MAP_NAMES[7],
      "Talen",
      state,
      { "Que demander à Talen ?": "Un procès public immédiat" },
      2,
    );

    runEvent(
      MAP_NAMES[8],
      "Serah",
      state,
      { "Quelle ligne Serah doit-elle tenir ?": "Vengeance avant la contre-attaque" },
      1,
    );
    runEvent(MAP_NAMES[9], "Table de commandement", state, {
      "Qui contrôlera la Citadelle ?": "Maintenir le Conseil technique",
    });

    runEvent(MAP_NAMES[10], "Conduit des prélèvements", state);
    runEvent(
      MAP_NAMES[10],
      "Varos",
      state,
      { "Accepter la trêve logistique ?": "Refuser et préparer nos propres relais" },
      1,
    );
    for (const fragment of ["Eryndor — année 0", "Eryndor — année 9", "Eryndor — année 14"]) {
      runEvent(MAP_NAMES[11], fragment, state);
    }
    runEvent(MAP_NAMES[11], "Mémoire d’Eryndor", state, {}, 1);

    runEvent(MAP_NAMES[12], "Capitaine Orve", state, {
      "Engager les réserves sur ce secteur ?": "Oui, tenir ce secteur",
    });
    runEvent(MAP_NAMES[12], "Conduit des serviteurs", state);
    runEvent(MAP_NAMES[13], "Ancre du grain", state, {
      "Quel prix inscrire ?": "Donner les réserves de marche",
    });
    runEvent(MAP_NAMES[13], "Ancre de la garde", state, {
      "Quel prix inscrire ?": "Rompre les anciens serments maintenant",
    });
    runEvent(MAP_NAMES[13], "Ancre du nom", state, {
      "Quel prix inscrire ?": "Rendre les noms aux communautés",
    });
    runEvent(MAP_NAMES[13], "Mécanisme originel", state);
    runEvent(MAP_NAMES[14], "Cœur du Pacte", state, {
      "Quelle famille de solution choisir ?": "Restaurer le Pacte collectif",
    });

    expect(endingReached(state)).toEqual(["0056"]);
    const completed = completedQuestsFor(state.questEvents);
    expect(MAIN_QUEST_IDS.every((questId) => completed.has(questId))).toBe(true);
    expect(SIDE_QUEST_IDS.filter((questId) => completed.has(questId)).length).toBeLessThan(6);
    expect(state.variables.get("0007") ?? 0).toBeLessThan(5);
    expect(state.teleports.at(-1)?.mapId).toBe(mapNamed(MAP_NAMES[15]).id);
  });

  it("paces revelations, keeps Varos active and preserves distinct character knowledge", () => {
    const varosMaps = BUNDLE.maps.filter((map) =>
      map.events.some((event) => event.name.toLocaleLowerCase("fr").includes("varos")),
    );
    expect(varosMaps.length).toBeGreaterThanOrEqual(12);
    expect(varosMaps[0]?.name).toBe(MAP_NAMES[0]);
    expect(varosMaps.at(-1)?.name).toBe(MAP_NAMES[14]);

    const fullText = BUNDLE.maps.map(mapText).join("\n").toLocaleLowerCase("fr");
    for (const forbidden of [
      "l’histoire fait mal",
      "le royaume mange ses propres ombres",
      "les pierres se souviennent de ce que les hommes oublient",
    ]) {
      expect(fullText).not.toContain(forbidden);
    }
    for (const character of ["Lyra", "Varkesh", "Serah", "Elyne", "Talen", "Maëlys", "Eryndor"]) {
      expect(fullText, character).toContain(character.toLocaleLowerCase("fr"));
    }

    expect(mapText(mapNamed(MAP_NAMES[0]))).toContain("vos noms ne figurent nulle part");
    expect(mapText(mapNamed(MAP_NAMES[2]))).toContain("les convois");
    expect(mapText(mapNamed(MAP_NAMES[5]))).toContain("consentement");
    expect(mapText(mapNamed(MAP_NAMES[7]))).toContain("neuf noms par six numéros");
    expect(mapText(mapNamed(MAP_NAMES[11]))).toContain("Liin signifie le témoin vivant");
    expect(mapText(mapNamed(MAP_NAMES[14]))).toContain("crime durable");

    const sayCommands = allCommands().filter(
      (command): command is Extract<EventCommand, { t: "say" }> => command.t === "say",
    );
    expect(sayCommands.length).toBeGreaterThanOrEqual(300);
    expect(Math.max(...sayCommands.map((command) => command.text.length))).toBeLessThanOrEqual(
      COMMAND_TEXT_MAX,
    );
    const duplicateCounts = new Map<string, number>();
    for (const command of sayCommands) {
      duplicateCounts.set(command.text, (duplicateCounts.get(command.text) ?? 0) + 1);
    }
    expect(Math.max(...duplicateCounts.values())).toBeLessThanOrEqual(12);

    const epilogueVariableConditions = new Set(
      mapNamed(MAP_NAMES[15]).events.flatMap((event) =>
        event.pages.flatMap((eventPage) =>
          eventPage.condVariableId ? [eventPage.condVariableId] : [],
        ),
      ),
    );
    for (const variableId of ["0010", "0011", "0016", "0017", "0019"]) {
      expect(epilogueVariableConditions.has(variableId), variableId).toBe(true);
    }

    const lyraEpilogue = eventNamed(MAP_NAMES[15], "Lyra");
    expect(new Set(lyraEpilogue.pages.map((eventPage) => eventPage.condSwitchId))).toEqual(
      new Set(["0027", "0028", "0029", "0030", "0054"]),
    );
    expect(
      lyraEpilogue.pages.some(
        (eventPage) =>
          eventPage.condSwitchId === "0027" &&
          eventPage.condVariableId === "0006" &&
          eventPage.condVariableMin === 4,
      ),
    ).toBe(true);

    const serahEpilogue = eventNamed(MAP_NAMES[15], "Serah");
    expect(new Set(serahEpilogue.pages.map((eventPage) => eventPage.condSwitchId))).toEqual(
      new Set(["0031", "0032", "0055"]),
    );
  });

  it("uses only solo-safe authored mechanics while supporting parties up to four", () => {
    expect(BUNDLE.adventure.maxPlayers).toBe(4);
    const commands = allCommands();
    expect(commands.some((command) => command.t === "loop")).toBe(false);
    expect(
      BUNDLE.maps.flatMap((map) =>
        map.events.flatMap((event) =>
          event.pages.filter((eventPage) =>
            ["auto", "parallel", "event-touch"].includes(eventPage.trigger),
          ),
        ),
      ),
    ).toHaveLength(0);

    const essentialPuzzleEvents = [
      eventNamed(MAP_NAMES[5], "Salle de la demande"),
      eventNamed(MAP_NAMES[5], "Salle du refus"),
      eventNamed(MAP_NAMES[5], "Salle des témoins"),
      eventNamed(MAP_NAMES[7], "Porte de fondation"),
      eventNamed(MAP_NAMES[7], "Porte du convoi"),
      eventNamed(MAP_NAMES[7], "Porte des ruines"),
      eventNamed(MAP_NAMES[13], "Ancre du grain"),
      eventNamed(MAP_NAMES[13], "Ancre de la garde"),
      eventNamed(MAP_NAMES[13], "Ancre du nom"),
    ];
    for (const event of essentialPuzzleEvents) {
      const opcodes = new Set(
        event.pages.flatMap((eventPage) =>
          flattenedCommands(eventPage.commands).map((command) => command.t),
        ),
      );
      expect(opcodes.has("changeItems"), event.name).toBe(false);
      expect(opcodes.has("advanceQuest"), event.name).toBe(false);
      expect(opcodes.has("wait"), event.name).toBe(false);
    }
  });
});
