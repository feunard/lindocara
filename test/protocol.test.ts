import {
  encodeServerMessage,
  parseClientMessage,
  parseServerMessage,
} from "@lindocara/engine/protocol.js";
import { emptyLayer, encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import { describe, expect, it } from "vitest";

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
    expect(parseClientMessage(JSON.stringify({ t: "attack" }))).toEqual({ t: "attack" });
    expect(parseClientMessage(JSON.stringify({ t: "attack", targetId }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "interact", targetId }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "use", item: "potion", targetId }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "interact" }))).toEqual({ t: "interact" });
    expect(parseClientMessage(JSON.stringify({ t: "use", item: "potion" }))).toEqual({
      t: "use",
      item: "potion",
    });
    expect(
      parseClientMessage(JSON.stringify({ t: "item.use", item: "invisibility_potion" })),
    ).toEqual({ t: "item.use", item: "invisibility_potion" });
    expect(
      parseClientMessage(JSON.stringify({ t: "merchant.buy", item: "damage_elixir" })),
    ).toEqual({ t: "merchant.buy", item: "damage_elixir" });
    expect(parseClientMessage(JSON.stringify({ t: "item.use", item: "admin_elixir" }))).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ t: "merchant.buy", item: "health_potion", price: 0 })),
    ).toBeNull();
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

  it("rejects the removed targeted heal intent", () => {
    expect(parseClientMessage(JSON.stringify({ t: "heal", targetId }))).toBeNull();
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
    expect(parseClientMessage(JSON.stringify({ t: "skill", slot: 3, targetId }))).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ t: "skill", slot: 3, targetId: "nearest target" })),
    ).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "skill", slot: 0 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "skill", slot: 6 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "skill", slot: "3" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "skill.release", slot: 3 }))).toEqual({
      t: "skill.release",
      slot: 3,
    });
    expect(parseClientMessage(JSON.stringify({ t: "skill.release", slot: 3, x: 999 }))).toBeNull();
  });

  it("accepts only known talent allocation intents without client-authored outcomes", () => {
    expect(
      parseClientMessage(
        JSON.stringify({ t: "talent.unlock", nodeId: "warrior.iron_guard.perfect" }),
      ),
    ).toEqual({ t: "talent.unlock", nodeId: "warrior.iron_guard.perfect" });
    expect(parseClientMessage(JSON.stringify({ t: "talent.reset" }))).toEqual({
      t: "talent.reset",
    });
    expect(
      parseClientMessage(JSON.stringify({ t: "talent.unlock", nodeId: "warrior.god_mode" })),
    ).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({
          t: "talent.unlock",
          nodeId: "warrior.iron_guard.perfect",
          damage: 999,
        }),
      ),
    ).toBeNull();
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
  it("accepts only the exact merchant-open signal", () => {
    expect(parseServerMessage(JSON.stringify({ t: "merchant.open" }))).toEqual({
      t: "merchant.open",
    });
    expect(parseServerMessage(JSON.stringify({ t: "merchant.open", gold: 999 }))).toBeNull();
  });
  it("rejects unknown or structurally incomplete messages", () => {
    expect(parseServerMessage(JSON.stringify({ t: "unknown" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ t: "snapshot", players: [] }))).toBeNull();
    expect(parseServerMessage("broken")).toBeNull();
  });

  const player = {
    id: "p1",
    nick: "Mira",
    x: 16,
    y: 16,
    ack: 0,
    hp: 100,
    maxHp: 100,
    level: 1,
    appearance: { body: "wayfarer", primaryColor: "azure" },
    class: "priest",
    equipment: { mainHand: "heartwood_staff", offHand: null },
    life: "alive",
    facing: { x: 1, y: 0 },
    action: null,
  };
  const self = {
    xp: 0,
    xpToNext: 100,
    inventory: { potions: 0, gold: 0, crystals: 0 },
    quest: { status: "available", progress: 0, target: 3 },
    life: "alive",
    corpse: null,
  };
  const welcomeBase = {
    t: "welcome",
    tick: 10,
    selfId: "p1",
    players: [player],
    monsters: [],
    guards: [],
    loot: [],
    corpses: [],
    projectiles: [],
    self,
  };
  /** A world the client can actually collide against: terrain now travels, so a welcome without it
   *  is not a welcome. */
  const layer = encodeTileLayer(emptyLayer(2, 2));
  const world = {
    zoneId: "verdant-reach",
    revision: 0,
    zoneNameKey: "zone.verdant_reach.name",
    tiles: ["..", "##"],
    elements: [],
    colliders: [],
    tilesetId: TINY_SWORDS_TILESET_ID,
    layers: [layer, layer, layer],
    events: [],
    width: 64,
    height: 64,
    playerSize: 32,
    obstacles: [],
    safeZone: null,
    questNpc: { id: "mira", x: 16, y: 16 },
    questNpcs: [],
    questSites: [],
    cemeteries: [],
    portals: [],
    merchant: null,
  };

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

  it("rejects incomplete state and entity snapshots before they reach the client", () => {
    expect(
      parseServerMessage(JSON.stringify({ ...welcomeBase, world, self: { life: "alive" } })),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ ...welcomeBase, world, players: [{ ...player, equipment: {} }] }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ ...welcomeBase, world: { ...world, layers: ["bad", layer, layer] } }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ t: "party.state", party: { id: "party", leaderId: "p1", members: [{}] } }),
      ),
    ).toBeNull();
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
          projectiles: emptyDelta,
          events: emptyDelta,
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
          projectiles: emptyDelta,
          events: emptyDelta,
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
          projectiles: [],
          events: [],
        }),
      ),
    ).toMatchObject({ t: "world.resync", tick: 14 });

    const projectile = {
      id: "projectile-a",
      actionId: "action-a",
      ownerId: "hero-a",
      color: "violet",
      kind: "healing_light",
      x: 10,
      y: 20,
      direction: { x: 1, y: 0 },
      radius: 11,
      spawnedAt: 1_000,
      expiresAt: 2_000,
    };
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "world.resync",
          tick: 15,
          players: [],
          monsters: [],
          guards: [],
          loot: [],
          corpses: [],
          projectiles: [projectile],
          events: [],
        }),
      ),
    ).toMatchObject({ t: "world.resync", projectiles: [projectile] });
    for (const malformed of [
      { ...projectile, direction: { x: 0, y: 0 } },
      { ...projectile, color: "green" },
      { ...projectile, radius: 0 },
      { ...projectile, expiresAt: 900 },
    ]) {
      expect(
        parseServerMessage(
          JSON.stringify({
            t: "world.resync",
            tick: 16,
            players: [],
            monsters: [],
            guards: [],
            loot: [],
            corpses: [],
            projectiles: [malformed],
            events: [],
          }),
        ),
      ).toBeNull();
    }
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
    for (const code of ["heal.cast", "heal.received"] as const) {
      expect(
        parseServerMessage(
          JSON.stringify({ t: "event", code, params: { color: "ember" }, tone: "good" }),
        ),
      ).toMatchObject({ t: "event", code, params: { color: "ember" } });
    }
  });
});

