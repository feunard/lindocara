import { writeFileSync } from "node:fs";
import {
  ADVENTURE_BUNDLE_FORMAT,
  ADVENTURE_BUNDLE_VERSION,
  type AdventureBundle,
  parseAdventureBundle,
} from "@lindocara/engine/adventure-bundle.js";
import { parseAdventureRegistry } from "@lindocara/engine/adventure-state.js";
import { colliderIndexFrom } from "@lindocara/engine/collider.js";
import type { EventCommand } from "@lindocara/engine/event-commands.js";
import { isWalkable, type TerrainGeometry } from "@lindocara/engine/game.js";
import {
  bakeCollision,
  elementColliders,
  elementCoversCell,
  elementFitsMap,
  parseMapData,
} from "@lindocara/engine/map-data.js";
import { type MapEvent, parseMapEvents } from "@lindocara/engine/map-events.js";
import { collectQuestCommandBindings, validateAuthoredQuests } from "@lindocara/engine/quests.js";
import { PLAYER_SIZE } from "@lindocara/engine/simulation.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { MAP_IDS, type StoryRefs, SWITCHES, VARIABLES } from "./campaign.js";
import { buildMaps } from "./maps.js";
import { buildQuests } from "./quests.js";

const OUTPUT = new URL("../../adventures/liin-adventure-ia.json", import.meta.url);

function visitCommands(
  commands: readonly EventCommand[],
  visit: (command: EventCommand) => void,
): void {
  for (const command of commands) {
    visit(command);
    if (command.t === "if") {
      visitCommands(command.then, visit);
      visitCommands(command.else, visit);
    } else if (command.t === "loop") {
      visitCommands(command.body, visit);
    } else if (command.t === "choices") {
      for (const option of command.options) visitCommands(option.body, visit);
    }
  }
}

function mapGeometry(map: AdventureBundle["maps"][number]): TerrainGeometry {
  const data = parseMapData(map);
  if (!data) throw new Error(`invalid map data: ${map.name}`);
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
  map: AdventureBundle["maps"][number],
  geometry: TerrainGeometry,
  starts: readonly { col: number; row: number }[],
): Set<string> {
  const key = (col: number, row: number) => `${col},${row}`;
  const seen = new Set<string>();
  const queue: { col: number; row: number }[] = [];
  for (const start of starts) {
    if (!walkable(geometry, start.col, start.row)) {
      throw new Error(`${map.name}: arrival ${start.col},${start.row} is not walkable`);
    }
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
      const next = key(col, row);
      if (
        col < 0 ||
        row < 0 ||
        col >= map.cols ||
        row >= map.rows ||
        seen.has(next) ||
        !walkable(geometry, col, row)
      ) {
        continue;
      }
      seen.add(next);
      queue.push({ col, row });
    }
  }
  return seen;
}

