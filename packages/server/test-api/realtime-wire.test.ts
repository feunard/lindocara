import {
  encodeServerMessage,
  parseServerMessage,
  type ServerMessage,
} from "@lindocara/engine/protocol.js";
import { Alepha } from "alepha";
import { test } from "vitest";
import { RealtimeChannels } from "../src/api/realtime/channels.ts";
import { frameByteLength } from "../src/api/realtime/wire.ts";

// `RealtimeChannels` is not wired into `LindocaraApi` yet — this task only declares the
// channels, not the rooms that will consume them (Task 2+). `alepha.inject()` works on an
// unregistered class the same way `room-integration.spec.ts` injects a bare `class Game {
// world = $channel(...) }` (see `.vendor/alepha` for the primitive constraint), so a fresh
// `Alepha.create()` with no `.with(...)` is enough to exercise the channel definitions.
test("worldChannel, partyChannel and presenceChannel are mounted at their realtime-tranche paths", ({
  expect,
}) => {
  const alepha = Alepha.create();
  const channels = alepha.inject(RealtimeChannels);

  expect(channels.worldChannel.options.path).toBe("/ws/world");
  expect(channels.partyChannel.options.path).toBe("/ws/party");
  expect(channels.presenceChannel.options.path).toBe("/ws/presence");
});

// The loose wire schema is not the parser — `parseClientMessage`/`encodeServerMessage` from
// `@lindocara/engine/protocol.js` remain the only wire truth (single-parser doctrine). This
// proves a real `ServerMessage`, JSON-encoded the way `World` would send it, survives
// validation against the channel's loose `in` schema (server -> client) unchanged, and still
// decodes back to the exact original message.
test("a ServerMessage round-trips encodeServerMessage/JSON through the loose channel schema", ({
  expect,
}) => {
  const alepha = Alepha.create();
  const channels = alepha.inject(RealtimeChannels);

  const message: ServerMessage = {
    t: "chat",
    channel: "local",
    from: "Éloïse",
    text: "Salut, ça va ? café ☕",
  };

  const raw = encodeServerMessage(message);
  const parsedJson: unknown = JSON.parse(raw);
  const validated = channels.worldChannel.options.schema.in.parse(parsedJson);

  expect(parseServerMessage(JSON.stringify(validated))).toEqual(message);
});

// `raw.length` counts UTF-16 code units: an accented character like "é" is one code unit but
// two UTF-8 bytes, so a `MAX_FRAME_BYTES` check against `.length` would silently undercount and
// let an oversized frame through. `frameByteLength` must count actual wire bytes instead.
test("frameByteLength counts UTF-8 bytes, not UTF-16 code units", ({ expect }) => {
  const raw = "café";

  expect(raw.length).toBe(4);
  expect(frameByteLength(raw)).toBe(5);
});
