import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../src/server/session.js";

const ORIGIN = "https://lindocara.test";

async function login(nickname: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
}

/** Extract the raw session token from a Set-Cookie header. */
function tokenFrom(response: Response): string {
  const setCookie = response.headers.get("Set-Cookie");
  expect(setCookie).toContain(`${SESSION_COOKIE}=`);
  const value = setCookie?.split(";")[0]?.split("=")[1];
  expect(value).toBeTruthy();
  return value as string;
}

describe("POST /api/session", () => {
  it("issues an HttpOnly session cookie for a valid nickname", async () => {
    const response = await login("player_one");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ nick: "player_one" });

    const setCookie = response.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    // The test origin is https, so the cookie must be marked Secure.
    expect(setCookie).toContain("Secure");
  });

  it.each([
    "a",
    "way-too-long-a-nickname",
    "has space",
    "",
  ])("rejects invalid nickname %j", async (nickname) => {
    const response = await login(nickname);
    expect(response.status).toBe(400);
  });

  it("rejects a non-JSON body", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/session`, {
      method: "POST",
      body: "not json",
    });
    expect(response.status).toBe(400);
  });
});

describe("GET /api/me", () => {
  it("returns 401 without a cookie", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/me`);
    expect(response.status).toBe(401);
  });

  it("returns 401 for a forged cookie", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/me`, {
      headers: { Cookie: `${SESSION_COOKIE}=forged.token` },
    });
    expect(response.status).toBe(401);
  });

  it("returns the session for a valid cookie", async () => {
    const token = tokenFrom(await login("returning"));
    const response = await SELF.fetch(`${ORIGIN}/api/me`, {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ nick: "returning" });
  });
});

describe("DELETE /api/session", () => {
  it("clears the cookie", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/session`, { method: "DELETE" });
    expect(response.status).toBe(204);
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});

describe("GET /api/ws", () => {
  it("refuses a plain GET without an upgrade header", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/ws`);
    expect(response.status).toBe(426);
  });

  it("refuses an upgrade without a session", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/ws`, {
      headers: { Upgrade: "websocket" },
    });
    expect(response.status).toBe(401);
  });
});

describe("unknown routes", () => {
  it("404s unmatched api paths", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/nope`);
    expect(response.status).toBe(404);
  });
});
