/**
 * `relocateProfile` is the front-door fallback's fenced location write: it moves a character while
 * the caller's lease epoch still matches, and — unlike `handoffProfileLocation` — must NOT advance
 * the epoch, because the room that called it is about to compare `profile.sessionEpoch` against the
 * very lease that authorized the move.
 */

import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { createAccount } from "../src/server/accounts.js";
import { createCharacter } from "../src/server/characters.js";
import { createDb } from "../src/server/db/index.js";
import { acquireSessionEpoch, loadProfile, relocateProfile } from "../src/server/profile.js";

describe("relocateProfile", () => {
  // The pool does not isolate storage between tests.
  afterEach(async () => {
    await env.DB.exec("DELETE FROM character");
    await env.DB.exec("DELETE FROM account");
  });

  async function newCharacter(): Promise<string> {
    const db = createDb(env.DB);
    const account = await createAccount(db, "relocate-owner", "a good password");
    if (account === "username_taken") throw new Error("unexpected collision");
    const created = await createCharacter(
      db,
      account.id,
      "Relocatee",
      { body: "wayfarer", primaryColor: "azure" },
      "warrior",
    );
    if (created === "limit_reached") throw new Error("unexpected cap");
    return created.id;
  }

  it("moves the character only while the epoch matches", async () => {
    const db = createDb(env.DB);
    const characterId = await newCharacter();
    // A room acquires the lease epoch on connect, then relocates while it still holds it — mirror
    // that here rather than asserting against the fresh row's epoch of 0.
    expect(await acquireSessionEpoch(db, characterId)).toBe(1);

    const moved = await relocateProfile(
      db,
      { id: characterId, sessionEpoch: 1 },
      { zoneId: "some-map-id", instanceId: "main", x: 96, y: 96 },
    );
    expect(moved).toBe(true);
    const profile = await loadProfile(db, characterId);
    expect(profile?.zoneId).toBe("some-map-id");
    expect(profile?.sessionEpoch).toBe(1); // relocation does NOT advance the epoch

    const stale = await relocateProfile(
      db,
      { id: characterId, sessionEpoch: 99 },
      { zoneId: "elsewhere", instanceId: "main", x: 0, y: 0 },
    );
    expect(stale).toBe(false);
    expect((await loadProfile(db, characterId))?.zoneId).toBe("some-map-id");
  });
});
