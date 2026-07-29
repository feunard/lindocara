/**
 * Adventure test sessions as stored things on Alepha: a disposable, editor-owned playtest that
 * provisions a hidden real party+hero on the caller's chosen adventure/map, runs playability
 * diagnostics up front, and tears the whole envelope down on delete or replacement. Ported from
 * `packages/server/src/adventure-test-sessions.ts`, function-by-function, onto `$repository` calls
 * and the existing Task 10 services instead of raw Drizzle/D1 statements and a bespoke
 * `deleteParty`.
 *
 * **Collaborative, not author-only.** This task's own brief says "author-only", but the legacy
 * source it ports contradicts that: `createAdventureTestSession` in
 * `packages/server/src/adventure-test-sessions.ts` has no ownership check against the adventure's
 * author at all — its own docblock says outright "Collaborative editing: the editor playtests
 * anyone's adventure," matching every other Task 8/9 collaborative-editing precedent
 * (`AdventureService`/`MapService`). `MapService`'s own docblock resolved an identical brief/code
 * conflict the same way: follow the legacy CODE, not the brief's paraphrase of it. `DELETE` IS
 * ownership-fenced (a session's own `userId`), matching legacy `deleteAdventureTestSession`.
 *
 * **The hero-creation path is not forked.** `HeroService.createHero` already resolves the
 * adventure's default start (its own `resolveHeroStart`, the full 3-tier port of legacy
 * `resolveAdventureStart`) as part of every normal hero create — this reuses that path unchanged
 * for the "adventure global start" case (`input.startMapId === null`) and only relocates the freshly
 * created hero afterward when the caller chose a specific member map, exactly mirroring legacy's own
 * `createHero` + conditional relocate-and-reload sequence.
 *
 * **Replacement, not conflict, ported exactly.** `adventureTestSessions` carries two real unique
 * indexes (`userId`, `partyId` — Task 7). Legacy's create flow removes the account's previous test
 * session(s) BEFORE inserting the new one (`removeAccountTestSessions`), so a second create for the
 * same account REPLACES the first rather than ever colliding with either index — the party gets a
 * fresh uuid every time, so the `partyId` index never collides either. `removeAccountTestSessions`
 * below reuses `PartyService.deleteParty` (host-only party delete) rather than a bespoke query: that
 * single call already cascades the party's `partyMembers`/`heroes`/`adventureTestSessions` rows (all
 * FK `cascade` off `parties.id`) AND fires `HeroService.onHeroDeleted` for every removed hero — the
 * exact realtime seam legacy's own `revokeHeroes` fan-out existed for, with no separate wiring needed
 * here.
 *
 * **Validation happens before replacement**, exactly like legacy: a broken draft must never destroy
 * the account's currently running test session.
 */
import type { AdventureRegistry } from "@lindocara/engine/adventure-state.js";
import {
  ADVENTURE_TEST_SESSION_TTL_MS,
  type CreateAdventureTestSessionInput,
} from "@lindocara/engine/adventure-test.js";
import { CONSUMABLE_IDS } from "@lindocara/engine/consumables.js";
import { PARTY_COLORS } from "@lindocara/engine/party.js";
import {
  collectQuestCommandBindings,
  type QuestDiagnostic,
  type QuestValidationContext,
  validateAuthoredQuests,
} from "@lindocara/engine/quests.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { adventureTestSessions } from "../entities/adventureTestSessions.ts";
import { heroes } from "../entities/heroes.ts";
import { parties } from "../entities/parties.ts";
import { partyMembers } from "../entities/partyMembers.ts";
import { AdventureService, type StoredAdventure } from "./AdventureService.ts";
import { HeroService, type StoredHero } from "./HeroService.ts";
import { type MapPayload, MapService } from "./MapService.ts";
import { type PartyListing, PartyService } from "./PartyService.ts";

export interface AdventureTestSessionPayload {
  readonly id: string;
  readonly adventureId: string;
  readonly startMapId: string | null;
  readonly expiresAt: number;
  readonly party: PartyListing;
  readonly hero: StoredHero;
  /** Non-blocking diagnostics still matter to the creator and are shown before they continue. */
  readonly diagnostics: readonly QuestDiagnostic[];
}

