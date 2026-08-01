import {
  encodeServerMessage,
  parseClientMessage,
  parseServerMessage,
} from "@lindocara/engine/protocol.js";
import { emptyLayer, encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import { DEFAULT_NPC_MODEL_ASSET_ID } from "@lindocara/engine/tiny-swords-catalog.js";
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

  it("accepts the Rogue loadout and only finite server-authored combat windows", () => {
    const rogue = {
      ...player,
      class: "rogue",
      equipment: { mainHand: "shadow_daggers", offHand: null },
    };
    const rogueState = {
      ...self,
      rogue: {
        openingUntil: 1_500,
        stealthUntil: 8_000,
        smokeProtectionUntil: 500,
        shadowReturnUntil: 2_000,
        danceMarksUntil: 0,
      },
    };
    expect(
      parseServerMessage(
        JSON.stringify({ ...welcomeBase, world, players: [rogue], self: rogueState }),
      ),
    ).toMatchObject({
      t: "welcome",
      players: [{ class: "rogue", equipment: { mainHand: "shadow_daggers" } }],
      self: { rogue: { openingUntil: 1_500, stealthUntil: 8_000 } },
    });
    expect(
      parseServerMessage(
        JSON.stringify({
          ...welcomeBase,
          world,
          players: [rogue],
          self: { ...rogueState, rogue: { ...rogueState.rogue, openingUntil: "soon" } },
        }),
      ),
    ).toBeNull();
  });

  it("round-trips the Peasant class and starter toolkit in authoritative snapshots", () => {
    const peasant = {
      ...player,
      class: "peasant",
      equipment: { mainHand: "worn_toolkit", offHand: null },
      peasantCarry: { kind: "wood", until: 5_000 },
    };
    expect(
      parseServerMessage(JSON.stringify({ ...welcomeBase, world, players: [peasant] })),
    ).toMatchObject({
      t: "welcome",
      players: [
        {
          class: "peasant",
          equipment: { mainHand: "worn_toolkit", offHand: null },
          peasantCarry: { kind: "wood", until: 5_000 },
        },
      ],
    });
    expect(
      parseServerMessage(
        JSON.stringify({
          ...welcomeBase,
          world,
          players: [{ ...peasant, peasantCarry: { kind: "stone", until: 5_000 } }],
        }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({
          ...welcomeBase,
          world,
          players: [{ ...player, peasantCarry: peasant.peasantCarry }],
        }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({
          ...welcomeBase,
          world,
          players: [{ ...peasant, peasantCarry: { kind: "gold", until: -1 } }],
        }),
      ),
    ).toBeNull();
  });

  it("accepts only a finite Ranger afterimage swap deadline", () => {
    const rangerState = { ...self, ranger: { afterimageUntil: 2_000 } };
    expect(
      parseServerMessage(
        JSON.stringify({ ...welcomeBase, world, players: [player], self: rangerState }),
      ),
    ).toMatchObject({ t: "welcome", self: { ranger: { afterimageUntil: 2_000 } } });
    expect(
      parseServerMessage(
        JSON.stringify({
          ...welcomeBase,
          world,
          players: [player],
          self: { ...self, ranger: { afterimageUntil: "later" } },
        }),
      ),
    ).toBeNull();
  });

  it("accepts authoritative party materials and rejects invalid shared stock", () => {
    expect(
      parseServerMessage(
        JSON.stringify({
          ...welcomeBase,
          world,
          self: { ...self, materials: { wood: 3, stone: 2, iron: 1, meat: 4 } },
        }),
      ),
    ).toMatchObject({
      t: "welcome",
      self: { materials: { wood: 3, stone: 2, iron: 1, meat: 4 } },
    });
    expect(
      parseServerMessage(
        JSON.stringify({ ...welcomeBase, world, self: { ...self, materials: { gold: 10 } } }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ ...welcomeBase, world, self: { ...self, materials: { wood: -1 } } }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ ...welcomeBase, world, self: { ...self, materials: { wood: 1 } } }),
      ),
    ).toBeNull();
  });

  it("accepts a monster special action inside authoritative snapshots", () => {
    const quake = {
      id: "boss-quake-1",
      kind: "monster_attack",
      skillId: "troll_quake",
      direction: { x: 1, y: 0 },
      startedAt: 1_000,
      impactAt: 1_850,
      recoveryEndsAt: 2_750,
      resolved: false,
    };
    const boss = {
      id: "boss-1",
      name: "BOSS",
      species: "gate_troll",
      kind: "troll",
      rank: "boss",
      specialTechnique: "troll_quake",
      x: 32,
      y: 32,
      hp: 2_000,
      maxHp: 2_000,
      dead: false,
      graphicAssetId: DEFAULT_NPC_MODEL_ASSET_ID,
      threatening: true,
      facing: { x: 1, y: 0 },
      action: quake,
    };
    const normal = {
      ...boss,
      id: "normal-1",
      name: "Normal",
      rank: "normal",
      specialTechnique: "none",
      hp: 145,
      maxHp: 145,
      action: {
        ...quake,
        id: "normal-strike-1",
        skillId: undefined,
      },
    };
    const elite = {
      ...boss,
      id: "elite-1",
      name: "Elite",
      rank: "elite",
      hp: 900,
      maxHp: 900,
      action: {
        ...quake,
        id: "elite-quake-1",
      },
    };

    const parsed = parseServerMessage(
      JSON.stringify({
        t: "world.resync",
        tick: 20,
        players: [player],
        monsters: [normal, elite, boss],
        guards: [],
        loot: [],
        corpses: [],
        projectiles: [],
        events: [],
      }),
    );
    expect(parsed).toMatchObject({
      t: "world.resync",
      monsters: [
        { rank: "normal", threatening: true, action: { kind: "monster_attack" } },
        {
          rank: "elite",
          threatening: true,
          action: { kind: "monster_attack", skillId: "troll_quake" },
        },
        {
          rank: "boss",
          threatening: true,
          action: { kind: "monster_attack", skillId: "troll_quake" },
        },
      ],
    });
    if (parsed?.t !== "world.resync") throw new Error("expected a full resynchronization");
    expect(parsed.monsters[0]?.action).not.toHaveProperty("skillId");
    expect(parsed.monsters[0]?.graphicAssetId).toBe(DEFAULT_NPC_MODEL_ASSET_ID);
    expect(
      parseServerMessage(
        JSON.stringify({
          ...welcomeBase,
          world,
          monsters: [{ ...normal, graphicAssetId: "nope" }],
        }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({
          ...welcomeBase,
          world,
          players: [{ ...player, action: quake }],
        }),
      ),
    ).toBeNull();
  });

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

  it("validates the complete structured quest tracker payload", () => {
    const tracker = {
      id: "0001",
      title: "Goblin watch",
      description: "Keep the road open.",
      journalSummary: "Defeat the spear goblins.",
      category: "side",
      region: "Old road",
      landmark: "Eastern gate",
      giverName: "Warden Mira",
      knownConsequence: "Travellers can return.",
      recommendedLevel: 2,
      scope: "party",
      repeatable: false,
      abandonable: true,
      completion: "turn-in",
      objectiveMode: "simultaneous",
      status: "active",
      objectives: [
        {
          id: "0001",
          label: "",
          progress: 4,
          target: 10,
          rule: {
            id: "0001",
            label: "",
            target: 10,
            optional: false,
            hidden: false,
            stage: 0,
            type: "kill",
            species: "spear_goblin",
            mapScope: { kind: "any" },
            credit: "contributors",
          },
        },
      ],
      rewards: {
        experience: 100,
        gold: 20,
        items: [{ itemId: "health_potion", quantity: 1 }],
        choices: [],
      },
    };
    expect(
      parseServerMessage(
        JSON.stringify({ ...welcomeBase, world, self: { ...self, authoredQuests: [tracker] } }),
      ),
    ).toMatchObject({ t: "welcome", self: { authoredQuests: [{ id: "0001" }] } });
    expect(
      parseServerMessage(
        JSON.stringify({
          ...welcomeBase,
          world,
          self: {
            ...self,
            authoredQuests: [
              {
                ...tracker,
                objectives: [{ ...tracker.objectives[0], target: 9 }],
              },
            ],
          },
        }),
      ),
    ).toBeNull();
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

  it("round-trips a server-authored monster special animation", () => {
    const quake = encodeServerMessage({
      t: "animation",
      actionId: "action-monster-quake-1",
      actorKind: "monster",
      actorId: "boss-1",
      action: "skill",
      skillId: "troll_quake",
      direction: { x: 1, y: 0 },
      startedAt: 100,
      impactAt: 950,
      recoveryEndsAt: 1_850,
    });

    expect(parseServerMessage(quake)).toMatchObject({
      t: "animation",
      actorKind: "monster",
      action: "skill",
      skillId: "troll_quake",
    });
  });

  it("round-trips only validated server-resolved monster special impacts", () => {
    const impact = {
      t: "monster.special_impact",
      actionId: "action-monster-quake-1",
      actorId: "boss-1",
      technique: "troll_quake",
      x: 320,
      y: 192,
      direction: { x: 1, y: 0 },
      impactAt: 950,
    } as const;

    expect(parseServerMessage(encodeServerMessage(impact))).toEqual(impact);
    for (const invalid of [
      { ...impact, technique: "none" },
      { ...impact, technique: "made_up" },
      { ...impact, x: Number.NaN },
      { ...impact, direction: { x: 0, y: 0 } },
      { ...impact, clientDamage: 999 },
    ]) {
      expect(parseServerMessage(JSON.stringify(invalid))).toBeNull();
    }
  });

  it("accepts only bounded ordered server-owned multi-hit contacts", () => {
    const animation = {
      t: "animation",
      actionId: "action-cyclone-1",
      actorKind: "player",
      actorId: "player-1",
      action: "skill",
      skillId: "whirlwind",
      talented: true,
      evolved: true,
      direction: { x: 1, y: 0 },
      startedAt: 100,
      impactAt: 300,
      impactTimes: [300, 550, 800, 1_050],
      recoveryEndsAt: 1_300,
    };

    expect(parseServerMessage(JSON.stringify(animation))).toMatchObject({
      t: "animation",
      impactTimes: [300, 550, 800, 1_050],
    });
    for (const impactTimes of [
      [300],
      [301, 550],
      [300, 550, 550],
      [300, 1_301],
      [300, Number.NaN],
      Array.from({ length: 9 }, (_, index) => 300 + index * 50),
    ]) {
      expect(parseServerMessage(JSON.stringify({ ...animation, impactTimes }))).toBeNull();
    }
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

describe("Rogue Shadow Dance result messages", () => {
  const sequence = {
    t: "rogue.shadow_dance" as const,
    actionId: "dance-1",
    actorId: "rogue-1",
    startedAt: 1_000,
    endsAt: 1_180,
    strikes: [
      {
        targetId: "monster-a",
        from: { x: 32, y: 64 },
        targetPosition: { x: 128, y: 64 },
        landing: { x: 160, y: 64 },
        impactAt: 1_000,
        damage: 32,
        killed: false,
      },
      {
        targetId: "monster-b",
        from: { x: 160, y: 64 },
        targetPosition: { x: 240, y: 64 },
        landing: { x: 272, y: 64 },
        impactAt: 1_090,
        damage: 20,
        killed: true,
      },
    ],
    finalPosition: { x: 272, y: 64 },
  };

  it("round-trips the complete server-authored order and validated positions", () => {
    expect(parseServerMessage(encodeServerMessage(sequence))).toEqual(sequence);
  });

  it("rejects empty, oversized, out-of-order, or mismatched-final-position chains", () => {
    expect(parseServerMessage(JSON.stringify({ ...sequence, strikes: [] }))).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({
          ...sequence,
          strikes: Array.from({ length: 6 }, () => sequence.strikes[0]),
        }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({
          ...sequence,
          strikes: [
            sequence.strikes[0],
            { ...sequence.strikes[1], impactAt: sequence.startedAt - 1 },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(JSON.stringify({ ...sequence, finalPosition: { x: 0, y: 0 } })),
    ).toBeNull();
  });
});

describe("Priest ultimate visual messages", () => {
  it("accepts bounded Lumen portals and Polarity Orbs", () => {
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "priest.lumen_portal",
          id: "gate-1",
          actorId: "priest-1",
          from: { x: 10, y: 20 },
          to: { x: 90, y: 40 },
          startedAt: 1_000,
          endsAt: 5_000,
        }),
      ),
    ).toMatchObject({ t: "priest.lumen_portal", id: "gate-1" });
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "priest.polarity_orb",
          id: "orb-1",
          actorId: "priest-1",
          x: 20,
          y: 30,
          maximumRadius: 160,
          startedAt: 1_000,
          returnsAt: 1_900,
          endsAt: 2_800,
        }),
      ),
    ).toMatchObject({ t: "priest.polarity_orb", maximumRadius: 160 });
  });

  it("rejects invalid timelines and unbounded portal lifetimes", () => {
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "priest.lumen_portal",
          id: "gate-1",
          actorId: "priest-1",
          from: { x: 10, y: 20 },
          to: { x: 90, y: 40 },
          startedAt: 1_000,
          endsAt: 20_000,
        }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "priest.polarity_orb",
          id: "orb-1",
          actorId: "priest-1",
          x: 20,
          y: 30,
          maximumRadius: 160,
          startedAt: 1_000,
          returnsAt: 900,
          endsAt: 2_800,
        }),
      ),
    ).toBeNull();
  });
});

