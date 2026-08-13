/**
 * `WorldClient` on the Alepha wire: `connect()` resolves `GET /api/join` before ever opening a
 * socket, dials the raw `/ws/world` room directly (never Alepha's own `WebSocketClient`, which
 * swallows close codes), wraps every outgoing frame as `{roomId, message}` and strips the
 * server-stamped `__alephaRoom` transport key before handing a frame to `parseServerMessage`.
 * seq/ack/prediction/interpolation/resync stay covered by `net.test.tsx`; this file only proves
 * the wire shape and the resolveJoin-then-connect sequencing (including a fresh resolution per
 * reconnect, the same way `session.ts`'s 4008 immediate-reconnect path does).
 */
import { type ConnectionHandlers, WorldClient } from "@lindocara/client/game/net.js";
import { encodeMap } from "@lindocara/engine/hd2d/map-data.js";
import type { ServerMessage, WorldEventSnapshot } from "@lindocara/engine/protocol.js";
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

  /** Dispatches a raw JSON string — used to add a transport key (`__alephaRoom`) a typed
   *  `ServerMessage` has no field for. */
  raw(json: string): void {
    this.dispatchEvent(new MessageEvent("message", { data: json }));
  }

  message(value: unknown): void {
    this.raw(JSON.stringify(value));
  }
}

/** Grid side, in cells. Coordinates therefore run -8..+8 on both ground axes. */
const WORLD_SIZE = 16;

/** A flat, entirely walkable heightfield — the room's only geometry now, and the string
 *  `isWorldInfo` decodes to bounds-check every appearance collection in the same frame. */
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

/** The same grid with a solid prop wall across `x in [0.5, 1)` and its eastern third flooded: one
 *  thing the ordinary movement rule cannot pass, and one thing it can drown in. */
function walledAndFloodedHeightfield(size = WORLD_SIZE): string {
  const levels: (number | null)[] = [];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) levels.push(i >= 12 ? null : 0);
  }
  return encodeMap({
    version: 1,
    size,
    levelHeight: 0.9,
    waterLevel: -0.05,
    levels,
    materials: new Array(size * size).fill("herbe"),
    colliders: [{ x: 0.5, z: -size / 2, w: 0.5, h: size }],
    spawns: [{ name: "default", x: 0, z: 0 }],
    elements: [],
    events: [],
  });
}

