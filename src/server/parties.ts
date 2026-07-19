/**
 * Parties: live playthroughs of an adventure, like private servers. This boundary owns the D1
 * reads and writes; a party is created only from an adventure the caller owns, and records its
 * current version and player cap. Immutable published adventure versions remain a later boundary;
 * this V1 still resolves the mutable adventure id at runtime.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { CreatePartyInput, PartyColor } from "../shared/party.js";
import { loadAdventure } from "./adventures.js";
import { adventure, type Db, party, partyMember } from "./db/index.js";

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
  // A draft adventure (no start authored) has nowhere for heroes to spawn. Refuse the party at
  // creation with a DISTINCT code rather than letting hero creation later fail as a misleading
  // "hero not found" — the fault is the adventure, not the hero.
  if (!adv.graph.start) throw new Error("not_playable: adventure has no start");
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
  await db.batch([
    db.insert(party).values(row),
    db.insert(partyMember).values({ partyId: id, accountId, color: input.color }),
  ]);
  const stored = await loadPartyRow(db, id);
  if (!stored) throw new Error("not_found: party vanished mid-create");
  return toStored(stored);
}

export async function listPublicParties(db: Db, accountId: string): Promise<PartyListing[]> {
  const rows = await db
    .select({
      id: party.id,
      name: party.name,
      adventureId: party.adventureId,
      adventureTitle: adventure.title,
      maxPlayers: party.maxPlayers,
      status: party.status,
      hostAccountId: party.hostAccountId,
    })
    .from(party)
    .innerJoin(adventure, eq(party.adventureId, adventure.id));
  if (rows.length === 0) return [];
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
        rows.map((row) => row.id),
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
  return rows.map((row) => ({
    ...row,
    colors: coloursByParty.get(row.id) ?? [],
    mine: mineByParty.has(row.id),
    myColor: mineByParty.get(row.id) ?? null,
  }));
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

export async function deleteParty(db: Db, accountId: string, partyId: string): Promise<void> {
  const row = await loadPartyRow(db, partyId);
  if (!row || row.hostAccountId !== accountId) throw new Error("not_found: no such party");
  await db.batch([
    db.delete(partyMember).where(eq(partyMember.partyId, partyId)),
    db.delete(party).where(eq(party.id, partyId)),
  ]);
}
