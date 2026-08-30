import type { AdventureRegistry } from "@lindocara/engine/adventure-state.js";
/**
 * Maps as stored things on Alepha: load, create, save, delete, and the rules that keep the world
 * enterable. Ported from `packages/server/src/maps.ts`, function-by-function, onto `$repository`
 * calls instead of raw Drizzle/D1 statements — see that file's docblock for the two invariants this
 * exists to protect (never delete the last map of an adventure; `isFirst` always has a survivor).
 *
 * **Owner-fenced editing.** Every HTTP-facing list/read/create/update/delete/front-door operation
 * receives the authenticated user id and makes foreign rows indistinguishable from missing rows.
 * Internal methods remain identity-free for room loading, startup backfill and test tooling; they
 * must not be exposed directly by a controller. The separate heightfield endpoint follows the same
 * owner fence and answers 404 for a foreign map.
 */
import {
  type AdventureGraph,
  type AdventureInput,
  type MapMarkerIds,
  parseAdventureGraph,
  validateAdventure,
} from "@lindocara/engine/adventure.js";
import { bridgeOrientation, encodeBridgeDimensions } from "@lindocara/engine/bridges.js";
import { createBuildingInteriorInput } from "@lindocara/engine/building-interior.js";
import { encodeBuildingTransform, isStandingBuildingAsset } from "@lindocara/engine/buildings.js";
import { encodeElementTransform } from "@lindocara/engine/element-orientation.js";
import { encodeElementScaleTransform } from "@lindocara/engine/element-scale.js";
import { parseEventCommands } from "@lindocara/engine/event-commands.js";
import {
  defaultMonsterTuning,
  isMonsterSpecies,
  type MonsterAttackProfile,
} from "@lindocara/engine/game.js";
import { type HarvestProfile, parseHarvestProfile } from "@lindocara/engine/harvest.js";
import { compileAuthoredMap } from "@lindocara/engine/hd2d/authored-map.js";
import { decodeMap, encodeMap } from "@lindocara/engine/hd2d/map-data.js";
import {
  EMPTY_MARKERS,
  type MapElement,
  parseMapData,
  type UndergroundMap,
} from "@lindocara/engine/map-data.js";
import type { InteriorShell, MapEnvironment } from "@lindocara/engine/map-environment.js";
import {
  entryEvents,
  exitEvents,
  isEventKind,
  type MapEvent,
  type MapEventPage,
  parseNpcRoutine,
} from "@lindocara/engine/map-events.js";
import type { MapHeroSettings } from "@lindocara/engine/map-hero-settings.js";
import type { MapFixedLighting } from "@lindocara/engine/map-lighting.js";
import type { MapWeather } from "@lindocara/engine/map-weather.js";
import { isNativeSceneryAsset } from "@lindocara/engine/native-scenery.js";
import { encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
import { $inject } from "alepha";
import { users } from "alepha/api/users";
import { $repository, sql } from "alepha/orm";

// Pure, D1-free helper: reused as-is rather than re-ported (see its own docblock).
import {
  decodeStoredAdventureRegistry,
  prepareAdventureRegistry,
} from "../../adventure-registry.js";
import { adventures } from "../entities/adventures.ts";
import { heroes } from "../entities/heroes.ts";
import { type MapElement as MapElementRow, mapElements } from "../entities/mapElements.ts";
import { type MapEventPage as MapEventPageRow, mapEventPages } from "../entities/mapEventPages.ts";
import { type MapEvent as MapEventRow, mapEvents } from "../entities/mapEvents.ts";
import { type MapRow, maps } from "../entities/maps.ts";
import { parties } from "../entities/parties.ts";
import { HeroService } from "./HeroService.ts";
import {
  decodeLayers,
  decodeMapAudio,
  decodeMapHeroSettings,
  defaultMapInput,
  elementToWire,
  encodeLayers,
  graphReferencesMap,
  graphWithoutMap,
  MAX_ADVENTURE_MAPS,
  type MapInput,
  markersJson,
  markersOfRow,
  validateMapInput,
} from "./mapAuthoring.ts";

// D1 caps a single statement at ~100 bound parameters (SQLITE_LIMIT_VARIABLE_NUMBER, as seen through
// Cloudflare's D1 binding). `Repository.createMany` (`.vendor/alepha/src/orm/core/services/
// Repository.ts:866-908`) batches by ROW COUNT only via its `batchSize` option — it has no idea how
// wide a row is, so each entity needs its own batch size derived from its column count, chosen to
// keep `rows * columns` comfortably under the cap. `:memory:` sqlite in tests has no such limit, so
// an unchunked write stays green there while breaking in production — legacy `maps.ts:663-710`
// chunked explicitly for the same reason. Column counts below are every column `cast()` will encode
// for an INSERT (schema fields, including ones filled by a default rather than passed explicitly).
const D1_BOUND_PARAM_BUDGET = 90;
/** id, mapId, col, row, offsetX, offsetY, kind, variant, buildingDestructible, buildingMaxHp,
 *  buildingInteriorMapId.
 *  Exported so `maps.test.ts` can assert
 *  this stays in step with `mapElements`'s actual schema column count — see that test. */
export const MAP_ELEMENT_COLUMNS = 11;
/** id, createdAt, mapId, col, row, name, ordinal, kind, species, patrolRadius, monsterRank,
 *  monsterMaxHp, monsterDamage, monsterSpeed, monsterXp, monsterWeakness, monsterWeaknessPercent,
 *  monsterSpecialTechnique, monsterAttackProfile, monsterRespawnMode, monsterRespawnDelayMs,
 *  harvestProfile, linkedEventId, showMarker, monsterPursuitMode, monsterAcceleration,
 *  monsterMaxSpeed, monsterOneHitKill.
 *  Exported — see
 *  `MAP_ELEMENT_COLUMNS`'s comment. */
export const MAP_EVENT_COLUMNS = 28;
/** id, eventId, position, condSwitchId, condVariableId, condVariableMin, condSelfSwitch,
 *  graphicAssetId, graphicTint, moveType, moveSpeed, moveFreq, optMoveAnim, optStopAnim, optDirFix,
 *  optThrough, optOnTop, optHostile, trigger, moveRoute, commands. Exported — see
 *  `MAP_ELEMENT_COLUMNS`'s comment. */
export const MAP_EVENT_PAGE_COLUMNS = 21;
const MAP_ELEMENT_BATCH_SIZE = Math.floor(D1_BOUND_PARAM_BUDGET / MAP_ELEMENT_COLUMNS);
const MAP_EVENT_BATCH_SIZE = Math.floor(D1_BOUND_PARAM_BUDGET / MAP_EVENT_COLUMNS);
const MAP_EVENT_PAGE_BATCH_SIZE = Math.floor(D1_BOUND_PARAM_BUDGET / MAP_EVENT_PAGE_COLUMNS);
// Reading pages binds one parameter per event id. Dense authored maps can carry 128 runtime events,
// so the read path needs the same production-database discipline as writes and cascade cleanup.
const MAP_EVENT_PAGE_READ_CHUNK = 40;
/**
 * Child tables predate vertical storeys and their unique keys contain only the 2D authored slot.
 * Encode depth outside the legal editor-column range at rest, then restore it at the service
 * boundary. This keeps the existing schema valid while allowing the same logical cell per floor.
 */
const UNDERGROUND_STORAGE_COL_STRIDE = 2_048;

function storedContentCol(col: number, depth: number | undefined): number {
  return depth === undefined ? col : col + depth * UNDERGROUND_STORAGE_COL_STRIDE;
}

function authoredContentCol(col: number, depth: number | undefined): number {
  return depth === undefined ? col : col - depth * UNDERGROUND_STORAGE_COL_STRIDE;
}

/** The `heightfield` column's empty-string "no heightfield" sentinel (matching the `audio`/
 *  `heroSettings` convention on the same entity), normalised to `null` so nothing past
 *  `MapService` needs to know the sentinel exists. */
function heightfieldOfRow(value: string): string | null {
  return value === "" ? null : value;
}

/** Corrupt or missing harvest JSON never escapes as trusted gameplay configuration. */
function decodeHarvestProfileColumn(text: string | null | undefined): HarvestProfile | null {
  if (!text) return null;
  try {
    return parseHarvestProfile(JSON.parse(text));
  } catch {
    return null;
  }
}

export interface MapSummary {
  id: string;
  name: string;
  author: string;
  revision: number;
  cols: number;
  rows: number;
  isFirst: boolean;
  environment: MapEnvironment;
}

/** The wire shape a map round-trips as: `StoredMap` (`maps.ts`) with layers RLE-encoded, exactly
 *  what `mapResponseBody` produced. `accountId` keeps the legacy wire name for continuity even
 *  though the column backing it is `userId` (see Task 6's `maps` entity docblock). */
export interface MapPayload {
  id: string;
  accountId: string;
  adventureId: string;
  name: string;
  revision: number;
  environment: MapEnvironment;
  interiorShell?: InteriorShell;
  underground?: UndergroundMap;
  /** The authored weather, read back out of the heightfield the same way `environment` is. */
  weather: MapWeather;
  tilesetId: string;
  cols: number;
  rows: number;
  layers: string[];
  elements: MapElement[];
  spawn: { col: number; row: number };
  markers: ReturnType<typeof markersOfRow>;
  events: MapEvent[];
  audio: ReturnType<typeof decodeMapAudio>;
  heroSettings: MapHeroSettings;
  dayNightCycle: boolean;
  fixedLighting: MapFixedLighting;
  /** JSON-encoded `MapData` heightfield (`engine/hd2d/map-data.ts`), or `null` if this map has
   *  none yet — the empty-string column sentinel normalised away at this boundary (see
   *  `saveHeightfield`'s docblock). */
  heightfield: string | null;
}

export interface BuildingInteriorResult {
  sourceMap: MapPayload;
  interiorMap: MapPayload;
}

export class MapService {
  heroService = $inject(HeroService);

  maps = $repository(maps);
  users = $repository(users);
  adventures = $repository(adventures);
  mapElements = $repository(mapElements);
  mapEvents = $repository(mapEvents);
  mapEventPages = $repository(mapEventPages);
  parties = $repository(parties);
  heroes = $repository(heroes);

  /** The maps of one adventure (UX wave #5), oldest first. Ported from `listMapsForAdventure`. */
  async listMaps(adventureId: string): Promise<MapSummary[]> {
    const rows = await this.maps.findMany({
      where: { adventureId: { eq: adventureId } },
      orderBy: "createdAt",
    });
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        name: row.name,
        author: (await this.users.findById(row.userId))?.username ?? "unknown",
        revision: row.revision,
        cols: row.cols,
        rows: row.rows,
        isFirst: row.isFirst,
        environment: decodeMap(row.heightfield)?.environment ?? "exterior",
      })),
    );
  }

  /** HTTP-facing list: an adventure id is not a capability to enumerate another author's maps. */
  async listMapsForUser(userId: string, adventureId: string): Promise<MapSummary[]> {
    const rows = await this.maps.findMany({
      where: { adventureId: { eq: adventureId }, userId: { eq: userId } },
      orderBy: "createdAt",
    });
    const author = (await this.users.findById(userId))?.username ?? "unknown";
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      author,
      revision: row.revision,
      cols: row.cols,
      rows: row.rows,
      isFirst: row.isFirst,
      environment: decodeMap(row.heightfield)?.environment ?? "exterior",
    }));
  }

  /**
   * Ported from `createMap`: the trusted blank template, unless `content` carries an authored map.
   *
   * `content` is the editor's unsaved sandbox arriving at its first save (see
   * `AdventureService.createAdventureWithDefaultMap`). Client-authored terrain is not TRUSTED here
   * any more than it is on a `PUT`: it goes through the same `validateMapInput` gate, and the stored
   * heightfield is compiled from it by this server, never taken from the wire.
   */
  async createMap(
    adventureId: string,
    name: string,
    cols?: number,
    rows?: number,
    content?: MapInput,
  ): Promise<MapPayload> {
    const owner = await this.adventures.findById(adventureId);
    if (!owner) throw new Error("not_found: no such adventure");
    const input = content ?? defaultMapInput(name, cols, rows);
    const data = validateMapInput(input);
    const memberMaps = await this.maps.findMany({ where: { adventureId: { eq: adventureId } } });
    const exteriorCount = memberMaps.filter(
      (member) => (decodeMap(member.heightfield)?.environment ?? "exterior") === "exterior",
    ).length;
    if ((data.environment ?? "exterior") === "exterior" && exteriorCount >= MAX_ADVENTURE_MAPS) {
      throw new Error(`limit: at most ${MAX_ADVENTURE_MAPS} maps per adventure`);
    }
    // Interiors no longer steal exterior authoring slots, but remain bounded against accidental
    // recursive room creation. Four editable interiors per exterior slot is deliberately generous.
    if (
      (data.environment ?? "exterior") === "interior" &&
      memberMaps.length >= MAX_ADVENTURE_MAPS * 4
    ) {
      throw new Error(`limit: at most ${MAX_ADVENTURE_MAPS * 4} total maps per adventure`);
    }
    const heightfield = encodeMap(compileAuthoredMap(data, data.events));
    // NOT protected by `$transactional()` on this app's actual production target: Alepha's D1
    // provider reports `supportsTransactions: false`, so `$transactional()` degrades to a no-op
    // there and never opens a `BEGIN` (see `PartyService`'s own docblock for the same fact, verified
    // against the same provider). Two concurrent `createMap` calls for the same account could both
    // read `firstCountForAccount === 0` as true before either write lands, so this count-then-flag
    // pair is NOT what keeps `isFirst` unique per account. The real guard is `map_account_first_
    // unique` (Task 6's partial-unique index on `(userId) WHERE isFirst`): a losing concurrent
    // writer's `create()` fails the unique constraint and the caller sees that error, rather than
    // two rows silently ending up `isFirst: true`. This count is a friendly fast-path for the
    // non-racing, overwhelmingly common case (an account's very first map), not a correctness
    // mechanism.
    const firstCountForAccount = await this.maps.count({ userId: { eq: owner.userId } });
    const id = crypto.randomUUID();
    const row = await this.maps.create({
      id,
      userId: owner.userId,
      adventureId,
      name: data.name,
      cols: input.cols,
      rows: input.rows,
      tilesetId: input.tilesetId,
      layers: encodeLayers(input.layers),
      spawnCol: input.spawn.col,
      spawnRow: input.spawn.row,
      markers: markersJson(data.markers),
      audio: JSON.stringify(data.audio),
      heroSettings: JSON.stringify(data.heroSettings),
      dayNightCycle: data.dayNightCycle,
      fixedLighting: data.fixedLighting,
      heightfield,
      isFirst: firstCountForAccount === 0,
    });
    // The blank template yields empty elements/events; an authored `content` may carry both, and a
    // future default template might seed either — so both are always written from the input.
    await this.writeElements(id, input.elements);
    await this.writeEvents(id, data.events);
    return this.toPayload(row);
  }

  /** HTTP-facing create: only the adventure author may add maps to their adventure. */
  async createMapForUser(
    userId: string,
    adventureId: string,
    name: string,
    cols?: number,
    rows?: number,
  ): Promise<MapPayload> {
    const adventure = await this.adventures.findById(adventureId);
    if (!adventure || adventure.userId !== userId) throw new Error("not_found: no such adventure");
    return this.createMap(adventureId, name, cols, rows);
  }

  /**
   * Create and link one editable interior from an authored building slot. The new room is an
   * ordinary member map; the source element stores only that map id.
   */
  async createBuildingInteriorForUser(
    userId: string,
    sourceMapId: string,
    placement: {
      elementId?: string;
      col?: number;
      row?: number;
      offsetX?: number;
      offsetY?: number;
    },
  ): Promise<BuildingInteriorResult> {
    const source = await this.requireOwnedMap(userId, sourceMapId);
    // A save may rewrite or move a selected element before this second request reaches the room.
    // Its durable row id is therefore the primary key. The composite slot remains as a compatibility
    // fallback for an unsaved element selected by an older client, whose first save has only just
    // minted that id and cannot put it back into the already-captured selection object.
    const byId = placement.elementId
      ? await this.mapElements.findById(placement.elementId)
      : undefined;
    const element =
      byId?.mapId === sourceMapId
        ? byId
        : placement.col !== undefined &&
            placement.row !== undefined &&
            placement.offsetX !== undefined &&
            placement.offsetY !== undefined
          ? await this.mapElements.findOne({
              where: {
                mapId: { eq: sourceMapId },
                col: { eq: placement.col },
                row: { eq: placement.row },
                offsetX: { eq: placement.offsetX },
                offsetY: { eq: placement.offsetY },
              },
            })
          : undefined;
    if (!element || !isStandingBuildingAsset(element.kind)) {
      throw new Error("placement: selected element is not a standing building");
    }
    if (element.buildingInteriorMapId) {
      const existing = await this.maps.findById(element.buildingInteriorMapId);
      if (existing?.adventureId === source.adventureId && existing.userId === userId) {
        return {
          sourceMap: await this.toPayload(source),
          interiorMap: await this.toPayload(existing),
        };
      }
    }

    const suffix = " · Intérieur";
    const name = `${source.name.slice(0, Math.max(1, 48 - suffix.length))}${suffix}`;
    const content = createBuildingInteriorInput({
      name,
      exteriorMapId: source.id,
      exitEventId: crypto.randomUUID(),
      // Returning to the authored exterior spawn is always safer than guessing a door cell from
      // sprite art: the spawn already passed the map's walkability validation.
      returnCol: source.spawnCol,
      returnRow: source.spawnRow,
      buildingAssetId: element.kind,
    });
    const interior = await this.createMap(
      source.adventureId,
      name,
      content.cols,
      content.rows,
      content,
    );
    try {
      await this.mapElements.updateById(element.id, { buildingInteriorMapId: interior.id });
      const updatedSource = await this.maps.updateById(source.id, { revision: sql`revision + 1` });
      return {
        sourceMap: await this.toPayload(updatedSource),
        interiorMap: interior,
      };
    } catch (error) {
      await this.deleteMap(interior.id).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Ported from `loadMap`, and now the HTTP-facing read too — open to any authenticated account,
   * because a map is as readable as the adventure that contains it.
   *
   * `GET /api/maps/:id` used to call an owner-scoped twin (`getMapForUser` → `requireOwnedMap`),
   * which refused a foreign row with the same `not_found` as a missing one. That made adventures
   * unshareable in a way nothing announced: `GET /api/adventures/:id` answered any account
   * happily, then every one of its maps 404'd, so the editor failed the whole load and told the
   * visitor the adventure did not exist. Writing still requires ownership; reading no longer does,
   * and the two entry points are one function again.
   */
  async getMap(id: string): Promise<MapPayload> {
    const row = await this.maps.findById(id);
    if (!row) throw new Error("not_found: no such map");
    return this.toPayload(row);
  }

  /** Ported from `updateMap`. */
  async updateMap(
    id: string,
    input: MapInput,
    expectedRevision?: number,
    proposedAdventure?: AdventureInput,
  ): Promise<MapPayload> {
    const data = validateMapInput(input);
    const heightfield = input.heightfield ?? encodeMap(compileAuthoredMap(data, data.events));
    const existing = await this.maps.findById(id);
    if (!existing) throw new Error("not_found: no such map");
    if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
      throw new Error("conflict: map was changed by another editor");
    }
    const compareRevision = expectedRevision ?? existing.revision;

    const owningAdventure = proposedAdventure
      ? await this.adventures.findById(existing.adventureId)
      : undefined;

    let preparedRegistry: AdventureRegistry | undefined;
    if (proposedAdventure?.registry !== undefined) {
      if (!owningAdventure) throw new Error("not_found: owning adventure vanished");
      preparedRegistry = prepareAdventureRegistry(
        proposedAdventure.registry,
        decodeStoredAdventureRegistry(owningAdventure.registry),
      );
    }

    // COMPAT-only: a normal authoring PUT never sends `adventure.graph` (the editor no longer
    // authors one), so this block only runs for a legacy/test writer that re-seeds it explicitly.
    if (proposedAdventure?.graph && owningAdventure) {
      await this.revalidateGraphOnMapSave(
        id,
        data.events,
        owningAdventure,
        proposedAdventure.graph,
        proposedAdventure,
      );
    }

    let updated: MapRow;
    try {
      updated = await this.maps.updateOne(
        { id: { eq: id }, revision: { eq: compareRevision } },
        {
          name: data.name,
          cols: input.cols,
          rows: input.rows,
          tilesetId: input.tilesetId,
          layers: encodeLayers(input.layers),
          spawnCol: input.spawn.col,
          spawnRow: input.spawn.row,
          markers: markersJson(data.markers),
          ...(input.audio !== undefined ? { audio: JSON.stringify(data.audio) } : {}),
          ...(input.heroSettings !== undefined
            ? { heroSettings: JSON.stringify(data.heroSettings) }
            : {}),
          ...(input.dayNightCycle !== undefined ? { dayNightCycle: data.dayNightCycle } : {}),
          ...(input.fixedLighting !== undefined ? { fixedLighting: data.fixedLighting } : {}),
          heightfield,
          revision: sql`revision + 1`,
        },
      );
    } catch {
      const latest = await this.maps.findById(id);
      if (latest && latest.revision !== compareRevision) {
        throw new Error("conflict: map was changed by another editor");
      }
      throw new Error("not_found: map ownership changed mid-update");
    }

    // Replace wholesale: the new layers land with the new elements/events together, never a map
    // whose terrain moved but whose scenery/events did not (or vice-versa).
    await this.mapElements.deleteMany({ mapId: { eq: id } });
    await this.mapEvents.deleteMany({ mapId: { eq: id } });
    await this.writeElements(id, input.elements);
    await this.writeEvents(id, data.events);

    if (proposedAdventure && owningAdventure) {
      await this.adventures.updateById(owningAdventure.id, {
        title: proposedAdventure.title.trim(),
        maxPlayers: proposedAdventure.maxPlayers,
        ...(proposedAdventure.cameraMode !== undefined
          ? { cameraMode: proposedAdventure.cameraMode }
          : {}),
        ...(proposedAdventure.gameMode !== undefined
          ? { gameMode: proposedAdventure.gameMode }
          : {}),
        ...(proposedAdventure.graph !== undefined
          ? { graph: JSON.stringify(proposedAdventure.graph) }
          : {}),
        ...(proposedAdventure.audio !== undefined
          ? { audio: JSON.stringify(proposedAdventure.audio) }
          : {}),
        ...(preparedRegistry !== undefined ? { registry: JSON.stringify(preparedRegistry) } : {}),
      });
    } else {
      // An empty patch, on purpose: the repository always stamps `updatedAt`, so this is a pure
      // touch. It makes the adventure row mean "last WORKED ON" rather than "last renamed", which
      // is what `AdventureService.listAdventures` orders by and therefore what a bare `/editor`
      // resumes. Without it, an hour of painting would leave the adventure looking untouched since
      // the day it was titled. A map save carries `adventure` only when the editor happens to have
      // metadata to send, so the branch above cannot be relied on to keep the timestamp honest.
      await this.adventures.updateById(existing.adventureId, {});
    }

    return {
      id,
      accountId: existing.userId,
      adventureId: existing.adventureId,
      name: data.name,
      revision: updated.revision,
      environment: data.environment ?? "exterior",
      ...(data.interiorShell ? { interiorShell: data.interiorShell } : {}),
      ...(data.underground ? { underground: data.underground } : {}),
      weather: data.weather ?? "none",
      tilesetId: data.tilesetId,
      cols: data.cols,
      rows: data.rows,
      layers: data.layers.map(encodeTileLayer),
      elements: [...data.elements],
      spawn: data.spawn,
      // `validateMapInput`'s declared return type inherits `MapData.markers?: MapMarkers` (optional
      // for a legacy payload), but its own throw guard means this call's `markers` is always
      // present — `EMPTY_MARKERS` here is an unreachable type-level fallback, not a real one.
      markers: data.markers ?? EMPTY_MARKERS,
      events: data.events,
      audio: input.audio === undefined ? decodeMapAudio(existing.audio) : data.audio,
      heroSettings:
        input.heroSettings === undefined
          ? decodeMapHeroSettings(existing.heroSettings)
          : data.heroSettings,
      dayNightCycle:
        input.dayNightCycle === undefined ? existing.dayNightCycle : data.dayNightCycle,
      fixedLighting:
        input.fixedLighting === undefined ? existing.fixedLighting : data.fixedLighting,
      heightfield,
    };
  }

  /** HTTP-facing update. The ownership check happens before graph or child-row mutation. */
  async updateMapForUser(
    userId: string,
    id: string,
    input: MapInput,
    expectedRevision?: number,
    proposedAdventure?: AdventureInput,
  ): Promise<MapPayload> {
    await this.requireOwnedMap(userId, id);
    return this.updateMap(id, input, expectedRevision, proposedAdventure);
  }

  /** Ported from `deleteMap`. */
  async deleteMap(id: string, options: { force?: boolean } = {}): Promise<void> {
    const row = await this.maps.findById(id);
    if (!row) throw new Error("not_found: no such map");
    const force = options.force === true;
    const owner = await this.adventures.findById(row.adventureId);

    if (!force) {
      const openParties = await this.parties.findMany({
        where: { adventureId: { eq: row.adventureId }, status: { eq: "open" } },
      });
      if (openParties.length > 0) {
        const occupied = await this.heroes.findMany({
          where: {
            partyId: { inArray: openParties.map((party) => party.id) },
            mapId: { eq: row.id },
          },
          limit: 1,
        });
        if (occupied.length > 0) throw new Error("in_use: a player is still in this map");
      }
      if (owner && graphReferencesMap(owner.graph, id)) {
        throw new Error("referenced: an adventure still uses this map");
      }
    }

    const mapCount = await this.maps.count({ adventureId: { eq: row.adventureId } });
    if (mapCount <= 1) throw new Error("last_map: the world needs somewhere to be");

    if (force) {
      // Force also clears the parties/heroes it would otherwise make impossible to remove — for the
      // WHOLE adventure, not just this map, mirroring the legacy unconditional wipe (its guard SQL
      // filters only on `adventure_id`, never on which map a hero happens to be standing on).
      const partiesForAdventure = await this.parties.findMany({
        where: { adventureId: { eq: row.adventureId } },
      });
      for (const party of partiesForAdventure) {
        const heroesInParty = await this.heroes.findMany({ where: { partyId: { eq: party.id } } });
        for (const hero of heroesInParty) {
          await this.heroes.deleteById(hero.id);
          // Fires the same realtime-revocation seam `PartyService.deleteParty` and
          // `TestSessionService` honor for every hero they remove — see `HeroService.onHeroDeleted`'s
          // own docblock.
          await this.heroService.onHeroDeleted(hero.id);
        }
        await this.parties.deleteById(party.id);
      }
      if (owner) {
        const nextGraph = graphWithoutMap(owner.graph, id);
        if (nextGraph !== owner.graph)
          await this.adventures.updateById(owner.id, { graph: nextGraph });
      }
    }

    // Interior links are intentionally scalar rather than foreign keys: deleting a normal member
    // map turns every door that referenced it back into an unlinked building instead of cascading
    // into scenery deletion. Bump each affected exterior revision so an open editor cannot later
    // overwrite that unlink with stale data unnoticed.
    const linkedBuildings = await this.mapElements.findMany({
      where: { buildingInteriorMapId: { eq: id } },
    });
    for (const building of linkedBuildings) {
      await this.mapElements.updateById(building.id, { buildingInteriorMapId: sql`NULL` });
    }
    for (const sourceMapId of new Set(linkedBuildings.map((building) => building.mapId))) {
      if (sourceMapId !== id) {
        await this.maps.updateById(sourceMapId, { revision: sql`revision + 1` });
      }
    }

    await this.mapElements.deleteMany({ mapId: { eq: id } });
    await this.mapEvents.deleteMany({ mapId: { eq: id } });
    await this.maps.deleteById(id);
    await this.reassignFirstIfNeeded(row.userId);
    // One conditional single-statement write, never a read-then-write: `$transactional()` degrades
    // to a no-op on D1, so a `findById` + `updateById` pair here would race a concurrent delete. A
    // dangling `startMapId` would still resolve fine (`HeroService.resolveHeroStart`'s tier 1 falls
    // through when the id no longer names a member map), but leaving it would show the editor's star
    // on a map that no longer exists. `null`, not `undefined` — the ORM's `cast()` keeps only the
    // scalar keys the caller's object actually has (`Object.keys`), so an `undefined` VALUE still
    // reaches drizzle's `.set()`, which then silently drops it and leaves the stale id in place; only
    // an explicit `null` clears the column (`AdventureService.updateAdventure` hit the identical trap
    // — see its own comment on this exact line shape).
    await this.adventures.updateMany(
      { id: { eq: row.adventureId }, startMapId: { eq: id } },
      { startMapId: null },
    );
  }

  /** HTTP-facing delete. Force bypasses references, never ownership. */
  async deleteMapForUser(
    userId: string,
    id: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    await this.requireOwnedMap(userId, id);
    await this.deleteMap(id, options);
  }

  /**
   * Hand the front-door flag to a chosen map. Exactly one map carries it, before and after — clear
   * runs before set, so nothing ever observes two `isFirst` rows for the same account (the
   * `map_account_first_unique` partial-unique index Task 6 ported would reject that). Ported from
   * `setFirstMap`.
   *
   * DEPLOY-TRANCHE ATOMICITY REVISIT: legacy's `setFirstMap` cleared-then-set inside a single D1
   * `db.batch()`, an atomic multi-statement unit on that provider. This clear-then-set pair is two
   * separate `Repository` calls with no such envelope, and `$transactional()` would not restore one
   * either — it degrades to a no-op on Alepha's D1 provider (`supportsTransactions: false`, see
   * `createMap`'s comment above and `PartyService`'s docblock). A crash or a concurrent
   * `setFirstMap`/`createMap` between the clear and the set could leave an account with zero
   * `isFirst` maps for a window (recoverable — `deleteMap`'s `reassignFirstIfNeeded` picks an oldest
   * survivor — but not instantaneous). Revisit when this app actually deploys to D1: either restore
   * a real atomic batch primitive or accept the transient-zero window as a documented trade-off.
   */
  async setFirstMap(id: string): Promise<void> {
    const row = await this.maps.findById(id);
    if (!row) throw new Error("not_found: no such map");
    await this.maps.updateMany(
      { userId: { eq: row.userId }, isFirst: { eq: true } },
      { isFirst: false },
    );
    await this.maps.updateById(row.id, { isFirst: true });
  }

  /** HTTP-facing front-door selection. */
  async setFirstMapForUser(userId: string, id: string): Promise<void> {
    await this.requireOwnedMap(userId, id);
    await this.setFirstMap(id);
  }

  /**
   * One-time deployment bridge for maps created before the HD-2D column existed. This runs during
   * application readiness, not room creation: the runtime still accepts exactly one terrain
   * document and never compiles a fallback while a party is joining.
   */
  async backfillMissingHeightfields(): Promise<number> {
    const missing = await this.maps.findMany({ where: { heightfield: { eq: "" } } });
    let backfilled = 0;
    for (const row of missing) {
      const payload = await this.toPayload(row);
      const authored = parseMapData(payload);
      if (!authored) continue;
      const heightfield = encodeMap(compileAuthoredMap(authored, payload.events));
      await this.maps.updateMany(
        { id: { eq: row.id }, heightfield: { eq: "" } },
        { heightfield, revision: sql`revision + 1` },
      );
      backfilled += 1;
    }
    return backfilled;
  }

  /**
   * Writes the map's heightfield column, deliberately bypassing `updateMap`'s graph/authoring
   * plumbing. The editor and import paths normally compile this field themselves.
   *
   * **UNFENCED, and the only unfenced write on this service.** It answers to a map id and nothing
   * else, so it must never be reached from HTTP. Exactly two kinds of caller remain, both
   * IN-PROCESS and neither with a caller identity to check in the first place:
   * `scripts/build-proving-map.ts` (boots the app itself against a local SQLite file) and the
   * `test-api/` fixtures that stamp terrain on a map they just created. Making them supply a
   * `userId` would mean each first reading the owner off the very row it is about to write, which
   * checks a value against itself — the same dead weight this service's own docblock records
   * legacy's `deleteMap(accountId)` option as having been. Everything that travels over HTTP,
   * including `scripts/seed-proving-adventure.ts` (which no longer touches this service at all —
   * it PUTs the route), goes through {@link saveHeightfieldForUser} below, where the fence lives.
   *
   * It does NOT bypass the revision bump, and must not. `revision` is the map's cache identity
   * (`(mapId, revision)`, see the `maps` entity) and the client early-returns from
   * `configureMapTerrain` on an unchanged pair — a heightfield rewritten under a stale revision
   * would leave a live session drawing the previous terrain forever. `sql\`revision + 1\`` is the
   * same monotone bump `updateMap` applies, done in the database rather than read-then-written
   * here, so two concurrent writers cannot land on the same number.
   */
  async saveHeightfield(id: string, heightfield: string): Promise<void> {
    const row = await this.maps.findById(id);
    if (!row) throw new Error("not_found: no such map");
    await this.maps.updateById(id, { heightfield, revision: sql`revision + 1` });
  }

  /**
   * The heightfield write an HTTP caller reaches (`PUT /api/maps/:id/heightfield`,
   * `MapController.saveHeightfield`): the same column write as above, behind an owner fence.
   *
   * **The fence is this package's existing ownership idiom, not a new one.** `PartyService`'s
   * `deleteParty(userId, partyId)` is the shape being copied line for line — the controller hands
   * down `user.id`, the service loads the row, compares it to the row's own owner column and
   * throws `not_found` when they differ (`HeroService.deleteHero` and `TestSessionService` pass the
   * caller down the same way). The owner column is `userId`, the one `createMap` stamps from the
   * owning adventure's author, so "the map's author" needs no second lookup.
   *
   * **`not_found`, deliberately, and with the identical message a missing row throws.** The map
   * family has no forbidden code (`rethrowAsMapError`: `not_found` -> 404 `map_not_found`), and
   * inventing one would put a machine code on the wire that no dictionary key answers
   * (`packages/client/src/api.ts`). The identical refusal is now the rule for every HTTP map
   * operation: callers cannot distinguish a missing row from another author's row, and no force
   * flag bypasses that ownership fence.
   */
  async saveHeightfieldForUser(userId: string, id: string, heightfield: string): Promise<void> {
    await this.requireOwnedMap(userId, id);
    await this.maps.updateById(id, { heightfield, revision: sql`revision + 1` });
  }

  // ---------------------------------------------------------------------------------------------

  private async requireOwnedMap(userId: string, id: string): Promise<MapRow> {
    const row = await this.maps.findById(id);
    if (!row || row.userId !== userId) throw new Error("not_found: no such map");
    return row;
  }

  private async reassignFirstIfNeeded(userId: string): Promise<void> {
    const stillFlagged = await this.maps.findOne({
      where: { userId: { eq: userId }, isFirst: { eq: true } },
    });
    if (stillFlagged) return;
    // `findOne` (unlike `findMany`) takes no `orderBy` — it is a `limit: 1` `findMany` under the
    // hood with no ordering guarantee, so the "oldest survivor" pick goes through `findMany` here.
    const [survivor] = await this.maps.findMany({
      where: { userId: { eq: userId } },
      orderBy: "createdAt",
      limit: 1,
    });
    if (survivor) await this.maps.updateById(survivor.id, { isFirst: true });
  }

  private async writeElements(mapId: string, elements: readonly MapElement[]): Promise<void> {
    if (elements.length === 0) return;
    await this.mapElements.createMany(
      elements.map((element) => ({
        id: element.id ?? crypto.randomUUID(),
        mapId,
        col: storedContentCol(element.col, element.undergroundDepth),
        row: element.row,
        offsetX: element.offsetX,
        offsetY: element.offsetY,
        kind: element.assetId,
        // Modern rows reuse the historical integer slot for a compact building/bridge transform,
        // optionally wrapped with free rotation. Legacy rows still decode `kind + variant`.
        variant: encodeElementTransform(
          bridgeOrientation(element.assetId)
            ? encodeBridgeDimensions(element.bridge)
            : isStandingBuildingAsset(element.assetId)
              ? encodeBuildingTransform(element.orientation, element.building?.dimensions)
              : isNativeSceneryAsset(element.assetId)
                ? encodeBuildingTransform(element.orientation, element.dimensions)
                : (encodeElementScaleTransform(element.scale ?? 1) ?? 0),
          element.rotation,
        ),
        buildingDestructible: element.building?.destructible,
        buildingMaxHp: element.building?.maxHp,
        buildingInteriorMapId: element.building?.interiorMapId,
      })),
      { batchSize: MAP_ELEMENT_BATCH_SIZE },
    );
  }

  private async writeEvents(mapId: string, events: readonly MapEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.mapEvents.createMany(
      events.map((event) => ({
        id: event.id,
        mapId,
        col: storedContentCol(event.col, event.undergroundDepth),
        row: event.row,
        name: event.name,
        ordinal: event.ordinal,
        linkedEventId: event.linkedEventId,
        showMarker: event.showMarker ?? true,
        kind: event.kind,
        species: event.species ?? undefined,
        patrolRadius: event.patrolRadius ?? undefined,
        monsterRank: event.monsterRank ?? undefined,
        monsterMaxHp: event.monsterMaxHp ?? undefined,
        monsterDamage: event.monsterDamage ?? undefined,
        monsterSpeed: event.monsterSpeed ?? undefined,
        monsterXp: event.monsterXp ?? undefined,
        monsterWeakness: event.monsterWeakness ?? undefined,
        monsterWeaknessPercent: event.monsterWeaknessPercent ?? undefined,
        monsterSpecialTechnique: event.monsterSpecialTechnique ?? undefined,
        monsterAttackProfile: event.monsterAttackProfile ?? undefined,
        monsterRespawnMode: event.monsterRespawnMode ?? undefined,
        monsterRespawnDelayMs: event.monsterRespawnDelayMs ?? undefined,
        monsterPursuitMode: event.monsterPursuitMode ?? undefined,
        monsterAcceleration: event.monsterAcceleration ?? undefined,
        monsterMaxSpeed: event.monsterMaxSpeed ?? undefined,
        monsterOneHitKill: event.monsterOneHitKill ?? false,
        harvestProfile:
          event.harvestProfile === undefined ? undefined : JSON.stringify(event.harvestProfile),
      })),
      { batchSize: MAP_EVENT_BATCH_SIZE },
    );
    // A page's durable identity is `(eventId, position)`; `mapEventPages.position` is minted fresh
    // on every rewrite, 1-based (Task 6's entity bounds it `min(1).max(8)`, unlike the legacy
    // 0-based array index) — order is all that round-trips, not the numeric value itself.
    const pageRows = events.flatMap((event) =>
      event.pages.map((page, index) => ({
        id: crypto.randomUUID(),
        eventId: event.id,
        position: index + 1,
        condSwitchId: page.condSwitchId ?? undefined,
        condVariableId: page.condVariableId ?? undefined,
        condVariableMin: page.condVariableMin ?? undefined,
        condSelfSwitch: page.condSelfSwitch ?? undefined,
        graphicAssetId: page.graphicAssetId ?? undefined,
        graphicTint: page.graphicTint ?? 0xffffff,
        moveType: page.moveType,
        moveRoute: JSON.stringify(page.moveRoute ?? []),
        moveSpeed: page.moveSpeed,
        moveFreq: page.moveFreq,
        optMoveAnim: page.optMoveAnim,
        optStopAnim: page.optStopAnim,
        optDirFix: page.optDirFix,
        optThrough: page.optThrough,
        optOnTop: page.optOnTop,
        // Absent stays absent: a peaceful page writes no column value rather than an explicit
        // `false`, exactly as the parser keeps it out of the wire shape.
        ...(page.optHostile === undefined ? {} : { optHostile: page.optHostile }),
        trigger: page.trigger,
        commands: JSON.stringify(page.commands),
      })),
    );
    if (pageRows.length > 0) {
      await this.mapEventPages.createMany(pageRows, { batchSize: MAP_EVENT_PAGE_BATCH_SIZE });
    }
  }

  private async toPayload(row: MapRow): Promise<MapPayload> {
    let elementRows: MapElementRow[];
    try {
      elementRows = await this.mapElements.findMany({ where: { mapId: { eq: row.id } } });
    } catch (error) {
      throw mapReadError("elements", error);
    }
    let events: MapEvent[];
    try {
      events = await this.loadEvents(row.id);
    } catch (error) {
      if (isMapReadError(error)) throw error;
      throw mapReadError("events", error);
    }
    try {
      const heightfield = heightfieldOfRow(row.heightfield);
      const decodedHeightfield = heightfield ? decodeMap(heightfield) : null;
      const elementDepths = new Map(
        decodedHeightfield?.underground?.elementDepths?.map((entry) => [entry.id, entry.depth]),
      );
      const eventDepths = new Map(
        decodedHeightfield?.underground?.eventDepths?.map((entry) => [entry.id, entry.depth]),
      );
      return {
        id: row.id,
        accountId: row.userId,
        adventureId: row.adventureId,
        name: row.name,
        revision: row.revision,
        environment: decodedHeightfield?.environment ?? "exterior",
        ...(decodedHeightfield?.interiorShell
          ? { interiorShell: decodedHeightfield.interiorShell }
          : {}),
        ...(decodedHeightfield?.underground ? { underground: decodedHeightfield.underground } : {}),
        // Weather rides in the heightfield beside `environment` and is read back the same way: it
        // is authored map-level presentation, so it needs no column of its own.
        weather: decodedHeightfield?.weather ?? "none",
        tilesetId: row.tilesetId,
        cols: row.cols,
        rows: row.rows,
        layers: decodeLayers(row.id, row.layers, row.cols, row.rows).map(encodeTileLayer),
        elements: elementRows.flatMap((element): MapElement[] => {
          const wire = elementToWire(element);
          if (!wire) return [];
          const depth = elementDepths.get(wire.id ?? "");
          return [
            depth === undefined
              ? wire
              : {
                  ...wire,
                  col: authoredContentCol(wire.col, depth),
                  undergroundDepth: depth,
                },
          ];
        }),
        spawn: { col: row.spawnCol, row: row.spawnRow },
        markers: markersOfRow({ markers: row.markers, cols: row.cols, rows: row.rows }),
        events: events.map((event) => {
          const depth = eventDepths.get(event.id);
          return depth === undefined
            ? event
            : {
                ...event,
                col: authoredContentCol(event.col, depth),
                undergroundDepth: depth,
              };
        }),
        audio: decodeMapAudio(row.audio),
        heroSettings: decodeMapHeroSettings(row.heroSettings),
        dayNightCycle: row.dayNightCycle,
        fixedLighting: row.fixedLighting,
        heightfield,
      };
    } catch (error) {
      throw mapReadError("payload", error);
    }
  }

  /** Ported from `eventsOf`: events ordered by ordinal, each carrying its pages ordered by
   *  position. A monster/guard row missing its required tuning is dropped rather than surfaced as
   *  an event the wire parser would reject — the same "one bad row must not break the map" degrade
   *  `toPayload`'s element mapping uses. */
  private async loadEvents(mapId: string): Promise<MapEvent[]> {
    let eventRows: MapEventRow[];
    try {
      eventRows = await this.mapEvents.findMany({
        where: { mapId: { eq: mapId } },
        orderBy: "ordinal",
      });
    } catch (error) {
      throw mapReadError("event_rows", error);
    }
    if (eventRows.length === 0) return [];
    const pageRows: MapEventPageRow[] = [];
    for (const eventIds of chunkArray(
      eventRows.map((event) => event.id),
      MAP_EVENT_PAGE_READ_CHUNK,
    )) {
      try {
        pageRows.push(
          ...(await this.mapEventPages.findMany({
            where: { eventId: { inArray: eventIds } },
            orderBy: "position",
          })),
        );
      } catch (error) {
        throw mapReadError("event_pages", error);
      }
    }
    try {
      const pagesByEvent = new Map<string, MapEventPage[]>();
      for (const page of pageRows) {
        const list = pagesByEvent.get(page.eventId) ?? [];
        list.push(pageToWire(page));
        pagesByEvent.set(page.eventId, list);
      }
      return eventRows.flatMap((row): MapEvent[] => {
        // `spawn` was retired in favour of `adventures.startMapId`. Old authored rows remain in
        // production and are intentionally inert; unknown future/invalid values degrade likewise.
        if (!isEventKind(row.kind)) return [];
        const pages = pagesByEvent.get(row.id);
        if (!pages || pages.length === 0) return [];
        const isMonster = row.kind === "monster";
        const isNpc = row.kind === "npc";
        const isTuned = isMonster || isNpc;
        const isGuard = row.kind === "guard";
        const isHarvestable = row.kind === "harvestable";
        const harvestProfile = isHarvestable
          ? decodeHarvestProfileColumn(row.harvestProfile)
          : null;
        if (
          (isMonster && (!isMonsterSpecies(row.species) || row.patrolRadius == null)) ||
          ((isGuard || isNpc) && row.patrolRadius == null) ||
          (isHarvestable && harvestProfile === null)
        ) {
          return [];
        }
        const species = isMonster && isMonsterSpecies(row.species) ? row.species : null;
        const tuning = isTuned ? defaultMonsterTuning(species ?? "spear_goblin") : null;
        return [
          {
            id: row.id,
            col: row.col,
            row: row.row,
            name: row.name,
            ordinal: row.ordinal,
            ...(row.linkedEventId == null ? {} : { linkedEventId: row.linkedEventId }),
            showMarker: row.showMarker,
            kind: row.kind,
            species,
            patrolRadius: isMonster || isGuard || isNpc ? (row.patrolRadius ?? null) : null,
            monsterRank: isTuned ? (row.monsterRank ?? tuning?.rank ?? null) : null,
            monsterMaxHp: isTuned ? (row.monsterMaxHp ?? tuning?.maxHp ?? null) : null,
            monsterDamage: isTuned ? (row.monsterDamage ?? tuning?.damage ?? null) : null,
            monsterSpeed: isTuned ? (row.monsterSpeed ?? tuning?.speed ?? null) : null,
            monsterXp: isTuned ? (row.monsterXp ?? tuning?.xp ?? null) : null,
            monsterWeakness: isTuned ? (row.monsterWeakness ?? tuning?.weakness ?? null) : null,
            monsterWeaknessPercent: isTuned
              ? (row.monsterWeaknessPercent ?? tuning?.weaknessPercent ?? null)
              : null,
            monsterSpecialTechnique: isTuned
              ? (row.monsterSpecialTechnique ?? tuning?.specialTechnique ?? null)
              : null,
            ...(isMonster && row.monsterAttackProfile != null
              ? { monsterAttackProfile: row.monsterAttackProfile as MonsterAttackProfile }
              : {}),
            ...(isMonster && row.monsterRespawnMode != null
              ? { monsterRespawnMode: row.monsterRespawnMode }
              : {}),
            ...(isMonster && row.monsterRespawnDelayMs != null
              ? { monsterRespawnDelayMs: row.monsterRespawnDelayMs }
              : {}),
            ...(isMonster && row.monsterPursuitMode != null
              ? { monsterPursuitMode: row.monsterPursuitMode }
              : {}),
            ...(isMonster && row.monsterAcceleration != null
              ? { monsterAcceleration: row.monsterAcceleration }
              : {}),
            ...(isMonster && row.monsterMaxSpeed != null
              ? { monsterMaxSpeed: row.monsterMaxSpeed }
              : {}),
            ...(isMonster ? { monsterOneHitKill: row.monsterOneHitKill } : {}),
            ...(harvestProfile === null ? {} : { harvestProfile }),
            pages,
          } as MapEvent,
        ];
      });
    } catch (error) {
      throw mapReadError("event_decode", error);
    }
  }

  /**
   * Graph revalidation before a referenced-map mutation (COMPAT-only path — see `updateMap`'s
   * docblock). Ported from the `proposedAdventure.graph` block inside legacy `updateMap`.
   */
  private async revalidateGraphOnMapSave(
    mapId: string,
    savedEvents: readonly MapEvent[],
    owner: { id: string; title: string; graph: string },
    proposedGraph: AdventureGraph,
    proposedAdventure: AdventureInput,
  ): Promise<void> {
    const memberRows = await this.maps.findMany({ where: { adventureId: { eq: owner.id } } });
    const markersByMap = new Map<string, MapMarkerIds>();
    for (const memberRow of memberRows)
      markersByMap.set(memberRow.id, { entryIds: [], exitIds: [] });
    const otherIds = memberRows
      .map((memberRow) => memberRow.id)
      .filter((memberId) => memberId !== mapId);
    if (otherIds.length > 0) {
      const eventRows = await this.mapEvents.findMany({ where: { mapId: { inArray: otherIds } } });
      for (const event of eventRows) {
        const anchors = markersByMap.get(event.mapId);
        if (!anchors) continue;
        if (event.kind === "entry") (anchors.entryIds as string[]).push(event.id);
        else if (event.kind === "exit") (anchors.exitIds as string[]).push(event.id);
      }
    }
    markersByMap.set(mapId, {
      entryIds: entryEvents(savedEvents).map((event) => event.id),
      exitIds: exitEvents(savedEvents).map((event) => event.id),
    });
    try {
      validateAdventure(
        {
          title: proposedAdventure.title,
          maxPlayers: proposedAdventure.maxPlayers,
          graph: proposedGraph,
        },
        markersByMap,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "invalid graph";
      throw new Error(`referenced: adventure "${owner.title}" would become invalid (${reason})`);
    }
    const storedStart = parseAdventureGraph(JSON.parse(owner.graph))?.start ?? null;
    const nextStart = proposedGraph.start;
    const startMoved =
      storedStart === null
        ? nextStart !== null
        : nextStart === null ||
          nextStart.mapId !== storedStart.mapId ||
          nextStart.entryId !== storedStart.entryId;
    if (startMoved) {
      const used = await this.parties.findMany({
        where: { adventureId: { eq: owner.id } },
        limit: 1,
      });
      if (used.length > 0) throw new Error("referenced: a live party pins this adventure start");
    }
  }
}

/** Consecutive bounded slices for database predicates with one bind per item. */
function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

type MapReadPhase =
  | "elements"
  | "events"
  | "event_rows"
  | "event_pages"
  | "event_decode"
  | "payload";

function mapReadError(phase: MapReadPhase, cause: unknown): Error {
  return new Error(`read_${phase}: stored map content could not be reconstructed`, { cause });
}

function isMapReadError(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith("read_");
}

function pageToWire(page: MapEventPageRow): MapEventPage {
  return {
    condSwitchId: page.condSwitchId ?? null,
    condVariableId: page.condVariableId ?? null,
    condVariableMin: page.condVariableMin ?? null,
    condSelfSwitch: page.condSelfSwitch ?? null,
    graphicAssetId: (page.graphicAssetId as EditorAssetId | undefined) ?? null,
    graphicTint: page.graphicTint,
    moveType: page.moveType,
    moveRoute: parseRoutineColumn(page.moveRoute),
    moveSpeed: page.moveSpeed,
    moveFreq: page.moveFreq,
    optMoveAnim: page.optMoveAnim,
    optStopAnim: page.optStopAnim,
    optDirFix: page.optDirFix,
    optThrough: page.optThrough,
    optOnTop: page.optOnTop,
    ...(page.optHostile === undefined ? {} : { optHostile: page.optHostile }),
    trigger: page.trigger,
    commands: parseCommandsColumn(page.commands),
  };
}

/** Corrupt or unknown JSON degrades to the empty program rather than failing — the same
 *  "one bad row must not break the map" degrade `loadEvents` uses at the event level. */
function parseRoutineColumn(text: string): NonNullable<MapEventPage["moveRoute"]> {
  try {
    return parseNpcRoutine(JSON.parse(text)) ?? [];
  } catch {
    return [];
  }
}

function parseCommandsColumn(text: string): MapEventPage["commands"] {
  try {
    return parseEventCommands(JSON.parse(text)) ?? [];
  } catch {
    return [];
  }
}
