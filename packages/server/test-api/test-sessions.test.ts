/**
 * Adventure test sessions on Alepha: session gate, collaborative create (NOT author-only — see
 * below), replace-not-conflict semantics for a second session on the same account, playability
 * diagnostics (422), the `map_not_found`/`adventure_not_found`/`adventure_not_playable` families,
 * ownership-fenced delete, and both `adventureTestSessions` unique indexes (`userId`, `partyId`)
 * exercised distinctly. Drives the real HTTP server, same idiom as `parties.test.ts`/
 * `adventures.test.ts` (real `fetch()` against `ServerProvider.hostname`, never the typed client,
 * because `TestSessionController`'s schemas are deliberately loose; see its own docblock).
 *
 * Business rules are ported from `packages/server/test/adventure-test-sessions-api.test.ts` (read in
 * full before writing this file) and `packages/server/src/adventure-test-sessions.ts`.
 *
 * **Pinned divergence from this task's own brief wording.** The brief says "author-only". The legacy
 * source it ports does not gate CREATE on authorship at all (`createAdventureTestSession`'s own
 * docblock: "Collaborative editing: the editor playtests anyone's adventure"). This file pins the
 * legacy behavior — a non-author CAN start a test session on someone else's adventure — the same way
 * `maps.test.ts` pins `MapService`'s identical, deliberate brief/code divergence. Only DELETE is
 * ownership-fenced, exactly like legacy.
 */
import { createAuthoredQuestDefinition } from "@lindocara/engine/quests.js";
import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { ServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { adventures } from "../src/api/entities/adventures.ts";
import { adventureTestSessions } from "../src/api/entities/adventureTestSessions.ts";
import { heroes } from "../src/api/entities/heroes.ts";
import { parties } from "../src/api/entities/parties.ts";
import { MapService } from "../src/api/services/MapService.ts";
import { createTestApp, PROVING_SIZE, provingHeightfield } from "./helpers.ts";

const PASSWORD = "Sup3rSecret";

class SeedProbe {
  adventures = $repository(adventures);
  parties = $repository(parties);
  heroes = $repository(heroes);
  adventureTestSessions = $repository(adventureTestSessions);
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
      ...(init.headers ?? {}),
    },
  });
}

/**
 * `POST /api/adventures` creates its adventure AND an atomic default map ("Map1") in one call. A
 * second map ("Sous-sol") is added so `startMapId` selection has somewhere else to point, and it is
 * given a heightfield whose spawn is deliberately OFF-CENTRE — that spawn is where a playtest hero
 * must land, and a spawn at the grid origin would be satisfied by a hero placed at `0,0,0` for any
 * reason at all, including the reason this fixture exists to rule out.
 */
const SECOND_MAP_SPAWN = { x: 2, z: -3 };

async function newAdventureWithTwoMaps(token: string): Promise<{
  id: string;
  title: string;
  firstMapId: string;
  secondMapId: string;
}> {
  const response = await authedFetch("/api/adventures", token, {
    method: "POST",
    body: JSON.stringify({ title: "Laboratoire", maxPlayers: 4 }),
  });
  expect(response.status).toBe(201);
  const adventure = (await response.json()) as {
    id: string;
    title: string;
    defaultMap: { id: string };
  };
  const second = await authedFetch("/api/maps", token, {
    method: "POST",
    body: JSON.stringify({ adventureId: adventure.id, name: "Sous-sol" }),
  });
  expect(second.status).toBe(201);
  const secondMap = (await second.json()) as { id: string; spawn: { col: number; row: number } };
  await alepha
    .inject(MapService)
    .saveHeightfield(secondMap.id, provingHeightfield(PROVING_SIZE, SECOND_MAP_SPAWN));
  return {
    id: adventure.id,
    title: adventure.title,
    firstMapId: adventure.defaultMap.id,
    secondMapId: secondMap.id,
  };
}

/** A draft adventure with zero maps (bypassing the controller's atomic default-map create) — the
 *  only way to reach `adventure_not_playable`, mirroring `parties.test.ts`'s own `newDraftAdventure`. */
