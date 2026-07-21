/**
 * Parties: live playthroughs of an adventure, like private servers. This boundary owns the D1
 * reads and writes; a party is created only from an adventure the caller owns, and records its
 * current version and player cap. Immutable published adventure versions remain a later boundary;
 * this V1 still resolves the mutable adventure id at runtime.
 */
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import {
  type CreatePartyInput,
  MAX_HOSTED_PARTIES,
  PARTY_LIST_PAGE_SIZE,
  type PartyColor,
} from "../shared/party.js";
import { loadAdventure } from "./adventures.js";
import { adventure, type Db, hero, party, partyMember } from "./db/index.js";

export interface PartyListing {
  id: string;
  name: string | null;
  adventureId: string;
  adventureTitle: string;
  maxPlayers: number;
  status: "open" | "completed";
  hostAccountId: string;
  colors: PartyColor[];
  mine: boolean;
  myColor: PartyColor | null;
}

export interface StoredParty {
  id: string;
  adventureId: string;
  adventureVersion: number;
  maxPlayers: number;
  hostAccountId: string;
  name: string | null;
  status: "open" | "completed";
}

export interface PartyListingPage {
  items: PartyListing[];
  nextCursor: string | null;
}

interface PartyCursor {
  createdAt: Date;
  id: string;
}

function parsePartyCursor(value: string | undefined): PartyCursor | null {
  if (value === undefined) return null;
  const separator = value.indexOf(":");
  if (separator <= 0) throw new Error("page: invalid party cursor");
  const timestamp = Number(value.slice(0, separator));
  const id = value.slice(separator + 1);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !/^[A-Za-z0-9-]{1,64}$/.test(id)) {
    throw new Error("page: invalid party cursor");
  }
  return { createdAt: new Date(timestamp), id };
}

function encodePartyCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.getTime()}:${row.id}`;
}

function toStored(row: typeof party.$inferSelect): StoredParty {
  return {
    id: row.id,
    adventureId: row.adventureId,
    adventureVersion: row.adventureVersion,
    maxPlayers: row.maxPlayers,
    hostAccountId: row.hostAccountId,
    name: row.name,
    status: row.status,
  };
}

async function loadPartyRow(db: Db, partyId: string): Promise<typeof party.$inferSelect | null> {
  const rows = await db.select().from(party).where(eq(party.id, partyId)).limit(1);
  return rows[0] ?? null;
}

export async function loadPartyForMember(
  db: Db,
  accountId: string,
  partyId: string,
): Promise<StoredParty | null> {
  const row = await db
    .select({ party })
    .from(party)
    .innerJoin(
      partyMember,
      and(eq(partyMember.partyId, party.id), eq(partyMember.accountId, accountId)),
    )
    .where(eq(party.id, partyId))
    .get();
  return row ? toStored(row.party) : null;
}

/** Runtime-only lookup: admission has already established membership at the Worker boundary. */
export async function loadPartyForRuntime(db: Db, partyId: string): Promise<StoredParty | null> {
  const row = await loadPartyRow(db, partyId);
  return row ? toStored(row) : null;
}

/** Idempotent victory fence. `true` means this call performed the one open -> completed change. */
export async function completeParty(db: Db, partyId: string): Promise<boolean> {
  const completed = await db
    .update(party)
    .set({ status: "completed", updatedAt: new Date() })
    .where(and(eq(party.id, partyId), eq(party.status, "open")))
    .returning({ id: party.id })
    .get();
  return completed !== undefined;
}

export async function createParty(
  db: Db,
  accountId: string,
  input: CreatePartyInput,
): Promise<StoredParty> {
  const adv = await loadAdventure(db, accountId, input.adventureId);
  if (!adv) throw new Error("adventure: no such adventure");
  // D25: the first map + spawn are DERIVED (`resolveAdventureStart`) — a spawn event, else the legacy
  // graph start, else the first map's walkable spawn — so no `graph.start` is required to play. Only a
  // mapless adventure has nowhere for heroes to spawn. Refuse it at creation with a DISTINCT code
  // rather than letting hero creation later fail as a misleading "hero not found".
  if (adv.mapIds.length === 0) throw new Error("not_playable: adventure has no map");
  const id = crypto.randomUUID();
  const row = {
    id,
    adventureId: adv.id,
    adventureVersion: adv.version,
    maxPlayers: adv.maxPlayers,
    hostAccountId: accountId,
    name: input.name,
    status: "open" as const,
  };
  // Both statements are one D1 transaction. The second is conditional on the first having
  // created the party, so a zero-change quota result does not trip a foreign-key error and can be
  // reported as a stable business code. The conditional count is the race-proof backstop.
  const [createdParty] = await db.$client.batch([
    db.$client
      .prepare(
        `INSERT INTO party
           (id, adventure_id, adventure_version, max_players, host_account_id, name, status,
            created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, (unixepoch() * 1000), (unixepoch() * 1000)
         WHERE (SELECT count(*) FROM party WHERE host_account_id = ?) < ?`,
      )
      .bind(
        row.id,
        row.adventureId,
        row.adventureVersion,
        row.maxPlayers,
        row.hostAccountId,
        row.name,
        row.status,
        accountId,
        MAX_HOSTED_PARTIES,
      ),
    db.$client
      .prepare(
        `INSERT INTO party_member (party_id, account_id, color, joined_at)
         SELECT ?, ?, ?, (unixepoch() * 1000)
         WHERE EXISTS (SELECT 1 FROM party WHERE id = ?)`,
      )
      .bind(id, accountId, input.color, id),
  ]);
  if (!createdParty || (createdParty.meta.changes ?? 0) === 0) {
    throw new Error("cap: too many hosted parties");
  }
  const stored = await loadPartyRow(db, id);
  if (!stored) throw new Error("not_found: party vanished mid-create");
  return toStored(stored);
}

export async function listPublicPartiesPage(
  db: Db,
  accountId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<PartyListingPage> {
  const limit = options.limit ?? PARTY_LIST_PAGE_SIZE;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > PARTY_LIST_PAGE_SIZE) {
    throw new Error("page: invalid party page size");
  }
  const cursor = parsePartyCursor(options.cursor);
  const fields = {
    id: party.id,
    name: party.name,
    adventureId: party.adventureId,
    adventureTitle: adventure.title,
    maxPlayers: party.maxPlayers,
    status: party.status,
    hostAccountId: party.hostAccountId,
    createdAt: party.createdAt,
  };
  const cursorCondition = cursor
    ? or(
        lt(party.createdAt, cursor.createdAt),
        and(eq(party.createdAt, cursor.createdAt), lt(party.id, cursor.id)),
      )
    : undefined;
  const base = db
    .select(fields)
    .from(party)
    .innerJoin(adventure, eq(party.adventureId, adventure.id));
  const rows = cursorCondition
    ? await base
        .where(cursorCondition)
        .orderBy(desc(party.createdAt), desc(party.id))
        .limit(limit + 1)
    : await base.orderBy(desc(party.createdAt), desc(party.id)).limit(limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  if (pageRows.length === 0) return { items: [], nextCursor: null };
  const members = await db
    .select({
      partyId: partyMember.partyId,
      accountId: partyMember.accountId,
      color: partyMember.color,
    })
    .from(partyMember)
    .where(
      inArray(
        partyMember.partyId,
        pageRows.map((row) => row.id),
      ),
    );
  const coloursByParty = new Map<string, PartyColor[]>();
  const mineByParty = new Map<string, PartyColor>();
  for (const member of members) {
    const list = coloursByParty.get(member.partyId) ?? [];
    list.push(member.color);
    coloursByParty.set(member.partyId, list);
    if (member.accountId === accountId) mineByParty.set(member.partyId, member.color);
  }
  const lastRow = pageRows.at(-1);
  return {
    items: pageRows.map(({ createdAt: _createdAt, ...row }) => ({
      ...row,
      colors: coloursByParty.get(row.id) ?? [],
      mine: mineByParty.has(row.id),
      myColor: mineByParty.get(row.id) ?? null,
    })),
    nextCursor: hasMore && lastRow ? encodePartyCursor(lastRow) : null,
  };
}

/** Small direct-call convenience for domain tests; the HTTP boundary always uses cursor pages. */
export async function listPublicParties(db: Db, accountId: string): Promise<PartyListing[]> {
  return (await listPublicPartiesPage(db, accountId)).items;
}

export async function joinParty(
  db: Db,
  accountId: string,
  partyId: string,
  color: PartyColor,
): Promise<void> {
  const row = await loadPartyRow(db, partyId);
  if (!row) throw new Error("not_found: no such party");
  const members = await db
    .select({ accountId: partyMember.accountId, color: partyMember.color })
    .from(partyMember)
    .where(eq(partyMember.partyId, partyId));
  if (members.some((member) => member.accountId === accountId)) {
    throw new Error("already_member: already in this party");
  }
  if (members.length >= row.maxPlayers) throw new Error("full: party is full");
  if (members.some((member) => member.color === color)) {
    throw new Error("color_taken: that colour is taken");
  }
  // Atomic cap backstop: the length check above is a friendly fast-path, but two concurrent joins
  // could both pass it before either inserts. This conditional insert writes only while the live
  // count is still under the cap, so a party can never exceed maxPlayers under a race (mirrors
  // deleteMap's last-map guard). PK(partyId,accountId) and UNIQUE(partyId,color) are the matching
  // DB backstops for the already_member and color_taken fences.
  const result = await db.$client
    .prepare(
      `INSERT OR IGNORE INTO party_member (party_id, account_id, color, joined_at)
         SELECT ?, ?, ?, (unixepoch() * 1000)
         WHERE (SELECT count(*) FROM party_member WHERE party_id = ?) < ?`,
    )
    .bind(partyId, accountId, color, partyId, row.maxPlayers)
    .run();
  if ((result.meta.changes ?? 0) > 0) return;

  // `OR IGNORE` turns both uniqueness fences into a zero-change result. Classify against the
  // state that won the serialized SQLite write so concurrent callers always receive a stable
  // business error, never a driver-specific UNIQUE exception.
  const after = await db
    .select({ accountId: partyMember.accountId, color: partyMember.color })
    .from(partyMember)
    .where(eq(partyMember.partyId, partyId));
  if (after.some((member) => member.accountId === accountId)) {
    throw new Error("already_member: already in this party");
  }
  if (after.some((member) => member.color === color)) {
    throw new Error("color_taken: that colour is taken");
  }
  if (after.length >= row.maxPlayers) throw new Error("full: party is full");
  throw new Error("full: party admission lost its atomic guard");
}

export async function deleteParty(db: Db, accountId: string, partyId: string): Promise<string[]> {
  const row = await loadPartyRow(db, partyId);
  if (!row || row.hostAccountId !== accountId) throw new Error("not_found: no such party");

  // Return every deleted hero so the HTTP boundary can revoke its presence lease after the
  // transaction commits. Deleting the hero rows explicitly (rather than relying only on the
  // party FK cascade) makes the identity set deterministic and keeps the delete atomic with the
  // party itself: no active save can survive merely because its account was not the host.
  const [deletedHeroes] = await db.batch([
    db.delete(hero).where(eq(hero.partyId, partyId)).returning({ id: hero.id }),
    db.delete(partyMember).where(eq(partyMember.partyId, partyId)),
    db.delete(party).where(eq(party.id, partyId)),
  ]);
  return deletedHeroes.map((deleted) => deleted.id);
}