describe("Peasant support visual messages", () => {
  const camp = {
    t: "peasant.camp" as const,
    id: "camp-1",
    actorId: "peasant-1",
    x: 64,
    y: 96,
    radius: 96,
    startedAt: 1_000,
    expiresAt: 13_000,
  };

  it("round-trips bounded camps, removals and exactly identified bomb impacts", () => {
    expect(parseServerMessage(JSON.stringify(camp))).toEqual(camp);
    expect(parseServerMessage(JSON.stringify({ t: "peasant.camp_removed", id: camp.id }))).toEqual({
      t: "peasant.camp_removed",
      id: camp.id,
    });
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "peasant.bomb_impact",
          actionId: "bomb-1",
          actorId: "peasant-1",
          x: 80,
          y: 96,
          radius: 72,
          impactAt: 2_000,
        }),
      ),
    ).toMatchObject({ t: "peasant.bomb_impact", actionId: "bomb-1" });
  });

  it("rejects forged ranges, lifetimes and extra gameplay fields", () => {
    expect(parseServerMessage(JSON.stringify({ ...camp, radius: 0 }))).toBeNull();
    expect(
      parseServerMessage(JSON.stringify({ ...camp, expiresAt: camp.startedAt + 120_001 })),
    ).toBeNull();
    expect(parseServerMessage(JSON.stringify({ ...camp, healing: 999 }))).toBeNull();
  });
});
