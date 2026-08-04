/**
 * Maps as stored things on Alepha: load, create, save, delete, and the rules that keep the world
 * enterable. Ported from `packages/server/src/maps.ts`, function-by-function, onto `$repository`
 * calls instead of raw Drizzle/D1 statements — see that file's docblock for the two invariants this
 * exists to protect (never delete the last map of an adventure; `isFirst` always has a survivor).
 *
 * **Collaborative editing, preserved from legacy.** `maps.ts` and its own tests
 * (`packages/server/test/maps-api.test.ts`, see the `describe` blocks literally named "collaborative
 * editing is open") establish that ANY authenticated account may list/create/read/update/delete ANY
 * adventure's maps — a map's `userId` inherits from its owning adventure's author, never from the
 * caller, and `deleteMap`'s legacy `accountId` option is accepted but never actually read by the
 * function body. There is no per-map ownership fence to port; a caller id parameter would be dead
 * weight, exactly as it was in the option bag it came from. The task brief's own test list asked for
 * "foreign user -> 404 (ownership is invisibility)"; the actual port source contradicts that in both
 * code and tests, and the brief also says to preserve every legacy behavior — this follows the code.
 * The only genuine 404 boundaries are: an id that matches no row (never existed, wrong table, or a
 * plain string like the retired `BUILTIN_MAP_ID` sentinel, which is not a uuid and so can never match
 * a real row), and a row whose owning adventure has vanished.
 */
import {
  type AdventureGraph,
  type AdventureInput,
  type MapMarkerIds,
  parseAdventureGraph,
  validateAdventure,
} from "@lindocara/engine/adventure.js";
import type { AdventureRegistry } from "@lindocara/engine/adventure-state.js";
import { parseEventCommands } from "@lindocara/engine/event-commands.js";
import {
  defaultMonsterTuning,
  type MonsterAttackProfile,
  type MonsterSpecies,
} from "@lindocara/engine/game.js";
import { type HarvestProfile, parseHarvestProfile } from "@lindocara/engine/harvest.js";
import { EMPTY_MARKERS, type MapElement } from "@lindocara/engine/map-data.js";
import {
  entryEvents,
  exitEvents,
  type MapEvent,
  type MapEventPage,
  parseNpcRoutine,
} from "@lindocara/engine/map-events.js";
import type { MapHeroSettings } from "@lindocara/engine/map-hero-settings.js";
import { encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
import { $inject } from "alepha";
import { $repository, sql } from "alepha/orm";
// Pure, D1-free helper: reused as-is rather than re-ported (see its own docblock).
import {
  decodeStoredAdventureRegistry,
  prepareAdventureRegistry,
} from "../../adventure-registry.js";
import { adventures } from "../entities/adventures.ts";
import { heroes } from "../entities/heroes.ts";
import { mapElements } from "../entities/mapElements.ts";
import { type MapEventPage as MapEventPageRow, mapEventPages } from "../entities/mapEventPages.ts";
import { mapEvents } from "../entities/mapEvents.ts";
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
/** id, mapId, col, row, offsetX, offsetY, kind, variant. Exported so `maps.test.ts` can assert
 *  this stays in step with `mapElements`'s actual schema column count — see that test. */
export const MAP_ELEMENT_COLUMNS = 8;
/** id, createdAt, mapId, col, row, name, ordinal, kind, species, patrolRadius, monsterRank,
 *  monsterMaxHp, monsterDamage, monsterSpeed, monsterXp, monsterWeakness, monsterWeaknessPercent,
 *  monsterSpecialTechnique, monsterAttackProfile, monsterRespawnMode, monsterRespawnDelayMs,
 *  harvestProfile.
 *  Exported — see
 *  `MAP_ELEMENT_COLUMNS`'s comment. */
export const MAP_EVENT_COLUMNS = 22;
/** id, eventId, position, condSwitchId, condVariableId, condVariableMin, condSelfSwitch,
 *  graphicAssetId, graphicTint, moveType, moveSpeed, moveFreq, optMoveAnim, optStopAnim, optDirFix,
 *  optThrough, optOnTop, trigger, moveRoute, commands. Exported — see `MAP_ELEMENT_COLUMNS`'s
 *  comment. */
export const MAP_EVENT_PAGE_COLUMNS = 20;
const MAP_ELEMENT_BATCH_SIZE = Math.floor(D1_BOUND_PARAM_BUDGET / MAP_ELEMENT_COLUMNS);
const MAP_EVENT_BATCH_SIZE = Math.floor(D1_BOUND_PARAM_BUDGET / MAP_EVENT_COLUMNS);
const MAP_EVENT_PAGE_BATCH_SIZE = Math.floor(D1_BOUND_PARAM_BUDGET / MAP_EVENT_PAGE_COLUMNS);

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
  revision: number;
  cols: number;
  rows: number;
  isFirst: boolean;
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
  /** JSON-encoded `MapData` heightfield (`engine/hd2d/map-data.ts`), or `null` if this map has
   *  none yet — the empty-string column sentinel normalised away at this boundary (see
   *  `saveHeightfield`'s docblock). */
  heightfield: string | null;
}

