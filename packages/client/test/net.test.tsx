import { type ConnectionHandlers, WorldClient } from "@lindocara/client/game/net.js";
import { encodeMap } from "@lindocara/engine/hd2d/map-data.js";
import { defaultMapHeroSettings } from "@lindocara/engine/map-hero-settings.js";
import { MAX_PENDING_COMMANDS } from "@lindocara/engine/prediction.js";
import type { ServerMessage } from "@lindocara/engine/protocol.js";
import { TICK_DT } from "@lindocara/engine/simulation.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeWebSocket extends EventTarget {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  readyState = FakeWebSocket.OPEN;
  closeCode: number | null = null;

  constructor(readonly url: URL) {
    super();
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState !== FakeWebSocket.OPEN) return;
    this.readyState = 3;
    this.closeCode = code;
    this.dispatchEvent(new CloseEvent("close", { code, reason }));
  }

  message(value: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
  }
}

/** Grid side, in cells. Coordinates therefore run -8..+8 on both ground axes. */
const WORLD_SIZE = 16;

/**
 * The room's only geometry: an encoded `MapData` the client decodes and bakes its own `ZoneTerrain`
 * from, with the very function the server ran on the very same string.
 *
 * Deliberately featureless — level-0 ground everywhere, no water, no colliders — so nothing about
 * the terrain can make a seq/ack/prediction assertion fail for a reason that has nothing to do with
 * what it asserts. A prediction that never collides is exactly what these tests want.
 */
function flatHeightfield(size = WORLD_SIZE): string {
  return encodeMap({
    version: 1,
    size,
    levelHeight: 0.9,
    waterLevel: -0.05,
    levels: new Array(size * size).fill(0),
    materials: new Array(size * size).fill("herbe"),
    colliders: [],
    spawns: [{ name: "default", x: 0, z: 0 }],
    elements: [],
    events: [],
  });
}

const WELCOME: ServerMessage = {
  t: "welcome",
  tick: 1,
  selfId: "hero-1",
  world: {
    zoneId: "verdant-reach",
    revision: 1,
    zoneNameKey: "zone.verdant_reach",
    elements: [],
    tilesetId: "tiny-swords",
    layers: [
      `0*${WORLD_SIZE * WORLD_SIZE}`,
      `0*${WORLD_SIZE * WORLD_SIZE}`,
      `0*${WORLD_SIZE * WORLD_SIZE}`,
    ],
    events: [],
    heightfield: flatHeightfield(),
    // `isWorldInfo` refuses a frame whose `size` disagrees with its own decoded heightfield: the
    // appearance collections are bounds-checked against the grid the client is about to draw.
    size: WORLD_SIZE,
    questNpc: { id: "mira", x: 16, y: 16 },
    questNpcs: [],
    questSites: [],
    cemeteries: [],
    portals: [],
    merchant: null,
  },
  players: [
    {
      id: "hero-1",
      nick: "Mira",
      // Tile units, grid centre as origin: the hero starts at the middle of the flat grid.
      x: 0,
      y: 0,
      z: 0,
      ack: 0,
      hp: 100,
      maxHp: 100,
      level: 1,
      appearance: { body: "wayfarer", primaryColor: "azure" },
      class: "priest",
      equipment: { mainHand: "heartwood_staff", offHand: null },
      life: "alive",
      facing: { x: 1, z: 0 },
      action: null,
    },
  ],
  monsters: [],
  guards: [],
  loot: [],
  corpses: [],
  projectiles: [],
  self: {
    xp: 0,
    xpToNext: 100,
    inventory: { potions: 0, gold: 0, crystals: 0 },
    quest: { status: "available", progress: 0, target: 3 },
    life: "alive",
    corpse: null,
  },
};

/** `connect()` now resolves `GET /api/join` before opening a socket (net-wire.test.ts covers the
 *  wire shape in detail); this suite is about seq/ack/prediction/interpolation/resync, so every
 *  test gets one fixed, always-succeeding join and awaits `flush()` once before touching the
 *  fake socket. */
