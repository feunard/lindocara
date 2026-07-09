/**
 * The socket, plus the snapshot buffer that makes 20 Hz server updates look like smooth
 * 60 Hz motion.
 *
 * Snapshots arrive as discrete positions. Drawing the newest one each frame gives visible
 * 50 ms stutter. Instead we render the world slightly in the past — `INTERPOLATION_DELAY_MS`
 * behind the newest snapshot — which means there is almost always a snapshot on each side
 * of the render time to interpolate between. The cost is a constant, deliberate lag; the
 * benefit is continuous motion that survives a late or dropped packet.
 */

import {
  type ClientMessage,
  type PlayerSnapshot,
  parseServerMessage,
  type ServerMessage,
} from "../shared/protocol.js";
import type { Input } from "../shared/simulation.js";

/** Must exceed the server tick interval (50 ms) or we would routinely extrapolate. */
const INTERPOLATION_DELAY_MS = 100;

/** Enough history to ride out a hiccup, not enough to drift. */
const BUFFER_MS = 1000;

interface BufferedSnapshot {
  /** `performance.now()` when this arrived — server ticks say nothing about local clocks. */
  receivedAt: number;
  players: PlayerSnapshot[];
}

export interface Connection {
  send(input: Input): void;
  close(): void;
}

export interface ConnectionHandlers {
  onWelcome(selfId: string): void;
  onClose(reason: string): void;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class WorldClient {
  #socket: WebSocket | null = null;
  #buffer: BufferedSnapshot[] = [];
  #selfId: string | null = null;

  get selfId(): string | null {
    return this.#selfId;
  }

  connect(handlers: ConnectionHandlers): Connection {
    const url = new URL("/api/ws", window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

    const socket = new WebSocket(url);
    this.#socket = socket;

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const message = parseServerMessage(event.data);
      if (!message) return;
      this.#handle(message, handlers);
    });

    socket.addEventListener("close", (event) => {
      this.#socket = null;
      handlers.onClose(event.reason || "connection closed");
    });

    socket.addEventListener("error", () => {
      handlers.onClose("connection error");
    });

    return {
      send: (input) => this.#send({ t: "input", input }),
      close: () => socket.close(1000, "client left"),
    };
  }

  #handle(message: ServerMessage, handlers: ConnectionHandlers): void {
    if (message.t === "welcome") {
      this.#selfId = message.selfId;
      handlers.onWelcome(message.selfId);
      return;
    }

    const receivedAt = performance.now();
    this.#buffer.push({ receivedAt, players: message.players });

    const cutoff = receivedAt - BUFFER_MS;
    while (this.#buffer.length > 2 && (this.#buffer[0]?.receivedAt ?? 0) < cutoff) {
      this.#buffer.shift();
    }
  }

  #send(message: ClientMessage): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) return;
    this.#socket.send(JSON.stringify(message));
  }

  /**
   * Where every player should be drawn *right now*, interpolated between the two snapshots
   * bracketing the render time.
   */
  sample(now: number): PlayerSnapshot[] {
    if (this.#buffer.length === 0) return [];

    const newest = this.#buffer[this.#buffer.length - 1];
    if (!newest) return [];
    if (this.#buffer.length === 1) return newest.players;

    const renderAt = now - INTERPOLATION_DELAY_MS;

    // Newest snapshot is already older than the render time: the stream stalled. Freeze on
    // the last known truth rather than extrapolating into a guess.
    if (renderAt >= newest.receivedAt) return newest.players;

    let older = this.#buffer[0];
    let newer = newest;
    for (let i = 0; i < this.#buffer.length - 1; i++) {
      const a = this.#buffer[i];
      const b = this.#buffer[i + 1];
      if (!a || !b) continue;
      if (a.receivedAt <= renderAt && renderAt <= b.receivedAt) {
        older = a;
        newer = b;
        break;
      }
    }
    if (!older) return newest.players;

    const span = newer.receivedAt - older.receivedAt;
    const alpha = span <= 0 ? 1 : (renderAt - older.receivedAt) / span;

    const previous = new Map(older.players.map((p) => [p.id, p]));
    return newer.players.map((player) => {
      const before = previous.get(player.id);
      // A player who only exists in the newer snapshot just joined: nothing to lerp from.
      if (!before) return player;
      return {
        ...player,
        x: lerp(before.x, player.x, alpha),
        y: lerp(before.y, player.y, alpha),
      };
    });
  }
}