export class MapService {
  heroService = $inject(HeroService);

  maps = $repository(maps);
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
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      revision: row.revision,
      cols: row.cols,
      rows: row.rows,
      isFirst: row.isFirst,
    }));
  }

  /** Ported from `createMap`: always the trusted blank template, never client-authored terrain. */
  async createMap(
    adventureId: string,
    name: string,
    cols?: number,
    rows?: number,
  ): Promise<MapPayload> {
    const owner = await this.adventures.findById(adventureId);
    if (!owner) throw new Error("not_found: no such adventure");
    const mapCount = await this.maps.count({ adventureId: { eq: adventureId } });
    if (mapCount >= MAX_ADVENTURE_MAPS) {
      throw new Error(`limit: at most ${MAX_ADVENTURE_MAPS} maps per adventure`);
    }
    const input = defaultMapInput(name, cols, rows);
    const data = validateMapInput(input);
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
      isFirst: firstCountForAccount === 0,
    });
    // `defaultMapInput` always yields empty elements/events; writing them here keeps this in step
    // with `createMap`'s shape in case a future default template ever seeds either.
    await this.writeElements(id, input.elements);
    await this.writeEvents(id, data.events);
    return this.toPayload(row);
  }

  /** Ported from `loadMap`. */
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
        ...(proposedAdventure.graph !== undefined
          ? { graph: JSON.stringify(proposedAdventure.graph) }
          : {}),
        ...(proposedAdventure.audio !== undefined
          ? { audio: JSON.stringify(proposedAdventure.audio) }
          : {}),
        ...(preparedRegistry !== undefined ? { registry: JSON.stringify(preparedRegistry) } : {}),
      });
    }

    return {
      id,
      accountId: existing.userId,
      adventureId: existing.adventureId,
      name: data.name,
      revision: updated.revision,
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
      // Not part of the authoring PUT (the editor gains this in its own later piece) — carried
      // over from the existing row unconditionally, same as every other write in this method
      // leaves it untouched.
      heightfield: heightfieldOfRow(existing.heightfield),
    };
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

    await this.mapElements.deleteMany({ mapId: { eq: id } });
    await this.mapEvents.deleteMany({ mapId: { eq: id } });
    await this.maps.deleteById(id);
    await this.reassignFirstIfNeeded(row.userId);
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

  /**
   * Writes the map's heightfield column directly — a single-column write shape mirroring
   * `setFirstMap` above, deliberately bypassing `updateMap`'s revision/graph/authoring plumbing.
   * The heightfield is not yet part of the collaborative map-authoring surface (no controller
   * route calls this): today the only writer is `scripts/build-proving-map.ts` (Task 5), and the
   * editor gains its own authoring path in a later piece.
   */
  async saveHeightfield(id: string, heightfield: string): Promise<void> {
    const row = await this.maps.findById(id);
    if (!row) throw new Error("not_found: no such map");
    await this.maps.updateById(id, { heightfield });
  }

  // ---------------------------------------------------------------------------------------------

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
        mapId,
        col: element.col,
        row: element.row,
        offsetX: element.offsetX,
        offsetY: element.offsetY,
        kind: element.assetId,
        variant: 0,
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
        col: event.col,
        row: event.row,
        name: event.name,
        ordinal: event.ordinal,
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
        trigger: page.trigger,
        commands: JSON.stringify(page.commands),
      })),
    );
    if (pageRows.length > 0) {
      await this.mapEventPages.createMany(pageRows, { batchSize: MAP_EVENT_PAGE_BATCH_SIZE });
    }
  }

  private async toPayload(row: MapRow): Promise<MapPayload> {
    const elementRows = await this.mapElements.findMany({ where: { mapId: { eq: row.id } } });
    const events = await this.loadEvents(row.id);
    return {
      id: row.id,
      accountId: row.userId,
      adventureId: row.adventureId,
      name: row.name,
      revision: row.revision,
      tilesetId: row.tilesetId,
      cols: row.cols,
      rows: row.rows,
      layers: decodeLayers(row.id, row.layers, row.cols, row.rows).map(encodeTileLayer),
      elements: elementRows.flatMap((element): MapElement[] => {
        const wire = elementToWire(element);
        return wire ? [wire] : [];
      }),
      spawn: { col: row.spawnCol, row: row.spawnRow },
      markers: markersOfRow({ markers: row.markers, cols: row.cols, rows: row.rows }),
      events,
      audio: decodeMapAudio(row.audio),
      heroSettings: decodeMapHeroSettings(row.heroSettings),
      heightfield: heightfieldOfRow(row.heightfield),
    };
  }

  /** Ported from `eventsOf`: events ordered by ordinal, each carrying its pages ordered by
   *  position. A monster/guard row missing its required tuning is dropped rather than surfaced as
   *  an event the wire parser would reject — the same "one bad row must not break the map" degrade
   *  `toPayload`'s element mapping uses. */
  private async loadEvents(mapId: string): Promise<MapEvent[]> {
    const eventRows = await this.mapEvents.findMany({
      where: { mapId: { eq: mapId } },
      orderBy: "ordinal",
    });
    if (eventRows.length === 0) return [];
    const pageRows = await this.mapEventPages.findMany({
      where: { eventId: { inArray: eventRows.map((event) => event.id) } },
      orderBy: "position",
    });
    const pagesByEvent = new Map<string, MapEventPage[]>();
    for (const page of pageRows) {
      const list = pagesByEvent.get(page.eventId) ?? [];
      list.push(pageToWire(page));
      pagesByEvent.set(page.eventId, list);
    }
    return eventRows.flatMap((row): MapEvent[] => {
      const pages = pagesByEvent.get(row.id);
      if (!pages || pages.length === 0) return [];
      const isMonster = row.kind === "monster";
      const isNpc = row.kind === "npc";
      const isTuned = isMonster || isNpc;
      const isGuard = row.kind === "guard";
      const isHarvestable = row.kind === "harvestable";
      const harvestProfile = isHarvestable ? decodeHarvestProfileColumn(row.harvestProfile) : null;
      if (
        (isMonster && (row.species == null || row.patrolRadius == null)) ||
        ((isGuard || isNpc) && row.patrolRadius == null) ||
        (isHarvestable && harvestProfile === null)
      ) {
        return [];
      }
      const species = isMonster ? (row.species as MonsterSpecies) : null;
      const tuning = isTuned ? defaultMonsterTuning(species ?? "spear_goblin") : null;
      return [
        {
          id: row.id,
          col: row.col,
          row: row.row,
          name: row.name,
          ordinal: row.ordinal,
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
          ...(harvestProfile === null ? {} : { harvestProfile }),
          pages,
        } as MapEvent,
      ];
    });
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