function stubJoin(): void {
  const mock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ roomId: "party-1:verdant-reach", channelPath: "/ws/world" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", mock);
}

/** Flushes the resolveJoin promise chain with a macrotask, robust to however many microtask hops
 *  `api()`'s `await fetch` / `await response.json()` chain grows to. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function handlers(): ConnectionHandlers {
  return {
    onWelcome: vi.fn(),
    onState: vi.fn(),
    onChat: vi.fn(),
    onPartyInvite: vi.fn(),
    onPartyState: vi.fn(),
    onMerchantOpen: vi.fn(),
    onAnimation: vi.fn(),
    onMonsterSpecialImpact: vi.fn(),
    onShadowDance: vi.fn(),
    onLumenPortal: vi.fn(),
    onLumenTrail: vi.fn(),
    onPolarityOrb: vi.fn(),
    onPeasantCamp: vi.fn(),
    onPeasantCampBank: vi.fn(),
    onPeasantCampRemoved: vi.fn(),
    onPeasantBombImpact: vi.fn(),
    onEvent: vi.fn(),
    onEventSay: vi.fn(),
    onEventChoices: vi.fn(),
    onEventClose: vi.fn(),
    onQuestOpen: vi.fn(),
    onQuestResult: vi.fn(),
    onQuestClose: vi.fn(),
    onClose: vi.fn(),
  };
}

describe("WorldClient lifecycle", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  it("bounds unacknowledged prediction and requests one resync", async () => {
    stubJoin();
    const client = new WorldClient();
    client.connect(handlers(), "hero-1", "party-1");
    await flush();
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket?.message(WELCOME);

    for (let i = 0; i < MAX_PENDING_COMMANDS + 20; i++) {
      client.update({ up: false, down: false, left: false, right: true }, TICK_DT);
    }

    // Every frame rides the `{roomId, message}` envelope (net-wire.test.ts covers its shape in
    // detail) — unwrap it here since this test is only about the seq/resync counts underneath.
    const messages =
      socket?.sent.map((raw) => (JSON.parse(raw) as { message: { t: string } }).message) ?? [];
    expect(messages.filter((message) => message.t === "input")).toHaveLength(MAX_PENDING_COMMANDS);
    expect(messages.filter((message) => message.t === "world.resync")).toHaveLength(1);
  });

  it("flips the self hero's facing from local input, without waiting for the server", async () => {
    stubJoin();
    const client = new WorldClient();
    client.connect(handlers(), "hero-1", "party-1");
    await flush();
    const socket = FakeWebSocket.instances[0];
    socket?.message(WELCOME); // the welcome snapshot faces right (x: 1)

    // Hold left for a few ticks. No further server snapshot arrives, so facing must be predicted.
    for (let i = 0; i < 3; i++) {
      client.update({ up: false, down: false, left: true, right: false }, TICK_DT);
    }

    const self = client.sample(1000).players.find((player) => player.id === "hero-1");
    expect(self?.facing.x).toBeLessThan(0); // faces left the frame the key is held, not after a round trip
  });

  it("uses replacement map hero settings on the first predicted tick after its welcome", async () => {
    stubJoin();
    const callbacks = handlers();
    const client = new WorldClient();
    client.connect(callbacks, "hero-1", "party-1");
    await flush();
    const socket = FakeWebSocket.instances[0];

    const mapASettings = defaultMapHeroSettings();
    // Tiles per second, inside `MAP_HERO_STAT_LIMITS.movementSpeed`, which is tile units now.
    mapASettings.classes.priest.stats.movementSpeed = 100 / 64;
    socket?.message({
      ...WELCOME,
      world: { ...WELCOME.world, zoneId: "map-a", heroSettings: mapASettings },
    });
    client.update({ up: false, down: false, left: false, right: true }, TICK_DT);
    expect(
      client.sample(performance.now()).players.find((player) => player.id === "hero-1")?.x,
    ).toBe((100 / 64) * TICK_DT);

    const mapBSettings = defaultMapHeroSettings();
    mapBSettings.classes.priest.stats.movementSpeed = 400 / 64;
    mapBSettings.classes.priest.disabledSkills = [2];
    socket?.message({
      ...WELCOME,
      tick: 2,
      world: { ...WELCOME.world, zoneId: "map-b", heroSettings: mapBSettings },
    });
    client.update({ up: false, down: false, left: false, right: true }, TICK_DT);

    expect(callbacks.onWelcome).toHaveBeenLastCalledWith(
      "hero-1",
      expect.objectContaining({
        zoneId: "map-b",
        heroSettings: mapBSettings,
      }),
      WELCOME.self,
    );
    expect(
      client.sample(performance.now()).players.find((player) => player.id === "hero-1")?.x,
    ).toBe((400 / 64) * TICK_DT);
  });

  it("forwards the complete authoritative Shadow Dance result without deriving targets", async () => {
    stubJoin();
    const callbacks = handlers();
    const client = new WorldClient();
    client.connect(callbacks, "hero-1", "party-1");
    await flush();
    const socket = FakeWebSocket.instances[0];
    socket?.message(WELCOME);
    const sequence = {
      t: "rogue.shadow_dance",
      actionId: "dance-1",
      actorId: "hero-1",
      startedAt: 1_000,
      endsAt: 1_090,
      // Every position in the sequence is a GROUND vector: `x` and `z`, tile units. The chain
      // carries no elevation at all — the client reads that off the terrain under the landing.
      strikes: [
        {
          targetId: "monster-1",
          from: { x: 0, z: 0 },
          targetPosition: { x: 1, z: 0 },
          landing: { x: 2, z: 0 },
          impactAt: 1_000,
          damage: 32,
          killed: false,
        },
      ],
      finalPosition: { x: 2, z: 0 },
    };

    socket?.message(sequence);
    client.update({ up: false, down: false, left: true, right: false }, TICK_DT);

    expect(callbacks.onShadowDance).toHaveBeenCalledOnce();
    expect(callbacks.onShadowDance).toHaveBeenCalledWith(sequence);
    // The landing is the sequence's own ground point; the elevation is the flat grid's, never a
    // value the sequence supplied.
    expect(
      client.sample(performance.now()).players.find((player) => player.id === "hero-1"),
    ).toMatchObject({ x: 2, y: 0, z: 0 });
  });

  it("keeps snapshots flowing while a boss performs a special technique", async () => {
    stubJoin();
    const callbacks = handlers();
    const client = new WorldClient();
    client.connect(callbacks, "hero-1", "party-1");
    await flush();
    const socket = FakeWebSocket.instances[0];
    socket?.message(WELCOME);
    const action = {
      id: "boss-quake-1",
      kind: "monster_attack" as const,
      skillId: "troll_quake",
      direction: { x: 1, z: 0 },
      startedAt: 1_000,
      impactAt: 1_850,
      recoveryEndsAt: 2_750,
      resolved: false,
    };
    const boss = {
      id: "boss-1",
      name: "BOSS",
      species: "gate_troll" as const,
      kind: "troll" as const,
      rank: "boss" as const,
      specialTechnique: "troll_quake" as const,
      x: 1,
      y: 0,
      z: 0,
      hp: 2_000,
      maxHp: 2_000,
      dead: false,
      facing: { x: 1, z: 0 },
      action,
    };
    const normal = {
      ...boss,
      id: "normal-1",
      name: "Normal",
      rank: "normal" as const,
      specialTechnique: "none" as const,
      hp: 145,
      maxHp: 145,
      action: {
        ...action,
        id: "normal-strike-1",
        skillId: undefined,
      },
    };
    const elite = {
      ...boss,
      id: "elite-1",
      name: "Elite",
      rank: "elite" as const,
      hp: 900,
      maxHp: 900,
      action: {
        ...action,
        id: "elite-quake-1",
      },
    };
    socket?.message({
      t: "animation",
      actionId: action.id,
      actorKind: "monster",
      actorId: boss.id,
      action: "skill",
      skillId: "troll_quake",
      direction: action.direction,
      startedAt: action.startedAt,
      impactAt: action.impactAt,
      recoveryEndsAt: action.recoveryEndsAt,
    });
    socket?.message({
      t: "world.resync",
      tick: 2,
      players: WELCOME.players,
      monsters: [normal, elite, boss],
      guards: [],
      loot: [],
      corpses: [],
      projectiles: [],
      events: [],
    });

    expect(callbacks.onAnimation).toHaveBeenCalledWith(
      expect.objectContaining({ actorKind: "monster", skillId: "troll_quake" }),
    );
    const monsters = client.sample(performance.now()).monsters;
    expect(monsters).toEqual([
      expect.objectContaining({
        id: "normal-1",
        rank: "normal",
        action: expect.objectContaining({ kind: "monster_attack" }),
      }),
      expect.objectContaining({
        id: "elite-1",
        rank: "elite",
        action: expect.objectContaining({ skillId: "troll_quake" }),
      }),
      expect.objectContaining({ id: "boss-1", rank: "boss", action }),
    ]);
    expect(monsters[0]?.action).not.toHaveProperty("skillId");
    const messages =
      socket?.sent.map((raw) => (JSON.parse(raw) as { message: { t: string } }).message) ?? [];
    expect(messages.filter((message) => message.t === "world.resync")).toHaveLength(0);
  });

  it("forwards one validated authoritative monster-special impact to presentation", async () => {
    stubJoin();
    const callbacks = handlers();
    const client = new WorldClient();
    client.connect(callbacks, "hero-1", "party-1");
    await flush();
    const socket = FakeWebSocket.instances[0];
    socket?.message(WELCOME);
    // The exact frame the room emits (`worldTick.ts`): a GROUND centre (`x`/`z`, tile units) and a
    // ground direction. No elevation — the impact is a disc on the floor, not a point in space.
    const impact = {
      t: "monster.special_impact",
      actionId: "boss-quake-1",
      actorId: "boss-1",
      technique: "troll_quake",
      x: 1.5,
      z: 1,
      direction: { x: 1, z: 0 },
      impactAt: 1_850,
    } as const;

    socket?.message(impact);

    // RED, and deliberately so: `parseServerMessage`'s `monster.special_impact` branch was not
    // converted with the rest of the wire — it still lists `"y"` in `hasOnlyKeys` and asserts
    // `isFiniteNumber(value.y)`, so the `{x, z}` frame the room actually emits is refused and the
    // client silently drops every boss special impact. `tsc` cannot see it: the branch ends in
    // `value as unknown as ServerMessage`. Fix is `"y"` -> `"z"` in the key list and
    // `value.y` -> `value.z` in the predicate (`packages/engine/src/protocol.ts`, ~line 2022).
    expect(callbacks.onMonsterSpecialImpact).toHaveBeenCalledOnce();
    expect(callbacks.onMonsterSpecialImpact).toHaveBeenCalledWith(impact);
  });

  it("reports an error followed by close only once", async () => {
    stubJoin();
    const callbacks = handlers();
    const client = new WorldClient();
    client.connect(callbacks, "hero-1", "party-1");
    await flush();
    const socket = FakeWebSocket.instances[0];

    socket?.dispatchEvent(new Event("error"));
    socket?.close(1006, "closed after error");

    expect(callbacks.onClose).toHaveBeenCalledOnce();
    expect(callbacks.onClose).toHaveBeenCalledWith(1006, "connection error");
  });

  it("closes a malformed initial frame instead of latching an unusable resync", async () => {
    stubJoin();
    const callbacks = handlers();
    const client = new WorldClient();
    client.connect(callbacks, "hero-1", "party-1");
    await flush();
    const socket = FakeWebSocket.instances[0];

    socket?.message({ t: "not-a-welcome" });

    expect(socket?.closeCode).toBe(1002);
    expect(callbacks.onClose).toHaveBeenCalledWith(1002, "invalid welcome");
    expect(socket?.sent).toEqual([]);
  });
});
