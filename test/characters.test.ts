import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { createAccount } from "../src/server/accounts.js";
import { createCharacter } from "../src/server/characters.js";
import { createDb } from "../src/server/db/index.js";
import { createMap } from "../src/server/maps.js";
import { loadProfile } from "../src/server/profile.js";
import { DEFAULT_APPEARANCE } from "../src/shared/character.js";

const ORIGIN = "https://lindocara.test";
const appearance = (primaryColor: string) => ({ body: "wayfarer", primaryColor });

async function registered(username: string): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "12345678" }),
  });
  expect(response.status).toBe(200);
  const pair = response.headers.get("Set-Cookie")?.split(";")[0];
  if (!pair) throw new Error("no session cookie issued");
  return pair;
}

function characters(cookie: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/characters`, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: cookie, ...init?.headers },
  });
}

describe("character endpoints", () => {
  afterEach(async () => {
    await env.DB.exec("DELETE FROM character");
    await env.DB.exec("DELETE FROM account");
    // Elements before maps (FK) — mirrors test/maps.test.ts's cleanup. The pool does not isolate
    // storage between tests, so maps created directly against `db` below must not leak forward.
    await env.DB.exec("DELETE FROM map_element");
    await env.DB.exec("DELETE FROM map");
  });

  it("requires a session", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/characters`);
    expect(response.status).toBe(401);
  });

  it("creates, lists, and deletes a character", async () => {
    const cookie = await registered("crud_user");

    const created = await characters(cookie, {
      method: "POST",
      body: JSON.stringify({ name: "Hero", appearance: appearance("ember"), class: "warrior" }),
    });
    expect(created.status).toBe(200);
    const body = (await created.json()) as { id: string };
    expect(body).toMatchObject({
      name: "Hero",
      appearance: appearance("ember"),
      equipment: { mainHand: "weathered_sword", offHand: "oak_shield" },
      level: 1,
    });

    const listed = await characters(cookie);
    expect(await listed.json()).toMatchObject([{ id: body.id, name: "Hero" }]);

    const deleted = await SELF.fetch(`${ORIGIN}/api/characters/${body.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(deleted.status).toBe(204);
    expect(await (await characters(cookie)).json()).toEqual([]);
  });

  it("validates name and appearance with machine codes", async () => {
    const cookie = await registered("validator");
    const badName = await characters(cookie, {
      method: "POST",
      body: JSON.stringify({ name: "x", appearance: appearance("ember"), class: "warrior" }),
    });
    expect(badName.status).toBe(400);
    expect(await badName.json()).toEqual({ error: "invalid_name" });

    const badLook = await characters(cookie, {
      method: "POST",
      body: JSON.stringify({
        name: "FineName",
        appearance: appearance("plaid"),
        class: "warrior",
      }),
    });
    expect(badLook.status).toBe(400);
    expect(await badLook.json()).toEqual({ error: "invalid_appearance" });

    const badBody = await characters(cookie, {
      method: "POST",
      body: JSON.stringify({
        name: "FineName",
        appearance: { body: "giant", primaryColor: "azure" },
        class: "warrior",
      }),
    });
    expect(badBody.status).toBe(400);
    expect(await badBody.json()).toEqual({ error: "invalid_appearance" });
  });

  it("requires a valid class", async () => {
    const cookie = await registered("classless");
    const missing = await characters(cookie, {
      method: "POST",
      body: JSON.stringify({ name: "NoClass", appearance: appearance("azure") }),
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "invalid_class" });

    const bogus = await characters(cookie, {
      method: "POST",
      body: JSON.stringify({
        name: "Bogus",
        appearance: appearance("azure"),
        class: "necromancer",
      }),
    });
    expect(bogus.status).toBe(400);
  });

  it("round-trips the class through create and list", async () => {
    const cookie = await registered("healer_maker");
    const created = await characters(cookie, {
      method: "POST",
      body: JSON.stringify({ name: "Mercy", appearance: appearance("moss"), class: "priest" }),
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      name: "Mercy",
      class: "priest",
      appearance: appearance("moss"),
      equipment: { mainHand: "heartwood_staff", offHand: null },
      level: 1,
    });
    const listed = (await (await characters(cookie)).json()) as Array<{ class: string }>;
    expect(listed[0]?.class).toBe("priest");
  });

  it("assigns and persists the server-owned starter equipment for every class", async () => {
    const cookie = await registered("starter_loadouts");
    const expected = {
      warrior: { mainHand: "weathered_sword", offHand: "oak_shield" },
      ranger: { mainHand: "hunter_bow", offHand: null },
      priest: { mainHand: "heartwood_staff", offHand: null },
    } as const;

    for (const [index, playerClass] of (["warrior", "ranger", "priest"] as const).entries()) {
      const response = await characters(cookie, {
        method: "POST",
        body: JSON.stringify({
          name: `Loadout${index}`,
          appearance: appearance("violet"),
          class: playerClass,
          equipment: { mainHand: "hunter_bow", offHand: "oak_shield" },
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        class: playerClass,
        appearance: appearance("violet"),
        equipment: expected[playerClass],
      });
    }

    const listed = (await (await characters(cookie)).json()) as Array<{
      class: keyof typeof expected;
      equipment: unknown;
    }>;
    for (const entry of listed) expect(entry.equipment).toEqual(expected[entry.class]);
  });

  it("refuses a fourth character", async () => {
    const cookie = await registered("hoarder");
    for (const name of ["One", "Two", "Three"]) {
      const created = await characters(cookie, {
        method: "POST",
        body: JSON.stringify({ name, appearance: appearance("azure"), class: "warrior" }),
      });
      expect(created.status).toBe(200);
    }
    const fourth = await characters(cookie, {
      method: "POST",
      body: JSON.stringify({ name: "Four", appearance: appearance("azure"), class: "warrior" }),
    });
    expect(fourth.status).toBe(409);
    expect(await fourth.json()).toEqual({ error: "limit_reached" });
  });

  it("hides other accounts' characters from list and delete", async () => {
    const aliceCookie = await registered("alice");
    const bobCookie = await registered("bob");
    const created = await characters(aliceCookie, {
      method: "POST",
      body: JSON.stringify({
        name: "AliceHero",
        appearance: appearance("violet"),
        class: "warrior",
      }),
    });
    const body = (await created.json()) as { id: string };

    expect(await (await characters(bobCookie)).json()).toEqual([]);
    const theft = await SELF.fetch(`${ORIGIN}/api/characters/${body.id}`, {
      method: "DELETE",
      headers: { Cookie: bobCookie },
    });
    expect(theft.status).toBe(404);
    expect(await (await characters(aliceCookie)).json()).toHaveLength(1);
  });
});

describe("creation location resolves through D1", () => {
  afterEach(async () => {
    await env.DB.exec("DELETE FROM character");
    await env.DB.exec("DELETE FROM account");
    // Elements before maps (FK) — mirrors test/maps.test.ts's cleanup.
    await env.DB.exec("DELETE FROM map_element");
    await env.DB.exec("DELETE FROM map");
  });

  it("creates a character on the built-in floor when no map exists", async () => {
    const db = createDb(env.DB);
    const account = await createAccount(db, "nova_builtin", "12345678");
    if (account === "username_taken") throw new Error("unexpected username collision");
    const created = await createCharacter(db, account.id, "Nova", DEFAULT_APPEARANCE, "warrior");
    if (created === "limit_reached") throw new Error("unexpected limit_reached");
    const profile = await loadProfile(db, created.id);
    expect(profile?.zoneId).toBe("builtin");
    expect(profile?.instanceId).toBe("main");
  });

  it("creates a character on the first map when one exists", async () => {
    const db = createDb(env.DB);
    const stored = await createMap(db, {
      name: "Home",
      blocks: Array.from({ length: 15 }, () => ".".repeat(20)),
      elements: [],
      spawn: { col: 3, row: 3 },
    });
    const account = await createAccount(db, "nova_map", "12345678");
    if (account === "username_taken") throw new Error("unexpected username collision");
    const created = await createCharacter(db, account.id, "Nova", DEFAULT_APPEARANCE, "warrior");
    if (created === "limit_reached") throw new Error("unexpected limit_reached");
    const profile = await loadProfile(db, created.id);
    expect(profile?.zoneId).toBe(stored.id);
  });
});
