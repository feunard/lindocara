/**
 * Adventures as stored things on Alepha: create (atomic with the default first map), list, load,
 * update and delete. Ported from `packages/server/src/adventures.ts`, function-by-function, onto
 * `$repository` calls instead of raw Drizzle/D1 statements — see that file's docblock for why
 * membership is implicit (`map.adventureId` IS the membership) and why a graph is COMPAT-only on the
 * PUT (the editor no longer authors one).
 *
 * **Read is open, write is owned.** Listing and reading are open to every authenticated account —
 * only the default listing (`GET /api/adventures`, no `scope`) filters by `userId` — while editing
 * and deletion require owning the row and answer a foreign caller 403 `adventure_forbidden`.
 *
 * Writing used to be as open as reading, inherited from legacy (`deleteAdventure`'s own
 * `_accountId` parameter was accepted and never read). That was not a considered position so much
 * as an unfinished one, and it paired badly with the MAP routes, which fenced even READS by owner:
 * a shared adventure handed a visitor a row whose every map 404'd, so the editor failed the load
 * and reported the adventure missing, while any account could quietly rewrite or delete someone
 * else's work. Both halves moved at once — maps became readable, adventures became owner-writable —
 * so that "anyone may look, only the author may change" holds across both.
 *
 * The default-map creation reuses `MapService.createMap` wholesale rather than re-implementing the
 * blank-template/first-map logic here: the adventure row is inserted first (inside the same
 * `$transactional()` the controller wraps this in), then `MapService.createMap` sees it via its own
 * `adventures.findById` lookup in the same transaction.
 */
