/**
 * The portable adventure bundle: ONE JSON document carrying a whole adventure — metadata, registry
 * (switches/variables/quests), every map (layers, elements, spawn, events) and the exit graph.
 *
 * The bundle keeps the SOURCE database ids (map ids, event uuids) exactly as exported: they are what
 * the graph, the quest registry and authored `teleport` commands reference. An importer must mint
 * fresh ids (`map_event.id` is a global primary key — importing twice would collide) and then call
 * `rewriteBundleIds` so every internal reference follows. References that point outside the bundle
 * are left untouched rather than dropped: the server's validation owns the final verdict.
 */
import { type AdventureGraph, type ExitDestination, parseAdventureGraph } from "./adventure.js";
import { type AdventureRegistry, parseAdventureRegistry } from "./adventure-state.js";
import type { EventCommand } from "./event-commands.js";
import type { MapElement } from "./map-data.js";
import { parseMapData } from "./map-data.js";
import { type MapEvent, parseMapEvents } from "./map-events.js";
import type {
  AuthoredQuestDefinition,
  AuthoredQuestObjective,
  QuestEventReference,
} from "./quests.js";

export const ADVENTURE_BUNDLE_FORMAT = "lindocara-adventure";
export const ADVENTURE_BUNDLE_VERSION = 1;
/** Mirrors MAX_ADVENTURE_MAPS without importing the server; the server re-validates anyway. */
export const MAX_BUNDLE_MAPS = 16;

export interface AdventureBundleMap {
  /** The source database id — the key the bundle's internal references use. */
  id: string;
  name: string;
  tilesetId: string;
  cols: number;
  rows: number;
  /** RLE-encoded, exactly 3, the wire format `PUT /api/maps/:id` accepts. */
  layers: readonly string[];
  elements: readonly MapElement[];
  spawn: { col: number; row: number };
  events: readonly MapEvent[];
}

