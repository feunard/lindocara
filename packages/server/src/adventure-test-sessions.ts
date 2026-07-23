/**
 * Disposable adventure playtests.
 *
 * A playtest deliberately runs through the normal party/hero/GameSession/World stack. The only
 * special piece is this D1 envelope: it hides the party from player save/join lists, expires it,
 * and makes reset/exit delete every hero progression row by cascade.
 */

import type { AdventureRegistry } from "@lindocara/engine/adventure-state.js";
import {
  ADVENTURE_TEST_SESSION_TTL_MS,
  type CreateAdventureTestSessionInput,
} from "@lindocara/engine/adventure-test.js";
import { CONSUMABLE_IDS } from "@lindocara/engine/consumables.js";
import { mapSpawnPoint } from "@lindocara/engine/map-data.js";
import {
  collectQuestCommandBindings,
  type QuestDiagnostic,
  type QuestValidationContext,
  validateAuthoredQuests,
} from "@lindocara/engine/quests.js";
import { and, eq, lt } from "drizzle-orm";
import { loadAdventure, resolveAdventureStart } from "./adventures.js";
import {
  adventureTestSession,
  type Db,
  hero as heroTable,
  party as partyTable,
} from "./db/index.js";
import { createHero, loadOwnedHero, type StoredHero } from "./heroes.js";
import { loadMap, type StoredMap } from "./maps.js";
import { deleteParty, type PartyListing, type StoredParty } from "./parties.js";

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
  | {
      readonly ok: true;
      readonly session: AdventureTestSessionPayload;
      readonly replacedHeroIds: readonly string[];
    };

export type AdventureTestPartyAccess =
  | { readonly kind: "normal" }
  | { readonly kind: "allowed"; readonly sessionId: string }
  | { readonly kind: "forbidden"; readonly sessionId: string };

function questContext(registry: AdventureRegistry, maps: StoredMap[]) {
  const offeredQuestIds = new Set<string>();
  const turnInQuestIds = new Set<string>();
  for (const map of maps) {
    for (const event of map.events) {
      for (const page of event.pages) {
        collectQuestCommandBindings(page.commands, offeredQuestIds, turnInQuestIds);
      }
    }
  }
  return {
    mapIds: new Set(maps.map((map) => map.id)),
    eventIdsByMap: new Map(
      maps.map((map) => [map.id, new Set(map.events.map((event) => event.id))]),
    ),
    itemIds: new Set(CONSUMABLE_IDS),
    switchIds: new Set(registry.switches.map((entry) => entry.id)),
    variableIds: new Set(registry.variables.map((entry) => entry.id)),
    offeredQuestIds,
    turnInQuestIds,
  } satisfies QuestValidationContext;
}

async function removeSessions(
  db: Db,
  rows: readonly { id: string; accountId: string; partyId: string }[],
): Promise<string[]> {
  const deletedHeroIds: string[] = [];
  for (const row of rows) {
    // `deleteParty` explicitly returns the heroes whose presence leases must be revoked. Its party
    // deletion cascades the test-session envelope and every normalized hero child row atomically.
    deletedHeroIds.push(...(await deleteParty(db, row.accountId, row.partyId)));
  }
  return deletedHeroIds;
}

/** Remove this account's previous test before a reset/new launch. A real save is never selected. */
async function removeAccountTestSessions(db: Db, accountId: string): Promise<string[]> {
  const rows = await db
    .select({
      id: adventureTestSession.id,
      accountId: adventureTestSession.accountId,
      partyId: adventureTestSession.partyId,
    })
    .from(adventureTestSession)
    .where(eq(adventureTestSession.accountId, accountId));
  return removeSessions(db, rows);
}

/** Opportunistic TTL collection, called by author-facing list/create endpoints. */
export async function cleanupExpiredAdventureTestSessions(
  db: Db,
  now = new Date(),
): Promise<string[]> {
  const rows = await db
    .select({
      id: adventureTestSession.id,
      accountId: adventureTestSession.accountId,
      partyId: adventureTestSession.partyId,
    })
    .from(adventureTestSession)
    .where(lt(adventureTestSession.expiresAt, now));
  return removeSessions(db, rows);
}

/** Admission check: ordinary parties pass through; test parties are owner-only and time-bounded. */
export async function adventureTestPartyAccess(
  db: Db,
  accountId: string,
  partyId: string,
  now = new Date(),
): Promise<AdventureTestPartyAccess> {
  const row = await db
    .select({
      id: adventureTestSession.id,
      accountId: adventureTestSession.accountId,
      expiresAt: adventureTestSession.expiresAt,
    })
    .from(adventureTestSession)
    .where(eq(adventureTestSession.partyId, partyId))
    .get();
  if (!row) return { kind: "normal" };
  return row.accountId === accountId && row.expiresAt.getTime() > now.getTime()
    ? { kind: "allowed", sessionId: row.id }
    : { kind: "forbidden", sessionId: row.id };
}