import {
  type AdventureCameraMode,
  type AdventureGameMode,
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
import { decodeMap } from "@lindocara/engine/hd2d/map-data.js";
import { $inject } from "alepha";
import { users } from "alepha/api/users";
import { $repository } from "alepha/orm";
import {
  decodeStoredAdventureRegistry,
  prepareAdventureRegistry,
} from "../../adventure-registry.js";
import { type Adventure, adventures } from "../entities/adventures.ts";
import { adventureTestSessions } from "../entities/adventureTestSessions.ts";
import { heroes } from "../entities/heroes.ts";
import { mapElements } from "../entities/mapElements.ts";
import { mapEventPages } from "../entities/mapEventPages.ts";
import { mapEvents } from "../entities/mapEvents.ts";
import { maps } from "../entities/maps.ts";
import { parties } from "../entities/parties.ts";
import { decodeAdventureAudio } from "./adventureAuthoring.ts";
import { type MapPayload, MapService } from "./MapService.ts";
import { DEFAULT_FIRST_MAP_NAME, type MapInput } from "./mapAuthoring.ts";

// `mapEventPages.deleteMany`'s `eventId: { inArray: [...] }` binds exactly one parameter per event
// id (unlike an INSERT, there is no per-column multiplication — see `MapService`'s own docblock for
// the fuller D1 ~100-bound-parameter-cap explanation). A single map's event count is bounded by
// `MAX_EVENTS_PER_MAP`, but every other bulk op in this
// codebase chunks rather than trusting a ceiling to never move — this stays consistent with that
// discipline (and with `MapService`'s own chunked writes) rather than being the one exception.
const MAP_EVENT_PAGE_DELETE_CHUNK = 40;

export interface StoredAdventure {
  id: string;
  accountId: string;
  title: string;
  maxPlayers: number;
  cameraMode: AdventureCameraMode;
  gameMode: AdventureGameMode;
  version: number;
  mapIds: string[];
  graph: AdventureGraph;
  registry: AdventureRegistry;
  audio: AdventureAudioConfig;
  startMapId: string | null;
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
  adventureTestSessions = $repository(adventureTestSessions);

  /**
   * The owner-scoped editor listing (default, no `scope`), MOST RECENTLY WORKED ON FIRST.
   *
   * The order is load-bearing, not presentation: a bare `/editor` resumes `[0]` rather than opening
   * an empty sandbox, so this endpoint is what "the adventure I was last working on" means. It
   * reads the adventure row's own `updatedAt`, which `MapService.updateMap` touches on every map
   * save precisely so that painting a map for an hour counts as working on its adventure. Ordering
   * by `createdAt` (what this did before) would have resumed whichever adventure happened to be
   * made first, forever.
   *
   * File → Open shows the same order, which is the right one there too.
   */
  async listAdventures(userId: string): Promise<AdventureSummary[]> {
    const rows = await this.adventures.findMany({
      where: { userId: { eq: userId } },
      orderBy: { column: "updatedAt", direction: "desc" },
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

  /**
   * One atomic create: the adventure row AND its default map (UX wave #2/#3/#4). Ported from
   * `createAdventureWithDefaultMap`; the map half is reused from `MapService.createMap` rather than
   * duplicated.
   *
   * `firstMap` is the editor's unsaved sandbox: entering the editor no longer writes anything, so
   * the author's first save arrives here carrying the map they have been drawing. It REPLACES the
   * blank template rather than being written beside it — the adventure still owns exactly one map —
   * and it rides this same call so a named adventure can never be persisted without it.
   */
  async createAdventureWithDefaultMap(
    userId: string,
    input: CreateAdventureInput,
    firstMap?: MapInput,
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
      ...(input.cameraMode !== undefined ? { cameraMode: input.cameraMode } : {}),
      ...(input.gameMode !== undefined ? { gameMode: input.gameMode } : {}),
      graph: JSON.stringify(EMPTY_GRAPH),
      ...(input.audio !== undefined ? { audio: JSON.stringify(input.audio) } : {}),
      ...(registry !== undefined ? { registry: JSON.stringify(registry) } : {}),
    });
    // The born map is named `Map1` (UX wave #16); a fresh adventure has zero maps, so the lowest
    // free `MapN` is unconditionally the first. `createMap` also stamps `isFirst: true` for it.
    const map = await this.mapService.createMap(
      id,
      DEFAULT_FIRST_MAP_NAME,
      undefined,
      undefined,
      firstMap,
    );
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

  /** Ported from `updateAdventure`: owner-only since read/write split (pass `ownerId` from any
   *  caller acting for a user), a COMPAT-only graph write, and the live-party start-pin guard. */
  async updateAdventure(
    id: string,
    input: AdventureInput,
    ownerId?: string,
  ): Promise<StoredAdventure> {
    const row = await this.adventures.findById(id);
    if (!row) throw new Error("not_found: no such adventure");
    // `ownerId` is optional so the server-side callers that legitimately act on nobody's behalf
    // (seeding, the test-session flow) keep working unchanged; the HTTP route always passes it.
    if (ownerId !== undefined && row.userId !== ownerId) {
      throw new Error("forbidden: not the owner of this adventure");
    }
    const title = input.title.trim();
    if (title.length === 0 || title.length > 48) throw new Error("title: 1-48 characters");
    if (input.maxPlayers < 1 || input.maxPlayers > 4) throw new Error("players: between 1 and 4");

    // `undefined` preserves; `null` clears; a string must name a map of THIS adventure. A foreign or
    // deleted id would otherwise persist and resolve to nothing at join time, which reads to the
    // player as "the adventure starts in the wrong place" with nothing logged.
    if (typeof input.startMapId === "string") {
      const target = await this.maps.findById(input.startMapId);
      if (!target || target.adventureId !== id) {
        throw new Error("maps: the start map must belong to this adventure");
      }
      if ((decodeMap(target.heightfield)?.environment ?? "exterior") === "interior") {
        throw new Error("maps: an interior cannot be the adventure start");
      }
    }
    if (input.startMapId !== undefined && (row.startMapId ?? null) !== (input.startMapId ?? null)) {
      if (await this.isAdventureInUseByARealParty(id)) {
        throw new Error("in_use: a party still references this adventure");
      }
    }

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
        if (await this.isAdventureInUseByARealParty(id)) {
          throw new Error("in_use: a party still references this adventure");
        }
      }
    }

    await this.adventures.updateById(id, {
      title,
      maxPlayers: input.maxPlayers,
      ...(input.cameraMode !== undefined ? { cameraMode: input.cameraMode } : {}),
      ...(input.gameMode !== undefined ? { gameMode: input.gameMode } : {}),
      ...(proposedGraph !== undefined ? { graph: JSON.stringify(proposedGraph) } : {}),
      ...(input.audio !== undefined ? { audio: JSON.stringify(input.audio) } : {}),
      ...(proposedRegistry !== undefined ? { registry: JSON.stringify(proposedRegistry) } : {}),
      // NOT `?? undefined`: the update schema accepts `T | null` on an optional column
      // (`updateSchema.ts` unions it with `z.null()`), but drizzle's `mapUpdateSet` filters out
      // any key whose VALUE is `undefined` before building the SQL `SET` clause — so sending
      // `undefined` here would silently no-op instead of clearing the column, which is exactly
      // what happens if `null` is coerced to `undefined` first.
      ...(input.startMapId !== undefined ? { startMapId: input.startMapId } : {}),
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
  async deleteAdventure(
    id: string,
    options: { force?: boolean; ownerId?: string } = {},
  ): Promise<void> {
    const row = await this.adventures.findById(id);
    if (!row) throw new Error("not_found: no such adventure");
    if (options.ownerId !== undefined && row.userId !== options.ownerId) {
      throw new Error("forbidden: not the owner of this adventure");
    }
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
      const eventIds = eventRows.map((event) => event.id);
      for (const chunk of chunkArray(eventIds, MAP_EVENT_PAGE_DELETE_CHUNK)) {
        await this.mapEventPages.deleteMany({ eventId: { inArray: chunk } });
      }
      await this.mapEvents.deleteMany({ mapId: { eq: mapRow.id } });
      await this.mapElements.deleteMany({ mapId: { eq: mapRow.id } });
      await this.maps.deleteById(mapRow.id);
    }

    await this.adventures.deleteById(id);
  }

  // ---------------------------------------------------------------------------------------------

  /**
   * True when a party OTHER than an editor test-session's own hidden envelope references this
   * adventure. The start-map guard exists to stop a live save's start from moving out from under
   * another party — not to fence the author's own transient playtest.
   * `TestSessionService.createTestSession` provisions a REAL `parties` row for every playtest (see
   * its own docblock), and `adventureTestSessions.partyId` is the only marker that identifies one:
   * there is no flag on `parties` itself. A party id present in `adventureTestSessions` is excluded;
   * any remaining party means a real save is in play.
   */
  private async isAdventureInUseByARealParty(id: string): Promise<boolean> {
    const used = await this.parties.findMany({ where: { adventureId: { eq: id } } });
    if (used.length === 0) return false;
    const testSessions = await this.adventureTestSessions.findMany({
      where: { partyId: { inArray: used.map((party) => party.id) } },
    });
    const testSessionPartyIds = new Set(testSessions.map((session) => session.partyId));
    return used.some((party) => !testSessionPartyIds.has(party.id));
  }

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
      cameraMode: row.cameraMode,
      gameMode: row.gameMode,
      version: row.version,
      mapIds,
      graph,
      registry: decodeStoredAdventureRegistry(row.registry),
      audio: decodeAdventureAudio(row.audio),
      startMapId: row.startMapId ?? null,
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

/** Splits `items` into consecutive slices of at most `size`, preserving order. An empty input
 *  yields an empty array of chunks (the caller's `for...of` then simply does nothing), matching
 *  `MapService`'s own chunked-write guards (`if (elements.length === 0) return;`). */
function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
