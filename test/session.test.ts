import { describe, expect, it, vi } from "vitest";
import {
  createSession,
  isValidNickname,
  readSessionCookie,
  SESSION_TTL_SECONDS,
  signSession,
  verifySession,
} from "../src/server/session.js";

const SECRET = "test-secret";

describe("isValidNickname", () => {
  it.each(["ab", "Player_1", "a-b-c", "0123456789abcdef"])("accepts %j", (nick) => {
    expect(isValidNickname(nick)).toBe(true);
  });

  it.each([
    "a",
    "0123456789abcdefg",
    "has space",
    "emoji-🐟",
    "semi;colon",
    "",
    null,
    42,
  ])("rejects %j", (nick) => {
    expect(isValidNickname(nick)).toBe(false);
  });
});

describe("signSession / verifySession", () => {
  it("round-trips a session", async () => {
    const session = createSession("player");
    const token = await signSession(session, SECRET);

    expect(await verifySession(token, SECRET)).toEqual(session);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSession(createSession("player"), SECRET);
    expect(await verifySession(token, "other-secret")).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const session = createSession("player");
    const token = await signSession(session, SECRET);
    const [, signature] = token.split(".");

    // Forge a payload claiming to be someone else, keeping the original signature.
    const forged = btoa(JSON.stringify({ ...session, nick: "victim" }))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");

    expect(await verifySession(`${forged}.${signature}`, SECRET)).toBeNull();
  });

  it.each([
    "",
    ".",
    "nodot",
    "a.",
    ".b",
    "a.b.c",
    "!!!.???",
  ])("rejects malformed token %j", async (token) => {
    expect(await verifySession(token, SECRET)).toBeNull();
  });

  it("refuses to sign or verify with an unset secret", async () => {
    const session = createSession("player");
    await expect(signSession(session, "")).rejects.toThrow(/SESSION_SECRET/);

    const token = await signSession(session, SECRET);
    await expect(verifySession(token, "")).rejects.toThrow(/SESSION_SECRET/);
  });

  it("rejects an expired token", async () => {
    const token = await signSession(createSession("player"), SECRET);
    expect(await verifySession(token, SECRET)).not.toBeNull();

    const past = Date.now() + (SESSION_TTL_SECONDS + 60) * 1000;
    vi.spyOn(Date, "now").mockReturnValue(past);
    try {
      expect(await verifySession(token, SECRET)).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("readSessionCookie", () => {
  it("finds the cookie among others", () => {
    const request = new Request("https://example.com", {
      headers: { Cookie: "a=1; lindocara_session=tok; b=2" },
    });
    expect(readSessionCookie(request)).toBe("tok");
  });

  it("does not match a cookie whose name merely ends with ours", () => {
    const request = new Request("https://example.com", {
      headers: { Cookie: "not_lindocara_session=nope" },
    });
    expect(readSessionCookie(request)).toBeNull();
  });

  it("returns null when there is no cookie header", () => {
    expect(readSessionCookie(new Request("https://example.com"))).toBeNull();
  });
});
