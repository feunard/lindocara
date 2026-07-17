/**
 * The nested heroes API over SELF.fetch: create in a party you joined, cap, non-member refusal,
 * owner-scoped list and delete. Register-and-cookie pattern from parties-api.test.ts.
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../src/server/session.js";

const ORIGIN = "https://lindocara.test";
const COLS = 20;
const ROWS = 15;

function blocks(): string[] {
  const rows: string[] = [];
  while (rows.length < ROWS) rows.push(".".repeat(COLS));
  return rows;
}

function mapBody(name: string): Record<string, unknown> {
  return {
    name,
    blocks: blocks(),
    elements: [],
    spawn: { col: 0, row: 0 },
    markers: {
      entries: [{ id: "door", col: 5, row: 5 }],
      exits: [{ id: "gate", col: 7, row: 7 }],
      monsterSpawns: [],
    },
  };
}

let userCount = 0;

async function register(): Promise<string> {
  userCount += 1;
  const response = await SELF.fetch(`${ORIGIN}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: `heroapi${userCount}`, password: "12345678" }),
  });
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

/** Creates two maps + an adventure + a party owned by `cookie`, returns the party id. */
async function seedParty(cookie: string): Promise<string> {
  const a = await authed("/api/maps", cookie, {
    method: "POST",
    body: JSON.stringify(mapBody("A")),
  });
  const b = await authed("/api/maps", cookie, {
    method: "POST",
    body: JSON.stringify(mapBody("B")),
  });
  const mapA = ((await a.json()) as { id: string }).id;
  const mapB = ((await b.json()) as { id: string }).id;
  const adventure = await authed("/api/adventures", cookie, {
    method: "POST",
    body: JSON.stringify({
      title: "Donjon",
      maxPlayers: 4,
      mapIds: [mapA, mapB],
      graph: {
        start: { mapId: mapA, entryId: "door" },
        links: [
          { mapId: mapA, exitId: "gate", dest: { mapId: mapB, entryId: "door" } },
          { mapId: mapB, exitId: "gate", dest: "end" },
        ],
      },
    }),
  });
  const adventureId = ((await adventure.json()) as { id: string }).id;
  const party = await authed("/api/parties", cookie, {
    method: "POST",
    body: JSON.stringify({ adventureId, color: "blue" }),
  });
  return ((await party.json()) as { id: string }).id;
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM hero");
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
  await env.DB.exec("DELETE FROM adventure_map");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
});

describe("session gate", () => {
  it("401s the hero routes without a cookie", async () => {
    const routes: [string, string][] = [
      ["GET", "/api/parties/some-id/heroes"],
      ["POST", "/api/parties/some-id/heroes"],
      ["DELETE", "/api/parties/some-id/heroes/hero-id"],
    ];
    for (const [method, path] of routes) {
      expect((await SELF.fetch(`${ORIGIN}${path}`, { method })).status).toBe(401);
    }
  });
});

describe("hero lifecycle over the wire", () => {
  it("creates, lists and deletes the caller's heroes", async () => {
    const host = await register();
    const partyId = await seedParty(host);

    const createRes = await authed(`/api/parties/${partyId}/heroes`, host, {
      method: "POST",
      body: JSON.stringify({ name: "Mira", class: "priest" }),
    });
    expect(createRes.status).toBe(201);
    const heroRow = (await createRes.json()) as { id: string; mapId: string };
    expect(heroRow).toMatchObject({ name: "Mira", class: "priest", life: "alive" });

    const listRes = await authed(`/api/parties/${partyId}/heroes`, host, {});
    expect(listRes.status).toBe(200);
    expect((await listRes.json()) as unknown[]).toHaveLength(1);

    const deleteRes = await authed(`/api/parties/${partyId}/heroes/${heroRow.id}`, host, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(204);
    expect(
      (await (await authed(`/api/parties/${partyId}/heroes`, host, {})).json()) as unknown[],
    ).toHaveLength(0);
  });

  it("answers machine codes for a bad body, a non-member, and the cap", async () => {
    const host = await register();
    const partyId = await seedParty(host);

    const invalid = await authed(`/api/parties/${partyId}/heroes`, host, {
      method: "POST",
      body: JSON.stringify({ name: "", class: "warrior" }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "hero_invalid" });

    const outsider = await register();
    const forbidden = await authed(`/api/parties/${partyId}/heroes`, outsider, {
      method: "POST",
      body: JSON.stringify({ name: "Sneak", class: "warrior" }),
    });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "hero_not_member" });

    for (const name of ["One", "Two", "Three"]) {
      await authed(`/api/parties/${partyId}/heroes`, host, {
        method: "POST",
        body: JSON.stringify({ name, class: "warrior" }),
      });
    }
    const capped = await authed(`/api/parties/${partyId}/heroes`, host, {
      method: "POST",
      body: JSON.stringify({ name: "Four", class: "warrior" }),
    });
    expect(capped.status).toBe(409);
    expect(await capped.json()).toEqual({ error: "hero_cap" });
  });
});