describe("combat animation messages", () => {
  it("round-trips server-authored player and monster animations", () => {
    const player = encodeServerMessage({
      t: "animation",
      actionId: "action-player-1",
      actorKind: "player",
      actorId: "player-1",
      action: "skill",
      skillId: "prayer",
      talented: true,
      evolved: true,
      direction: { x: 1, y: 0 },
      startedAt: 100,
      impactAt: 300,
      recoveryEndsAt: 600,
    });
    const monster = encodeServerMessage({
      t: "animation",
      actionId: "action-monster-1",
      actorKind: "monster",
      actorId: "goblin-1",
      action: "attack",
      direction: { x: 0, y: 1 },
      startedAt: 100,
      impactAt: 550,
      recoveryEndsAt: 1_050,
    });
    expect(parseServerMessage(player)).toMatchObject({
      t: "animation",
      action: "skill",
      talented: true,
      evolved: true,
    });
    expect(parseServerMessage(monster)).toMatchObject({ t: "animation", actorKind: "monster" });
  });

  it("rejects incomplete or non-finite animations", () => {
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "animation",
          actionId: "action-player-1",
          actorKind: "player",
          actorId: "player-1",
          action: "skill",
          direction: { x: 1, y: 0 },
          startedAt: 100,
          impactAt: 300,
          recoveryEndsAt: 600,
        }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "animation",
          actionId: "action-player-2",
          actorKind: "player",
          actorId: "player-1",
          action: "skill",
          skillId: "prayer",
          talented: false,
          direction: { x: 1, y: 0 },
          startedAt: 100,
          impactAt: 300,
          recoveryEndsAt: 600,
        }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "animation",
          actionId: "action-monster-1",
          actorKind: "monster",
          actorId: "goblin-1",
          action: "attack",
          direction: { x: 0, y: 0 },
          startedAt: 100,
          impactAt: 550,
          recoveryEndsAt: 1_050,
        }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "animation",
          actionId: "action-player-1",
          actorKind: "player",
          actorId: "player-1",
          action: "attack",
          direction: { x: 1, y: 0 },
          startedAt: 600,
          impactAt: 300,
          recoveryEndsAt: 900,
        }),
      ),
    ).toBeNull();
  });
});
