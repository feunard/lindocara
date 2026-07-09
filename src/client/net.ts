/**
 * The socket, the local prediction of your own square, and the interpolation buffer that makes
 * everyone else's 20 Hz movement look smooth.
 *
 * Two players are drawn by two different rules, on purpose:
 *
 * - **You** are drawn in the present. Your input is applied locally the moment you press a
 *   key, so the square answers within a frame. When a snapshot arrives it carries the server's
 *   truth — which is one round-trip stale — so the commands the server has not acknowledged
 *   yet are replayed on top of it. Agreement means nothing visibly happens.
 * - **Everyone else** is drawn in the recent past, `INTERPOLATION_DELAY_MS` behind the newest
 *   snapshot, interpolating between the two that bracket that instant. There is no way to know
 *   what a remote player is doing *now*, and guessing looks worse than being slightly late.
 */

import {
  CORRECTION_SMOOTHING_MS,
  MAX_ACCUMULATED_SECONDS,
  MAX_PENDING_COMMANDS,
  prunePending,
  reconcile,
  SNAP_THRESHOLD_PX,
} from "../shared/prediction.js";
import {
  type ClientMessage,
  type Command,
  type PlayerSnapshot,
  parseServerMessage,
  type ServerMessage,
} from "../shared/protocol.js";
import { type Input, NO_INPUT, step, TICK_DT, type Vec2 } from "../shared/simulation.js";

/** Must exceed the server tick interval (50 ms) or remote players would routinely extrapolate. */
const INTERPOLATION_DELAY_MS = 100;

/** Enough history to ride out a hiccup, not enough to drift. */
const BUFFER_MS = 1000;

interface BufferedSnapshot {
  /** `performance.now()` when this arrived — server ticks say nothing about local clocks. */
  receivedAt: number;
  players: PlayerSnapshot[];
}

export interface Connection {
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
  #selfNick = "";

  /** Our own position, one whole tick at a time. `null` until the world welcomes us. */
  #predicted: Vec2 | null = null;
  /** Commands sent but not yet acknowledged, oldest first. */
  #pending: Command[] = [];
  #seq = 0;
  #ack = 0;

  /** Leftover time that has not yet accumulated into a whole tick. */
  #accumulator = 0;
  #input: Input = NO_INPUT;

