/**
 * Parties as stored things on Alepha: cursor-paginated public listing, create-from-any-adventure
 * (the play flow is not owner-fenced, exactly like legacy), server-assigned-colour join, and
 * host-only delete. Ported from `packages/server/src/parties.ts`, function-by-function, onto
 * `$repository` calls instead of raw Drizzle/D1 statements.
 *
 * **Colour is always server-assigned**, on create AND on join — legacy's `CreatePartyInput.color`
 * (client-suppliable, defaulting `"blue"`) is deliberately NOT read here: the task brief calls for
 * "server-assigned color" on create too, so `createParty` always seats the host in the first
 * `PARTY_COLORS` slot, which is trivially free on a brand-new party (zero existing members).
 *
 * **The cap/full backstops are single-statement conditional INSERTs, not transactions.** A prior pass
 * here claimed `$transactional()` serializes a `count()`-then-`create()` sequence against SQLite's
 * single-writer transaction, mirroring `MapService.createMap`'s `isFirst`-flag reasoning. That claim
 * does not hold for THIS app's actual production target: Alepha's D1 provider reports
 * `supportsTransactions: false`, so `$transactional()` degrades to a no-op there (by design — see its
 * own docs on graceful degradation) and never opens a `BEGIN` at all. Two concurrent `createParty`/
 * `joinParty` calls against D1 could both read `count() < cap` as true before either write landed.
 * `createParty` and `joinParty` below instead build their guarded row as ONE
 * `INSERT ... SELECT ... WHERE (SELECT count(*) ...) < cap` statement via `Repository.query()` — a
 * single SQL statement is atomic on SQLite/D1 with or without a surrounding transaction (this is the
 * exact shape legacy's own D1 conditional-INSERT batch relied on, and D1 IS a SQLite dialect). The
 * plain `count()` checks that remain are friendly fast-paths for the non-racing caller; the atomic
 * INSERT is what actually enforces the cap under a race. `joinParty`'s `INSERT OR IGNORE` additionally
 * folds in the `already_member`/`color_taken` uniqueness fences the same way legacy's D1 batch did,
 * and reclassifies a zero-row outcome by re-reading state, exactly like legacy.
 *
 * **`adventure_test_session` exclusion, now ported (Task 11), via a real join.** Legacy's public
 * listing left-joins `adventure_test_session` to hide playtest parties
 * (`isNull(adventureTestSession.id)`). An earlier version of `listPartiesPage` below approximated
 * that with `notInArray(hiddenPartyIds)` built from a full read of every live
 * `adventureTestSessions` row — one bound SQL parameter per hidden party, unbounded by any page
 * size, so a busy editor day (many concurrent test sessions) could push a single listing query
 * past D1's ~100 bound-parameter cap (`SQLITE_LIMIT_VARIABLE_NUMBER`) and fail every party listing
 * outright. `listPartiesPage` now builds the legacy shape directly instead: a raw
 * `LEFT JOIN adventure_test_session ON adventure_test_session.party_id = parties.id
 * WHERE adventure_test_session.id IS NULL`, via `Repository.query()` (the same raw-SQL escape
 * hatch `createParty`/`joinParty` already use), zero bound parameters for the hidden-party set no
 * matter how many exist. Applied BEFORE the `LIMIT`, so a hidden party never shrinks a page below
 * its requested size, matching the legacy join's own pre-`LIMIT` filtering. The legacy
 * hosted-party-quota exclusion is still NOT ported — `createParty`'s atomic INSERT counts ALL of a
 * user's hosted parties, hidden test parties included — but a test session's party is never counted
 * there anyway (this service never routes a test session through `createParty`), so that half of
 * the gap remains unobservable, unlike the listing half this closes.
 */
import {
  MAX_HOSTED_PARTIES,
  PARTY_COLORS,
  PARTY_LIST_PAGE_SIZE,
  type PartyColor,
} from "@lindocara/engine/party.js";
import { $inject, z } from "alepha";
import { $repository, sql } from "alepha/orm";
import { adventures } from "../entities/adventures.ts";
import { adventureTestSessions } from "../entities/adventureTestSessions.ts";
import { heroes } from "../entities/heroes.ts";
import { maps } from "../entities/maps.ts";
import { type Party, parties } from "../entities/parties.ts";
import { partyMembers } from "../entities/partyMembers.ts";
import { HeroService } from "./HeroService.ts";
import { encodePartyCursor, parsePartyCursor } from "./partyAuthoring.ts";

