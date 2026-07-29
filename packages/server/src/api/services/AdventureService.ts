/**
 * Adventures as stored things on Alepha: create (atomic with the default first map), list, load,
 * update and delete. Ported from `packages/server/src/adventures.ts`, function-by-function, onto
 * `$repository` calls instead of raw Drizzle/D1 statements — see that file's docblock for why
 * membership is implicit (`map.adventureId` IS the membership) and why a graph is COMPAT-only on the
 * PUT (the editor no longer authors one).
 *
 * **Collaborative editing, preserved from legacy.** Listing, reading and editing are open to every
 * authenticated account; only the owner-scoped default listing (`GET /api/adventures`, no `scope`)
 * filters by `userId`. Deletion follows the same collaborative contract as legacy `deleteAdventure`
 * (its own `_accountId` parameter is accepted but never read) — there is no per-adventure ownership
 * fence on delete either.
 *
 * The default-map creation reuses `MapService.createMap` wholesale rather than re-implementing the
 * blank-template/first-map logic here: the adventure row is inserted first (inside the same
 * `$transactional()` the controller wraps this in), then `MapService.createMap` sees it via its own
 * `adventures.findById` lookup in the same transaction.
 */
import {
  type AdventureGraph,
  type AdventureInput,
  type CreateAdventureInput,
  EMPTY_GRAPH,
  type MapMarkerIds,
  parseAdventureGraph,
  validateAdventure,
} from "@lindocara/engine/adventure.js";
import type { AdventureRegistry } from "@lindocara/engine/adventure-state.js";
import type { AdventureAudioConfig } from "@lindocara/engine/audio-catalog.js";
import { $inject } from "alepha";
import { users } from "alepha/api/users";
import { $repository } from "alepha/orm";
import {
  decodeStoredAdventureRegistry,
  prepareAdventureRegistry,
} from "../../adventure-registry.js";
import { type Adventure, adventures } from "../entities/adventures.ts";
import { heroes } from "../entities/heroes.ts";
import { mapElements } from "../entities/mapElements.ts";
import { mapEventPages } from "../entities/mapEventPages.ts";
import { mapEvents } from "../entities/mapEvents.ts";
import { maps } from "../entities/maps.ts";
import { parties } from "../entities/parties.ts";
import { decodeAdventureAudio } from "./adventureAuthoring.ts";
import { type MapPayload, MapService } from "./MapService.ts";
import { DEFAULT_FIRST_MAP_NAME } from "./mapAuthoring.ts";

export interface StoredAdventure {
  id: string;
  accountId: string;
  title: string;
  maxPlayers: number;
  version: number;
  mapIds: string[];
  graph: AdventureGraph;
  registry: AdventureRegistry;
  audio: AdventureAudioConfig;
}

export interface AdventureSummary {
  id: string;
  title: string;
  maxPlayers: number;
  mapCount: number;
  playable: boolean;
  /** Present only for the collaborative listings (`scope=all`/`scope=play`), absent for the
   *  owner-scoped default listing — matching legacy `listAllAdventures`/`listPlayableAdventures`
   *  vs `listAdventures`. */
  author?: string;
}

export class AdventureService {
  mapService = $inject(MapService);

  adventures = $repository(adventures);
  maps = $repository(maps);
  mapElements = $repository(mapElements);
  mapEvents = $repository(mapEvents);
  mapEventPages = $repository(mapEventPages);
  parties = $repository(parties);
  heroes = $repository(heroes);
  users = $repository(users);

  /** The owner-scoped editor listing (default, no `scope`). Ported from `listAdventures`. */
  async listAdventures(userId: string): Promise<AdventureSummary[]> {
    const rows = await this.adventures.findMany({
      where: { userId: { eq: userId } },
      orderBy: "createdAt",
    });
    return Promise.all(rows.map((row) => this.toSummary(row)));
  }

  /** The collaborative editor's picker: EVERY adventure, drafts included, with author. Ported from
   *  `listAllAdventures`. */
  async listAllAdventures(): Promise<AdventureSummary[]> {
    const rows = await this.adventures.findMany({ orderBy: "createdAt" });
    return Promise.all(rows.map((row) => this.toSummary(row, { withAuthor: true })));
  }

