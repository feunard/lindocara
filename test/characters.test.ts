import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

const ORIGIN = "https://lindocara.test";

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
  });

  it("requires a session", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/characters`);
    expect(response.status).toBe(401);
  });

  it("creates, lists, and deletes a character", async () => {
    const cookie = await registered("crud_user");

    const created = await characters(cookie, {
      method: "POST",
      body: JSON.stringify({ name: "Hero", appearance: "ember", class: "warrior" }),
    });
    expect(created.status).toBe(200);
    const body = (await created.json()) as { id: string };
    expect(body).toMatchObject({ name: "Hero", appearance: "ember", level: 1 });

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
      body: JSON.stringify({ name: "x", appearance: "ember", class: "warrior" }),
    });
    expect(badName.status).toBe(400);
    expect(await badName.json()).toEqual({ error: "invalid_name" });

    const badLook = await characters(cookie, {
      method: "POST",
      body: JSON.stringify({ name: "FineName", appearance: "plaid", class: "warrior" }),
    });
    expect(badLook.status).toBe(400);
    expect(await badLook.json()).toEqual({ error: "invalid_appearance" });
  });

  it("requires a valid class", async () => {
    const cookie = await registered("classless");
    const missing = await characters(cookie, {
      method: "POST",
      body: JSON.stringify({ name: "NoClass", appearance: "azure" }),
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "invalid_class" });

    const bogus = await characters(cookie, {
      method: "POST",
      body: JSON.stringify({ name: "Bogus", appearance: "azure", class: "necromancer" }),
    });
    expect(bogus.status).toBe(400);
  });

  it("round-trips the class through create and list", async () => {
    const cookie = await registered("healer_maker");
    const created = await characters(cookie, {
      method: "POST",
      body: JSON.stringify({ name: "Mercy", appearance: "moss", class: "priest" }),
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ name: "Mercy", class: "priest", level: 1 });
    const listed = (await (await characters(cookie)).json()) as Array<{ class: string }>;
    expect(listed[0]?.class).toBe("priest");
  });

  it("refuses a fourth character", async () => {
    const cookie = await registered("hoarder");
    for (const name of ["One", "Two", "Three"]) {
      const created = await characters(cookie, {
        method: "POST",
        body: JSON.stringify({ name, appearance: "azure", class: "warrior" }),
      });
      expect(created.status).toBe(200);
    }
    const fourth = await characters(cookie, {
      method: "POST",
      body: JSON.stringify({ name: "Four", appearance: "azure", class: "warrior" }),
    });
    expect(fourth.status).toBe(409);
    expect(await fourth.json()).toEqual({ error: "limit_reached" });
  });

  it("hides other accounts' characters from list and delete", async () => {
    const aliceCookie = await registered("alice");
    const bobCookie = await registered("bob");
    const created = await characters(aliceCookie, {
      method: "POST",
      body: JSON.stringify({ name: "AliceHero", appearance: "violet", class: "warrior" }),
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