export interface StoredParty {
  id: string;
  adventureId: string;
  adventureVersion: number;
  maxPlayers: number;
  hostUserId: string;
  name: string | null;
  status: "open" | "completed";
}

export interface PartyListing {
  id: string;
  name: string | null;
  adventureId: string;
  adventureTitle: string;
  maxPlayers: number;
  status: "open" | "completed";
  hostUserId: string;
  colors: PartyColor[];
  mine: boolean;
  myColor: PartyColor | null;
}

export interface PartyListingPage {
  items: PartyListing[];
  nextCursor: string | null;
}

/** Row-shape schema for `Repository.query()`'s `RETURNING id` — see this file's docblock. */
const ID_ROW_SCHEMA = z.object({ id: z.uuid() });

function toStored(row: Party): StoredParty {
  return {
    id: row.id,
    adventureId: row.adventureId,
    adventureVersion: row.adventureVersion,
    maxPlayers: row.maxPlayers,
    hostUserId: row.hostUserId,
    name: row.name ?? null,
    status: row.status,
  };
}

export class PartyService {
  heroService = $inject(HeroService);

  parties = $repository(parties);
  partyMembers = $repository(partyMembers);
  adventures = $repository(adventures);
  maps = $repository(maps);
  heroes = $repository(heroes);
  adventureTestSessions = $repository(adventureTestSessions);

  /** Ported from `listPublicPartiesPage`. */
  async listPartiesPage(
    userId: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<PartyListingPage> {
    const limit = options.limit ?? PARTY_LIST_PAGE_SIZE;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > PARTY_LIST_PAGE_SIZE) {
      throw new Error("page: invalid party page size");
    }
    const cursor = parsePartyCursor(options.cursor);
    // Zero-bound-parameter hidden-party exclusion via a real LEFT JOIN — see this file's docblock
    // for why this replaced a `notInArray(hiddenPartyIds)` read-then-filter.
    //
    // Selects ONLY `id` from the raw join, never `createdAt` — `SqliteModelBuilder.sqliteDateTime`
    // (`.vendor/alepha/src/orm/core/services/SqliteModelBuilder.ts`) stores it as a raw epoch-ms
    // INTEGER and converts to/from the app-level ISO string only inside Drizzle's typed query
    // builder, which `Repository.query()`'s raw SQL bypasses entirely. Selecting it here would hand
    // an undecoded number to `clean()`'s `z.datetime()` validation and throw. The cursor's own
    // `${cursor.createdAt}` (ISO string) is converted to that SAME epoch-ms encoding via
    // `new Date(...).getTime()` — the exact inverse of `sqliteDateTime`'s own `toDriver` — so the
    // WHERE comparison runs raw-number-against-raw-number, matching what the column actually holds.
    // The ordered id list is then re-hydrated through the normal, decode-safe `findMany` below.
    const sessions = this.adventureTestSessions.table;
    const cursorCreatedAtMs = cursor ? new Date(cursor.createdAt).getTime() : undefined;
    const idRows = await this.parties.query(
      (table) =>
        cursor && cursorCreatedAtMs !== undefined
          ? sql`
              SELECT ${table.id} FROM ${table}
              LEFT JOIN ${sessions} ON ${sessions.partyId} = ${table.id}
              WHERE ${sessions.id} IS NULL
                AND (${table.createdAt} < ${cursorCreatedAtMs}
                     OR (${table.createdAt} = ${cursorCreatedAtMs} AND ${table.id} < ${cursor.id}))
              ORDER BY ${table.createdAt} DESC, ${table.id} DESC
              LIMIT ${limit + 1}
            `
          : sql`
              SELECT ${table.id} FROM ${table}
              LEFT JOIN ${sessions} ON ${sessions.partyId} = ${table.id}
              WHERE ${sessions.id} IS NULL
              ORDER BY ${table.createdAt} DESC, ${table.id} DESC
              LIMIT ${limit + 1}
            `,
      ID_ROW_SCHEMA,
    );
    const hasMore = idRows.length > limit;
    const orderedIds = idRows.slice(0, limit).map((row) => row.id);
    if (orderedIds.length === 0) return { items: [], nextCursor: null };
    const partyById = new Map(
      (await this.parties.findMany({ where: { id: { inArray: orderedIds } } })).map((row) => [
        row.id,
        row,
      ]),
    );
    const pageRows = orderedIds.flatMap((id) => {
      const row = partyById.get(id);
      return row ? [row] : [];
    });
    if (pageRows.length === 0) return { items: [], nextCursor: null };

    const adventureIds = [...new Set(pageRows.map((row) => row.adventureId))];
    const adventureRows = await this.adventures.findMany({
      where: { id: { inArray: adventureIds } },
    });
    const titleById = new Map(adventureRows.map((row) => [row.id, row.title]));

    const members = await this.partyMembers.findMany({
      where: { partyId: { inArray: pageRows.map((row) => row.id) } },
    });
    const colorsByParty = new Map<string, PartyColor[]>();
    const mineByParty = new Map<string, PartyColor>();
    for (const member of members) {
      const list = colorsByParty.get(member.partyId) ?? [];
      list.push(member.color);
      colorsByParty.set(member.partyId, list);
      if (member.userId === userId) mineByParty.set(member.partyId, member.color);
    }

    const items: PartyListing[] = pageRows.map((row) => ({
      id: row.id,
      name: row.name ?? null,
      adventureId: row.adventureId,
      adventureTitle: titleById.get(row.adventureId) ?? "",
      maxPlayers: row.maxPlayers,
      status: row.status,
      hostUserId: row.hostUserId,
      colors: colorsByParty.get(row.id) ?? [],
      mine: mineByParty.has(row.id),
      myColor: mineByParty.get(row.id) ?? null,
    }));
    const lastRow = pageRows.at(-1);
    return { items, nextCursor: hasMore && lastRow ? encodePartyCursor(lastRow) : null };
  }

