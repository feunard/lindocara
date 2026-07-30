import { type ConnectionHandlers, WorldClient } from "@lindocara/client/game/net.js";
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

const WELCOME: ServerMessage = {
  t: "welcome",
  tick: 1,
  selfId: "hero-1",
  world: {
    zoneId: "verdant-reach",
    revision: 1,
    zoneNameKey: "zone.verdant_reach",
    tiles: ["....", "....", "....", "...."],
    elements: [],
    colliders: [],
    tilesetId: "tiny-swords",
    layers: ["0*16", "0*16", "0*16"],
    events: [],
    width: 128,
    height: 128,
    playerSize: 32,
    obstacles: [],
    safeZone: null,
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
      x: 32,
      y: 32,
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
    onShadowDance: vi.fn(),
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
      strikes: [
        {
          targetId: "monster-1",
          from: { x: 32, y: 32 },
          targetPosition: { x: 64, y: 32 },
          landing: { x: 96, y: 32 },
          impactAt: 1_000,
          damage: 32,
          killed: false,
        },
      ],
      finalPosition: { x: 96, y: 32 },
    };

    socket?.message(sequence);
    client.update({ up: false, down: false, left: true, right: false }, TICK_DT);

    expect(callbacks.onShadowDance).toHaveBeenCalledOnce();
    expect(callbacks.onShadowDance).toHaveBeenCalledWith(sequence);
    expect(
      client.sample(performance.now()).players.find((player) => player.id === "hero-1"),
    ).toMatchObject({ x: 96, y: 32 });
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
