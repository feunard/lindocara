import { describe, expect, it, vi } from "vitest";
import type { PlayerProfile } from "../src/server/profile.js";
import {
  answerPartyInvite,
  createParty,
  inviteToParty,
  kickPartyMember,
  type PartySystemContext,
  removePlayerFromParties,
  sendPartyChat,
} from "../src/server/world/party-system.js";
import { newPlayer } from "../src/server/world/world-runtime.js";
import type { ServerMessage } from "../src/shared/protocol.js";

function profile(id: string): PlayerProfile {
  return {
    id,
    nick: id,
    x: 0,
    y: 0,
    level: 1,
    xp: 0,
    hp: 100,
    appearance: { body: "wayfarer", primaryColor: "azure" },
    class: "warrior",
    equipment: { mainHand: "weathered_sword", offHand: "oak_shield" },
    inventory: { potions: 0, gold: 0, crystals: 0 },
    quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
    zoneId: "verdant-reach",
    instanceId: "main",
    sessionEpoch: 1,
    wardRunExpiresAt: null,
    life: "alive",
    corpse: null,
  };
}

function setup() {
  const messages = new Map<string, ServerMessage[]>();
  const sockets = new Map<string, WebSocket>();
  const players = new Map();
  for (const id of ["leader", "member", "outsider"]) {
    const socket = { id } as unknown as WebSocket;
    sockets.set(id, socket);
    players.set(id, newPlayer(profile(id), id, "room"));
    messages.set(id, []);
  }
  const context: PartySystemContext = {
    parties: new Map(),
    partyByPlayerId: new Map(),
    invites: new Map(),
    playersById: players,
    socketByPlayerId: sockets,
    send: (socket, message) =>
      messages.get((socket as unknown as { id: string }).id)?.push(message),
    now: vi.fn(() => 100),
  };
  return { context, messages };
}

describe("temporary parties", () => {
  it("accepts a valid invitation and rejects a forged one", () => {
    const { context, messages } = setup();
    expect(createParty(context, "leader")).toBe("created");
    expect(inviteToParty(context, "leader", "member")).toBe("invited");
    expect(answerPartyInvite(context, "member", "forged", true)).toBe("invalid");
    const invite = messages.get("member")?.find((message) => message.t === "party.invite");
    expect(invite?.t).toBe("party.invite");
    if (invite?.t !== "party.invite") throw new Error("missing invite");
    expect(answerPartyInvite(context, "member", invite.inviteId, true)).toBe("joined");
  });

  it("allows only the leader to kick", () => {
    const { context, messages } = setup();
    createParty(context, "leader");
    inviteToParty(context, "leader", "member");
    const invite = messages.get("member")?.find((message) => message.t === "party.invite");
    if (invite?.t !== "party.invite") throw new Error("missing invite");
    answerPartyInvite(context, "member", invite.inviteId, true);
    expect(kickPartyMember(context, "member", "leader")).toBe("forbidden");
    expect(kickPartyMember(context, "leader", "member")).toBe("kicked");
  });

  it("sends party chat only to members and cleans membership on disconnect", () => {
    const { context, messages } = setup();
    createParty(context, "leader");
    inviteToParty(context, "leader", "member");
    const invite = messages.get("member")?.find((message) => message.t === "party.invite");
    if (invite?.t !== "party.invite") throw new Error("missing invite");
    answerPartyInvite(context, "member", invite.inviteId, true);
    for (const bucket of messages.values()) bucket.length = 0;
    const leader = context.playersById.get("leader");
    if (!leader) throw new Error("missing leader");
    expect(sendPartyChat(context, leader, "hello")).toBe(true);
    expect(messages.get("leader")?.some((message) => message.t === "chat")).toBe(true);
    expect(messages.get("member")?.some((message) => message.t === "chat")).toBe(true);
    expect(messages.get("outsider")).toHaveLength(0);
    removePlayerFromParties(context, "member");
    expect(context.partyByPlayerId.has("member")).toBe(false);
  });
});
