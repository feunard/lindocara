/**
 * The wire format between browser and Durable Object.
 *
 * Clients send intent, never position — the server is the only thing that decides where
 * a square is. Every inbound message is parsed defensively, because a client is an
 * attacker until proven otherwise.
 *
 * Inputs are numbered. The server echoes back the highest sequence number it has actually
 * applied (`ack`), which is what lets a client predict its own movement and then reconcile
 * against the truth. See `prediction.ts`.
 */

import type { Input } from "./simulation.js";

/** One tick's worth of intent, stamped so the server can acknowledge it. */
export interface Command {
  seq: number;
  input: Input;
}

export interface PlayerSnapshot {
  id: string;
  nick: string;
  x: number;
  y: number;
  /** Highest command sequence the server has applied for this player. */
  ack: number;
}

export interface WorldInfo {
  width: number;
  height: number;
  playerSize: number;
}

/** Sent by the browser, once per simulation tick. */
export type ClientMessage = { t: "input"; seq: number; input: Input };

/** Sent by the Durable Object. */
export type ServerMessage =
  | { t: "welcome"; selfId: string; world: WorldInfo; players: PlayerSnapshot[] }
  | { t: "snapshot"; tick: number; players: PlayerSnapshot[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseInput(value: unknown): Input | null {
  if (!isRecord(value)) return null;
  const { up, down, left, right } = value;
  if (
    typeof up !== "boolean" ||
    typeof down !== "boolean" ||
    typeof left !== "boolean" ||
    typeof right !== "boolean"
  ) {
    return null;
  }
  return { up, down, left, right };
}

/** Returns `null` for anything that is not a well-formed client message. */
export function parseClientMessage(raw: string | ArrayBuffer): ClientMessage | null {
  if (typeof raw !== "string") return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(value) || value.t !== "input") return null;

  // A sequence number is the client's claim about ordering. Anything that is not a positive
  // safe integer is a broken client or a hostile one; either way it does not get to move.
  const { seq } = value;
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) return null;

  const input = parseInput(value.input);
  return input === null ? null : { t: "input", seq, input };
}

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return null;
    if (value.t === "welcome" || value.t === "snapshot") return value as unknown as ServerMessage;
    return null;
  } catch {
    return null;
  }
}
