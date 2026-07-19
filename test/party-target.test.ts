import { describe, expect, it } from "vitest";
import { resolvePartyTarget } from "../src/client/game/party.js";
import type { PlayerSnapshot } from "../src/shared/protocol.js";

function player(id: string, nick: string): PlayerSnapshot {
  return {
    id,
    nick,
    x: 0,
    y: 0,
    ack: 0,
    hp: 100,
    maxHp: 100,
    level: 1,
    appearance: { body: "wayfarer", primaryColor: "azure" },
    class: "warrior",
    equipment: { mainHand: "weathered_sword", offHand: "oak_shield" },
    life: "alive",
    facing: { x: 1, y: 0 },
    action: null,
  };
}

const SELF = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

const players = [player(SELF, "Aelwyn"), player(BOB, "Bob")];

describe("resolving a party target", () => {
  // The server only accepts a UUID and counts anything else as a malformed frame; five in a row
  // disconnect you. So `/invite Bob` must resolve to an id on the client or the command kicks
  // the player who used it.
  it("resolves a typed nickname to that player's id", () => {
    expect(resolvePartyTarget(players, "Bob", SELF)).toEqual({ ok: true, playerId: BOB });
  });

  it("matches a nickname case-insensitively, because nobody types the capitals right", () => {
    expect(resolvePartyTarget(players, "bOb", SELF)).toEqual({ ok: true, playerId: BOB });
  });

  it("passes a raw id straight through, so the roster buttons keep working", () => {
    expect(resolvePartyTarget(players, BOB, SELF)).toEqual({ ok: true, playerId: BOB });
  });

  it("reports an unknown name rather than sending it and getting the player kicked", () => {
    expect(resolvePartyTarget(players, "Nobody", SELF)).toEqual({ ok: false, reason: "unknown" });
  });

  it("refuses to target yourself", () => {
    expect(resolvePartyTarget(players, "Aelwyn", SELF)).toEqual({ ok: false, reason: "self" });
    expect(resolvePartyTarget(players, SELF, SELF)).toEqual({ ok: false, reason: "self" });
  });

  it("treats an empty or whitespace-only query as unknown", () => {
    expect(resolvePartyTarget(players, "   ", SELF)).toEqual({ ok: false, reason: "unknown" });
  });

  it("trims what the player typed", () => {
    expect(resolvePartyTarget(players, "  Bob  ", SELF)).toEqual({ ok: true, playerId: BOB });
  });
});
