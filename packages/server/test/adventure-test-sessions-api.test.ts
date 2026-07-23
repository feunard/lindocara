/** Real HTTP/D1 boundary for disposable creator playtests. */
import { env, SELF } from "cloudflare:test";
import { createAuthoredQuestDefinition } from "@lindocara/engine/quests.js";
import { SESSION_COOKIE } from "@lindocara/server/session.js";
import { afterEach, describe, expect, it } from "vitest";

const ORIGIN = "https://lindocara.test";
let accountCounter = 0;

async function register(label: string): Promise<string> {
  accountCounter += 1;
  const response = await SELF.fetch(`${ORIGIN}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `play${accountCounter}${label}`.toLowerCase().slice(0, 16),
      password: "12345678",
    }),
  });
  expect(response.status).toBe(200);
  const value = (response.headers.get("Set-Cookie") ?? "").split(";")[0]?.split("=")[1];
  if (!value) throw new Error("expected a session cookie");
  return `${SESSION_COOKIE}=${value}`;
}

function authed(path: string, cookie: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: cookie, ...(init.headers ?? {}) },
  });
}

async function createAdventure(cookie: string): Promise<{
  id: string;
  firstMapId: string;
  secondMapId: string;
  secondSpawn: { col: number; row: number };
}> {
  const response = await authed("/api/adventures", cookie, {
    method: "POST",
    body: JSON.stringify({ title: "Laboratoire", maxPlayers: 4 }),
  });
  expect(response.status).toBe(201);
  const adventure = (await response.json()) as { id: string; defaultMap: { id: string } };
  const second = await authed("/api/maps", cookie, {
    method: "POST",
    body: JSON.stringify({ adventureId: adventure.id, name: "Sous-sol" }),
  });
  expect(second.status).toBe(201);
  const secondMap = (await second.json()) as {
    id: string;
    spawn: { col: number; row: number };
  };
  return {
    id: adventure.id,
    firstMapId: adventure.defaultMap.id,
    secondMapId: secondMap.id,
    secondSpawn: secondMap.spawn,
  };
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM party");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map");
});

describe("adventure playtest sessions", () => {
  it("creates a hidden real-runtime hero on a selected map, resets it, then deletes every row", async () => {
    const owner = await register("owner");
    const stranger = await register("stranger");
    const adventure = await createAdventure(owner);

    const created = await authed(`/api/adventures/${adventure.id}/test-sessions`, owner, {
      method: "POST",
      body: JSON.stringify({ startMapId: adventure.secondMapId, heroClass: "ranger" }),
    });
    expect(created.status).toBe(201);
    const first = (await created.json()) as {
      id: string;
      party: { id: string; mine: boolean; maxPlayers: number };
      hero: { id: string; mapId: string; class: string; x: number; y: number };
    };
    expect(first.party).toMatchObject({ mine: true, maxPlayers: 1 });
    expect(first.hero).toMatchObject({ mapId: adventure.secondMapId, class: "ranger" });
    expect(first.hero.x).toBe((adventure.secondSpawn.col + 0.5) * 64);
    expect(first.hero.y).toBe((adventure.secondSpawn.row + 0.5) * 64);

    const ownerListing = (await (await authed("/api/parties", owner)).json()) as {
      items: { id: string }[];
    };
    const strangerListing = (await (await authed("/api/parties", stranger)).json()) as {
      items: { id: string }[];
    };
    expect(ownerListing.items).toEqual([]);
    expect(strangerListing.items).toEqual([]);
    const join = await authed(`/api/parties/${first.party.id}/join`, stranger, { method: "POST" });
    expect(join.status).toBe(404);

    const reset = await authed(`/api/adventures/${adventure.id}/test-sessions`, owner, {
      method: "POST",
      body: JSON.stringify({ startMapId: null, heroClass: "priest" }),
    });
    expect(reset.status).toBe(201);
    const second = (await reset.json()) as {
      id: string;
      party: { id: string };
      hero: { id: string; mapId: string; class: string };
    };
    expect(second.id).not.toBe(first.id);
    expect(second.party.id).not.toBe(first.party.id);
    expect(second.hero).toMatchObject({ mapId: adventure.firstMapId, class: "priest" });

    expect(
      (
        await env.DB.prepare("SELECT id FROM party WHERE id IN (?, ?)")
          .bind(first.party.id, second.party.id)
          .all()
      ).results,
    ).toEqual([{ id: second.party.id }]);
    expect(
      (
        await env.DB.prepare("SELECT id FROM hero WHERE id IN (?, ?)")
          .bind(first.hero.id, second.hero.id)
          .all()
      ).results,
    ).toEqual([{ id: second.hero.id }]);

    const closed = await authed(`/api/adventure-test-sessions/${second.id}`, owner, {
      method: "DELETE",
    });
    expect(closed.status).toBe(204);
    expect((await env.DB.prepare("SELECT id FROM adventure_test_session").all()).results).toEqual(
      [],
    );
    expect((await env.DB.prepare("SELECT id FROM party").all()).results).toEqual([]);
    expect((await env.DB.prepare("SELECT id FROM hero").all()).results).toEqual([]);
  });

  it("blocks a full test with the same structured quest diagnostics the editor shows", async () => {
    const owner = await register("invalid");
    const adventure = await createAdventure(owner);
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
          destination: {
            kind: "area" as const,
            mapId: adventure.firstMapId,
            areaId: "north_gate",
          },
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
      ],
    };
    const saved = await authed(`/api/adventures/${adventure.id}`, owner, {
      method: "PUT",
      body: JSON.stringify({
        title: "Laboratoire",
        maxPlayers: 4,
        registry: { switches: [], variables: [], quests: [invalidQuest, impossibleQuest] },
      }),
    });
    expect(saved.status).toBe(200);

    const response = await authed(`/api/adventures/${adventure.id}/test-sessions`, owner, {
      method: "POST",
      body: JSON.stringify({ startMapId: null, heroClass: "warrior" }),
    });
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
      ]),
    );
    expect((await env.DB.prepare("SELECT id FROM party").all()).results).toEqual([]);
  });

  it("never mutates or hides the creator's real save", async () => {
    const owner = await register("save");
    const adventure = await createAdventure(owner);
    const partyResponse = await authed("/api/parties", owner, {
      method: "POST",
      body: JSON.stringify({ adventureId: adventure.id, name: "Real save" }),
    });
    expect(partyResponse.status).toBe(201);
    const realParty = (await partyResponse.json()) as { id: string };
    const heroResponse = await authed(`/api/parties/${realParty.id}/heroes`, owner, {
      method: "POST",
      body: JSON.stringify({ name: "Persistent", class: "warrior" }),
    });
    expect(heroResponse.status).toBe(201);
    const realHero = (await heroResponse.json()) as { id: string; mapId: string };
    await env.DB.prepare("UPDATE hero SET gold = 41, xp = 17 WHERE id = ?").bind(realHero.id).run();

    const testResponse = await authed(`/api/adventures/${adventure.id}/test-sessions`, owner, {
      method: "POST",
      body: JSON.stringify({ startMapId: adventure.secondMapId, heroClass: "ranger" }),
    });
    expect(testResponse.status).toBe(201);
    const test = (await testResponse.json()) as { id: string; party: { id: string } };
    expect(
      (
        (await (await authed("/api/parties", owner)).json()) as {
          items: { id: string }[];
        }
      ).items.map((item) => item.id),
    ).toEqual([realParty.id]);

    expect(
      (await env.DB.prepare("SELECT map_id, gold, xp FROM hero WHERE id = ?")
        .bind(realHero.id)
        .first()) ?? null,
    ).toEqual({ map_id: realHero.mapId, gold: 41, xp: 17 });

    expect(
      (await authed(`/api/adventure-test-sessions/${test.id}`, owner, { method: "DELETE" })).status,
    ).toBe(204);
    expect(
      (await env.DB.prepare("SELECT map_id, gold, xp FROM hero WHERE id = ?")
        .bind(realHero.id)
        .first()) ?? null,
    ).toEqual({ map_id: realHero.mapId, gold: 41, xp: 17 });
    expect(
      (await env.DB.prepare("SELECT id FROM party WHERE id = ?").bind(realParty.id).all()).results,
    ).toEqual([{ id: realParty.id }]);
    expect(
      (await env.DB.prepare("SELECT id FROM party WHERE id = ?").bind(test.party.id).all()).results,
    ).toEqual([]);
  });

  it("collects an expired hidden test when the creator returns to their adventures", async () => {
    const owner = await register("expiry");
    const adventure = await createAdventure(owner);
    const response = await authed(`/api/adventures/${adventure.id}/test-sessions`, owner, {
      method: "POST",
      body: JSON.stringify({ startMapId: null, heroClass: "warrior" }),
    });
    const test = (await response.json()) as {
      id: string;
      party: { id: string };
      hero: { id: string };
    };
    await env.DB.prepare("UPDATE adventure_test_session SET expires_at = 0 WHERE id = ?")
      .bind(test.id)
      .run();

    expect((await authed("/api/adventures", owner)).status).toBe(200);
    expect(
      (await env.DB.prepare("SELECT id FROM party WHERE id = ?").bind(test.party.id).all()).results,
    ).toEqual([]);
    expect(
      (await env.DB.prepare("SELECT id FROM hero WHERE id = ?").bind(test.hero.id).all()).results,
    ).toEqual([]);
    expect(
      (
        await env.DB.prepare("SELECT id FROM adventure_test_session WHERE id = ?")
          .bind(test.id)
          .all()
      ).results,
    ).toEqual([]);
  });

  it("requires authentication and validates the shared start/class shape", async () => {
    const owner = await register("shape");
    const adventure = await createAdventure(owner);
    expect(
      (
        await SELF.fetch(`${ORIGIN}/api/adventures/${adventure.id}/test-sessions`, {
          method: "POST",
        })
      ).status,
    ).toBe(401);
    const malformed = await authed(`/api/adventures/${adventure.id}/test-sessions`, owner, {
      method: "POST",
      body: JSON.stringify({ startMapId: "Map1", heroClass: "mage" }),
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "adventure_test_invalid" });
  });
});
