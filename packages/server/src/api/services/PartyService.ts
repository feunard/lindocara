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
 * **No atomic D1-style race backstop.** Legacy's `createParty`/`joinParty` use a conditional
 * `INSERT ... WHERE (SELECT count(*) ...) < cap` D1 batch statement so two concurrent requests can
 * never both slip past the cap check — Alepha's `Repository` has no equivalent primitive, and every
 * existing Alepha-side port (`MapService.createMap`'s `isFirst` flag, `AdventureService`) instead
 * relies on `$transactional()` serializing the whole count-then-act sequence against SQLite's
 * single-writer transaction, exactly as `MapService.createMap`'s own docblock documents. This port
 * follows that same precedent rather than inventing a new pattern; the required test list for this
 * task does not exercise the concurrent-race scenarios legacy's own test suite covers.
 *
 * **`adventure_test_session` exclusion not ported.** Legacy's public listing left-joins
 * `adventure_test_session` to hide playtest parties, and its hosted-party quota excludes them too.
 * Tranche 1 has no service that ever creates an `adventureTestSessions` row yet (the entity exists
 * from Task 7 but is unused), so no row can exist to hide — this is a documented simplification, not
 * a behavioral gap a caller can currently observe.
 */
import {
  MAX_HOSTED_PARTIES,
  PARTY_COLORS,
  PARTY_LIST_PAGE_SIZE,
  type PartyColor,
} from "@lindocara/engine/party.js";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { adventures } from "../entities/adventures.ts";
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
    const rows = await this.parties.findMany({
      ...(cursor
        ? {
            where: {
              or: [
                { createdAt: { lt: cursor.createdAt } },
                {
                  and: [{ createdAt: { eq: cursor.createdAt } }, { id: { lt: cursor.id } }],
                },
              ],
            },
          }
        : {}),
      orderBy: [
        { column: "createdAt", direction: "desc" },
        { column: "id", direction: "desc" },
      ],
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
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
    const hostedCount = await this.parties.count({ hostUserId: { eq: userId } });
    if (hostedCount >= MAX_HOSTED_PARTIES) throw new Error("cap: too many hosted parties");

    const id = crypto.randomUUID();
    const created = await this.parties.create({
      id,
      adventureId: adventure.id,
      adventureVersion: adventure.version,
      maxPlayers: adventure.maxPlayers,
      hostUserId: userId,
      ...(input.name !== null ? { name: input.name } : {}),
      status: "open",
    });
    // A brand-new party has zero members, so the first PARTY_COLORS slot is always free — colour is
    // server-assigned, never a client choice (see this file's docblock).
    await this.partyMembers.create({
      id: crypto.randomUUID(),
      partyId: id,
      userId,
      color: PARTY_COLORS[0],
    });
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
    await this.partyMembers.create({ id: crypto.randomUUID(), partyId, userId, color });
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