  /** Ported from `createParty`. Deliberately not owner-fenced: any account may start a party on any
   *  playable adventure (the play flow). */
  async createParty(
    userId: string,
    input: { adventureId: string; name: string | null },
  ): Promise<StoredParty> {
    const adventure = await this.adventures.findById(input.adventureId);
    if (!adventure) throw new Error("adventure: no such adventure");
    const mapCount = await this.maps.count({ adventureId: { eq: adventure.id } });
    if (mapCount === 0) throw new Error("not_playable: adventure has no map");

    // Friendly fast-path only — see this file's docblock. The atomic INSERT below is the real guard.
    const hostedCount = await this.parties.count({ hostUserId: { eq: userId } });
    if (hostedCount >= MAX_HOSTED_PARTIES) throw new Error("cap: too many hosted parties");

    const id = crypto.randomUUID();
    // Single-statement conditional INSERT: atomic on SQLite/D1 even with no surrounding transaction
    // (see this file's docblock). Every other column (status/timestamps) is omitted so the table's
    // own SQL-level defaults apply, exactly like the plain `.create()` this replaces.
    const insertedParty = await this.parties.query(
      // `${table.col}` inside an INSERT's column list prints a TABLE-QUALIFIED identifier
      // (`"parties"."id"`), which SQLite's parser rejects there (valid in SELECT/WHERE, not in
      // `INSERT INTO t (...)`) — confirmed empirically against this app's own SQLite provider.
      // `sql.raw(table.col.name)` embeds just the bare physical column name instead.
      (table) => sql`
        INSERT INTO ${table}
          (${sql.raw(table.id.name)}, ${sql.raw(table.adventureId.name)},
           ${sql.raw(table.adventureVersion.name)}, ${sql.raw(table.maxPlayers.name)},
           ${sql.raw(table.hostUserId.name)}, name)
        SELECT ${id}, ${adventure.id}, ${adventure.version}, ${adventure.maxPlayers}, ${userId},
               ${input.name}
        WHERE (SELECT count(*) FROM ${table} WHERE ${table.hostUserId} = ${userId}) < ${MAX_HOSTED_PARTIES}
        RETURNING ${table.id}
      `,
      ID_ROW_SCHEMA,
    );
    if (insertedParty.length === 0) throw new Error("cap: too many hosted parties");

    // A brand-new party has zero members, so the first PARTY_COLORS slot is always free — colour is
    // server-assigned, never a client choice (see this file's docblock). Not racy (nobody else can
    // reference this freshly minted party id yet), so a plain `.create()` is fine here.
    await this.partyMembers.create({
      id: crypto.randomUUID(),
      partyId: id,
      userId,
      color: PARTY_COLORS[0],
    });

    const created = await this.parties.findById(id);
    if (!created) throw new Error("not_found: party vanished mid-create");
    return toStored(created);
  }

