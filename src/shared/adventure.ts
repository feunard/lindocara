/**
 * An adventure is an authored graph over maps: exits (placed in maps) are bound here to a
 * destination map + entry, or to "end". Destinations belong to the adventure, never to the map —
 * a client can request "use this exit" but the server resolves where it leads from this graph.
 * Pure rules only: D1 lookups live in server/adventures.ts.
 */
import { MARKER_ID_PATTERN } from "./map-data.js";

export const ADVENTURE_TITLE_MAX = 48;
export const MAX_ADVENTURE_MAPS = 16;
export const MAX_ADVENTURE_LINKS = 64;

const MAP_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export type ExitDestination = { mapId: string; entryId: string } | "end";

export interface AdventureLink {
  mapId: string;
  exitId: string;
  dest: ExitDestination;
}

export interface AdventureGraph {
  start: { mapId: string; entryId: string };
  links: readonly AdventureLink[];
}

export interface AdventureInput {
  title: string;
  maxPlayers: number;
  mapIds: readonly string[];
  graph: AdventureGraph;
}

/** The marker ids of one member map, as Task 5 reads them from the stored payload. */
export interface MapMarkerIds {
  entryIds: readonly string[];
  exitIds: readonly string[];
}

function parseAnchor(value: unknown): { mapId: string; entryId: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const { mapId, entryId } = value as Record<string, unknown>;
  if (typeof mapId !== "string" || !MAP_ID_PATTERN.test(mapId)) return null;
  if (typeof entryId !== "string" || !MARKER_ID_PATTERN.test(entryId)) return null;
  return { mapId, entryId };
}

export function parseAdventureGraph(value: unknown): AdventureGraph | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const start = parseAnchor(record.start);
  if (!start) return null;
  const linksRaw = record.links;
  if (!Array.isArray(linksRaw) || linksRaw.length > MAX_ADVENTURE_LINKS) return null;
  const links: AdventureLink[] = [];
  for (const raw of linksRaw) {
    if (typeof raw !== "object" || raw === null) return null;
    const { mapId, exitId, dest } = raw as Record<string, unknown>;
    if (typeof mapId !== "string" || !MAP_ID_PATTERN.test(mapId)) return null;
    if (typeof exitId !== "string" || !MARKER_ID_PATTERN.test(exitId)) return null;
    if (dest === "end") {
      links.push({ mapId, exitId, dest: "end" });
      continue;
    }
    const anchor = parseAnchor(dest);
    if (!anchor) return null;
    links.push({ mapId, exitId, dest: anchor });
  }
  return { start, links };
}

export function parseAdventureInput(value: unknown): AdventureInput | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { title, maxPlayers, mapIds } = record;
  if (typeof title !== "string") return null;
  if (!Number.isSafeInteger(maxPlayers)) return null;
  if (!Array.isArray(mapIds) || mapIds.length > MAX_ADVENTURE_MAPS) return null;
  for (const id of mapIds) {
    if (typeof id !== "string" || !MAP_ID_PATTERN.test(id)) return null;
  }
  const graph = parseAdventureGraph(record.graph);
  if (!graph) return null;
  return { title, maxPlayers: maxPlayers as number, mapIds: mapIds as string[], graph };
}

/** Throws "title:|players:|maps:|graph:" — the prefix is the machine code, per server convention. */
export function validateAdventure(
  input: AdventureInput,
  markersByMap: ReadonlyMap<string, MapMarkerIds>,
): void {
  const title = input.title.trim();
  if (title.length === 0 || title.length > ADVENTURE_TITLE_MAX) {
    throw new Error(`title: 1-${ADVENTURE_TITLE_MAX} characters`);
  }
  if (input.maxPlayers < 1 || input.maxPlayers > 4) {
    throw new Error("players: between 1 and 4");
  }
  if (input.mapIds.length === 0 || input.mapIds.length > MAX_ADVENTURE_MAPS) {
    throw new Error(`maps: 1 to ${MAX_ADVENTURE_MAPS} maps`);
  }
  const members = new Set(input.mapIds);
  if (members.size !== input.mapIds.length) throw new Error("maps: duplicate map");
  for (const mapId of input.mapIds) {
    if (!markersByMap.has(mapId)) throw new Error(`maps: unknown map ${mapId}`);
  }

  const entryExists = (mapId: string, entryId: string): boolean =>
    (markersByMap.get(mapId)?.entryIds ?? []).includes(entryId);

  const { start, links } = input.graph;
  if (!members.has(start.mapId) || !entryExists(start.mapId, start.entryId)) {
    throw new Error("graph: start must name a member map and one of its entries");
  }

  const bound = new Set<string>();
  let ends = 0;
  for (const link of links) {
    if (!members.has(link.mapId)) throw new Error(`graph: link from non-member map ${link.mapId}`);
    if (!(markersByMap.get(link.mapId)?.exitIds ?? []).includes(link.exitId)) {
      throw new Error(`graph: no exit ${link.exitId} on map ${link.mapId}`);
    }
    const key = `${link.mapId}:${link.exitId}`;
    if (bound.has(key))
      throw new Error(`graph: exit ${link.exitId} on map ${link.mapId} bound twice`);
    bound.add(key);
    if (link.dest === "end") {
      ends += 1;
      continue;
    }
    if (!members.has(link.dest.mapId) || !entryExists(link.dest.mapId, link.dest.entryId)) {
      throw new Error(`graph: exit ${link.exitId} leads to a missing map or entry`);
    }
  }
  for (const mapId of input.mapIds) {
    for (const exitId of markersByMap.get(mapId)?.exitIds ?? []) {
      if (!bound.has(`${mapId}:${exitId}`)) {
        throw new Error(`graph: exit ${exitId} on map ${mapId} is unbound`);
      }
    }
  }
  if (ends === 0) throw new Error("graph: at least one exit must end the adventure");
}