  /** The play-flow listing: every PLAYABLE adventure, any author. Ported from
   *  `listPlayableAdventures`. */
  async listPlayableAdventures(): Promise<AdventureSummary[]> {
    const all = await this.listAllAdventures();
    return all.filter((entry) => entry.mapCount > 0);
  }

  /** One atomic create: the adventure row AND its blank default map (UX wave #2/#3/#4). Ported from
   *  `createAdventureWithDefaultMap`; the map half is reused from `MapService.createMap` rather than
   *  duplicated. */
  async createAdventureWithDefaultMap(
    userId: string,
    input: CreateAdventureInput,
  ): Promise<{ adventure: StoredAdventure; map: MapPayload }> {
    const title = input.title.trim();
    if (title.length === 0 || title.length > 48) throw new Error("title: 1-48 characters");
    if (input.maxPlayers < 1 || input.maxPlayers > 4) throw new Error("players: between 1 and 4");
    const registry =
      input.registry === undefined ? undefined : prepareAdventureRegistry(input.registry);
    const id = crypto.randomUUID();
    await this.adventures.create({
      id,
      userId,
      title,
      maxPlayers: input.maxPlayers,
      graph: JSON.stringify(EMPTY_GRAPH),
      ...(input.audio !== undefined ? { audio: JSON.stringify(input.audio) } : {}),
      ...(registry !== undefined ? { registry: JSON.stringify(registry) } : {}),
    });
    // The born map is named `Map1` (UX wave #16); a fresh adventure has zero maps, so the lowest
    // free `MapN` is unconditionally the first. `createMap` also stamps `isFirst: true` for it.
    const map = await this.mapService.createMap(id, DEFAULT_FIRST_MAP_NAME);
    const stored = await this.loadAdventureById(id);
    if (!stored) throw new Error("not_found: adventure vanished mid-create");
    return { adventure: stored, map };
  }

  /** The play-flow load: no owner fence. Ported from `loadAdventureById`. */
  async getAdventure(id: string): Promise<StoredAdventure> {
    const stored = await this.loadAdventureById(id);
    if (!stored) throw new Error("not_found: no such adventure");
    return stored;
  }

  /** Ported from `updateAdventure`: collaborative editing (any authenticated account may edit), a
   *  COMPAT-only graph write, and the live-party start-pin guard. */
  async updateAdventure(id: string, input: AdventureInput): Promise<StoredAdventure> {
    const row = await this.adventures.findById(id);
    if (!row) throw new Error("not_found: no such adventure");
    const title = input.title.trim();
    if (title.length === 0 || title.length > 48) throw new Error("title: 1-48 characters");
    if (input.maxPlayers < 1 || input.maxPlayers > 4) throw new Error("players: between 1 and 4");

    const proposedGraph = input.graph;
    const proposedRegistry =
      input.registry === undefined
        ? undefined
        : prepareAdventureRegistry(input.registry, decodeStoredAdventureRegistry(row.registry));

    if (proposedGraph !== undefined) {
      validateAdventure(
        { title: input.title, maxPlayers: input.maxPlayers, graph: proposedGraph },
        await this.markerIdsFor(id),
      );
      const storedStart = parseAdventureGraph(JSON.parse(row.graph))?.start ?? null;
      const nextStart = proposedGraph.start;
      const startMoved =
        storedStart === null
          ? nextStart !== null
          : nextStart === null ||
            nextStart.mapId !== storedStart.mapId ||
            nextStart.entryId !== storedStart.entryId;
      if (startMoved) {
        const used = await this.parties.findMany({
          where: { adventureId: { eq: id } },
          limit: 1,
        });
        if (used.length > 0) throw new Error("in_use: a party still references this adventure");
      }
    }

    await this.adventures.updateById(id, {
      title,
      maxPlayers: input.maxPlayers,
      ...(proposedGraph !== undefined ? { graph: JSON.stringify(proposedGraph) } : {}),
      ...(input.audio !== undefined ? { audio: JSON.stringify(input.audio) } : {}),
      ...(proposedRegistry !== undefined ? { registry: JSON.stringify(proposedRegistry) } : {}),
    });
    const stored = await this.loadAdventureById(id);
    if (!stored) throw new Error("not_found: adventure vanished mid-update");
    return stored;
  }