async function newDraftAdventure(userId: string): Promise<string> {
  const created = await probe.adventures.create({
    userId,
    title: "WIP",
    graph: JSON.stringify({ start: null, links: [] }),
  });
  return created.id;
}

describe("session gate", () => {
  test("401s every test-session route without a bearer token", async () => {
    const routes: [string, string][] = [
      ["POST", "/api/adventures/whatever/test-sessions"],
      ["DELETE", "/api/adventure-test-sessions/whatever"],
    ];
    for (const [method, path] of routes) {
      const response = await fetch(`${hostname}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({}) } : {}),
      });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("createTestSession", () => {
  test("creates a hidden real-runtime party+hero on the chosen map, for the AUTHOR", async () => {
    const owner = await registerAndLogin("tsowner");
    const adventure = await newAdventureWithTwoMaps(owner.token);

    const response = await authedFetch(
      `/api/adventures/${adventure.id}/test-sessions`,
      owner.token,
      {
        method: "POST",
        body: JSON.stringify({ startMapId: adventure.secondMapId, heroClass: "ranger" }),
      },
    );
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      id: string;
      adventureId: string;
      startMapId: string | null;
      expiresAt: number;
      party: { id: string; mine: boolean; maxPlayers: number; hostUserId: string };
      hero: { id: string; mapId: string; class: string; x: number; y: number; z: number };
      diagnostics: unknown[];
    };
    expect(created.adventureId).toBe(adventure.id);
    expect(created.startMapId).toBe(adventure.secondMapId);
    expect(created.expiresAt).toBeGreaterThan(Date.now());
    expect(created.party).toMatchObject({
      mine: true,
      maxPlayers: 1,
      hostUserId: owner.userId,
    });
    expect(created.hero).toMatchObject({ mapId: adventure.secondMapId, class: "ranger" });
    // The chosen map's OWN heightfield spawn, in tile units, on all three axes. This used to be the
    // tile-editor cell's pixel centre written into `x`/`y` — and after the conversion `y` was the
    // ELEVATION column while the ground `z` was never written at all, so every playtest hero's row
    // was nonsense. Nothing caught it: `restoreStandablePosition` refuses a position thirty-four
    // grids off the map and quietly falls back, so the session still worked.
    expect({ x: created.hero.x, y: created.hero.y, z: created.hero.z }).toEqual({
      x: SECOND_MAP_SPAWN.x,
      y: 0,
      z: SECOND_MAP_SPAWN.z,
    });
    expect(created.diagnostics).toEqual([]);

    // The hidden party is never visible to anyone's public listing, author included — see
    // `PartyService`'s own docblock on why this task also closes that listing gap.
    const listing = (await (await authedFetch("/api/parties", owner.token)).json()) as {
      items: { id: string }[];
    };
    expect(listing.items.find((item) => item.id === created.party.id)).toBeUndefined();
  });

  test("listing hides every party behind a live test session, even with 3+ present at once", async () => {
    // Each account may hold at most one live test session (`adventure_test_session_account_unique`),
    // so 3+ hidden parties at once means 3+ distinct authors. This is the shape `PartyService`'s
    // docblock describes: a `notInArray(hiddenPartyIds)` read-then-filter binds one SQL parameter
    // per hidden party, so this test is what would have exercised that unboundedness; the real
    // `LEFT JOIN`-based `listPartiesPage` it replaced stays at zero bound parameters regardless of
    // how many hidden parties exist.
    const viewer = await registerAndLogin("tshide-viewer");
    const hiddenPartyIds: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const author = await registerAndLogin(`tshide-author${i}`);
      const adventure = await newAdventureWithTwoMaps(author.token);
      const response = await authedFetch(
        `/api/adventures/${adventure.id}/test-sessions`,
        author.token,
        { method: "POST", body: JSON.stringify({ startMapId: null, heroClass: "warrior" }) },
      );
      expect(response.status).toBe(201);
      const created = (await response.json()) as { party: { id: string } };
      hiddenPartyIds.push(created.party.id);
    }

    // A real, non-hidden party for contrast: the join must exclude ONLY the hidden ones.
    const realAdventure = await newAdventureWithTwoMaps(viewer.token);
    const realParty = await authedFetch("/api/parties", viewer.token, {
      method: "POST",
      body: JSON.stringify({ adventureId: realAdventure.id }),
    });
    expect(realParty.status).toBe(201);
    const realPartyId = ((await realParty.json()) as { id: string }).id;

    const listing = (await (await authedFetch("/api/parties", viewer.token)).json()) as {
      items: { id: string }[];
    };
    const listedIds = listing.items.map((item) => item.id);
    for (const hiddenId of hiddenPartyIds) {
      expect(listedIds).not.toContain(hiddenId);
    }
    expect(listedIds).toContain(realPartyId);
  });

  test("also creates one for a NON-author — collaborative editing, not author-only (pinned legacy behavior)", async () => {
    const owner = await registerAndLogin("tscolbown");
    const stranger = await registerAndLogin("tscolbstr");
    const adventure = await newAdventureWithTwoMaps(owner.token);

    const response = await authedFetch(
      `/api/adventures/${adventure.id}/test-sessions`,
      stranger.token,
      { method: "POST", body: JSON.stringify({ startMapId: null, heroClass: "warrior" }) },
    );
    expect(response.status).toBe(201);
    const created = (await response.json()) as { party: { hostUserId: string } };
    expect(created.party.hostUserId).toBe(stranger.userId);
  });

  test("a second session for the same account REPLACES the first (legacy reset semantics, not a conflict)", async () => {
    const owner = await registerAndLogin("tsreplace");
    const adventure = await newAdventureWithTwoMaps(owner.token);

    const first = await authedFetch(`/api/adventures/${adventure.id}/test-sessions`, owner.token, {
      method: "POST",
      body: JSON.stringify({ startMapId: adventure.secondMapId, heroClass: "ranger" }),
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as {
      id: string;
      party: { id: string };
      hero: { id: string };
    };

    const second = await authedFetch(`/api/adventures/${adventure.id}/test-sessions`, owner.token, {
      method: "POST",
      body: JSON.stringify({ startMapId: null, heroClass: "priest" }),
    });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as {
      id: string;
      party: { id: string };
      hero: { id: string; mapId: string; class: string };
    };
    // Replacement, not a `409 party_already_member`-style conflict: distinct ids all around, and the
    // second call succeeds outright.
    expect(secondBody.id).not.toBe(firstBody.id);
    expect(secondBody.party.id).not.toBe(firstBody.party.id);
    expect(secondBody.hero).toMatchObject({ mapId: adventure.firstMapId, class: "priest" });

    // The first envelope (session, party, hero) is gone — cascaded via `PartyService.deleteParty`.
    expect(await probe.adventureTestSessions.findById(firstBody.id)).toBeUndefined();
    expect(await probe.parties.findById(firstBody.party.id)).toBeUndefined();
    expect(await probe.heroes.findById(firstBody.hero.id)).toBeUndefined();
    // Exactly one session/party/hero remains for this account.
    expect(
      (await probe.adventureTestSessions.findMany({ where: { userId: { eq: owner.userId } } }))
        .length,
    ).toBe(1);
  });

  test("blocks a test with structured quest diagnostics (422) and creates nothing", async () => {
    const owner = await registerAndLogin("tsinvalid");
    const adventure = await newAdventureWithTwoMaps(owner.token);
    const invalidQuest = createAuthoredQuestDefinition("0001", "Mission sans parcours");
    const impossibleQuest = {
      ...createAuthoredQuestDefinition("0002", "Mission sans source"),
      acceptance: "automatic" as const,
      completion: "automatic" as const,
      objectives: [
        {
          id: "0001",
          type: "reach" as const,
          label: "",
          target: 1,
          optional: false,
          hidden: false,
          stage: 0,
          destination: { kind: "area" as const, mapId: adventure.firstMapId, areaId: "north_gate" },
        },
        {
          id: "0002",
          type: "activity" as const,
          label: "",
          target: 1,
          optional: false,
          hidden: false,
          stage: 0,
          activityId: "village_defence",
        },
        {
          id: "0003",
          type: "kill" as const,
          label: "",
          target: 10,
          optional: false,
          hidden: false,
          stage: 0,
          species: "spear_goblin" as const,
          mapScope: { kind: "any" as const },
          credit: "contributors" as const,
        },
      ],
    };
    const saved = await authedFetch(`/api/adventures/${adventure.id}`, owner.token, {
      method: "PUT",
      body: JSON.stringify({
        title: adventure.title,
        maxPlayers: 4,
        registry: { switches: [], variables: [], quests: [invalidQuest, impossibleQuest] },
      }),
    });
    expect(saved.status).toBe(200);

    const response = await authedFetch(
      `/api/adventures/${adventure.id}/test-sessions`,
      owner.token,
      {
        method: "POST",
        body: JSON.stringify({ startMapId: null, heroClass: "warrior" }),
      },
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error: string;
      diagnostics: { code: string; severity: string }[];
    };
    expect(body.error).toBe("adventure_test_invalid");
    expect(body.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "quest.objectives.empty", severity: "error" }),
        expect.objectContaining({ code: "quest.acceptance.unbound", severity: "error" }),
        expect.objectContaining({ code: "quest.turn_in.unbound", severity: "error" }),
        expect.objectContaining({ code: "quest.objective.area_missing", severity: "error" }),
        expect.objectContaining({ code: "quest.objective.activity_missing", severity: "error" }),
        expect.objectContaining({ code: "quest.objective.monster_missing", severity: "error" }),
      ]),
    );
    expect(
      (await probe.parties.findMany({ where: { adventureId: { eq: adventure.id } } })).length,
    ).toBe(0);
  });

  test("400s an invalid create body", async () => {
    const owner = await registerAndLogin("tsbadbody");
    const adventure = await newAdventureWithTwoMaps(owner.token);
    const response = await authedFetch(
      `/api/adventures/${adventure.id}/test-sessions`,
      owner.token,
      {
        method: "POST",
        body: JSON.stringify({ startMapId: "not-a-uuid", heroClass: "warrior" }),
      },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "adventure_test_invalid" });
  });

  test("404s an unknown adventure with adventure_not_found", async () => {
    const owner = await registerAndLogin("tsnoadv");
    const response = await authedFetch(
      "/api/adventures/00000000-0000-4000-8000-000000000000/test-sessions",
      owner.token,
      { method: "POST", body: JSON.stringify({ startMapId: null, heroClass: "warrior" }) },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "adventure_not_found" });
  });

  test("409s a draft (mapless) adventure with adventure_not_playable", async () => {
    const owner = await registerAndLogin("tsdraft");
    const adventureId = await newDraftAdventure(owner.userId);
    const response = await authedFetch(
      `/api/adventures/${adventureId}/test-sessions`,
      owner.token,
      {
        method: "POST",
        body: JSON.stringify({ startMapId: null, heroClass: "warrior" }),
      },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "adventure_not_playable" });
  });

  test("404s a startMapId that names a real map from a DIFFERENT adventure with map_not_found", async () => {
    const owner = await registerAndLogin("tsforeignmap");
    const adventure = await newAdventureWithTwoMaps(owner.token);
    const other = await newAdventureWithTwoMaps(owner.token);
    const response = await authedFetch(
      `/api/adventures/${adventure.id}/test-sessions`,
      owner.token,
      {
        method: "POST",
        body: JSON.stringify({ startMapId: other.firstMapId, heroClass: "warrior" }),
      },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "map_not_found" });
  });
});

describe("deleteTestSession", () => {
  test("lets only the session's own account delete it", async () => {
    const owner = await registerAndLogin("tsdelowner");
    const stranger = await registerAndLogin("tsdelstranger");
    const adventure = await newAdventureWithTwoMaps(owner.token);
    const created = await authedFetch(
      `/api/adventures/${adventure.id}/test-sessions`,
      owner.token,
      {
        method: "POST",
        body: JSON.stringify({ startMapId: null, heroClass: "warrior" }),
      },
    );
    const session = (await created.json()) as {
      id: string;
      party: { id: string };
      hero: { id: string };
    };

    const refused = await authedFetch(
      `/api/adventure-test-sessions/${session.id}`,
      stranger.token,
      {
        method: "DELETE",
      },
    );
    expect(refused.status).toBe(404);
    expect(await refused.json()).toMatchObject({ error: "adventure_test_not_found" });

    const deleted = await authedFetch(`/api/adventure-test-sessions/${session.id}`, owner.token, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
    expect(await probe.parties.findById(session.party.id)).toBeUndefined();
    expect(await probe.heroes.findById(session.hero.id)).toBeUndefined();
    expect(await probe.adventureTestSessions.findById(session.id)).toBeUndefined();

    const again = await authedFetch(`/api/adventure-test-sessions/${session.id}`, owner.token, {
      method: "DELETE",
    });
    expect(again.status).toBe(404);
  });

  test("never mutates or removes the creator's real save", async () => {
    const owner = await registerAndLogin("tssafe");
    const adventure = await newAdventureWithTwoMaps(owner.token);
    const realPartyResponse = await authedFetch("/api/parties", owner.token, {
      method: "POST",
      body: JSON.stringify({ adventureId: adventure.id, name: "Real save" }),
    });
    expect(realPartyResponse.status).toBe(201);
    const realParty = (await realPartyResponse.json()) as { id: string };

    const testResponse = await authedFetch(
      `/api/adventures/${adventure.id}/test-sessions`,
      owner.token,
      {
        method: "POST",
        body: JSON.stringify({ startMapId: null, heroClass: "ranger" }),
      },
    );
    expect(testResponse.status).toBe(201);
    const test = (await testResponse.json()) as { id: string; party: { id: string } };

    expect(
      (
        (await (await authedFetch("/api/parties", owner.token)).json()) as {
          items: { id: string }[];
        }
      ).items.map((item) => item.id),
    ).toEqual([realParty.id]);

    expect(
      (
        await authedFetch(`/api/adventure-test-sessions/${test.id}`, owner.token, {
          method: "DELETE",
        })
      ).status,
    ).toBe(204);
    expect(await probe.parties.findById(realParty.id)).toBeDefined();
    expect(await probe.parties.findById(test.party.id)).toBeUndefined();
  });
});

describe("adventureTestSessions unique indexes (Task 7's deferred minor, isolated distinctly)", () => {
  test("rejects a second row with the same userId (account-unique) even with a distinct partyId", async () => {
    const owner = await registerAndLogin("tsuniqacc");
    const adventure = await newAdventureWithTwoMaps(owner.token);
    const partyOne = await probe.parties.create({
      adventureId: adventure.id,
      adventureVersion: 1,
      maxPlayers: 1,
      hostUserId: owner.userId,
      status: "open",
    });
    const partyTwo = await probe.parties.create({
      adventureId: adventure.id,
      adventureVersion: 1,
      maxPlayers: 1,
      hostUserId: owner.userId,
      status: "open",
    });
    await probe.adventureTestSessions.create({
      id: crypto.randomUUID(),
      userId: owner.userId,
      adventureId: adventure.id,
      partyId: partyOne.id,
      expiresAt: new Date().toISOString(),
    });
    let error: unknown;
    try {
      await probe.adventureTestSessions.create({
        id: crypto.randomUUID(),
        userId: owner.userId,
        adventureId: adventure.id,
        partyId: partyTwo.id,
        expiresAt: new Date().toISOString(),
      });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeDefined();
    expect((error as Error).name).toBe("DbConflictError");
  });

  test("rejects a second row with the same partyId (party-unique) even with a distinct userId", async () => {
    const owner = await registerAndLogin("tsunipown");
    const rival = await registerAndLogin("tsunipriv");
    const adventure = await newAdventureWithTwoMaps(owner.token);
    const sharedParty = await probe.parties.create({
      adventureId: adventure.id,
      adventureVersion: 1,
      maxPlayers: 1,
      hostUserId: owner.userId,
      status: "open",
    });
    await probe.adventureTestSessions.create({
      id: crypto.randomUUID(),
      userId: owner.userId,
      adventureId: adventure.id,
      partyId: sharedParty.id,
      expiresAt: new Date().toISOString(),
    });
    let error: unknown;
    try {
      await probe.adventureTestSessions.create({
        id: crypto.randomUUID(),
        userId: rival.userId,
        adventureId: adventure.id,
        partyId: sharedParty.id,
        expiresAt: new Date().toISOString(),
      });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeDefined();
    expect((error as Error).name).toBe("DbConflictError");
  });
});
