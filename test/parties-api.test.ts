/**
 * The parties CRUD API over SELF.fetch: session gate, create-from-owned-adventure, join fencing,
 * host-only delete, and the wire codes. Register-and-cookie pattern from adventures-api.test.ts.
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../src/server/session.js";
import { layeredWireTerrain } from "./support/map-fixtures.js";

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
    ...layeredWireTerrain(blocks()),
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
    body: JSON.stringify({ username: `partyapi${userCount}`, password: "12345678" }),
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

async function seedAdventure(cookie: string, maxPlayers = 4): Promise<string> {
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
  const created = await authed("/api/adventures", cookie, {
    method: "POST",
    body: JSON.stringify({
      title: "Donjon",
      maxPlayers,
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
  return ((await created.json()) as { id: string }).id;
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
  await env.DB.exec("DELETE FROM adventure_map");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
});

describe("session gate", () => {
  it("401s the party routes without a cookie", async () => {
    const routes: [string, string][] = [
      ["GET", "/api/parties"],
      ["POST", "/api/parties"],
      ["POST", "/api/parties/some-id/join"],
      ["DELETE", "/api/parties/some-id"],
    ];
    for (const [method, path] of routes) {
      expect((await SELF.fetch(`${ORIGIN}${path}`, { method })).status).toBe(401);
    }
  });
});

describe("party lifecycle over the wire", () => {
  it("creates, lists, is joined by another account, then host-deletes", async () => {
    const host = await register();
    const adventureId = await seedAdventure(host, 2);

    const createRes = await authed("/api/parties", host, {
      method: "POST",
      body: JSON.stringify({ adventureId, name: "Chez Nico", color: "blue" }),
    });
    expect(createRes.status).toBe(201);
    const party = (await createRes.json()) as { id: string };
    expect(party).toMatchObject({
      maxPlayers: 2,
      hostAccountId: expect.any(String),
      status: "open",
    });

    const guest = await register();
    const listRes = await authed("/api/parties", guest, {});
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { id: string; colors: string[] }[];
    expect(list.find((row) => row.id === party.id)).toMatchObject({ colors: ["blue"] });

    const takenRes = await authed(`/api/parties/${party.id}/join`, guest, {
      method: "POST",
      body: JSON.stringify({ color: "blue" }),
    });
    expect(takenRes.status).toBe(409);
    expect(await takenRes.json()).toEqual({ error: "party_color_taken" });

    const joinRes = await authed(`/api/parties/${party.id}/join`, guest, {
      method: "POST",
      body: JSON.stringify({ color: "red" }),
    });
    expect(joinRes.status).toBe(204);

    // guest is not the host → cannot delete
    const forbidden = await authed(`/api/parties/${party.id}`, guest, { method: "DELETE" });
    expect(forbidden.status).toBe(404);

    const deleteRes = await authed(`/api/parties/${party.id}`, host, { method: "DELETE" });
    expect(deleteRes.status).toBe(204);
  });

  it("answers machine codes for a bad body and a foreign adventure", async () => {
    const host = await register();
    const invalid = await authed("/api/parties", host, {
      method: "POST",
      body: JSON.stringify({ color: "black" }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "party_invalid" });

    const missing = await authed("/api/parties", host, {
      method: "POST",
      body: JSON.stringify({ adventureId: "no-such-adventure" }),
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "party_adventure" });
  });

  it("refuses deleting an adventure a party references, over the wire", async () => {
    const host = await register();
    const adventureId = await seedAdventure(host);
    const created = await authed("/api/parties", host, {
      method: "POST",
      body: JSON.stringify({ adventureId, color: "blue" }),
    });
    expect(created.status).toBe(201);
    const res = await authed(`/api/adventures/${adventureId}`, host, { method: "DELETE" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "adventure_referenced" });
  });

  it("answers party_full when the cap is already reached", async () => {
    const host = await register();
    const adventureId = await seedAdventure(host, 1); // cap 1 → the host's auto-join fills it
    const created = await authed("/api/parties", host, {
      method: "POST",
      body: JSON.stringify({ adventureId, color: "blue" }),
    });
    const party = (await created.json()) as { id: string };
    const guest = await register();
    const res = await authed(`/api/parties/${party.id}/join`, guest, {
      method: "POST",
      body: JSON.stringify({ color: "red" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "party_full" });
  });

  it("annotates the listing with the caller's membership", async () => {
    const host = await register();
    const adventureId = await seedAdventure(host);
    await authed("/api/parties", host, {
      method: "POST",
      body: JSON.stringify({ adventureId, color: "blue" }),
    });
    const mineRes = await authed("/api/parties", host, {});
    expect(((await mineRes.json()) as { mine: boolean; myColor: string }[])[0]).toMatchObject({
      mine: true,
      myColor: "blue",
    });
    const stranger = await register();
    const theirs = await authed("/api/parties", stranger, {});
    expect(((await theirs.json()) as { mine: boolean }[])[0]).toMatchObject({
      mine: false,
      myColor: null,
    });
  });
});
