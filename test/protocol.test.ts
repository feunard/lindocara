import { describe, expect, it } from "vitest";
import { parseClientMessage, parseServerMessage } from "../src/shared/protocol.js";

describe("client protocol", () => {
  it("accepts movement and action intents without accepting outcomes", () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          t: "input",
          seq: 7,
          input: { up: true, down: false, left: false, right: true },
        }),
      ),
    ).toEqual({
      t: "input",
      seq: 7,
      input: { up: true, down: false, left: false, right: true },
    });
    expect(parseClientMessage(JSON.stringify({ t: "attack" }))).toEqual({ t: "attack" });
    expect(parseClientMessage(JSON.stringify({ t: "interact" }))).toEqual({ t: "interact" });
    expect(parseClientMessage(JSON.stringify({ t: "use", item: "potion" }))).toEqual({
      t: "use",
      item: "potion",
    });
    expect(parseClientMessage(JSON.stringify({ t: "chat", text: "hello" }))).toEqual({
      t: "chat",
      text: "hello",
    });
  });

  it.each([
    "not json",
    JSON.stringify({ t: "teleport", x: 1, y: 1 }),
    JSON.stringify({ t: "damage", amount: 999 }),
    JSON.stringify({ t: "use", item: "admin_sword" }),
    JSON.stringify({ t: "input", input: { up: true, down: false, left: false, right: false } }),
    JSON.stringify({
      t: "input",
      seq: 0,
      input: { up: true, down: false, left: false, right: false },
    }),
    JSON.stringify({ t: "input", input: { up: "yes" } }),
    JSON.stringify({ t: "chat", text: 42 }),
  ])("rejects untrusted frame %s", (raw) => {
    expect(parseClientMessage(raw)).toBeNull();
  });

  it("rejects binary frames", () => {
    expect(parseClientMessage(new ArrayBuffer(8))).toBeNull();
  });
});

describe("server protocol", () => {
  it("rejects unknown or structurally incomplete messages", () => {
    expect(parseServerMessage(JSON.stringify({ t: "unknown" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ t: "snapshot", players: [] }))).toBeNull();
    expect(parseServerMessage("broken")).toBeNull();
  });
});