export interface AdventureBundle {
  format: typeof ADVENTURE_BUNDLE_FORMAT;
  version: typeof ADVENTURE_BUNDLE_VERSION;
  adventure: { title: string; maxPlayers: number; registry: AdventureRegistry };
  maps: readonly AdventureBundleMap[];
  graph: AdventureGraph;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Total: null on anything malformed. Reuses the exact wire parsers each fragment already has. */
export function parseAdventureBundle(value: unknown): AdventureBundle | null {
  if (!isPlainObject(value)) return null;
  if (value.format !== ADVENTURE_BUNDLE_FORMAT) return null;
  if (value.version !== ADVENTURE_BUNDLE_VERSION) return null;
  if (!isPlainObject(value.adventure)) return null;
  const { title, maxPlayers } = value.adventure;
  if (typeof title !== "string" || title.trim().length === 0 || title.trim().length > 48)
    return null;
  if (!Number.isSafeInteger(maxPlayers) || (maxPlayers as number) < 1 || (maxPlayers as number) > 4)
    return null;
  const registry = parseAdventureRegistry(value.adventure.registry ?? { switches: [], variables: [] });
  if (!registry) return null;
  if (!Array.isArray(value.maps) || value.maps.length === 0 || value.maps.length > MAX_BUNDLE_MAPS)
    return null;
  const maps: AdventureBundleMap[] = [];
  const seenIds = new Set<string>();
  for (const raw of value.maps) {
    if (!isPlainObject(raw)) return null;
    if (typeof raw.id !== "string" || raw.id.length === 0 || seenIds.has(raw.id)) return null;
    if (typeof raw.name !== "string" || raw.name.trim().length === 0 || raw.name.length > 48)
      return null;
    const data = parseMapData(raw);
    if (!data) return null;
    const events = parseMapEvents(raw.events ?? [], data.cols, data.rows);
    if (!events) return null;
    seenIds.add(raw.id);
    maps.push({
      id: raw.id,
      name: raw.name.trim(),
      tilesetId: data.tilesetId,
      cols: data.cols,
      rows: data.rows,
      // Keep the ORIGINAL encoded strings: parseMapData proved them, re-encoding is not needed.
      layers: (raw.layers as string[]).slice(),
      elements: data.elements,
      spawn: data.spawn,
      events,
    });
  }
  const graph = parseAdventureGraph(value.graph ?? { start: null, links: [] });
  if (!graph) return null;
  return {
    format: ADVENTURE_BUNDLE_FORMAT,
    version: ADVENTURE_BUNDLE_VERSION,
    adventure: { title: title.trim(), maxPlayers: maxPlayers as number, registry },
    maps,
    graph,
  };
}

export interface BundleIdMapping {
  /** Old (bundle) map id → new (destination database) map id. */
  mapIds: ReadonlyMap<string, string>;
  /** Old event uuid → freshly minted uuid. */
  eventIds: ReadonlyMap<string, string>;
}

const mapId = (mapping: BundleIdMapping, id: string): string => mapping.mapIds.get(id) ?? id;
const eventId = (mapping: BundleIdMapping, id: string): string => mapping.eventIds.get(id) ?? id;

/** Authored programs can point at other maps (`teleport`); rewrite recursively through branches. */
function rewriteCommands(
  commands: readonly EventCommand[],
  mapping: BundleIdMapping,
): EventCommand[] {
  return commands.map((command) => {
    switch (command.t) {
      case "teleport":
        return { ...command, mapId: mapId(mapping, command.mapId) };
      case "if":
        return {
          ...command,
          then: rewriteCommands(command.then, mapping),
          else: rewriteCommands(command.else, mapping),
        };
      case "loop":
        return { ...command, body: rewriteCommands(command.body, mapping) };
      case "choices":
        return {
          ...command,
          options: command.options.map((option) => ({
            ...option,
            body: rewriteCommands(option.body, mapping),
          })),
        };
      default:
        return command;
    }
  });
}

function rewriteEventRef(
  ref: QuestEventReference | null,
  mapping: BundleIdMapping,
): QuestEventReference | null {
  if (!ref) return null;
  return { mapId: mapId(mapping, ref.mapId), eventId: eventId(mapping, ref.eventId) };
}

function rewriteObjective(
  objective: AuthoredQuestObjective,
  mapping: BundleIdMapping,
): AuthoredQuestObjective {
  switch (objective.type) {
    case "kill":
      return objective.mapScope.kind === "maps"
        ? {
            ...objective,
            mapScope: {
              kind: "maps",
              mapIds: objective.mapScope.mapIds.map((id) => mapId(mapping, id)),
            },
          }
        : objective;
    case "defeat-target": {
      const targetRef = rewriteEventRef(objective.targetRef, mapping);
      return targetRef ? { ...objective, targetRef } : objective;
    }
    case "interact": {
      const targetRef = rewriteEventRef(objective.targetRef, mapping);
      return targetRef ? { ...objective, targetRef } : objective;
    }
    case "reach":
      return {
        ...objective,
        destination:
          objective.destination.kind === "map"
            ? { kind: "map", mapId: mapId(mapping, objective.destination.mapId) }
            : { ...objective.destination, mapId: mapId(mapping, objective.destination.mapId) },
      };
    case "use-item":
      if (objective.context === null) return objective;
      return objective.context.kind === "map"
        ? { ...objective, context: { kind: "map", mapId: mapId(mapping, objective.context.mapId) } }
        : {
            ...objective,
            context: {
              kind: "event",
              mapId: mapId(mapping, objective.context.mapId),
              eventId: eventId(mapping, objective.context.eventId),
            },
          };
    default:
      return objective;
  }
}

function rewriteQuest(
  quest: AuthoredQuestDefinition,
  mapping: BundleIdMapping,
): AuthoredQuestDefinition {
  return {
    ...quest,
    giver: rewriteEventRef(quest.giver, mapping),
    turnInTarget: rewriteEventRef(quest.turnInTarget, mapping),
    objectives: quest.objectives.map((objective) => rewriteObjective(objective, mapping)),
    rewards: {
      ...quest.rewards,
      customCommands: rewriteCommands(quest.rewards.customCommands, mapping),
    },
  };
}

function rewriteDestination(
  dest: ExitDestination,
  mapping: BundleIdMapping,
): ExitDestination {
  if (dest === "end") return dest;
  return { mapId: mapId(mapping, dest.mapId), entryId: eventId(mapping, dest.entryId) };
}

/**
 * Rewrite EVERY internal reference of a bundle through the mapping: map ids, event uuids, the
 * graph, quest bindings and nested teleport commands. Ids absent from the mapping pass through
 * unchanged — the destination server's validation decides whether they are legal there.
 */
export function rewriteBundleIds(
  bundle: AdventureBundle,
  mapping: BundleIdMapping,
): AdventureBundle {
  return {
    ...bundle,
    adventure: {
      ...bundle.adventure,
      registry: {
        ...bundle.adventure.registry,
        ...(bundle.adventure.registry.quests
          ? {
              quests: bundle.adventure.registry.quests.map((quest) =>
                rewriteQuest(quest, mapping),
              ),
            }
          : {}),
      },
    },
    maps: bundle.maps.map((map) => ({
      ...map,
      id: mapId(mapping, map.id),
      events: map.events.map((event) => ({
        ...event,
        id: eventId(mapping, event.id),
        pages: event.pages.map((page) => ({
          ...page,
          commands: rewriteCommands(page.commands, mapping),
        })),
      })),
    })),
    graph: {
      start: bundle.graph.start
        ? {
            mapId: mapId(mapping, bundle.graph.start.mapId),
            entryId: eventId(mapping, bundle.graph.start.entryId),
          }
        : null,
      links: bundle.graph.links.map((link) => ({
        mapId: mapId(mapping, link.mapId),
        exitId: eventId(mapping, link.exitId),
        dest: rewriteDestination(link.dest, mapping),
      })),
    },
  };
}

/** Mint a fresh uuid per event of every map — the mapping `rewriteBundleIds` consumes. */
export function mintEventIdMapping(
  bundle: AdventureBundle,
  mint: () => string,
): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const map of bundle.maps) {
    for (const event of map.events) mapping.set(event.id, mint());
  }
  return mapping;
}