  /** Where the last correction moved us from, decayed to zero over CORRECTION_SMOOTHING_MS. */
  #error: Vec2 = { x: 0, y: 0 };
  #errorAt = 0;

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
      if (message) this.#handle(message, handlers);
    });

    socket.addEventListener("close", (event) => {
      this.#socket = null;
      handlers.onClose(event.reason || "connection closed");
    });

    socket.addEventListener("error", () => handlers.onClose("connection error"));

    return { close: () => socket.close(1000, "client left") };
  }

  /**
   * Advance the local simulation by `dt` seconds, emitting one command per whole tick.
   *
   * The command rate is the server's tick rate, not the display's: replay during
   * reconciliation only reproduces the server exactly if each command means one TICK_DT.
   */
  update(input: Input, dt: number): void {
    if (this.#predicted === null) return;

    this.#input = input;
    this.#accumulator = Math.min(this.#accumulator + dt, MAX_ACCUMULATED_SECONDS);

    while (this.#accumulator >= TICK_DT) {
      this.#accumulator -= TICK_DT;

      const seq = ++this.#seq;
      this.#pending.push({ seq, input });
      this.#predicted = step(this.#predicted, input, TICK_DT);
      this.#send({ t: "input", seq, input });
    }
  }

  /** Every player, positioned for this exact frame. */
  sample(now: number): PlayerSnapshot[] {
    const players = this.#sampleRemote(now);
    const self = this.#sampleSelf(now);
    if (self) players.push(self);
    return players;
  }

  #handle(message: ServerMessage, handlers: ConnectionHandlers): void {
    if (message.t === "welcome") {
      this.#selfId = message.selfId;
      this.#selfNick = message.players.find((p) => p.id === message.selfId)?.nick ?? "";

      const spawn = message.players.find((p) => p.id === message.selfId);
      this.#predicted = spawn ? { x: spawn.x, y: spawn.y } : { x: 0, y: 0 };

      handlers.onWelcome(message.selfId);
      return;
    }

    const receivedAt = performance.now();
    this.#buffer.push({ receivedAt, players: message.players });

    const cutoff = receivedAt - BUFFER_MS;
    while (this.#buffer.length > 2 && (this.#buffer[0]?.receivedAt ?? 0) < cutoff) {
      this.#buffer.shift();
    }

    this.#reconcile(message.players, receivedAt);
  }

  /** Fold the server's truth back into our prediction. */
  #reconcile(players: PlayerSnapshot[], now: number): void {
    if (this.#selfId === null || this.#predicted === null) return;

    const authoritative = players.find((p) => p.id === this.#selfId);
    if (!authoritative) return;

    // Where we are currently drawing ourselves, before anything changes.
    const drawnBefore = step(this.#predicted, this.#input, this.#accumulator);

    this.#ack = authoritative.ack;
    this.#pending = prunePending(this.#pending, authoritative.ack);

    // The server is not consuming our commands — flooded, stalled, or we are far ahead.
    // Replaying a runaway list only compounds the error. Concede and take the server's word.
    if (this.#pending.length > MAX_PENDING_COMMANDS) {
      this.#pending = [];
      this.#predicted = { x: authoritative.x, y: authoritative.y };
      this.#error = { x: 0, y: 0 };
      return;
    }

    this.#predicted = reconcile({ x: authoritative.x, y: authoritative.y }, this.#pending);

    const drawnAfter = step(this.#predicted, this.#input, this.#accumulator);
    const error = { x: drawnBefore.x - drawnAfter.x, y: drawnBefore.y - drawnAfter.y };

    if (Math.hypot(error.x, error.y) > SNAP_THRESHOLD_PX) {
      // Too far wrong to be a misprediction — a respawn, or a rebuilt world. Snap, don't glide.
      this.#error = { x: 0, y: 0 };
      return;
    }

    this.#error = error;
    this.#errorAt = now;
  }

  #sampleSelf(now: number): PlayerSnapshot | null {
    if (this.#selfId === null || this.#predicted === null) return null;

    // Extrapolate the partial tick that has not been committed to a command yet. This is what
    // turns a 20 Hz prediction into 60 Hz motion, and it costs nothing: `step` is pure.
    const position = step(this.#predicted, this.#input, this.#accumulator);

    const elapsed = now - this.#errorAt;
    const decay = Math.max(0, 1 - elapsed / CORRECTION_SMOOTHING_MS);

    return {
      id: this.#selfId,
      nick: this.#selfNick,
      x: position.x + this.#error.x * decay,
      y: position.y + this.#error.y * decay,
      ack: this.#ack,
    };
  }

  /** Everyone but us, interpolated between the two snapshots bracketing the render time. */
  #sampleRemote(now: number): PlayerSnapshot[] {
    const newest = this.#buffer[this.#buffer.length - 1];
    if (!newest) return [];

    const others = (players: PlayerSnapshot[]) => players.filter((p) => p.id !== this.#selfId);
    if (this.#buffer.length === 1) return others(newest.players);

    const renderAt = now - INTERPOLATION_DELAY_MS;

    // The newest snapshot is already older than the render time: the stream stalled. Freeze on
    // the last known truth rather than extrapolating into a guess.
    if (renderAt >= newest.receivedAt) return others(newest.players);

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
    if (!older) return others(newest.players);

    const span = newer.receivedAt - older.receivedAt;
    // Clamped: if renderAt falls outside the pair — briefly possible just after joining, when
    // the buffer is shorter than the interpolation delay — extrapolating along a stale segment
    // flings the square across the world.
    const alpha = span <= 0 ? 1 : Math.min(1, Math.max(0, (renderAt - older.receivedAt) / span));

    const previous = new Map(older.players.map((p) => [p.id, p]));
    return others(newer.players).map((player) => {
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

  #send(message: ClientMessage): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) return;
    this.#socket.send(JSON.stringify(message));
  }
}
