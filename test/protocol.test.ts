import { describe, expect, it } from "vitest";
import {
  encodeServerMessage,
  parseClientMessage,
  parseServerMessage,
} from "../src/shared/protocol.js";

describe("client protocol", () => {
  it("accepts movement and action intents without accepting outcomes", () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          t: "input",
          seq: 7,
          input: { up: true, down: false, left: false, right: true },
        }),
      ),
    ).toEqual({
      t: "input",
      seq: 7,
      input: { up: true, down: false, left: false, right: true },
    });
    expect(parseClientMessage(JSON.stringify({ t: "attack" }))).toEqual({ t: "attack" });
    expect(parseClientMessage(JSON.stringify({ t: "interact" }))).toEqual({ t: "interact" });
    expect(parseClientMessage(JSON.stringify({ t: "use", item: "potion" }))).toEqual({
      t: "use",
      item: "potion",
    });
    expect(parseClientMessage(JSON.stringify({ t: "chat", text: "hello" }))).toEqual({
      t: "chat",
      channel: "local",
      text: "hello",
    });
    expect(
      parseClientMessage(JSON.stringify({ t: "chat", channel: "global", text: "hello" })),
    ).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "world.resync" }))).toEqual({
      t: "world.resync",
    });
    expect(parseClientMessage(JSON.stringify({ t: "navigation.debug", enabled: true }))).toEqual({
      t: "navigation.debug",
      enabled: true,
    });
    expect(
      parseClientMessage(JSON.stringify({ t: "navigation.debug", enabled: "yes" })),
    ).toBeNull();
  });

  it.each([
    "not json",
    JSON.stringify({ t: "teleport", x: 1, y: 1 }),
    JSON.stringify({ t: "damage", amount: 999 }),
    JSON.stringify({ t: "use", item: "admin_sword" }),
    JSON.stringify({ t: "input", input: { up: true, down: false, left: false, right: false } }),
    JSON.stringify({
      t: "input",
      seq: 0,
      input: { up: true, down: false, left: false, right: false },
    }),
    JSON.stringify({ t: "input", input: { up: "yes" } }),
    JSON.stringify({ t: "chat", text: 42 }),
  ])("rejects untrusted frame %s", (raw) => {
    expect(parseClientMessage(raw)).toBeNull();
  });

  it("rejects binary frames", () => {
    expect(parseClientMessage(new ArrayBuffer(8))).toBeNull();
  });

  it("parses the heal intent and rejects garbage variants", () => {
    expect(parseClientMessage(JSON.stringify({ t: "heal" }))).toEqual({ t: "heal" });
    expect(parseClientMessage(JSON.stringify({ t: "heal", target: "someone" }))).toEqual({
      t: "heal",
    });
    expect(parseClientMessage(JSON.stringify({ t: "heals" }))).toBeNull();
  });

  it("accepts only the five authoritative skill slots", () => {
    expect(parseClientMessage(JSON.stringify({ t: "skill", slot: 3 }))).toEqual({
      t: "skill",
      slot: 3,
    });
    expect(parseClientMessage(JSON.stringify({ t: "skill", slot: 0 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "skill", slot: 6 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "skill", slot: "3" }))).toBeNull();
  });

  it("accepts only server-minted UUIDs for party actions", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    expect(parseClientMessage(JSON.stringify({ t: "party.invite", playerId: id }))).toEqual({
      t: "party.invite",
      playerId: id,
    });
    expect(parseClientMessage(JSON.stringify({ t: "party.accept", inviteId: id }))).toEqual({
      t: "party.accept",
      inviteId: id,
    });
    expect(
      parseClientMessage(JSON.stringify({ t: "party.invite", playerId: "not-a-player" })),
    ).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ t: "party.accept", inviteId: "../invite" })),
    ).toBeNull();
  });
});

describe("server protocol", () => {
  it("rejects unknown or structurally incomplete messages", () => {
    expect(parseServerMessage(JSON.stringify({ t: "unknown" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ t: "snapshot", players: [] }))).toBeNull();
    expect(parseServerMessage("broken")).toBeNull();
  });

  it("only accepts a welcome whose world carries a zone the client actually knows", () => {
    const base = {
      t: "welcome",
      tick: 10,
      selfId: "p1",
      players: [],
      monsters: [],
      guards: [],
      loot: [],
      corpses: [],
      self: {},
    };
    expect(
      parseServerMessage(JSON.stringify({ ...base, world: { zoneId: "verdant-reach" } })),
    ).toMatchObject({ t: "welcome", world: { zoneId: "verdant-reach" } });
    // A cached SPA build meeting a server that has since added a zone must drop the frame
    // (and resync/reconnect) rather than hand an unrecognised id to zoneDefinition() downstream.
    expect(
      parseServerMessage(JSON.stringify({ ...base, world: { zoneId: "some-future-zone" } })),
    ).toBeNull();
    expect(parseServerMessage(JSON.stringify({ ...base, world: {} }))).toBeNull();
  });

  it("validates world deltas and full resynchronization messages", () => {
    const emptyDelta = { upsert: [], remove: [] };
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "world.delta",
          tick: 12,
          players: emptyDelta,
          monsters: emptyDelta,
          guards: emptyDelta,
          loot: emptyDelta,
          corpses: emptyDelta,
        }),
      ),
    ).toMatchObject({ t: "world.delta", tick: 12 });
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "world.delta",
          tick: 12,
          players: { upsert: [{}], remove: [] },
          monsters: emptyDelta,
          guards: emptyDelta,
          loot: emptyDelta,
          corpses: emptyDelta,
        }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "world.resync",
          tick: 14,
          players: [],
          monsters: [],
          guards: [],
          loot: [],
          corpses: [],
        }),
      ),
    ).toMatchObject({ t: "world.resync", tick: 14 });
  });
});

describe("event messages", () => {
  it("round-trips a coded event", () => {
    const encoded = encodeServerMessage({
      t: "event",
      code: "combat.hit",
      params: { species: "spear_goblin", damage: 12 },
      tone: "info",
      x: 1,
      y: 2,
    });
    expect(parseServerMessage(encoded)).toMatchObject({ t: "event", code: "combat.hit" });
  });

  it("rejects unknown codes and the legacy text shape", () => {
    expect(
      parseServerMessage(JSON.stringify({ t: "event", code: "made.up", tone: "info" })),
    ).toBeNull();
    expect(
      parseServerMessage(JSON.stringify({ t: "event", text: "Old prose.", tone: "info" })),
    ).toBeNull();
  });

  it("accepts the heal event codes", () => {
    for (const code of ["heal.cast", "heal.received", "heal.nobody"] as const) {
      expect(parseServerMessage(JSON.stringify({ t: "event", code, tone: "good" }))).toMatchObject({
        t: "event",
        code,
      });
    }
  });
});
