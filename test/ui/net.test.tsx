import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ConnectionHandlers, WorldClient } from "../../src/client/game/net.js";
import { MAX_PENDING_COMMANDS } from "../../src/shared/prediction.js";
import type { ServerMessage } from "../../src/shared/protocol.js";
import { TICK_DT } from "../../src/shared/simulation.js";

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
    onEvent: vi.fn(),
    onEventSay: vi.fn(),
    onEventChoices: vi.fn(),
    onEventClose: vi.fn(),
    onClose: vi.fn(),
  };
}

describe("WorldClient lifecycle", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  it("bounds unacknowledged prediction and requests one resync", () => {
    const client = new WorldClient();
    client.connect(handlers(), "hero-1", "party-1");
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket?.message(WELCOME);

    for (let i = 0; i < MAX_PENDING_COMMANDS + 20; i++) {
      client.update({ up: false, down: false, left: false, right: true }, TICK_DT);
    }

    const messages = socket?.sent.map((raw) => JSON.parse(raw) as { t: string }) ?? [];
    expect(messages.filter((message) => message.t === "input")).toHaveLength(MAX_PENDING_COMMANDS);
    expect(messages.filter((message) => message.t === "world.resync")).toHaveLength(1);
  });

  it("reports an error followed by close only once", () => {
    const callbacks = handlers();
    const client = new WorldClient();
    client.connect(callbacks, "hero-1", "party-1");
    const socket = FakeWebSocket.instances[0];

    socket?.dispatchEvent(new Event("error"));
    socket?.close(1006, "closed after error");

    expect(callbacks.onClose).toHaveBeenCalledOnce();
    expect(callbacks.onClose).toHaveBeenCalledWith(1006, "connection error");
  });

  it("closes a malformed initial frame instead of latching an unusable resync", () => {
    const callbacks = handlers();
    const client = new WorldClient();
    client.connect(callbacks, "hero-1", "party-1");
    const socket = FakeWebSocket.instances[0];

    socket?.message({ t: "not-a-welcome" });

    expect(socket?.closeCode).toBe(1002);
    expect(callbacks.onClose).toHaveBeenCalledWith(1002, "invalid welcome");
    expect(socket?.sent).toEqual([]);
  });
});