const WELCOME: Extract<ServerMessage, { t: "welcome" }> = {
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
      // Tile units, grid centre as origin.
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
    onQuestOpen: vi.fn(),
    onQuestResult: vi.fn(),
    onQuestClose: vi.fn(),
    onClose: vi.fn(),
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Stubs sequential `GET /api/join` responses — the Nth call gets the Nth entry (the last entry
 *  repeats for any further call). Fails loudly on any other path, so a test never silently passes
 *  against an unrelated fetch. */
function stubJoin(responses: { roomId: string; channelPath: string }[]): ReturnType<typeof vi.fn> {
  let call = 0;
  const mock = vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    if (!path.startsWith("/api/join?")) {
      throw new Error(`net-wire.test.ts: unexpected fetch ${path}`);
    }
    const response = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return Promise.resolve(jsonResponse(response));
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** Flushes the resolveJoin promise chain (`api()` awaits `fetch` then `response.json()`) with a
 *  macrotask, so it drains regardless of how many microtask hops the chain grows to. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("WorldClient on the alepha wire", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  it("resolves the join before opening the socket, dialing roomId + party + hero", async () => {
    const fetchMock = stubJoin([{ roomId: "party-1:verdant-reach", channelPath: "/ws/world" }]);
    const client = new WorldClient();
    client.connect(handlers(), "hero-1", "party-1");

    // No socket yet: resolveJoin must land first.
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/join?party=party-1&hero=hero-1");

    await flush();

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    expect(socket?.url.pathname).toBe("/ws/world");
    expect(socket?.url.protocol).toBe("ws:");
    expect(socket?.url.searchParams.get("roomId")).toBe("party-1:verdant-reach");
    expect(socket?.url.searchParams.get("party")).toBe("party-1");
    expect(socket?.url.searchParams.get("hero")).toBe("hero-1");
  });

  it("wraps every outgoing frame as {roomId, message}", async () => {
    stubJoin([{ roomId: "party-1:verdant-reach", channelPath: "/ws/world" }]);
    const client = new WorldClient();
    const connection = client.connect(handlers(), "hero-1", "party-1");
    await flush();

    connection.attack();

    const socket = FakeWebSocket.instances[0];
    expect(socket?.sent).toHaveLength(1);
    expect(JSON.parse(socket?.sent[0] ?? "")).toEqual({
      roomId: "party-1:verdant-reach",
      message: { t: "attack" },
    });

    // A skill direction is a GROUND vector: `x` and `z`, the two ground axes.
    connection.skill(5, { x: 0.6, z: 0.8 });
    expect(JSON.parse(socket?.sent[1] ?? "")).toEqual({
      roomId: "party-1:verdant-reach",
      message: { t: "skill", slot: 5, direction: { x: 0.6, z: 0.8 } },
    });
  });

  it("strips the __alephaRoom transport key before parsing an incoming frame", async () => {
    stubJoin([{ roomId: "party-1:verdant-reach", channelPath: "/ws/world" }]);
    const callbacks = handlers();
    const client = new WorldClient();
    client.connect(callbacks, "hero-1", "party-1");
    await flush();

    const socket = FakeWebSocket.instances[0];
    socket?.raw(JSON.stringify({ ...WELCOME, __alephaRoom: "party-1:verdant-reach" }));

    expect(callbacks.onWelcome).toHaveBeenCalledOnce();
    expect(callbacks.onWelcome).toHaveBeenCalledWith("hero-1", WELCOME.world, WELCOME.self);
  });

  it("dispatches authoritative Peasant camp replay, cleanup and bomb impact frames", async () => {
    stubJoin([{ roomId: "party-1:verdant-reach", channelPath: "/ws/world" }]);
    const callbacks = handlers();
    new WorldClient().connect(callbacks, "hero-1", "party-1");
    await flush();
    const socket = FakeWebSocket.instances[0];
    // The exact frame the room emits (`worldTick.ts`): a GROUND centre, `x` and `z`, in tile units.
    const camp = {
      t: "peasant.camp" as const,
      id: "camp-1",
      actorId: "hero-1",
      x: 1,
      z: 1.5,
      radius: 1.5,
      startedAt: 1_000,
      expiresAt: 13_000,
    };
    socket?.message(camp);
    socket?.message(camp); // admission + heartbeat replay is intentionally idempotent downstream
    const bank = { t: "peasant.camp_bank" as const, id: camp.id, gold: 75, opened: true };
    socket?.message(bank);
    socket?.message({ t: "peasant.camp_removed", id: camp.id });
    const ration = {
      t: "peasant.ration" as const,
      id: "ration-1",
      actorId: "hero-1",
      originX: 0,
      originY: 0.4,
      originZ: 0,
      x: 8,
      y: 0.2,
      z: -4,
      launchedAt: 1_000,
      landsAt: 1_900,
      fadeAt: 31_900,
      expiresAt: 32_900,
    };
    socket?.message(ration);
    socket?.message({ t: "peasant.ration_removed", id: ration.id });
    // The blast's GROUND point, `x` and `z`. It used to be `x` beside the projectile's ELEVATION,
    // which typechecked and drew the explosion on the horizon.
    const impact = {
      t: "peasant.bomb_impact" as const,
      actionId: "bomb-1",
      actorId: "hero-1",
      x: 1.25,
      z: -0.5,
      radius: 1.7,
      impactAt: 2_000,
    };
    socket?.message(impact);

    // Both frames go through `parseServerMessage`, which is the point: `isPeasantCampVisual`'s
    // `hasOnlyKeys` list and `isPeasantBombImpactVisual`'s are string-keyed and both branches end in
    // a cast, so a stale `"y"` in either compiles perfectly and DROPS every frame of that kind at
    // runtime — no camp, no blast, no error. Only a test that drives a real `{x, z}` frame through
    // the parser catches it.
    expect(callbacks.onPeasantCamp).toHaveBeenCalledTimes(2);
    expect(callbacks.onPeasantCamp).toHaveBeenLastCalledWith(camp);
    expect(callbacks.onPeasantCampBank).toHaveBeenCalledWith(bank);
    expect(callbacks.onPeasantCampRemoved).toHaveBeenCalledWith({
      t: "peasant.camp_removed",
      id: camp.id,
    });
    expect(callbacks.onPeasantRation).toHaveBeenCalledWith(ration);
    expect(callbacks.onPeasantRationRemoved).toHaveBeenCalledWith({
      t: "peasant.ration_removed",
      id: ration.id,
    });
    expect(callbacks.onPeasantBombImpact).toHaveBeenCalledOnce();
    expect(callbacks.onPeasantBombImpact).toHaveBeenCalledWith(impact);
  });

  it("re-resolves the join on every connect() — a 4008 reconnect reads the destination room fresh", async () => {
    const fetchMock = stubJoin([
      { roomId: "party-1:mapA", channelPath: "/ws/world" },
      { roomId: "party-1:mapB", channelPath: "/ws/world" },
    ]);
    const client = new WorldClient();
    client.connect(handlers(), "hero-1", "party-1");
    await flush();
    const first = FakeWebSocket.instances[0];
    expect(first?.url.searchParams.get("roomId")).toBe("party-1:mapA");

    first?.close(4008, "zone transition");

    // session.ts's reconnect table opens a brand-new WorldClient/connect() on 4008; the important
    // thing net.ts must get right is calling resolveJoin AGAIN rather than reusing the room the
    // player just left (the whole point of a map transition).
    const second = new WorldClient();
    second.connect(handlers(), "hero-1", "party-1");
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondSocket = FakeWebSocket.instances[1];
    expect(secondSocket?.url.searchParams.get("roomId")).toBe("party-1:mapB");
  });
});

/**
 * The two client-owned rules that talk to the room without ever deciding anything: a granted
 * mobility displacement (the S3 spec, decision 6) and the drowning REPORT that replaced the lab's
 * teleport-home. Driven through the real socket, because both are plumbing — a grant that never
 * reaches the hero and an event that never reaches the wire both fail silently.
 */
describe("WorldClient movement that the room grants or answers", () => {
  const FRAME = 1 / 60;
  const EAST = { up: false, down: false, left: false, right: true };

  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  /** Welcomes onto the walled, part-flooded grid; the socket is the room, the client is the hero. */
  async function joined(): Promise<{ socket: FakeWebSocket; client: WorldClient }> {
    stubJoin([{ roomId: "party-1:verdant-reach", channelPath: "/ws/world" }]);
    const client = new WorldClient();
    client.connect(handlers(), "hero-1", "party-1");
    await flush();
    const socket = FakeWebSocket.instances[0];
    if (!socket) throw new Error("no socket");
    socket.message({
      ...WELCOME,
      world: { ...WELCOME.world, heightfield: walledAndFloodedHeightfield() },
    });
    return { socket, client };
  }

  /** Where the hero itself is — the sample draws your own square in the present, from its state. */
  function selfX(client: WorldClient): number {
    const self = client.sample(0).players.find((player) => player.id === "hero-1");
    if (!self) throw new Error("no self in the sample");
    return self.x;
  }

  function sentMessages(socket: FakeWebSocket): { t?: string }[] {
    return socket.sent.map((raw) => (JSON.parse(raw) as { message: { t?: string } }).message);
  }

  it("spends a mobility grant the room put on the self state", async () => {
    const { socket, client } = await joined();

    // Ungranted, the wall at x = 0.5 is the end of the road.
    for (let frame = 0; frame < 60; frame++) client.update(EAST, FRAME);
    expect(selfX(client)).toBeLessThan(0.5);

    // The grant arrives the way it always does — on the self state the room already sends the
    // actor, with a server deadline read against `serverNow`.
    socket.message({
      t: "state",
      self: {
        ...WELCOME.self,
        serverNow: 10_000,
        mobility: {
          actionId: "8b1f4c62-0000-4000-8000-000000000001",
          distance: 3,
          until: 12_500,
        },
      },
    });
    for (let frame = 0; frame < 60; frame++) client.update(EAST, FRAME);

    expect(selfX(client)).toBeGreaterThan(1);
  });

  it("reports drowning to the room and decides nothing itself", async () => {
    const { socket, client } = await joined();

    // Phase east past the wall and into the flooded third, then hold under for the breath's own
    // eleven seconds. Nothing about the hero changes here — the room answers the report.
    socket.message({
      t: "state",
      self: {
        ...WELCOME.self,
        serverNow: 10_000,
        mobility: {
          actionId: "8b1f4c62-0000-4000-8000-000000000002",
          distance: 5,
          until: 12_500,
        },
      },
    });
    for (let frame = 0; frame < 15 * 60; frame++) client.update(EAST, FRAME);

    expect(
      sentMessages(socket).filter((message) => message.t === "drowned").length,
    ).toBeGreaterThan(0);
    // Still out at sea, east of the wall: the lab's `place(spawn)` would have put it back at 0.
    expect(selfX(client)).toBeGreaterThan(1);
  });

  it("applies and withdraws authoritative harvest collision with event state", async () => {
    const event: WorldEventSnapshot = {
      id: "harvest-wall",
      col: 9,
      row: 8,
      graphicAssetId: null,
      onTop: false,
      moveSpeed: 3,
      moveFrequency: 3,
      moveAnimation: false,
      directionFixed: true,
      presentation: "native",
      harvest: {
        state: "intact",
        generation: 0,
        hits: 0,
        hitsRequired: 3,
        lastHitAt: null,
        depletedAt: null,
        respawnAt: null,
        exhaustionBehavior: "replace",
        exhaustedAssetId: "resource.terrain-resources-wood-trees.stump-1",
        fadeDurationMs: 250,
        collider: [(WORLD_SIZE / 2 + 1) * 64, (WORLD_SIZE / 2 - 1) * 64, 64, 128],
      },
    };
    stubJoin([{ roomId: "party-1:verdant-reach", channelPath: "/ws/world" }]);
    const client = new WorldClient();
    client.connect(handlers(), "hero-1", "party-1");
    await flush();
    const socket = FakeWebSocket.instances[0];
    if (!socket) throw new Error("no socket");
    socket.message({
      ...WELCOME,
      world: { ...WELCOME.world, heightfield: flatHeightfield(), events: [event] },
    });

    for (let frame = 0; frame < 120; frame += 1) client.update(EAST, FRAME);
    expect(selfX(client)).toBeLessThan(1);

    socket.message({
      t: "world.resync",
      tick: 2,
      players: WELCOME.players,
      seaGuardians: [],
      monsters: [],
      guards: [],
      loot: [],
      corpses: [],
      projectiles: [],
      events: [],
    });
    for (let frame = 0; frame < 120; frame += 1) client.update(EAST, FRAME);
    expect(selfX(client)).toBeGreaterThan(1.5);
  });
});
