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
import type { ServerMessage } from "@lindocara/engine/protocol.js";
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

    connection.skill(5, { x: 0.6, y: 0.8 });
    expect(JSON.parse(socket?.sent[1] ?? "")).toEqual({
      roomId: "party-1:verdant-reach",
      message: { t: "skill", slot: 5, direction: { x: 0.6, y: 0.8 } },
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
    const camp = {
      t: "peasant.camp" as const,
      id: "camp-1",
      actorId: "hero-1",
      x: 64,
      y: 96,
      radius: 96,
      startedAt: 1_000,
      expiresAt: 13_000,
    };
    socket?.message(camp);
    socket?.message(camp); // admission + heartbeat replay is intentionally idempotent downstream
    const bank = { t: "peasant.camp_bank" as const, id: camp.id, gold: 75, opened: true };
    socket?.message(bank);
    socket?.message({ t: "peasant.camp_removed", id: camp.id });
    const impact = {
      t: "peasant.bomb_impact" as const,
      actionId: "bomb-1",
      actorId: "hero-1",
      x: 80,
      y: 96,
      radius: 110,
      impactAt: 2_000,
    };
    socket?.message(impact);

    expect(callbacks.onPeasantCamp).toHaveBeenCalledTimes(2);
    expect(callbacks.onPeasantCamp).toHaveBeenLastCalledWith(camp);
    expect(callbacks.onPeasantCampBank).toHaveBeenCalledWith(bank);
    expect(callbacks.onPeasantCampRemoved).toHaveBeenCalledWith({
      t: "peasant.camp_removed",
      id: camp.id,
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
