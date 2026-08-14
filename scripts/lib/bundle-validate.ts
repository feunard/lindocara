/**
 * Offline validation of a whole authored adventure bundle, shared by every builder script.
 *
 * Everything here answers one question the server would otherwise answer only after a network round
 * trip and a half-written adventure: **is this bundle playable?** It bakes collision exactly the way
 * the runtime does (`bakeCollision` + `elementColliders` through `isWalkable`), floods the walkable
 * field from every arrival a hero can actually reach, and refuses anything a player could get stuck
 * on — an event behind a cliff, a teleport landing in the sea, a map no authored teleport reaches.
 *
 * It is deliberately stricter than the server: the server accepts an unreachable event, a build
 * script should not. Extracted from the Liin builder so a second adventure inherits the same
 * guarantees instead of a second, weaker copy of them.
 */
import type { AdventureBundle, AdventureBundleMap } from "@lindocara/engine/adventure-bundle.js";
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
import { collectQuestCommandBindings } from "@lindocara/engine/quests.js";
import { PLAYER_SIZE } from "@lindocara/engine/simulation.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";

/** Walk an authored program, branches and loop bodies included. */
export function visitCommands(
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

export function mapGeometry(map: AdventureBundleMap): TerrainGeometry {
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

export function walkableCell(geometry: TerrainGeometry, col: number, row: number): boolean {
  return isWalkable(
    { x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 },
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
    if (!walkableCell(geometry, start.col, start.row)) {
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
        !walkableCell(geometry, col, row)
      ) {
        continue;
      }
      seen.add(next);
      queue.push({ col, row });
    }
  }
  return seen;
}

export interface BundleValidationOptions {
  /** The map a party starts on. Defaults to the bundle's own `adventure.startMapId`, like the server. */
  startMapId?: string;
  /**
   * Least share of a map's TOTAL cells a hero must be able to walk. A blunt density floor: it
   * catches a map that came out mostly solid. An archipelago is legitimately mostly sea, so an
   * island adventure lowers it — the connectivity check below is what actually protects it.
   */
  minTraversableRatio?: number;
  /**
   * Least share of a map's WALKABLE cells the flood must reach. This is the check that matters:
   * ground a hero can stand on but never walk to — an island lobe with no bridge, a terrace whose
   * stair failed to stamp, a courtyard sealed by a building collider — is invisible to a density
   * floor and ruins a map. Below 1 only to tolerate a deliberate decorative islet.
   */
  minConnectedRatio?: number;
  /**
   * Nombre absolu de cases coupées toléré, en plus de ce que `minConnectedRatio` autorise. Un
   * bosquet dense laisse parfois un recoin d'une case derrière un tronc : c'est du bruit, pas un
   * défaut de carte. La tolérance retenue est la PLUS GÉNÉREUSE des deux, ce qui permet d'exiger
   * une connexité parfaite (`minConnectedRatio: 1`) tout en acceptant quelques culs-de-sac.
   */
  maxCutOffCells?: number;
}

/**
 * Geometry, placement and travel. Throws on the first defect with the map and event that carries it —
 * a build script's job is to fail loudly before anything reaches D1, not to collect warnings.
 */
export function validateBundleMaps(
  bundle: AdventureBundle,
  options: BundleValidationOptions = {},
): void {
  const minTraversableRatio = options.minTraversableRatio ?? 0.45;
  const minConnectedRatio = options.minConnectedRatio ?? 0.9;
  const terrainHashes = new Set<string>();
  const mapsById = new Map(bundle.maps.map((map) => [map.id, map]));
  const geometries = new Map(bundle.maps.map((map) => [map.id, mapGeometry(map)]));

  // Every cell a hero can arrive on: the map's own spawn plus every authored teleport destination.
  // Flooding from the spawn alone would call a legitimately teleport-only annex "unreachable".
  const arrivalsByMap = new Map<string, { col: number; row: number }[]>();
  for (const map of bundle.maps) arrivalsByMap.set(map.id, [{ ...map.spawn }]);
  for (const map of bundle.maps) {
    for (const event of map.events) {
      for (const eventPage of event.pages) {
        visitCommands(eventPage.commands, (command) => {
          if (command.t !== "teleport") return;
          arrivalsByMap.get(command.mapId)?.push({ col: command.col, row: command.row });
        });
      }
    }
  }

  const teleportEdges = new Map<string, Set<string>>();
  for (const map of bundle.maps) {
    if (!parseMapData(map)) throw new Error(`${map.name}: map payload is invalid`);
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
            !walkableCell(destinationGeometry, command.col, command.row)
          ) {
            throw new Error(
              `${map.name}/${event.name}: teleport targets an unsafe cell ${destination.name} ${command.col},${command.row}`,
            );
          }
          // Landing on (or beside) a player-touch event bounces the hero straight back out.
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
    if (reachable.size < Math.floor(map.cols * map.rows * minTraversableRatio)) {
      throw new Error(
        `${map.name}: less than ${Math.round(minTraversableRatio * 100)}% of the field is traversable`,
      );
    }
    let walkableTotal = 0;
    for (let row = 0; row < map.rows; row += 1) {
      for (let col = 0; col < map.cols; col += 1) {
        if (walkableCell(geometry, col, row)) walkableTotal += 1;
      }
    }
    const cutOff = walkableTotal - reachable.size;
    const tolerated = Math.max(
      options.maxCutOffCells ?? 0,
      walkableTotal - Math.floor(walkableTotal * minConnectedRatio),
    );
    if (cutOff > tolerated) {
      throw new Error(
        `${map.name}: ${cutOff} of ${walkableTotal} walkable cells are cut off ` +
          `(reachable ${reachable.size}, tolerated ${tolerated}); a lobe, terrace or courtyard has no way in`,
      );
    }
  }

  const startMapId = options.startMapId ?? bundle.adventure.startMapId;
  if (!startMapId) throw new Error("no start map: adventure.startMapId is unset");
  const reached = new Set<string>([startMapId]);
  const queue = [startMapId];
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

/** Every switch/variable a page condition or a command names must exist in the registry. */
export function validateStateReferences(bundle: AdventureBundle): void {
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

/** The context `validateAuthoredQuests` needs, derived from the bundle itself. */
export function questContext(bundle: AdventureBundle) {
  const eventIdsByMap = new Map<string, ReadonlySet<string>>();
  const monsterSpeciesByMap = new Map<string, ReadonlySet<MapEvent["species"] & string>>();
  const monsterEventIdsByMap = new Map<string, ReadonlySet<string>>();
  const activityIds = new Set<string>();
  const areaIdsByMap = new Map<string, ReadonlySet<string>>();
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
    const areaIds = new Set<string>();
    for (const event of map.events) {
      for (const eventPage of event.pages) {
        collectQuestCommandBindings(
          eventPage.commands,
          offeredQuestIds,
          turnInQuestIds,
          activityIds,
          areaIds,
        );
      }
    }
    areaIdsByMap.set(map.id, areaIds);
  }
  return {
    mapIds: new Set(bundle.maps.map((map) => map.id)),
    eventIdsByMap,
    monsterSpeciesByMap,
    monsterEventIdsByMap,
    activityIds,
    areaIdsByMap,
    switchIds: new Set(bundle.adventure.registry.switches.map((entry) => entry.id)),
    variableIds: new Set(bundle.adventure.registry.variables.map((entry) => entry.id)),
    offeredQuestIds,
    turnInQuestIds,
  };
}
