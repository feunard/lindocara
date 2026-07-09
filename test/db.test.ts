/**
 * The player table is unused by the game today. These tests exist so that the schema, the
 * generated migration, and the Drizzle types cannot silently drift apart before anything
 * depends on them.
 */

import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { createDb, player } from "../src/server/db/index.js";

describe("player table", () => {
  // This pool does not isolate storage between tests, so rows written by one test are visible
  // to the next. Truncate rather than `reset()` from cloudflare:test: that wipes every
  // binding, Durable Object storage included, and this file has no business doing that.
  afterEach(async () => {
    await env.DB.exec("DELETE FROM player");
  });
  it("is created by the migration", async () => {
    const { results } = await env.DB.prepare(
      "select name from sqlite_master where type = 'table' and name = 'player'",
    ).all();

    expect(results).toHaveLength(1);
  });

  it("has the columns the schema declares", async () => {
    const { results } = await env.DB.prepare("pragma table_info(player)").all<{
      name: string;
      notnull: number;
      pk: number;
    }>();

    const columns = Object.fromEntries(results.map((c) => [c.name, c]));
    expect(Object.keys(columns).sort()).toEqual(["created_at", "id", "last_seen_at", "nick"]);
    expect(columns.id?.pk).toBe(1);
    expect(columns.nick?.notnull).toBe(1);
  });

  it("indexes nick, but does not make it unique", async () => {
    const { results } = await env.DB.prepare("pragma index_list(player)").all<{
      name: string;
      unique: number;
    }>();

    const nickIndex = results.find((i) => i.name === "player_nick_idx");
    expect(nickIndex).toBeDefined();
    // Nicknames are not identities yet. See the note in schema.ts.
    expect(nickIndex?.unique).toBe(0);
  });

  it("starts empty", async () => {
    const db = createDb(env.DB);
    expect(await db.select().from(player)).toEqual([]);
  });

  it("round-trips a row through Drizzle, defaulting the timestamps", async () => {
    const db = createDb(env.DB);
    const before = Date.now();

    await db.insert(player).values({ id: "11111111-2222-3333-4444-555555555555", nick: "nico" });

    const rows = await db.select().from(player);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row?.id).toBe("11111111-2222-3333-4444-555555555555");
    expect(row?.nick).toBe("nico");

    // `timestamp_ms` mode must hand back Dates, not raw integers.
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(row?.lastSeenAt).toBeInstanceOf(Date);
    expect(row?.createdAt.getTime()).toBeGreaterThanOrEqual(before - 2000);
  });

  it("rejects a duplicate primary key", async () => {
    const db = createDb(env.DB);
    const row = { id: "same-id", nick: "first" };

    await db.insert(player).values(row);
    await expect(db.insert(player).values({ ...row, nick: "second" })).rejects.toThrow();
  });

  // Deliberately last. "starts empty" above runs before any insert, so it would pass even if
  // rows leaked between tests. This one only passes because afterEach truncates — it is the
  // test that actually guards the guarantee.
  it("sees an empty table even after earlier tests inserted rows", async () => {
    const db = createDb(env.DB);
    expect(await db.select().from(player)).toEqual([]);
  });
});
