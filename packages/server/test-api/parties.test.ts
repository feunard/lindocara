/**
 * The parties API on Alepha: session gate, create-from-any-adventure with a server-assigned colour
 * (creator auto-joined), the 5th-member `party_full` fence, `already_member`/`color_taken`,
 * host-only delete, `adventure_not_playable` on a draft adventure, and cursor pagination (including
 * `party_page_invalid`). Drives the real HTTP server, same idiom as `maps.test.ts`/`adventures.test.ts`
 * (real `fetch()` against `ServerProvider.hostname`, never the typed client, because
 * `PartyController`'s schemas are deliberately loose; see its own docblock).
 *
 * Business rules are ported from `packages/server/test/parties.test.ts` and
 * `packages/server/test/parties-api.test.ts` (read in full before writing this file). See
 * `PartyService`'s own docblock for the two documented divergences: colour is server-assigned on
 * CREATE too (not just join), and the `adventure_test_session` listing exclusion is not ported
 * (nothing creates one yet in this tranche).
 */
import { MAX_HOSTED_PARTIES, PARTY_COLORS } from "@lindocara/engine/party.js";
import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { ServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { adventures } from "../src/api/entities/adventures.ts";
import { heroes } from "../src/api/entities/heroes.ts";
import { parties } from "../src/api/entities/parties.ts";
import { partyMembers } from "../src/api/entities/partyMembers.ts";
import { PartyRoom } from "../src/api/realtime/PartyRoom.ts";
import { HeroService } from "../src/api/services/HeroService.ts";
import { createTestApp } from "./helpers.ts";

const PASSWORD = "Sup3rSecret";

class SeedProbe {
  adventures = $repository(adventures);
  parties = $repository(parties);
  partyMembers = $repository(partyMembers);
  heroes = $repository(heroes);
}

let alepha: ReturnType<typeof createTestApp>;
let probe: SeedProbe;
let hostname: string;
let userCount = 0;

beforeEach(async () => {
  alepha = createTestApp();
  probe = alepha.inject(SeedProbe);
  await alepha.start();
  hostname = alepha.inject(ServerProvider).hostname;
});

afterEach(async () => {
  await alepha.stop();
});

async function registerAndLogin(prefix: string): Promise<{ userId: string; token: string }> {
  userCount += 1;
  const username = `${prefix}${userCount}`;
  const users = alepha.inject(UserController);
  const intent = await users.createRegistrationIntent.fetch({
    body: { username, password: PASSWORD },
  });
  const registered = await users.createUserFromIntent.fetch({
    body: { intentId: intent.data.intentId },
  });
  const login = await fetch(`${hostname}/_auth/token?provider=credentials`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const tokens = (await login.json()) as { access_token: string };
  return { userId: registered.data.id, token: tokens.access_token };
}

function authedFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${hostname}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
}

/** `POST /api/adventures` creates its adventure AND an atomic default map in one call, so the
 *  result is immediately playable — no separate map-authoring round trip needed for a party fixture. */
async function newPlayableAdventure(token: string, maxPlayers = 4): Promise<string> {
  const response = await authedFetch("/api/adventures", token, {
    method: "POST",
    body: JSON.stringify({ title: "Donjon", maxPlayers }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

/** A draft adventure with zero maps (bypassing the controller's atomic default-map create) — the
 *  only way to reach `adventure_not_playable`, mirroring `maps.test.ts`'s direct-probe pattern. */
async function newDraftAdventure(userId: string): Promise<string> {
  const created = await probe.adventures.create({
    userId,
    title: "WIP",
    graph: JSON.stringify({ start: null, links: [] }),
  });
  return created.id;
}

describe("session gate", () => {
  test("401s every party route without a bearer token", async () => {
    const routes: [string, string][] = [
      ["GET", "/api/parties"],
      ["POST", "/api/parties"],
      ["POST", "/api/parties/whatever/join"],
      ["DELETE", "/api/parties/whatever/membership"],
      ["DELETE", "/api/parties/whatever/archive"],
      ["DELETE", "/api/parties/whatever"],
    ];
    for (const [method, path] of routes) {
      const needsBody = method === "POST" && path === "/api/parties";
      const response = await fetch(`${hostname}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(needsBody ? { body: JSON.stringify({}) } : {}),
      });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("createParty", () => {
  test("creates from any adventure, host auto-joined with a server-assigned colour", async () => {
    const { userId, token } = await registerAndLogin("partyhost");
    const adventureId = await newPlayableAdventure(token, 3);

    const response = await authedFetch("/api/parties", token, {
      method: "POST",
      body: JSON.stringify({ adventureId, name: "Chez Nico" }),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      id: string;
      adventureId: string;
      maxPlayers: number;
      hostUserId: string;
      name: string | null;
      status: string;
    };
    expect(created).toMatchObject({
      adventureId,
      maxPlayers: 3,
      hostUserId: userId,
      name: "Chez Nico",
      status: "open",
    });

    const listed = await authedFetch("/api/parties", token);
    const page = (await listed.json()) as {
      items: { id: string; colors: string[]; mine: boolean; myColor: string | null }[];
    };
    const listing = page.items.find((item) => item.id === created.id);
    expect(listing).toMatchObject({
      colors: [PARTY_COLORS[0]],
      mine: true,
      myColor: PARTY_COLORS[0],
    });
  });

  test("ignores any client-suppliable colour — colour is always server-assigned", async () => {
    const { token } = await registerAndLogin("partycolor");
    const adventureId = await newPlayableAdventure(token);
    const response = await authedFetch("/api/parties", token, {
      method: "POST",
      body: JSON.stringify({ adventureId, color: "purple" }),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    const listed = await authedFetch("/api/parties", token);
    const page = (await listed.json()) as { items: { id: string; myColor: string | null }[] };
    expect(page.items.find((item) => item.id === created.id)?.myColor).toBe(PARTY_COLORS[0]);
  });

  test("refuses a draft adventure with a distinct not-playable code", async () => {
    const { userId, token } = await registerAndLogin("partydraft");
    const adventureId = await newDraftAdventure(userId);
    const response = await authedFetch("/api/parties", token, {
      method: "POST",
      body: JSON.stringify({ adventureId }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "adventure_not_playable" });
  });

  test("404s an unknown adventure with party_adventure", async () => {
    const { token } = await registerAndLogin("partynoadv");
    const response = await authedFetch("/api/parties", token, {
      method: "POST",
      body: JSON.stringify({ adventureId: "00000000-0000-4000-8000-000000000000" }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "party_adventure" });
  });

  test("400s an invalid create body", async () => {
    const { token } = await registerAndLogin("partyinvalid");
    const response = await authedFetch("/api/parties", token, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "party_invalid" });
  });

  test("enforces the hosted-party quota", async () => {
    const { userId, token } = await registerAndLogin("partyquota");
    const adventureId = await newPlayableAdventure(token);
    for (let index = 0; index < MAX_HOSTED_PARTIES; index += 1) {
      await probe.parties.create({
        adventureId,
        adventureVersion: 1,
        maxPlayers: 4,
        hostUserId: userId,
        status: "open",
      });
    }
    // At the cap: the atomic conditional-INSERT guard (not just the friendly count() fast-path) must
    // refuse a create attempted exactly at the boundary and leave the row count unchanged.
    const response = await authedFetch("/api/parties", token, {
      method: "POST",
      body: JSON.stringify({ adventureId }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "party_cap" });
    const hostedAfter = await probe.parties.findMany({ where: { hostUserId: { eq: userId } } });
    expect(hostedAfter).toHaveLength(MAX_HOSTED_PARTIES);
  });

  test("413s request_too_large on a create body over the 4 KiB small-route cap", async () => {
    const { token } = await registerAndLogin("partytoolarge");
    const adventureId = await newPlayableAdventure(token);
    // Padding well past `MAX_API_JSON_BYTES` (4 KiB) — `enforceBodySizeCap` runs before
    // `parseCreatePartyInput`, so this 413s regardless of the rest of the body's shape.
    const response = await authedFetch("/api/parties", token, {
      method: "POST",
      body: JSON.stringify({ adventureId, name: "x".repeat(5_000) }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "request_too_large" });
  });
});

describe("joinParty", () => {
  test("assigns the next free colour and fences already_member, then refuses the 5th member", async () => {
    const { token: hostToken } = await registerAndLogin("joinhost");
    const adventureId = await newPlayableAdventure(hostToken, 4);
    const created = await authedFetch("/api/parties", hostToken, {
      method: "POST",
      body: JSON.stringify({ adventureId }),
    });
    const party = (await created.json()) as { id: string };

    const dup = await authedFetch(`/api/parties/${party.id}/join`, hostToken, { method: "POST" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: "party_already_member" });

    // host holds PARTY_COLORS[0]; three more accounts fill the remaining three slots.
    for (let index = 1; index < PARTY_COLORS.length; index += 1) {
      const guest = await registerAndLogin(`joinguest${index}`);
      const response = await authedFetch(`/api/parties/${party.id}/join`, guest.token, {
        method: "POST",
      });
      expect(response.status, `guest ${index}`).toBe(204);
    }

    // The party is now full (host + 3 guests = maxPlayers 4); a 5th member is refused. This is
    // exactly the at-the-cap boundary: the atomic conditional-INSERT guard (not just the earlier
    // friendly length check) must refuse it and leave the member count unchanged.
    const fifth = await registerAndLogin("joinfifth");
    const overflow = await authedFetch(`/api/parties/${party.id}/join`, fifth.token, {
      method: "POST",
    });
    expect(overflow.status).toBe(409);
    expect(await overflow.json()).toMatchObject({ error: "party_full" });
    const membersAfter = await probe.partyMembers.findMany({
      where: { partyId: { eq: party.id } },
    });
    expect(membersAfter).toHaveLength(PARTY_COLORS.length);

    const listed = await authedFetch("/api/parties", hostToken);
    const page = (await listed.json()) as { items: { id: string; colors: string[] }[] };
    const listing = page.items.find((item) => item.id === party.id);
    expect(listing?.colors.sort()).toEqual([...PARTY_COLORS].sort());
  });

  test("404s a join on an unknown party", async () => {
    const { token } = await registerAndLogin("joinmissing");
    const response = await authedFetch(
      "/api/parties/00000000-0000-4000-8000-000000000000/join",
      token,
      {
        method: "POST",
      },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "party_not_found" });
  });
});

describe("rethrowAsPartyError DbConflictError mapping", () => {
  // `joinParty`'s own atomic conditional insert reclassifies its zero-row race outcome by re-reading
  // state, so it never throws a raw `DbConflictError` — but `createParty`'s initial host-membership
  // insert still goes through a plain `Repository.create()`, which does. This drives a REAL
  // `partyMembers(partyId, color)` unique-index hit through the actual SQLite provider (pre-inserting
  // the colliding row, per the review's own instruction) and asserts `rethrowAsPartyError` maps it to
  // `party_color_taken`, not a generic 409.
  test("maps a partyMembers(partyId,color) unique collision to party_color_taken", async () => {
    const { token: hostToken } = await registerAndLogin("conflicthost");
    const adventureId = await newPlayableAdventure(hostToken);
    const created = await authedFetch("/api/parties", hostToken, {
      method: "POST",
      body: JSON.stringify({ adventureId }),
    });
    const party = (await created.json()) as { id: string };
    // The host already holds PARTY_COLORS[0]. Pre-insert a SECOND row for a DIFFERENT account that
    // collides ONLY on (partyId, colour) — a different userId keeps it clear of the OTHER unique
    // index, `(partyId, userId)`, so the raw driver message names just the colour index.
    const { userId: rivalId } = await registerAndLogin("conflictrival");
    let dbConflictError: unknown;
    try {
      await probe.partyMembers.create({
        id: crypto.randomUUID(),
        partyId: party.id,
        userId: rivalId,
        color: PARTY_COLORS[0],
      });
    } catch (error) {
      dbConflictError = error;
    }
    expect(dbConflictError).toBeDefined();
    expect((dbConflictError as Error).name).toBe("DbConflictError");

    const { rethrowAsPartyError } = await import("../src/api/services/partyAuthoring.ts");
    let httpError: unknown;
    try {
      rethrowAsPartyError(dbConflictError);
    } catch (error) {
      httpError = error;
    }
    expect(httpError).toMatchObject({ status: 409, error: "party_color_taken" });
  });
});

describe("deleteParty", () => {
  test("lets only the host delete", async () => {
    const { token: hostToken } = await registerAndLogin("delhost");
    const adventureId = await newPlayableAdventure(hostToken);
    const created = await authedFetch("/api/parties", hostToken, {
      method: "POST",
      body: JSON.stringify({ adventureId }),
    });
    const party = (await created.json()) as { id: string };

    const { token: rivalToken } = await registerAndLogin("delrival");
    const refused = await authedFetch(`/api/parties/${party.id}`, rivalToken, { method: "DELETE" });
    expect(refused.status).toBe(404);
    expect(await refused.json()).toMatchObject({ error: "party_not_found" });

    const deleted = await authedFetch(`/api/parties/${party.id}`, hostToken, { method: "DELETE" });
    expect(deleted.status).toBe(204);

    const gone = await authedFetch(`/api/parties/${party.id}`, hostToken, { method: "DELETE" });
    expect(gone.status).toBe(404);
  });

  test("cascades every hero in the party and fires the onHeroDeleted seam for each one", async () => {
    const { token: hostToken } = await registerAndLogin("delcasc");
    const adventureId = await newPlayableAdventure(hostToken);
    const created = await authedFetch("/api/parties", hostToken, {
      method: "POST",
      body: JSON.stringify({ adventureId }),
    });
    const party = (await created.json()) as { id: string };
    const heroRes = await authedFetch(`/api/parties/${party.id}/heroes`, hostToken, {
      method: "POST",
      body: JSON.stringify({ name: "Doomed", class: "warrior" }),
    });
    const hero = (await heroRes.json()) as { id: string };

    // The realtime tranche overrides this in production; here it just proves the seam fires with the
    // right hero id, exactly once, as part of a party delete.
    const heroService = alepha.inject(HeroService);
    const revoked: string[] = [];
    heroService.onHeroDeleted = (heroId: string) => {
      revoked.push(heroId);
    };

    const deleted = await authedFetch(`/api/parties/${party.id}`, hostToken, { method: "DELETE" });
    expect(deleted.status).toBe(204);
    expect(revoked).toEqual([hero.id]);
    expect(await probe.heroes.findById(hero.id)).toBeUndefined();
  });
});

describe("abandonParty", () => {
  test("releases each member slot, transfers the host, and removes the party when it becomes empty", async () => {
    const { userId: hostId, token: hostToken } = await registerAndLogin("leavehost");
    const adventureId = await newPlayableAdventure(hostToken);
    const created = await authedFetch("/api/parties", hostToken, {
      method: "POST",
      body: JSON.stringify({ adventureId }),
    });
    const party = (await created.json()) as { id: string };

    const { userId: guestId, token: guestToken } = await registerAndLogin("leaveguest");
    expect(
      (await authedFetch(`/api/parties/${party.id}/join`, guestToken, { method: "POST" })).status,
    ).toBe(204);

    const hostHeroResponse = await authedFetch(`/api/parties/${party.id}/heroes`, hostToken, {
      method: "POST",
      body: JSON.stringify({ name: "Host hero", class: "warrior" }),
    });
    const hostHero = (await hostHeroResponse.json()) as { id: string };
    const guestHeroResponse = await authedFetch(`/api/parties/${party.id}/heroes`, guestToken, {
      method: "POST",
      body: JSON.stringify({ name: "Guest hero", class: "ranger" }),
    });
    const guestHero = (await guestHeroResponse.json()) as { id: string };

    const revoked: string[] = [];
    alepha.inject(HeroService).onHeroDeleted = (heroId: string) => {
      revoked.push(heroId);
    };

    const hostLeft = await authedFetch(`/api/parties/${party.id}/membership`, hostToken, {
      method: "DELETE",
    });
    expect(hostLeft.status).toBe(204);
    expect(await probe.parties.findById(party.id)).toMatchObject({ hostUserId: guestId });
    expect(await probe.partyMembers.findMany({ where: { partyId: { eq: party.id } } })).toEqual([
      expect.objectContaining({ userId: guestId }),
    ]);
    expect(await probe.heroes.findById(hostHero.id)).toBeUndefined();
    expect(await probe.heroes.findById(guestHero.id)).toBeDefined();
    expect(revoked).toEqual([hostHero.id]);

    const guestLeft = await authedFetch(`/api/parties/${party.id}/membership`, guestToken, {
      method: "DELETE",
    });
    expect(guestLeft.status).toBe(204);
    expect(await probe.parties.findById(party.id)).toBeUndefined();
    expect(await probe.partyMembers.findMany({ where: { partyId: { eq: party.id } } })).toEqual([]);
    expect(await probe.heroes.findById(guestHero.id)).toBeUndefined();
    expect(revoked).toEqual([hostHero.id, guestHero.id]);

    // The original host is no longer a member either; a stale repeat is indistinguishable from an
    // unknown party and cannot delete anything else.
    const stale = await authedFetch(`/api/parties/${party.id}/membership`, hostToken, {
      method: "DELETE",
    });
    expect(stale.status).toBe(404);
    expect(hostId).not.toBe(guestId);
  });
});

describe("purgeCompletedParty", () => {
  test("purges one account at a time and deletes the completed party after the last member", async () => {
    const { userId: hostId, token: hostToken } = await registerAndLogin("purgehost");
    const adventureId = await newPlayableAdventure(hostToken);
    const created = await authedFetch("/api/parties", hostToken, {
      method: "POST",
      body: JSON.stringify({ adventureId }),
    });
    const party = (await created.json()) as { id: string };
    const { userId: guestId, token: guestToken } = await registerAndLogin("purgeguest");
    expect(
      (await authedFetch(`/api/parties/${party.id}/join`, guestToken, { method: "POST" })).status,
    ).toBe(204);

    const hostHeroResponse = await authedFetch(`/api/parties/${party.id}/heroes`, hostToken, {
      method: "POST",
      body: JSON.stringify({ name: "Archived host", class: "warrior" }),
    });
    const hostHero = (await hostHeroResponse.json()) as { id: string };
    const guestHeroResponse = await authedFetch(`/api/parties/${party.id}/heroes`, guestToken, {
      method: "POST",
      body: JSON.stringify({ name: "Archived guest", class: "ranger" }),
    });
    const guestHero = (await guestHeroResponse.json()) as { id: string };

    const openRefusal = await authedFetch(`/api/parties/${party.id}/archive`, hostToken, {
      method: "DELETE",
    });
    expect(openRefusal.status).toBe(404);
    await probe.parties.updateById(party.id, { status: "completed" });

    const revoked: string[] = [];
    alepha.inject(HeroService).onHeroDeleted = (heroId: string) => {
      revoked.push(heroId);
    };

    const hostPurged = await authedFetch(`/api/parties/${party.id}/archive`, hostToken, {
      method: "DELETE",
    });
    expect(hostPurged.status).toBe(204);
    expect(await probe.parties.findById(party.id)).toMatchObject({
      status: "completed",
      hostUserId: guestId,
    });
    expect(await probe.partyMembers.findMany({ where: { partyId: { eq: party.id } } })).toEqual([
      expect.objectContaining({ userId: guestId }),
    ]);
    expect(await probe.heroes.findById(hostHero.id)).toBeUndefined();
    expect(await probe.heroes.findById(guestHero.id)).toBeDefined();
    expect(revoked).toEqual([hostHero.id]);

    const guestPurged = await authedFetch(`/api/parties/${party.id}/archive`, guestToken, {
      method: "DELETE",
    });
    expect(guestPurged.status).toBe(204);
    expect(await probe.parties.findById(party.id)).toBeUndefined();
    expect(await probe.heroes.findById(guestHero.id)).toBeUndefined();
    expect(revoked).toEqual([hostHero.id, guestHero.id]);

    const stale = await authedFetch(`/api/parties/${party.id}/archive`, hostToken, {
      method: "DELETE",
    });
    expect(stale.status).toBe(404);
    expect(hostId).not.toBe(guestId);
  });
});

describe("listParties pagination", () => {
  test("reports whether a listed party currently owns a live world room", async () => {
    const { token } = await registerAndLogin("pageonline");
    const adventureId = await newPlayableAdventure(token);
    const createdResponse = await authedFetch("/api/parties", token, {
      method: "POST",
      body: JSON.stringify({ adventureId }),
    });
    const created = (await createdResponse.json()) as { id: string };
    const roomKey = `${created.id}:map`;

    const online = async () => {
      const response = await authedFetch("/api/parties", token);
      const page = (await response.json()) as {
        items: { id: string; hasConnectedPlayers: boolean }[];
      };
      return page.items.find((item) => item.id === created.id)?.hasConnectedPlayers;
    };

    expect(await online()).toBe(false);
    const partyRoom = alepha.inject(PartyRoom);
    await partyRoom.room.call(created.id, "registerRoom", roomKey);
    expect(await online()).toBe(true);
    await partyRoom.room.call(created.id, "roomEmptied", roomKey);
    expect(await online()).toBe(false);
  });

  test("paginates with a cursor and stops at nextCursor: null", async () => {
    const { userId, token } = await registerAndLogin("page");
    const adventureId = await newPlayableAdventure(token);
    const seededIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const row = await probe.parties.create({
        adventureId,
        adventureVersion: 1,
        maxPlayers: 4,
        hostUserId: userId,
        status: "open",
      });
      seededIds.push(row.id);
    }

    const first = await authedFetch("/api/parties?limit=2", token);
    expect(first.status).toBe(200);
    const firstPage = (await first.json()) as {
      items: { id: string }[];
      nextCursor: string | null;
    };
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();
    if (!firstPage.nextCursor) throw new Error("expected a next cursor");

    const second = await authedFetch(
      `/api/parties?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
      token,
    );
    expect(second.status).toBe(200);
    const secondPage = (await second.json()) as {
      items: { id: string }[];
      nextCursor: string | null;
    };
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();

    const seen = new Set([...firstPage.items, ...secondPage.items].map((item) => item.id));
    for (const id of seededIds) expect(seen.has(id)).toBe(true);
  });

  test("400s party_page_invalid on a malformed cursor or an out-of-range limit", async () => {
    const { token } = await registerAndLogin("pagebad");
    const badCursor = await authedFetch("/api/parties?cursor=not-a-cursor", token);
    expect(badCursor.status).toBe(400);
    expect(await badCursor.json()).toMatchObject({ error: "party_page_invalid" });

    const badLimit = await authedFetch("/api/parties?limit=0", token);
    expect(badLimit.status).toBe(400);
    expect(await badLimit.json()).toMatchObject({ error: "party_page_invalid" });

    const overLimit = await authedFetch("/api/parties?limit=999", token);
    expect(overLimit.status).toBe(400);
    expect(await overLimit.json()).toMatchObject({ error: "party_page_invalid" });
  });
});