export type CreateAdventureTestSessionResult =
  | { readonly ok: false; readonly diagnostics: readonly QuestDiagnostic[] }
  | { readonly ok: true; readonly session: AdventureTestSessionPayload };

/** The `spawnCol`/`spawnRow -> {x,y}` arithmetic every other tile-center helper in this codebase
 *  encodes (`@lindocara/engine/map-data.js`'s `mapSpawnPoint`, `HeroService`'s own
 *  `mapDefaultSpawn`), applied to a `MapPayload.spawn` (already `{col,row}`) instead of a bare map
 *  row or a full `MapData`. Same formula, same `TILE_SIZE`, by construction. */
function tileCenter(spawn: { col: number; row: number }): { x: number; y: number } {
  return { x: spawn.col * TILE_SIZE + TILE_SIZE / 2, y: spawn.row * TILE_SIZE + TILE_SIZE / 2 };
}

/** Ported from `adventure-test-sessions.ts`'s own `questContext`, re-typed against `MapPayload`
 *  (`MapService`'s wire shape) instead of legacy's `StoredMap` — both carry the exact same
 *  `@lindocara/engine/map-events.js` `MapEvent[]` on `.events`, so the body is unchanged. */
function questContext(
  registry: AdventureRegistry,
  maps: readonly MapPayload[],
): QuestValidationContext {
  const offeredQuestIds = new Set<string>();
  const turnInQuestIds = new Set<string>();
  const activityIds = new Set<string>();
  const areaIdsByMap = new Map<string, Set<string>>();
  for (const map of maps) {
    const areaIds = new Set<string>();
    areaIdsByMap.set(map.id, areaIds);
    for (const event of map.events) {
      for (const page of event.pages) {
        collectQuestCommandBindings(
          page.commands,
          offeredQuestIds,
          turnInQuestIds,
          activityIds,
          page.trigger === "player-touch" ? areaIds : undefined,
        );
      }
    }
  }
  return {
    mapIds: new Set(maps.map((map) => map.id)),
    eventIdsByMap: new Map(
      maps.map((map) => [map.id, new Set(map.events.map((event) => event.id))]),
    ),
    monsterSpeciesByMap: new Map(
      maps.map((map) => [
        map.id,
        new Set(
          map.events.flatMap((event) =>
            event.kind === "monster" && event.species ? [event.species] : [],
          ),
        ),
      ]),
    ),
    monsterEventIdsByMap: new Map(
      maps.map((map) => [
        map.id,
        new Set(map.events.flatMap((event) => (event.kind === "monster" ? [event.id] : []))),
      ]),
    ),
    areaIdsByMap,
    itemIds: new Set(CONSUMABLE_IDS),
    activityIds,
    switchIds: new Set(registry.switches.map((entry) => entry.id)),
    variableIds: new Set(registry.variables.map((entry) => entry.id)),
    offeredQuestIds,
    turnInQuestIds,
  };
}

export class TestSessionService {
  adventureService = $inject(AdventureService);
  mapService = $inject(MapService);
  heroService = $inject(HeroService);
  partyService = $inject(PartyService);

  parties = $repository(parties);
  partyMembers = $repository(partyMembers);
  heroes = $repository(heroes);
  adventureTestSessions = $repository(adventureTestSessions);

  /** Ported from `createAdventureTestSession`. */
  async createTestSession(
    userId: string,
    adventureId: string,
    input: CreateAdventureTestSessionInput,
    now = new Date(),
  ): Promise<CreateAdventureTestSessionResult> {
    // Collaborative editing: the editor playtests anyone's adventure — see this file's docblock.
    // `getAdventure` throws its own "not_found: ..." on a missing row; that prefix is reserved by
    // `deleteTestSession` for a missing SESSION (matching legacy's exact two-prefix split), so any
    // failure to load here is rethrown with the "adventure:" prefix legacy itself used.
    let adventure: StoredAdventure;
    try {
      adventure = await this.adventureService.getAdventure(adventureId);
    } catch {
      throw new Error("adventure: no such adventure");
    }
    if (adventure.mapIds.length === 0) throw new Error("not_playable: adventure has no map");

    const maps = (
      await Promise.all(
        adventure.mapIds.map(async (mapId): Promise<MapPayload | null> => {
          try {
            return await this.mapService.getMap(mapId);
          } catch {
            return null;
          }
        }),
      )
    ).filter((map): map is MapPayload => map !== null);
    if (maps.length !== adventure.mapIds.length) {
      throw new Error("not_playable: adventure map missing");
    }

    const diagnostics = validateAuthoredQuests(
      adventure.registry.quests ?? [],
      questContext(adventure.registry, maps),
    );
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return { ok: false, diagnostics };
    }

