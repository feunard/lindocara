import { resolveTerrain } from "../shared/game.js";
import {
  CORRECTION_SMOOTHING_MS,
  MAX_ACCUMULATED_SECONDS,
  MAX_PENDING_COMMANDS,
  predictStep,
  prunePending,
  reconcile,
  SNAP_THRESHOLD_PX,
} from "../shared/prediction.js";
import {
  type ClientMessage,
  type Command,
  type EventCode,
  type EventParams,
  type EventTone,
  type LootSnapshot,
  type MonsterSnapshot,
  type PlayerSnapshot,
  parseServerMessage,
  type SelfState,
  type ServerMessage,
  type WorldInfo,
} from "../shared/protocol.js";
import { type Input, NO_INPUT, step, TICK_DT, type Vec2 } from "../shared/simulation.js";

const INTERPOLATION_DELAY_MS = 100;
const BUFFER_MS = 1_000;

interface BufferedSnapshot {
  receivedAt: number;
  players: PlayerSnapshot[];
  monsters: MonsterSnapshot[];
  loot: LootSnapshot[];
}

export interface SceneSample {
  players: PlayerSnapshot[];
  monsters: MonsterSnapshot[];
  loot: LootSnapshot[];
}

export interface Connection {
  attack(): void;
  interact(): void;
  usePotion(): void;
  sendChat(text: string): void;
  close(): void;
}

export interface ConnectionHandlers {
  onWelcome(selfId: string, world: WorldInfo, state: SelfState): void;
  onState(state: SelfState): void;
  onChat(from: string, text: string): void;
  onEvent(
    code: EventCode,
    params: EventParams | undefined,
    tone: EventTone,
    x?: number,
    y?: number,
  ): void;
  onClose(reason: string): void;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolate<T extends { id: string; x: number; y: number }>(
  older: T[],
  newer: T[],
  alpha: number,
): T[] {
  const previous = new Map(older.map((entity) => [entity.id, entity]));
  return newer.map((entity) => {
    const before = previous.get(entity.id);
    if (!before) return entity;
    return {
      ...entity,
      x: lerp(before.x, entity.x, alpha),
      y: lerp(before.y, entity.y, alpha),
    };
  });
}

function predictPartial(position: Vec2, input: Input, dt: number): Vec2 {
  return resolveTerrain(position, step(position, input, dt));
}

export class WorldClient {
  #socket: WebSocket | null = null;
  #buffer: BufferedSnapshot[] = [];

  #selfId: string | null = null;
  #selfSnapshot: PlayerSnapshot | null = null;
  #predicted: Vec2 | null = null;
  #pending: Command[] = [];
  #seq = 0;
  #ack = 0;

  #accumulator = 0;
  #input: Input = NO_INPUT;
  #error: Vec2 = { x: 0, y: 0 };
  #errorAt = 0;

  get selfId(): string | null {
    return this.#selfId;
  }

  connect(handlers: ConnectionHandlers, characterId: string): Connection {
    const url = new URL("/api/ws", window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("character", characterId);
    const socket = new WebSocket(url);
    this.#socket = socket;

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const message = parseServerMessage(event.data);
      if (message) this.#handle(message, handlers);
    });

    socket.addEventListener("close", (event) => {
      this.#socket = null;
      handlers.onClose(event.reason || "connection closed");
    });
    socket.addEventListener("error", () => handlers.onClose("connection error"));

    return {
      attack: () => this.#send({ t: "attack" }),
      interact: () => this.#send({ t: "interact" }),
      usePotion: () => this.#send({ t: "use", item: "potion" }),
      sendChat: (text) => this.#send({ t: "chat", text }),
      close: () => socket.close(1000, "client left"),
    };
  }

