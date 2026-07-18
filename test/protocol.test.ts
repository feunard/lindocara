import { describe, expect, it } from "vitest";
import {
  encodeServerMessage,
  parseClientMessage,
  parseServerMessage,
} from "../src/shared/protocol.js";

describe("client protocol", () => {
  const targetId = "33333333-3333-4333-8333-333333333333";

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
    expect(parseClientMessage(JSON.stringify({ t: "attack", targetId }))).toEqual({
      t: "attack",
      targetId,
    });
    expect(parseClientMessage(JSON.stringify({ t: "attack" }))).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ t: "attack", targetId: "road-goblin-scout" })),
    ).toEqual({ t: "attack", targetId: "road-goblin-scout" });
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
    expect(parseClientMessage(JSON.stringify({ t: "heal", targetId }))).toEqual({
      t: "heal",
      targetId,
    });
    expect(parseClientMessage(JSON.stringify({ t: "heal" }))).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ t: "heal", targetId: "someone nearby" })),
    ).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "heals" }))).toBeNull();
  });

  it("accepts only the five authoritative skill slots", () => {
    expect(parseClientMessage(JSON.stringify({ t: "skill", slot: 3 }))).toEqual({
      t: "skill",
      slot: 3,
    });
    expect(parseClientMessage(JSON.stringify({ t: "skill", slot: 3, targetId }))).toEqual({
      t: "skill",
      slot: 3,
      targetId,
    });
    expect(
      parseClientMessage(JSON.stringify({ t: "skill", slot: 3, targetId: "nearest target" })),
    ).toBeNull();
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

  const welcomeBase = {
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
  /** A world the client can actually collide against: terrain now travels, so a welcome without it
   *  is not a welcome. */
  const world = { zoneId: "verdant-reach", revision: 0, tiles: ["..", "##"], elements: [] };

  it("accepts any well-formed zone id, since terrain now travels in the welcome itself", () => {
    expect(parseServerMessage(JSON.stringify({ ...welcomeBase, world }))).toMatchObject({
      t: "welcome",
      world: { zoneId: "verdant-reach" },
    });
    // New contract: a zoneId is wire data now, not a lookup key into a compiled-in catalogue — a
    // map is a D1 row with a uuid id nobody can enumerate. `isZoneId` only checks that it's a
    // non-empty string within the length bound, so an id the client has never heard of (e.g. a
    // D1 map's uuid) is a normal welcome, not a dropped frame.
    expect(
      parseServerMessage(
        JSON.stringify({ ...welcomeBase, world: { ...world, zoneId: "some-future-zone" } }),
      ),
    ).toMatchObject({ t: "welcome", world: { zoneId: "some-future-zone" } });
    // Structural rejection still holds: empty and oversize ids remain invalid.
    expect(
      parseServerMessage(JSON.stringify({ ...welcomeBase, world: { ...world, zoneId: "" } })),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ ...welcomeBase, world: { ...world, zoneId: "a".repeat(65) } }),
      ),
    ).toBeNull();
    expect(parseServerMessage(JSON.stringify({ ...welcomeBase, world: {} }))).toBeNull();
  });

  // The terrain is data off a socket now, so it is checked like data. Every one of these would
  // otherwise reach decodeTileMap and throw on the first paint — the client would not drop a bad
  // frame, it would die on it.
  it("drops a welcome whose terrain is malformed instead of throwing", () => {
    const bad: unknown[] = [
      { ...world, tiles: undefined },
      { ...world, tiles: [] },
      { ...world, tiles: ["..", "###"] }, // ragged
      { ...world, tiles: ["xx", "xx"] }, // not a tile character
      { ...world, tiles: "…" },
      { ...world, elements: undefined },
      { ...world, revision: -1 },
      { ...world, revision: 1.5 },
      { ...world, elements: "nope" },
      { ...world, elements: [{ col: 0, row: 0, kind: "dragon", variant: 0 }] },
      { ...world, elements: [{ col: 0.5, row: 0, kind: "tree", variant: 0 }] },
    ];
    for (const broken of bad) {
      expect(
        parseServerMessage(JSON.stringify({ ...welcomeBase, world: broken })),
        JSON.stringify(broken),
      ).toBeNull();
    }
  });

  it("keeps a welcome carrying elements to draw", () => {
    const message = parseServerMessage(
      JSON.stringify({
        ...welcomeBase,
        world: { ...world, elements: [{ col: 1, row: 0, kind: "tree", variant: 2 }] },
      }),
    );
    expect(message).not.toBeNull();
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

describe("combat animation messages", () => {
  it("round-trips server-authored player and monster animations", () => {
    const player = encodeServerMessage({
      t: "animation",
      actorKind: "player",
      actorId: "player-1",
      action: "skill",
      skillId: "prayer",
      x: 100,
      y: 200,
    });
    const monster = encodeServerMessage({
      t: "animation",
      actorKind: "monster",
      actorId: "goblin-1",
      action: "attack",
      x: 120,
      y: 210,
    });
    expect(parseServerMessage(player)).toMatchObject({ t: "animation", action: "skill" });
    expect(parseServerMessage(monster)).toMatchObject({ t: "animation", actorKind: "monster" });
  });

  it("rejects incomplete or non-finite animations", () => {
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "animation",
          actorKind: "player",
          actorId: "player-1",
          action: "skill",
          x: 10,
          y: 20,
        }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "animation",
          actorKind: "monster",
          actorId: "goblin-1",
          action: "attack",
          x: null,
          y: 20,
        }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "animation",
          actorKind: "player",
          actorId: "player-1",
          action: "attack",
          x: 10,
          y: 20,
          targetX: 30,
        }),
      ),
    ).toBeNull();
  });
});
