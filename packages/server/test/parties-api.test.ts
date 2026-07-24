/**
 * The parties CRUD API over SELF.fetch: session gate, create-from-owned-adventure, join fencing,
 * host-only delete, and the wire codes. Register-and-cookie pattern from adventures-api.test.ts.
 */
import { env, SELF } from "cloudflare:test";
import { EMPTY_MARKERS } from "@lindocara/engine/map-data.js";
import { functionalEvent, type MapEvent } from "@lindocara/engine/map-events.js";
import { SESSION_COOKIE } from "@lindocara/server/session.js";
import { layeredWireTerrain } from "@lindocara/testing/map-fixtures.js";
import { afterEach, describe, expect, it } from "vitest";

const ORIGIN = "https://lindocara.test";
const COLS = 20;
const ROWS = 15;

// UX wave #12: the graph binds entry/exit EVENT uuids. Map A and map B use distinct uuid families
// because a `map_event` id is a global primary key.
const ENTRY_A = "aaaaaaaa-0000-4000-8000-000000000001";
const EXIT_A = "aaaaaaaa-0000-4000-8000-000000000002";
const ENTRY_B = "bbbbbbbb-0000-4000-8000-000000000001";
const EXIT_B = "bbbbbbbb-0000-4000-8000-000000000002";

function blocks(): string[] {
  const rows: string[] = [];
  while (rows.length < ROWS) rows.push(".".repeat(COLS));
  return rows;
}

function ev(id: string, kind: "entry" | "exit", col: number, row: number): MapEvent {
  return functionalEvent({ id, col, row, ordinal: 0, kind });
}

function eventsB(): MapEvent[] {
  return [ev(ENTRY_B, "entry", 5, 5), ev(EXIT_B, "exit", 7, 7)];
}

function mapBody(
  name: string,
  events: MapEvent[] = [ev(ENTRY_A, "entry", 5, 5), ev(EXIT_A, "exit", 7, 7)],
): Record<string, unknown> {
  return {
    name,
    ...layeredWireTerrain(blocks()),
    elements: [],
    spawn: { col: 0, row: 0 },
    markers: EMPTY_MARKERS,
    events,
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
  const created = await authed("/api/adventures", cookie, {
    method: "POST",
    body: JSON.stringify({ title: "Donjon", maxPlayers }),
  });
  // Reuse the atomic create's default first map as map A (two-map corridor, no stray map).
  const createdBody = (await created.json()) as { id: string; defaultMap: { id: string } };
  const adventureId = createdBody.id;
  const mapA = createdBody.defaultMap.id;
  // The born graph binds the default map's start/exit; reset to a draft before re-authoring mapA.
  await authed(`/api/adventures/${adventureId}`, cookie, {
    method: "PUT",
    body: JSON.stringify({ title: "Donjon", maxPlayers, graph: { start: null, links: [] } }),
  });
  const b = await authed("/api/maps", cookie, {
    method: "POST",
    body: JSON.stringify({ adventureId, name: "B" }),
  });
  const mapB = ((await b.json()) as { id: string }).id;
  await authed(`/api/maps/${mapA}`, cookie, { method: "PUT", body: JSON.stringify(mapBody("A")) });
  await authed(`/api/maps/${mapB}`, cookie, {
    method: "PUT",
    body: JSON.stringify(mapBody("B", eventsB())),
  });
  await authed(`/api/adventures/${adventureId}`, cookie, {
    method: "PUT",
    body: JSON.stringify({
      title: "Donjon",
      maxPlayers,
      graph: {
        start: { mapId: mapA, entryId: ENTRY_A },
        links: [
          { mapId: mapA, exitId: EXIT_A, dest: { mapId: mapB, entryId: ENTRY_B } },
          { mapId: mapB, exitId: EXIT_B, dest: "end" },
        ],
      },
    }),
  });
  return adventureId;
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
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
    const list = (await listRes.json()) as {
      items: { id: string; colors: string[] }[];
      nextCursor: string | null;
    };
    expect(list.items.find((row) => row.id === party.id)).toMatchObject({ colors: ["blue"] });

    // Colour is server-assigned now: joining takes no body and just works, the guest getting the
    // next free colour after the host's blue.
    const joinRes = await authed(`/api/parties/${party.id}/join`, guest, { method: "POST" });
    expect(joinRes.status).toBe(204);

    // guest is not the host → cannot delete
    const forbidden = await authed(`/api/parties/${party.id}`, guest, { method: "DELETE" });
    expect(forbidden.status).toBe(404);

    const deleteRes = await authed(`/api/parties/${party.id}`, host, { method: "DELETE" });
    expect(deleteRes.status).toBe(204);
  });

  it("lets another account discover and start a playable adventure", async () => {
    const host = await register();
    const adventureId = await seedAdventure(host);
    const guest = await register();

    // The play-scope listing is server-wide: the guest sees the host's playable adventure…
    const playable = await authed("/api/adventures?scope=play", guest, {});
    expect(playable.status).toBe(200);
    const playList = (await playable.json()) as {
      id: string;
      playable: boolean;
      author: string;
    }[];
    const found = playList.find((entry) => entry.id === adventureId);
    expect(found?.playable).toBe(true);
    expect(found?.author).toMatch(/^partyapi\d+$/);

    // …while the editor listing stays owner-fenced.
    const own = await authed("/api/adventures", guest, {});
    expect(((await own.json()) as { id: string }[]).some((a) => a.id === adventureId)).toBe(false);

    // And a party can be created on it by the non-owner…
    const created = await authed("/api/parties", guest, {
      method: "POST",
      body: JSON.stringify({ adventureId, color: "red" }),
    });
    expect(created.status).toBe(201);
    const partyId = ((await created.json()) as { id: string }).id;

    // …including hero creation, whose spawn derives from the (foreign) adventure's start.
    const heroCreated = await authed(`/api/parties/${partyId}/heroes`, guest, {
      method: "POST",
      body: JSON.stringify({ name: "Visiteuse", class: "ranger" }),
    });
    expect(heroCreated.status).toBe(201);
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
    expect(
      ((await mineRes.json()) as { items: { mine: boolean; myColor: string }[] }).items[0],
    ).toMatchObject({ mine: true, myColor: "blue" });
    const stranger = await register();
    const theirs = await authed("/api/parties", stranger, {});
    expect(((await theirs.json()) as { items: { mine: boolean }[] }).items[0]).toMatchObject({
      mine: false,
      myColor: null,
    });
  });

  it("rejects malformed pagination instead of issuing an unbounded query", async () => {
    const host = await register();
    const response = await authed("/api/parties?cursor=broken&limit=999", host, {});
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "party_page_invalid" });
  });
});
