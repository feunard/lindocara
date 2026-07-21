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
import { isUuid } from "./identifiers.js";

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

/** What `updateAdventure` accepts: its shell fields, and an OPTIONAL graph.
 *
 *  The adventure graph is no longer authored (UX teardown): the editor removed every affordance that
 *  wrote a start, an exit binding or a link, so a normal PUT from the client omits `graph` entirely
 *  and the stored graph is preserved untouched. The field survives as a COMPAT seam only — the test
 *  harness and any legacy writer may still send a full graph to seed or route an existing adventure,
 *  and it is validated (`validateAdventure`) and written only when explicitly present. Membership is
 *  implicit (the adventure's owned maps), so there is no `mapIds` on the wire. */
export interface AdventureInput {
  title: string;
  maxPlayers: number;
  /** COMPAT-only. Absent on every real authoring PUT (the stored graph is then preserved); present
   *  only when a legacy/test writer seeds the graph for runtime routing. */
  graph?: AdventureGraph;
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

/** UX wave #12: the graph binds the UUIDs of a map's entry/exit-kind EVENTS, not marker ids. These
 *  are the uuids of that member map's entry-kind and exit-kind events. */
export interface MapMarkerIds {
  entryIds: readonly string[];
  exitIds: readonly string[];
}

function parseAnchor(value: unknown): { mapId: string; entryId: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const { mapId, entryId } = value as Record<string, unknown>;
  if (typeof mapId !== "string" || !MAP_ID_PATTERN.test(mapId)) return null;
  // `entryId` is the uuid of an entry-kind event on `mapId` (was a marker id before UX wave #12).
  if (!isUuid(entryId)) return null;
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
    // `exitId` is the uuid of an exit-kind event on `mapId` (was a marker id before UX wave #12).
    if (!isUuid(exitId)) return null;
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
  // A missing `graph` is the normal case now (the editor never sends one): the stored graph is
  // preserved. A present-but-malformed graph is still rejected, so a legacy/test writer cannot
  // persist a graph the runtime could never parse.
  let graph: AdventureGraph | undefined;
  const rawGraph = (value as Record<string, unknown>).graph;
  if (rawGraph !== undefined) {
    const parsed = parseAdventureGraph(rawGraph);
    if (!parsed) return null;
    graph = parsed;
  }
  const registry = parseOptionalRegistry(value);
  if (!registry) return null;
  return {
    ...shell,
    ...(graph !== undefined ? { graph } : {}),
    ...(registry.registry !== undefined ? { registry: registry.registry } : {}),
  };
}

/**
 * Throws "title:|players:|graph:" — the prefix is the machine code, per server convention.
 *
 * This enforces REFERENTIAL INTEGRITY only — never completeness. An adventure must always be saveable
 * regardless of how far its graph is wired: an unlinked exit, no start, and no reachable ending are
 * all valid, work-in-progress states, not errors. What is still rejected is a graph that NAMES
 * something that does not exist — a start or destination pointing at a non-member map or a missing
 * entry, a link from a non-member map or a missing exit, or the same exit bound twice — because those
 * would persist a graph the runtime could never resolve.
 *
 * `markersByMap` is the adventure's OWNED maps (server/adventures.ts builds it from `map.adventure_id`),
 * so a graph that names a map not in this set is by construction a foreign-map reference and is
 * rejected. A draft graph (`start === null`) is valid, with or without links, as long as every link it
 * does carry is referentially sound.
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
  const members = new Set(markersByMap.keys());
  const entryExists = (mapId: string, entryId: string): boolean =>
    (markersByMap.get(mapId)?.entryIds ?? []).includes(entryId);

  // A start, IF set, must name a member map and one of its real entries. A null start is a draft — no
  // start is required for the adventure to save.
  if (start !== null && (!members.has(start.mapId) || !entryExists(start.mapId, start.entryId))) {
    throw new Error("graph: start must name a member map and one of its entries");
  }

  // Every link that IS present must be referentially sound; unbound exits are simply omitted from the
  // graph and never enforced here. Completeness (bind every exit, reach an ending) is deliberately not
  // checked — a partially-wired adventure is a valid save.
  const bound = new Set<string>();
  for (const link of links) {
    if (!members.has(link.mapId)) throw new Error(`graph: link from non-member map ${link.mapId}`);
    if (!(markersByMap.get(link.mapId)?.exitIds ?? []).includes(link.exitId)) {
      throw new Error(`graph: no exit ${link.exitId} on map ${link.mapId}`);
    }
    const key = `${link.mapId}:${link.exitId}`;
    if (bound.has(key))
      throw new Error(`graph: exit ${link.exitId} on map ${link.mapId} bound twice`);
    bound.add(key);
    if (link.dest === "end") continue;
    if (!members.has(link.dest.mapId) || !entryExists(link.dest.mapId, link.dest.entryId)) {
      throw new Error(`graph: exit ${link.exitId} leads to a missing map or entry`);
    }
  }
}
