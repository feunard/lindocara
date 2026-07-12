/**
 * The account API through the real Worker: register, login, and the guarantees the
 * client relies on (case-insensitive usernames, indistinguishable 401s, machine-readable
 * error codes).
 */

import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

const ORIGIN = "https://lindocara.test";

function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function cookieOf(response: Response): string {
  const header = response.headers.get("Set-Cookie");
  const pair = header?.split(";")[0];
  if (!pair) throw new Error("no session cookie issued");
  return pair;
}

describe("register and login", () => {
  afterEach(async () => {
    await env.DB.exec("DELETE FROM character");
    await env.DB.exec("DELETE FROM account");
  });

  it("registers, sets a session cookie, and /api/me sees the account", async () => {
    const response = await post("/api/register", { username: "Nico", password: "12345678" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ username: "nico" });

    const me = await SELF.fetch(`${ORIGIN}/api/me`, { headers: { Cookie: cookieOf(response) } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ username: "nico" });
  });

  it("rejects a duplicate username case-insensitively with a machine code", async () => {
    await post("/api/register", { username: "taken", password: "12345678" });
    const dup = await post("/api/register", { username: "TAKEN", password: "87654321" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "username_taken" });
  });

  it("validates username and password shape", async () => {
    expect((await post("/api/register", { username: "x", password: "12345678" })).status).toBe(400);
    expect((await post("/api/register", { username: "okname", password: "short" })).status).toBe(
      400,
    );
    expect((await post("/api/register", "not an object")).status).toBe(400);
  });

  it("logs in with the right password and rejects the wrong one", async () => {
    await post("/api/register", { username: "player1", password: "12345678" });
    const ok = await post("/api/session", { username: "PLAYER1", password: "12345678" });
    expect(ok.status).toBe(200);
    expect(cookieOf(ok)).toContain("lindocara_session=");

    const bad = await post("/api/session", { username: "player1", password: "xxxxxxxx" });
    expect(bad.status).toBe(401);
  });

  it("returns byte-identical 401s for unknown user and wrong password", async () => {
    await post("/api/register", { username: "existing", password: "12345678" });
    const wrongPassword = await post("/api/session", {
      username: "existing",
      password: "xxxxxxxx",
    });
    const unknownUser = await post("/api/session", { username: "phantom_", password: "xxxxxxxx" });
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(await wrongPassword.text()).toBe(await unknownUser.text());
  });

  it("logout clears the cookie", async () => {
    const registered = await post("/api/register", { username: "leaver", password: "12345678" });
    const out = await SELF.fetch(`${ORIGIN}/api/session`, {
      method: "DELETE",
      headers: { Cookie: cookieOf(registered) },
    });
    expect(out.status).toBe(204);
    expect(out.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("rejects a signed session whose account row was wiped", async () => {
    const registered = await post("/api/register", { username: "ghosted", password: "12345678" });
    const cookie = cookieOf(registered);
    await env.DB.exec("DELETE FROM account");

    const me = await SELF.fetch(`${ORIGIN}/api/me`, { headers: { Cookie: cookie } });
    expect(me.status).toBe(401);
    expect(await me.json()).toEqual({ error: "session_expired" });
    expect(me.headers.get("Set-Cookie")).toContain("Max-Age=0");

    const create = await SELF.fetch(`${ORIGIN}/api/characters`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: "GhostHero",
        appearance: { body: "wayfarer", primaryColor: "azure" },
        class: "warrior",
      }),
    });
    expect(create.status).toBe(401);
    expect(await create.json()).toEqual({ error: "session_expired" });
  });
});