export async function deleteAdventureTestSession(
  db: Db,
  accountId: string,
  sessionId: string,
): Promise<string[]> {
  const row = await db
    .select({
      id: adventureTestSession.id,
      accountId: adventureTestSession.accountId,
      partyId: adventureTestSession.partyId,
    })
    .from(adventureTestSession)
    .where(
      and(eq(adventureTestSession.id, sessionId), eq(adventureTestSession.accountId, accountId)),
    )
    .get();
  if (!row) throw new Error("not_found: no such adventure test session");
  return removeSessions(db, [row]);
}

export async function createAdventureTestSession(
  db: Db,
  accountId: string,
  adventureId: string,
  input: CreateAdventureTestSessionInput,
  now = new Date(),
): Promise<CreateAdventureTestSessionResult> {
  const adventure = await loadAdventure(db, accountId, adventureId);
  if (!adventure) throw new Error("adventure: no such owned adventure");
  if (adventure.mapIds.length === 0) throw new Error("not_playable: adventure has no map");

  const maps = (await Promise.all(adventure.mapIds.map((mapId) => loadMap(db, mapId)))).filter(
    (map): map is StoredMap => map !== null,
  );
  if (maps.length !== adventure.mapIds.length)
    throw new Error("not_playable: adventure map missing");

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
  const start = requestedMap
    ? { mapId: requestedMap.id, ...mapSpawnPoint(requestedMap) }
    : await resolveAdventureStart(db, adventure);
  if (!start) throw new Error("not_playable: adventure has no start");

  // Validation happens first: a broken draft never destroys the currently running test. From here
  // on, replacement is intentional reset semantics.
  const replacedHeroIds = await removeAccountTestSessions(db, accountId);
  const sessionId = crypto.randomUUID();
  const partyId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + ADVENTURE_TEST_SESSION_TTL_MS);
  const storedParty: StoredParty = {
    id: partyId,
    adventureId: adventure.id,
    adventureVersion: adventure.version,
    maxPlayers: 1,
    hostAccountId: accountId,
    name: null,
    status: "open",
  };

  // One transaction makes the party hidden from the instant it exists. Hero creation follows via
  // the normal normalized/fenced boundary; on any failure the hidden party is removed again.
  await db.$client.batch([
    db.$client
      .prepare(
        `INSERT INTO party
          (id, adventure_id, adventure_version, max_players, host_account_id, name, status,
           created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, NULL, 'open', ?, ?)`,
      )
      .bind(partyId, adventure.id, adventure.version, accountId, now.getTime(), now.getTime()),
    db.$client
      .prepare(
        `INSERT INTO party_member (party_id, account_id, color, joined_at)
         VALUES (?, ?, 'blue', ?)`,
      )
      .bind(partyId, accountId, now.getTime()),
    db.$client
      .prepare(
        `INSERT INTO adventure_test_session
          (id, account_id, adventure_id, party_id, start_map_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        sessionId,
        accountId,
        adventure.id,
        partyId,
        input.startMapId,
        expiresAt.getTime(),
        now.getTime(),
      ),
  ]);

  let createdHero: StoredHero;
  try {
    createdHero = await createHero(db, accountId, partyId, {
      name: "Testeur",
      class: input.heroClass,
    });
    if (
      createdHero.mapId !== start.mapId ||
      createdHero.x !== start.x ||
      createdHero.y !== start.y
    ) {
      await db
        .update(heroTable)
        .set({ mapId: start.mapId, x: start.x, y: start.y, updatedAt: now })
        .where(
          and(
            eq(heroTable.id, createdHero.id),
            eq(heroTable.partyId, partyId),
            eq(heroTable.accountId, accountId),
          ),
        );
      const relocated = await loadOwnedHero(db, accountId, partyId, createdHero.id);
      if (!relocated) throw new Error("not_found: playtest hero vanished after relocation");
      createdHero = relocated;
    }
  } catch (error) {
    await db.delete(partyTable).where(eq(partyTable.id, partyId));
    throw error;
  }

  return {
    ok: true,
    replacedHeroIds,
    session: {
      id: sessionId,
      adventureId: adventure.id,
      startMapId: input.startMapId,
      expiresAt: expiresAt.getTime(),
      party: {
        id: storedParty.id,
        name: null,
        adventureId: adventure.id,
        adventureTitle: adventure.title,
        maxPlayers: 1,
        status: "open",
        hostAccountId: accountId,
        colors: ["blue"],
        mine: true,
        myColor: "blue",
      },
      hero: createdHero,
      diagnostics,
    },
  };
}
