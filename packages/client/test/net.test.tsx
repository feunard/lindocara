import { type ConnectionHandlers, WorldClient } from "@lindocara/client/game/net.js";
import { encodeMap } from "@lindocara/engine/hd2d/map-data.js";
import { defaultMapHeroSettings } from "@lindocara/engine/map-hero-settings.js";
import type { ServerMessage } from "@lindocara/engine/protocol.js";
import { TICK_DT, TICK_MS } from "@lindocara/engine/simulation.js";
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
      vy: 0,
      airborne: false,
      swimming: false,
      gliding: false,
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
  seaGuardians: [],
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
    // The room has moved nobody yet, at the position it admitted this hero on.
    displacement: { seq: 0, x: 0, y: 0, z: 0 },
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
    onSeaGuardianDevour: vi.fn(),
    onAnimation: vi.fn(),
    onMonsterSpecialImpact: vi.fn(),
    onShadowDance: vi.fn(),
    onLumenPortal: vi.fn(),
    onLumenTrail: vi.fn(),
    onPolarityOrb: vi.fn(),
    onPeasantCamp: vi.fn(),
    onPeasantCampBank: vi.fn(),
    onPeasantCampRemoved: vi.fn(),
    onPeasantRation: vi.fn(),
    onPeasantRationRemoved: vi.fn(),
    onPeasantBombImpact: vi.fn(),
    onEvent: vi.fn(),
    onEventSay: vi.fn(),
    onEventChoices: vi.fn(),
    onEventClose: vi.fn(),
    onEventSound: vi.fn(),
    onAmbience: vi.fn(),
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

  it("reports its position on a cadence the room's rate window can survive", async () => {
    stubJoin();
    const client = new WorldClient();
    client.connect(handlers(), "hero-1", "party-1");
    await flush();
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket?.message(WELCOME);

    // One second of animation frames at 60 Hz. The hero steps on every one of them; the report is
    // throttled, because the room drops a connection above 35 frames a second.
    vi.useFakeTimers();
    try {
      for (let frame = 0; frame < 60; frame++) {
        client.update({ up: false, down: false, left: false, right: true }, 1 / 60);
        vi.advanceTimersByTime(1_000 / 60);
      }
    } finally {
      vi.useRealTimers();
    }

    // Every frame rides the `{roomId, message}` envelope (net-wire.test.ts covers its shape in
    // detail) — unwrap it here since this test is only about how many go out.
    const messages =
      socket?.sent.map((raw) => (JSON.parse(raw) as { message: { t: string } }).message) ?? [];
    const moves = messages.filter((message) => message.t === "move");
    expect(moves.length).toBeGreaterThan(0);
    // At most one per simulation tick — the exact rate the retired command stream ran at, and well
    // inside the room's 35/s window with chat, actions and resyncs still to fit beside it.
    expect(moves.length).toBeLessThanOrEqual(1_000 / TICK_MS);
    // And it really is throttled rather than merely deduplicated: the hero moved on every one of
    // the 60 frames, so an unthrottled reporter would have sent 60 distinct positions.
    expect(moves.length).toBeLessThan(60);
  });

  /** A `world.resync` carrying one self snapshot — the shortest path to driving `#reconcile` with
   *  an authoritative position of the test's choosing. */
  function resync(tick: number, self: Record<string, unknown>): ServerMessage {
    return {
      t: "world.resync",
      tick,
      players: [
        { ...(WELCOME as unknown as { players: Record<string, unknown>[] }).players[0], ...self },
      ],
      seaGuardians: [],
      monsters: [],
      guards: [],
      loot: [],
      corpses: [],
      projectiles: [],
      events: [],
    } as unknown as ServerMessage;
  }

  /** One second of animation frames, with `run(frame)` given the chance to deliver a snapshot. */
  function animate(client: WorldClient, run?: (frame: number) => void): void {
    vi.useFakeTimers();
    try {
      for (let frame = 0; frame < 60; frame++) {
        run?.(frame);
        client.update({ up: false, down: false, left: false, right: true }, 1 / 60);
        vi.advanceTimersByTime(1_000 / 60);
      }
    } finally {
      vi.useRealTimers();
    }
  }

  function movesOf(
    socket: FakeWebSocket | undefined,
  ): { t: string; x: number; z: number; vy: number; displacement: number }[] {
    return (socket?.sent ?? [])
      .map(
        (raw) =>
          (
            JSON.parse(raw) as {
              message: { t: string; x: number; z: number; vy: number; displacement: number };
            }
          ).message,
      )
      .filter((message) => message.t === "move");
  }

  it("ignores an authoritative elevation it did not report, however long the server relays it", async () => {
    // A hero that dies mid-jump freezes AIRBORNE, and the room drops every frame a corpse sends, so
    // it relays that elevation for as long as the body lies there — which is indefinitely. An echo
    // test that compared `y` would never match it again: every snapshot would re-adopt, re-cut the
    // hero's momentum and spend the rate window the player needs to ask for a resurrection.
    stubJoin();
    const stormed = new WorldClient();
    stormed.connect(handlers(), "hero-1", "party-1");
    const quiet = new WorldClient();
    quiet.connect(handlers(), "hero-1", "party-1");
    await flush();
    const stormedSocket = FakeWebSocket.instances[0];
    const quietSocket = FakeWebSocket.instances[1];
    stormedSocket?.message(WELCOME);
    quietSocket?.message(WELCOME);

    // Both walk east for a second. One of them is told, ten times a second, that it is four units in
    // the air at the very ground point it LAST REPORTED — which is exactly what a room relaying a
    // corpse's frozen position sends back, snapshot after snapshot.
    let tick = 2;
    animate(stormed, (frame) => {
      if (frame % 6 !== 0) return;
      const reported = movesOf(stormedSocket).at(-1);
      if (!reported) return;
      tick += 2;
      stormedSocket?.message(resync(tick, { x: reported.x, y: 4, z: reported.z }));
    });
    animate(quiet);

    const stormedX = stormed.sample(0).players.find((player) => player.id === "hero-1")?.x;
    const quietX = quiet.sample(0).players.find((player) => player.id === "hero-1")?.x;
    // Identical distance covered: the elevation-only disagreement changed nothing at all. Adopting
    // would have cut momentum ten times and left the stormed hero measurably behind.
    expect(stormedX).toBeCloseTo(quietX ?? Number.NaN, 10);
    expect(movesOf(stormedSocket).length).toBe(movesOf(quietSocket).length);
  });

  /**
   * A server-authored displacement reaches this client as one `SelfState.displacement` — the
   * position AND the stamp that authorises it, in a single frame.
   *
   * The pairing is the point. The room drops every report whose stamp is not its own current one, so
   * a client that raised its echo before it had adopted the position would spend that window
   * reporting where the hero USED to be, under a stamp the room accepts — which is precisely the
   * displacement-undone bug the stamp exists to prevent, reintroduced from the other side.
   */
  it("adopts a displacement's position and its stamp out of the same frame", async () => {
    stubJoin();
    const client = new WorldClient();
    client.connect(handlers(), "hero-1", "party-1");
    await flush();
    const socket = FakeWebSocket.instances[0];
    socket?.message(WELCOME);

    // Half a second of walking east, then the room moves the hero west and says so, then the walk
    // continues. One run, because the report throttle reads a clock the harness only advances here.
    animate(client, (frame) => {
      if (frame !== 30) return;
      socket?.message({
        t: "state",
        self: {
          ...(WELCOME as unknown as { self: Record<string, unknown> }).self,
          displacement: { seq: 3, x: -5, y: 0, z: 4 },
        },
      } as unknown as ServerMessage);
      const adopted = client.sample(0).players.find((player) => player.id === "hero-1");
      expect(adopted?.x).toBeCloseTo(-5, 10);
      expect(adopted?.z).toBeCloseTo(4, 10);
    });

    const moves = movesOf(socket);
    // Before the displacement the echo is the welcome's own stamp, and the hero had walked east.
    const walked = moves.filter((message) => message.displacement === 0);
    expect(walked.length).toBeGreaterThan(0);
    expect(walked.at(-1)?.x ?? 0).toBeGreaterThan(0);
    // After it, every report echoes the stamp that came WITH the position — a report still carrying
    // `0` would be dropped by the room and this hero would never move again — and the walk resumes
    // from where the room put it rather than from where it had walked to.
    const after = moves.filter((message) => message.displacement === 3);
    expect(after.length).toBeGreaterThan(0);
    expect(after.at(-1)?.x ?? 0).toBeLessThan(0);
    expect(moves.at(-1)?.displacement).toBe(3);
  });

  it("throttles its reports no matter how often the server moves it", async () => {
    stubJoin();
    const client = new WorldClient();
    client.connect(handlers(), "hero-1", "party-1");
    await flush();
    const socket = FakeWebSocket.instances[0];
    socket?.message(WELCOME);

    // A genuine displacement on EVERY frame — each carries a ground position this client never
    // reported, so each one is adopted. The rate is deliberately faster than any real snapshot
    // stream: what is being pinned is that the throttle is UNCONDITIONAL, not that 10 Hz happens to
    // stay under it. An adopt that reset the throttle's clock would report on every frame it landed
    // on, and the ceiling this whole constant exists to guarantee would not be one.
    let tick = 2;
    animate(client, (frame) => {
      tick += 2;
      socket?.message(resync(tick, { x: -3 + frame / 60, y: 0, z: 2 }));
    });

    expect(movesOf(socket).length).toBeLessThanOrEqual(1_000 / TICK_MS);
  });

  it("reports a unit heading, so the room never silently drops a frame", async () => {
    stubJoin();
    const client = new WorldClient();
    client.connect(handlers(), "hero-1", "party-1");
    await flush();
    const socket = FakeWebSocket.instances[0];
    socket?.message(WELCOME);

    // Diagonally, where a raw heading would be length √2 rather than 1 — `isDirection` refuses
    // anything outside [0.999, 1.001] and drops the WHOLE frame, on both ends, with no error.
    for (let frame = 0; frame < 40; frame++) {
      client.update({ up: true, down: false, left: false, right: true }, 1 / 60);
    }
    // …and then standing still, where a heading derived from the input alone would be zero-length.
    for (let frame = 0; frame < 40; frame++) {
      client.update({ up: false, down: false, left: false, right: false }, 1 / 60);
    }

    const moves = (socket?.sent ?? [])
      .map(
        (raw) =>
          (JSON.parse(raw) as { message: { t: string; facing?: { x: number; z: number } } })
            .message,
      )
      .filter((message) => message.t === "move");
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) {
      expect(Math.hypot(move.facing?.x ?? 0, move.facing?.z ?? 0)).toBeCloseTo(1, 6);
    }
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

  it("uses replacement map hero settings from the first frame after its welcome", async () => {
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
    // A second of frames rather than one: the movement rule accelerates into its speed cap instead
    // of snapping to it, so a single frame measures the ramp and not the setting.
    for (let frame = 0; frame < 20; frame++) {
      client.update({ up: false, down: false, left: false, right: true }, TICK_DT);
    }
    const slow = client.sample(performance.now()).players.find((player) => player.id === "hero-1");
    // Within one accelerating frame of a full second at the authored speed.
    expect(slow?.x ?? 0).toBeGreaterThan((100 / 64) * 0.9);
    expect(slow?.x ?? 0).toBeLessThanOrEqual(100 / 64);

    const mapBSettings = defaultMapHeroSettings();
    mapBSettings.classes.priest.stats.movementSpeed = 400 / 64;
    mapBSettings.classes.priest.disabledSkills = [2];
    socket?.message({
      ...WELCOME,
      tick: 2,
      world: { ...WELCOME.world, zoneId: "map-b", heroSettings: mapBSettings },
    });
    for (let frame = 0; frame < 20; frame++) {
      client.update({ up: false, down: false, left: false, right: true }, TICK_DT);
    }

    expect(callbacks.onWelcome).toHaveBeenLastCalledWith(
      "hero-1",
      expect.objectContaining({
        zoneId: "map-b",
        heroSettings: mapBSettings,
      }),
      WELCOME.self,
    );
    const fast = client.sample(performance.now()).players.find((player) => player.id === "hero-1");
    // The new map's own speed, from its own welcome — four times map A's, and measured from the
    // fresh hero that welcome created rather than carried over from the old one.
    expect(fast?.x ?? 0).toBeGreaterThan((400 / 64) * 0.9);
    expect(fast?.x ?? 0).toBeLessThanOrEqual(400 / 64);
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
      seaGuardians: [],
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