  /** Ported from `joinParty`. Colour is always server-assigned: the first free `PARTY_COLORS` slot. */
  async joinParty(userId: string, partyId: string): Promise<void> {
    const row = await this.parties.findById(partyId);
    if (!row) throw new Error("not_found: no such party");
    const members = await this.partyMembers.findMany({ where: { partyId: { eq: partyId } } });
    if (members.some((member) => member.userId === userId)) {
      throw new Error("already_member: already in this party");
    }
    if (members.length >= row.maxPlayers) throw new Error("full: party is full");
    const color = PARTY_COLORS.find((candidate) => !members.some((m) => m.color === candidate));
    if (!color) throw new Error("full: party is full");

    // Single-statement conditional insert, folding in BOTH uniqueness fences (`already_member`,
    // `color_taken`) via `OR IGNORE` and the cap via the `WHERE` subquery — see this file's docblock.
    // Atomic on SQLite/D1 regardless of any surrounding transaction.
    const memberId = crypto.randomUUID();
    const inserted = await this.partyMembers.query(
      // See `createParty`'s comment: `sql.raw(table.col.name)` for the bare column name, never
      // `${table.col}`, inside an INSERT column list.
      (table) => sql`
        INSERT OR IGNORE INTO ${table}
          (${sql.raw(table.id.name)}, ${sql.raw(table.partyId.name)}, ${sql.raw(table.userId.name)}, color)
        SELECT ${memberId}, ${partyId}, ${userId}, ${color}
        WHERE (SELECT count(*) FROM ${table} WHERE ${table.partyId} = ${partyId}) < ${row.maxPlayers}
        RETURNING ${table.id}
      `,
      ID_ROW_SCHEMA,
    );
    if (inserted.length > 0) return;

    // `OR IGNORE` turns both uniqueness fences AND a lost cap race into a silent zero-row result.
    // Classify against the state that won the serialized single-statement write, exactly like
    // legacy's own `joinParty` does after its D1 conditional insert. Priority matches legacy:
    // already_member wins over full, full wins over color_taken (a colour clash is only ever a race
    // artifact once colour is server-assigned).
    const after = await this.partyMembers.findMany({ where: { partyId: { eq: partyId } } });
    if (after.some((member) => member.userId === userId)) {
      throw new Error("already_member: already in this party");
    }
    if (after.length >= row.maxPlayers) throw new Error("full: party is full");
    if (after.some((member) => member.color === color)) {
      throw new Error("color_taken: that colour is taken");
    }
    throw new Error("full: party admission lost its atomic guard");
  }

  /** Ported from `deleteParty`: host-only. `partyMembers`/`heroes` cascade off `parties.id` via FK,
   *  but the hero ids are captured first so `HeroService.onHeroDeleted` can still revoke each one's
   *  realtime seam after the row is gone (mirrors legacy's explicit `revokeHeroes` fan-out). */
  async deleteParty(userId: string, partyId: string): Promise<void> {
    const row = await this.parties.findById(partyId);
    if (!row || row.hostUserId !== userId) throw new Error("not_found: no such party");
    const heroRows = await this.heroes.findMany({ where: { partyId: { eq: partyId } } });
    await this.parties.deleteById(partyId);
    for (const hero of heroRows) await this.heroService.onHeroDeleted(hero.id);
  }
}