function validateMaps(bundle: AdventureBundle): void {
  const terrainHashes = new Set<string>();
  const mapsById = new Map(bundle.maps.map((map) => [map.id, map]));
  const geometries = new Map(bundle.maps.map((map) => [map.id, mapGeometry(map)]));
  const arrivalsByMap = new Map<string, { col: number; row: number }[]>();
  for (const map of bundle.maps) arrivalsByMap.set(map.id, [{ ...map.spawn }]);
  for (const map of bundle.maps) {
    for (const event of map.events) {
      for (const eventPage of event.pages) {
        visitCommands(eventPage.commands, (command) => {
          if (command.t !== "teleport") return;
          const arrivals = arrivalsByMap.get(command.mapId);
          if (arrivals) arrivals.push({ col: command.col, row: command.row });
        });
      }
    }
  }
  const teleportEdges = new Map<string, Set<string>>();
  for (const map of bundle.maps) {
    const parsed = parseMapData(map);
    if (!parsed) throw new Error(`${map.name}: map payload is invalid`);
    if (!parseMapEvents(map.events, map.cols, map.rows)) {
      throw new Error(`${map.name}: event payload is invalid`);
    }
    const terrainHash = map.layers.join("|");
    if (terrainHashes.has(terrainHash))
      throw new Error(`${map.name}: terrain duplicates another map`);
    terrainHashes.add(terrainHash);
    const slots = new Set<string>();
    for (const candidate of map.elements) {
      if (!elementFitsMap(candidate, map.cols, map.rows)) {
        throw new Error(`${map.name}: element exceeds bounds (${candidate.assetId})`);
      }
      if (elementCoversCell(candidate, map.spawn.col, map.spawn.row)) {
        throw new Error(`${map.name}: element covers the spawn (${candidate.assetId})`);
      }
      const slot = `${candidate.col}:${candidate.row}:${candidate.offsetX}:${candidate.offsetY}`;
      if (slots.has(slot)) throw new Error(`${map.name}: duplicate element slot ${slot}`);
      slots.add(slot);
    }
    const geometry = geometries.get(map.id);
    if (!geometry) throw new Error(`${map.name}: missing geometry`);
    const reachable = reachableCells(map, geometry, arrivalsByMap.get(map.id) ?? [map.spawn]);
    for (const event of map.events) {
      if (!reachable.has(`${event.col},${event.row}`)) {
        throw new Error(
          `${map.name}: unreachable event ${event.name} at ${event.col},${event.row}`,
        );
      }
      for (const eventPage of event.pages) {
        if (
          eventPage.trigger === "auto" ||
          eventPage.trigger === "parallel" ||
          eventPage.trigger === "event-touch"
        ) {
          throw new Error(`${map.name}: unsupported autonomous trigger on ${event.name}`);
        }
        visitCommands(eventPage.commands, (command) => {
          if (command.t !== "teleport") return;
          const destination = mapsById.get(command.mapId);
          const destinationGeometry = geometries.get(command.mapId);
          if (!destination || !destinationGeometry) {
            throw new Error(`${map.name}/${event.name}: teleport targets a missing map`);
          }
          if (
            command.col < 0 ||
            command.row < 0 ||
            command.col >= destination.cols ||
            command.row >= destination.rows ||
            !walkable(destinationGeometry, command.col, command.row)
          ) {
            throw new Error(
              `${map.name}/${event.name}: teleport targets an unsafe cell ${destination.name} ${command.col},${command.row}`,
            );
          }
          const touchLoop = destination.events.some(
            (candidate) =>
              candidate.pages.some((candidatePage) => candidatePage.trigger === "player-touch") &&
              Math.abs(candidate.col - command.col) + Math.abs(candidate.row - command.row) <= 1,
          );
          if (touchLoop) {
            throw new Error(`${map.name}/${event.name}: teleport arrives in a player-touch loop`);
          }
          const edges = teleportEdges.get(map.id) ?? new Set<string>();
          edges.add(destination.id);
          teleportEdges.set(map.id, edges);
        });
      }
    }
    if (reachable.size < Math.floor(map.cols * map.rows * 0.45)) {
      throw new Error(`${map.name}: less than 45% of the field is traversable`);
    }
  }

  const reached = new Set<string>([MAP_IDS.prologue]);
  const queue = [MAP_IDS.prologue];
  for (let head = 0; head < queue.length; head += 1) {
    const source = queue[head];
    if (!source) continue;
    for (const destination of teleportEdges.get(source) ?? []) {
      if (reached.has(destination)) continue;
      reached.add(destination);
      queue.push(destination);
    }
  }
  const missing = bundle.maps.filter((map) => !reached.has(map.id)).map((map) => map.name);
  if (missing.length > 0)
    throw new Error(`maps unreachable through authored teleports: ${missing.join(", ")}`);
}