  update(input: Input, dt: number): void {
    if (this.#predicted === null) return;
    this.#input = input;
    if (this.#selfSnapshot?.dead) return;

    this.#accumulator = Math.min(this.#accumulator + dt, MAX_ACCUMULATED_SECONDS);
    while (this.#accumulator >= TICK_DT) {
      this.#accumulator -= TICK_DT;

      const seq = ++this.#seq;
      const command = { seq, input };
      this.#pending.push(command);
      this.#predicted = predictStep(this.#predicted, command);
      this.#send({ t: "input", seq, input });
    }
  }

  sample(now: number): SceneSample {
    const newest = this.#buffer[this.#buffer.length - 1];
    if (!newest) return { players: [], monsters: [], loot: [] };

    const interpolated = this.#sampleInterpolated(now, newest);
    const self = this.#sampleSelf(now);
    if (!self) return interpolated;
    return {
      ...interpolated,
      players: [...interpolated.players.filter((player) => player.id !== self.id), self],
    };
  }

  #handle(message: ServerMessage, handlers: ConnectionHandlers): void {
    if (message.t === "welcome") {
      this.#selfId = message.selfId;
      this.#push(message.players, message.monsters, message.loot);
      const self = message.players.find((player) => player.id === message.selfId);
      if (self) {
        this.#selfSnapshot = self;
        this.#predicted = { x: self.x, y: self.y };
        this.#ack = self.ack;
      }
      handlers.onWelcome(message.selfId, message.world, message.self);
      return;
    }
    if (message.t === "snapshot") {
      const receivedAt = this.#push(message.players, message.monsters, message.loot);
      this.#reconcile(message.players, receivedAt);
      return;
    }
    if (message.t === "state") {
      handlers.onState(message.self);
      return;
    }
    if (message.t === "chat") {
      handlers.onChat(message.from, message.text);
      return;
    }
    handlers.onEvent(message.code, message.params, message.tone, message.x, message.y);
  }

  #push(players: PlayerSnapshot[], monsters: MonsterSnapshot[], loot: LootSnapshot[]): number {
    const receivedAt = performance.now();
    this.#buffer.push({ receivedAt, players, monsters, loot });
    const cutoff = receivedAt - BUFFER_MS;
    while (this.#buffer.length > 2 && (this.#buffer[0]?.receivedAt ?? 0) < cutoff) {
      this.#buffer.shift();
    }
    return receivedAt;
  }

  #reconcile(players: PlayerSnapshot[], now: number): void {
    if (this.#selfId === null || this.#predicted === null) return;

    const authoritative = players.find((player) => player.id === this.#selfId);
    if (!authoritative) return;
    this.#selfSnapshot = authoritative;

    const drawnBefore = this.#samplePredictedPosition();
    this.#ack = authoritative.ack;
    this.#pending = prunePending(this.#pending, authoritative.ack);

    if (authoritative.dead || this.#pending.length > MAX_PENDING_COMMANDS) {
      this.#pending = [];
      this.#predicted = { x: authoritative.x, y: authoritative.y };
      this.#error = { x: 0, y: 0 };
      return;
    }

    this.#predicted = reconcile({ x: authoritative.x, y: authoritative.y }, this.#pending);

    const drawnAfter = this.#samplePredictedPosition();
    const error = { x: drawnBefore.x - drawnAfter.x, y: drawnBefore.y - drawnAfter.y };

    if (Math.hypot(error.x, error.y) > SNAP_THRESHOLD_PX) {
      this.#error = { x: 0, y: 0 };
      return;
    }

    this.#error = error;
    this.#errorAt = now;
  }

  #samplePredictedPosition(): Vec2 {
    if (this.#predicted === null || this.#selfSnapshot?.dead) {
      return this.#predicted ?? { x: 0, y: 0 };
    }
    return predictPartial(this.#predicted, this.#input, this.#accumulator);
  }

  #sampleSelf(now: number): PlayerSnapshot | null {
    if (!this.#selfSnapshot || this.#predicted === null) return null;
    const position = this.#samplePredictedPosition();
    const elapsed = now - this.#errorAt;
    const decay = Math.max(0, 1 - elapsed / CORRECTION_SMOOTHING_MS);

    return {
      ...this.#selfSnapshot,
      x: position.x + this.#error.x * decay,
      y: position.y + this.#error.y * decay,
      ack: this.#ack,
    };
  }

  #sampleInterpolated(now: number, newest: BufferedSnapshot): SceneSample {
    if (this.#buffer.length === 1) {
      return {
        players: newest.players.filter((player) => player.id !== this.#selfId),
        monsters: newest.monsters,
        loot: newest.loot,
      };
    }

    const renderAt = now - INTERPOLATION_DELAY_MS;
    if (renderAt >= newest.receivedAt) {
      return {
        players: newest.players.filter((player) => player.id !== this.#selfId),
        monsters: newest.monsters,
        loot: newest.loot,
      };
    }

    let older = this.#buffer[0];
    let newer = newest;
    for (let i = 0; i < this.#buffer.length - 1; i++) {
      const a = this.#buffer[i];
      const b = this.#buffer[i + 1];
      if (a && b && a.receivedAt <= renderAt && renderAt <= b.receivedAt) {
        older = a;
        newer = b;
        break;
      }
    }
    if (!older) {
      return {
        players: newest.players.filter((player) => player.id !== this.#selfId),
        monsters: newest.monsters,
        loot: newest.loot,
      };
    }
    const span = newer.receivedAt - older.receivedAt;
    const alpha = span <= 0 ? 1 : Math.max(0, Math.min(1, (renderAt - older.receivedAt) / span));
    return {
      players: interpolate(older.players, newer.players, alpha).filter(
        (player) => player.id !== this.#selfId,
      ),
      monsters: interpolate(older.monsters, newer.monsters, alpha),
      loot: newer.loot,
    };
  }

  #send(message: ClientMessage): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) return;
    this.#socket.send(JSON.stringify(message));
  }
}