  /** Ported from `deleteAdventure`. `parties.adventureId` is FK-`restrict` (Task 7), so a live party
   *  must be cleared explicitly before the adventure row can go, exactly as force mode did over raw
   *  SQL in legacy. `maps`/`mapElements`/`mapEvents` are FK-`cascade` off `adventureId`/`mapId`, but
   *  every child table is still cleaned up explicitly here rather than relied on — the same
   *  precaution `MapService.deleteMap` takes with its own children. */
  async deleteAdventure(id: string, options: { force?: boolean } = {}): Promise<void> {
    const row = await this.adventures.findById(id);
    if (!row) throw new Error("not_found: no such adventure");
    const force = options.force === true;

    const relatedParties = await this.parties.findMany({ where: { adventureId: { eq: id } } });
    if (relatedParties.length > 0 && !force) {
      throw new Error("referenced: a party still uses this adventure");
    }

    for (const party of relatedParties) {
      const heroesInParty = await this.heroes.findMany({ where: { partyId: { eq: party.id } } });
      for (const hero of heroesInParty) await this.heroes.deleteById(hero.id);
      await this.parties.deleteById(party.id);
    }

    const mapRows = await this.maps.findMany({ where: { adventureId: { eq: id } } });
    for (const mapRow of mapRows) {
      const eventRows = await this.mapEvents.findMany({ where: { mapId: { eq: mapRow.id } } });
      if (eventRows.length > 0) {
        await this.mapEventPages.deleteMany({
          eventId: { inArray: eventRows.map((event) => event.id) },
        });
      }
      await this.mapEvents.deleteMany({ mapId: { eq: mapRow.id } });
      await this.mapElements.deleteMany({ mapId: { eq: mapRow.id } });
      await this.maps.deleteById(mapRow.id);
    }

    await this.adventures.deleteById(id);
  }

  // ---------------------------------------------------------------------------------------------

  private async toSummary(
    row: Adventure,
    options: { withAuthor?: boolean } = {},
  ): Promise<AdventureSummary> {
    const mapCount = await this.maps.count({ adventureId: { eq: row.id } });
    const summary: AdventureSummary = {
      id: row.id,
      title: row.title,
      maxPlayers: row.maxPlayers,
      mapCount,
      playable: mapCount > 0,
    };
    if (options.withAuthor) {
      const author = await this.users.findById(row.userId);
      summary.author = author?.username ?? "unknown";
    }
    return summary;
  }

  private async loadAdventureById(id: string): Promise<StoredAdventure | null> {
    const row = await this.adventures.findById(id);
    if (!row) return null;
    const mapRows = await this.maps.findMany({
      where: { adventureId: { eq: id } },
      orderBy: "createdAt",
    });
    return this.toStored(
      row,
      mapRows.map((mapRow) => mapRow.id),
    );
  }

  private toStored(row: Adventure, mapIds: string[]): StoredAdventure {
    const graph = parseAdventureGraph(JSON.parse(row.graph));
    if (!graph) throw new Error("graph: stored graph is corrupt");
    return {
      id: row.id,
      accountId: row.userId,
      title: row.title,
      maxPlayers: row.maxPlayers,
      version: row.version,
      mapIds,
      graph,
      registry: decodeStoredAdventureRegistry(row.registry),
      audio: decodeAdventureAudio(row.audio),
    };
  }

  /** The entry/exit-EVENT uuids of every map the adventure owns — the member set `validateAdventure`
   *  checks the graph against. Ported from `markerIdsFor`. */
  private async markerIdsFor(adventureId: string): Promise<Map<string, MapMarkerIds>> {
    const mapRows = await this.maps.findMany({
      where: { adventureId: { eq: adventureId } },
      orderBy: "createdAt",
    });
    const byMap = new Map<string, MapMarkerIds>();
    for (const mapRow of mapRows) byMap.set(mapRow.id, { entryIds: [], exitIds: [] });
    if (mapRows.length === 0) return byMap;
    const eventRows = await this.mapEvents.findMany({
      where: { mapId: { inArray: mapRows.map((mapRow) => mapRow.id) } },
    });
    for (const event of eventRows) {
      const anchors = byMap.get(event.mapId);
      if (!anchors) continue;
      if (event.kind === "entry") (anchors.entryIds as string[]).push(event.id);
      else if (event.kind === "exit") (anchors.exitIds as string[]).push(event.id);
    }
    return byMap;
  }
}
