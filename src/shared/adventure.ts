/**
 * An adventure is an authored graph over its OWN maps: exits (placed in maps) are bound here to a
 * destination map + entry, or to "end". A map belongs to exactly one adventure (UX wave #5), so
 * membership is implicit — every map the adventure owns is a member, and the graph may only
 * reference those. A client can request "use this exit" but the server resolves where it leads from
 * this graph. Pure rules only: D1 lookups live in server/adventures.ts.
 *
 * `start` is nullable: a freshly created adventure is a draft with no maps yet, so it has no start
 * anchor to point at. `EMPTY_GRAPH` is that draft state. A draft is valid but not playable — heroes
 * cannot spawn and party admission refuses it until a real start is authored.
 */
import { type AdventureRegistry, parseAdventureRegistry } from "./adventure-state.js";
import { MARKER_ID_PATTERN } from "./map-data.js";

export const ADVENTURE_TITLE_MAX = 48;
export const MAX_ADVENTURE_MAPS = 16;
// MAX_ADVENTURE_MAPS (16) x MAX_MAP_EXITS (8) = 128, the maximum number of exits a
// fully-saturated adventure can bind, so a complete valid graph can never exceed this cap.
export const MAX_ADVENTURE_LINKS = 128;

const MAP_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export type ExitDestination = { mapId: string; entryId: string } | "end";

export interface AdventureLink {
  mapId: string;
  exitId: string;
  dest: ExitDestination;
}

export interface AdventureGraph {
  /** Null for a draft adventure with no start authored yet (see `EMPTY_GRAPH`). */
  start: { mapId: string; entryId: string } | null;
  links: readonly AdventureLink[];
}

/** The graph a freshly created (draft) adventure carries: no start, no links. */
export const EMPTY_GRAPH: AdventureGraph = { start: null, links: [] };

/** What `updateAdventure` accepts: the graph plus its shell fields. Membership is implicit (the
 *  adventure's owned maps), so there is no `mapIds` on the wire any more. */
export interface AdventureInput {
  title: string;
  maxPlayers: number;
  graph: AdventureGraph;
  /** The switch/variable registry, when the client sends one. `undefined` means "leave the stored
   *  registry untouched" — a PUT that omits it never wipes the column. */
  registry?: AdventureRegistry;
}

/** What `createAdventure` accepts: just the shell. The server mints an empty draft graph. */
export interface CreateAdventureInput {
  title: string;
  maxPlayers: number;
  registry?: AdventureRegistry;
}

/** The marker ids of one member map, read from the stored payload. */
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
  // A null/absent start is a draft graph; anything else must be a well-formed anchor.
  let start: { mapId: string; entryId: string } | null = null;
  if (record.start !== null && record.start !== undefined) {
    start = parseAnchor(record.start);
    if (!start) return null;
  }
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

function parseShell(value: unknown): { title: string; maxPlayers: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const { title, maxPlayers } = value as Record<string, unknown>;
  if (typeof title !== "string") return null;
  if (!Number.isSafeInteger(maxPlayers)) return null;
  return { title, maxPlayers: maxPlayers as number };
}

function parseOptionalRegistry(value: unknown): { ok: true; registry?: AdventureRegistry } | null {
  const record = value as Record<string, unknown>;
  if (record.registry === undefined) return { ok: true };
  const parsed = parseAdventureRegistry(record.registry);
  if (!parsed) return null;
  return { ok: true, registry: parsed };
}

export function parseCreateAdventureInput(value: unknown): CreateAdventureInput | null {
  const shell = parseShell(value);
  if (!shell) return null;
  const registry = parseOptionalRegistry(value);
  if (!registry) return null;
  return {
    ...shell,
    ...(registry.registry !== undefined ? { registry: registry.registry } : {}),
  };
}

export function parseAdventureInput(value: unknown): AdventureInput | null {
  const shell = parseShell(value);
  if (!shell) return null;
  const graph = parseAdventureGraph((value as Record<string, unknown>).graph);
  if (!graph) return null;
  const registry = parseOptionalRegistry(value);
  if (!registry) return null;
  return {
    ...shell,
    graph,
    ...(registry.registry !== undefined ? { registry: registry.registry } : {}),
  };
}

/**
 * Throws "title:|players:|maps:|graph:" — the prefix is the machine code, per server convention.
 *
 * `markersByMap` is the adventure's OWNED maps (server/adventures.ts builds it from `map.adventure_id`),
 * so a graph that names a map not in this set is by construction a foreign-map reference and is
 * rejected. A draft graph (`start === null`) is valid with no members and no links — an adventure
 * being built before its first map exists.
 */
export function validateAdventure(
  input: { title: string; maxPlayers: number; graph: AdventureGraph },
  markersByMap: ReadonlyMap<string, MapMarkerIds>,
): void {
  const title = input.title.trim();
  if (title.length === 0 || title.length > ADVENTURE_TITLE_MAX) {
    throw new Error(`title: 1-${ADVENTURE_TITLE_MAX} characters`);
  }
  if (input.maxPlayers < 1 || input.maxPlayers > 4) {
    throw new Error("players: between 1 and 4");
  }

  const { start, links } = input.graph;
  if (start === null) {
    // A draft: nothing is wired yet. Links without a start make no sense.
    if (links.length > 0) throw new Error("graph: a draft adventure cannot have links");
    return;
  }

  const members = new Set(markersByMap.keys());
  if (members.size === 0 || members.size > MAX_ADVENTURE_MAPS) {
    throw new Error(`maps: 1 to ${MAX_ADVENTURE_MAPS} maps`);
  }

  const entryExists = (mapId: string, entryId: string): boolean =>
    (markersByMap.get(mapId)?.entryIds ?? []).includes(entryId);

  if (!members.has(start.mapId) || !entryExists(start.mapId, start.entryId)) {
    throw new Error("graph: start must name a member map and one of its entries");
  }

  const bound = new Set<string>();
  const destinations = new Map<string, Set<string>>();
  const endingMaps = new Set<string>();
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
      endingMaps.add(link.mapId);
      continue;
    }
    if (!members.has(link.dest.mapId) || !entryExists(link.dest.mapId, link.dest.entryId)) {
      throw new Error(`graph: exit ${link.exitId} leads to a missing map or entry`);
    }
    const next = destinations.get(link.mapId) ?? new Set<string>();
    next.add(link.dest.mapId);
    destinations.set(link.mapId, next);
  }
  for (const [mapId, markers] of markersByMap) {
    for (const exitId of markers.exitIds) {
      if (!bound.has(`${mapId}:${exitId}`)) {
        throw new Error(`graph: exit ${exitId} on map ${mapId} is unbound`);
      }
    }
  }
  const reachable = new Set<string>([start.mapId]);
  const pending = [start.mapId];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) continue;
    for (const destination of destinations.get(current) ?? []) {
      if (reachable.has(destination)) continue;
      reachable.add(destination);
      pending.push(destination);
    }
  }
  if (![...endingMaps].some((mapId) => reachable.has(mapId))) {
    throw new Error("graph: no adventure ending is reachable from the start");
  }
  // No "every owned map must be reachable" rule: under implicit membership (UX wave #5) a map the
  // adventure owns but has not wired into the graph yet is a work-in-progress, not an error — an
  // author adds a map before linking it. Playability still requires a reachable ending above.
}