function validateStateReferences(bundle: AdventureBundle): void {
  const switchIds = new Set(bundle.adventure.registry.switches.map((entry) => entry.id));
  const variableIds = new Set(bundle.adventure.registry.variables.map((entry) => entry.id));
  for (const map of bundle.maps) {
    for (const event of map.events) {
      for (const eventPage of event.pages) {
        if (eventPage.condSwitchId && !switchIds.has(eventPage.condSwitchId)) {
          throw new Error(
            `${map.name}/${event.name}: unknown page switch ${eventPage.condSwitchId}`,
          );
        }
        if (eventPage.condVariableId && !variableIds.has(eventPage.condVariableId)) {
          throw new Error(
            `${map.name}/${event.name}: unknown page variable ${eventPage.condVariableId}`,
          );
        }
        visitCommands(eventPage.commands, (command) => {
          const commandSwitchId =
            command.t === "setSwitch"
              ? command.switchId
              : command.t === "if" && command.cond.type === "switch"
                ? command.cond.switchId
                : null;
          if (commandSwitchId !== null && !switchIds.has(commandSwitchId)) {
            throw new Error(`${map.name}/${event.name}: unknown command switch`);
          }
          const commandVariableId =
            command.t === "setVariable"
              ? command.variableId
              : command.t === "if" && command.cond.type === "variable"
                ? command.cond.variableId
                : null;
          if (commandVariableId !== null && !variableIds.has(commandVariableId)) {
            throw new Error(`${map.name}/${event.name}: unknown command variable`);
          }
        });
      }
    }
  }
}

function questContext(bundle: AdventureBundle) {
  const eventIdsByMap = new Map<string, ReadonlySet<string>>();
  const monsterSpeciesByMap = new Map<string, ReadonlySet<MapEvent["species"] & string>>();
  const monsterEventIdsByMap = new Map<string, ReadonlySet<string>>();
  const activityIds = new Set<string>();
  const offeredQuestIds = new Set<string>();
  const turnInQuestIds = new Set<string>();
  for (const map of bundle.maps) {
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
        collectQuestCommandBindings(
          eventPage.commands,
          offeredQuestIds,
          turnInQuestIds,
          activityIds,
        );
      }
    }
  }
  return {
    mapIds: new Set(bundle.maps.map((map) => map.id)),
    eventIdsByMap,
    monsterSpeciesByMap,
    monsterEventIdsByMap,
    activityIds,
    switchIds: new Set(bundle.adventure.registry.switches.map((entry) => entry.id)),
    variableIds: new Set(bundle.adventure.registry.variables.map((entry) => entry.id)),
    offeredQuestIds,
    turnInQuestIds,
  };
}

const refs: StoryRefs = {};
const maps = buildMaps(refs);
const quests = buildQuests(refs);
const bundle: AdventureBundle = {
  format: ADVENTURE_BUNDLE_FORMAT,
  version: ADVENTURE_BUNDLE_VERSION,
  adventure: {
    title: "Liin — Les Dettes de l’Aube",
    maxPlayers: 4,
    registry: {
      switches: SWITCHES,
      variables: VARIABLES,
      quests,
    },
  },
  maps,
  // Modern authored travel uses explicit, conditional teleports. The spawn event derives the start;
  // no unconditional exit graph is needed or allowed to bypass a story gate.
  graph: { start: null, links: [] },
};

if (!parseAdventureRegistry(bundle.adventure.registry)) {
  throw new Error("generated Liin registry is invalid");
}
const parsed = parseAdventureBundle(bundle);
if (!parsed) throw new Error("generated Liin bundle envelope is invalid");
validateMaps(parsed);
validateStateReferences(parsed);
const questDiagnostics = validateAuthoredQuests(quests, questContext(parsed));
const questErrors = questDiagnostics.filter((diagnostic) => diagnostic.severity === "error");
if (questErrors.length > 0) {
  throw new Error(`generated Liin quests are invalid:\n${JSON.stringify(questErrors, null, 2)}`);
}

const endingSwitches = new Set(
  parsed.maps.flatMap((map) =>
    map.events.flatMap((event) =>
      event.pages.flatMap((eventPage) => {
        const values: string[] = [];
        visitCommands(eventPage.commands, (command) => {
          if (
            command.t === "setSwitch" &&
            ["0051", "0052", "0053", "0054", "0055", "0056"].includes(command.switchId)
          ) {
            values.push(command.switchId);
          }
        });
        return values;
      }),
    ),
  ),
);
if (endingSwitches.size !== 6) throw new Error("all six campaign endings must be authored");

writeFileSync(OUTPUT, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
console.log(
  `built ${parsed.adventure.title}: ${parsed.maps.length} maps, ${quests.length} quests, ${parsed.maps.reduce((count, map) => count + map.events.length, 0)} events`,
);