    const requestedMap =
      input.startMapId === null
        ? null
        : (maps.find((candidate) => candidate.id === input.startMapId) ?? null);
    if (input.startMapId !== null && !requestedMap) {
      throw new Error("map: selected test map is not part of the adventure");
    }

    // Validation happens first — see this file's docblock. From here on, replacement is intentional
    // reset semantics: a broken draft must never destroy the currently running test.
    await this.removeAccountTestSessions(userId);

    const sessionId = crypto.randomUUID();
    const partyId = crypto.randomUUID();
    const expiresAt = new Date(now.getTime() + ADVENTURE_TEST_SESSION_TTL_MS);

    await this.parties.create({
      id: partyId,
      adventureId: adventure.id,
      adventureVersion: adventure.version,
      maxPlayers: 1,
      hostUserId: userId,
      status: "open",
    });
    await this.partyMembers.create({
      id: crypto.randomUUID(),
      partyId,
      userId,
      color: PARTY_COLORS[0],
    });
    await this.adventureTestSessions.create({
      id: sessionId,
      userId,
      adventureId: adventure.id,
      partyId,
      ...(input.startMapId !== null ? { startMapId: input.startMapId } : {}),
      expiresAt: expiresAt.toISOString(),
    });

    // Hero creation follows via the normal normalized/fenced boundary; on any failure the hidden
    // party is removed again (its cascade also removes the just-created member/session rows).
    let hero: StoredHero;
    try {
      hero = await this.heroService.createHero(userId, partyId, {
        name: "Testeur",
        class: input.heroClass,
      });
      if (requestedMap) {
        const start = { mapId: requestedMap.id, ...tileCenter(requestedMap.spawn) };
        if (hero.mapId !== start.mapId || hero.x !== start.x || hero.y !== start.y) {
          await this.heroes.updateById(hero.id, { mapId: start.mapId, x: start.x, y: start.y });
          hero = { ...hero, mapId: start.mapId, x: start.x, y: start.y };
        }
      }
    } catch (error) {
      await this.parties.deleteById(partyId);
      throw error;
    }

    return {
      ok: true,
      session: {
        id: sessionId,
        adventureId: adventure.id,
        startMapId: input.startMapId,
        expiresAt: expiresAt.getTime(),
        party: {
          id: partyId,
          name: null,
          adventureId: adventure.id,
          adventureTitle: adventure.title,
          maxPlayers: 1,
          status: "open",
          hostUserId: userId,
          colors: [PARTY_COLORS[0]],
          mine: true,
          myColor: PARTY_COLORS[0],
        },
        hero,
        diagnostics,
      },
    };
  }

  /** Ported from `deleteAdventureTestSession`: ownership-fenced by the session's own `userId`. */
  async deleteTestSession(userId: string, sessionId: string): Promise<void> {
    const row = await this.adventureTestSessions.findOne({
      where: { id: { eq: sessionId }, userId: { eq: userId } },
    });
    if (!row) throw new Error("not_found: no such adventure test session");
    await this.partyService.deleteParty(userId, row.partyId);
  }

  // ---------------------------------------------------------------------------------------------

  /** Ported from `removeAccountTestSessions`: remove this account's previous test session(s) before
   *  a reset/new launch — a real save is never selected (`partyId` always names a hidden test
   *  party, see this file's docblock). Reuses `PartyService.deleteParty`'s cascade + realtime seam
   *  rather than a bespoke query. */
  private async removeAccountTestSessions(userId: string): Promise<void> {
    const rows = await this.adventureTestSessions.findMany({ where: { userId: { eq: userId } } });
    for (const row of rows) {
      await this.partyService.deleteParty(userId, row.partyId);
    }
  }
}
