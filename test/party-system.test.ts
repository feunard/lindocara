import type { ServerMessage } from "@lindocara/engine/protocol.js";
import type { PlayerProfile } from "@lindocara/server/profile.js";
import {
  answerPartyInvite,
  broadcastPartyStateIfChanged,
  createParty,
  dissolveParty,
  inviteToParty,
  kickPartyMember,
  leaveParty,
  PARTY_MAX_MEMBERS,
  type PartySystemContext,
  removePlayerFromParties,
  sendPartyChat,
} from "@lindocara/server/world/party-system.js";
import { newPlayer } from "@lindocara/server/world/world-runtime.js";
import { describe, expect, it, vi } from "vitest";

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

  it("lets a member leave, and reassigns leadership when the leader is the one who left", () => {
    const { context, messages } = setup();
    createParty(context, "leader");
    inviteToParty(context, "leader", "member");
    const invite = messages.get("member")?.find((message) => message.t === "party.invite");
    if (invite?.t !== "party.invite") throw new Error("missing invite");
    answerPartyInvite(context, "member", invite.inviteId, true);

    expect(leaveParty(context, "leader")).toBe("left");
    expect(context.partyByPlayerId.has("leader")).toBe(false);
    // The party outlives its founder: the remaining member must inherit it, not be stranded in
    // a party that still names a leader who is gone.
    const party = [...context.parties.values()][0];
    expect(party?.leaderId).toBe("member");
    expect(party?.members.has("member")).toBe(true);
  });

  it("dissolves a party only for its leader, and drops every member's membership", () => {
    const { context, messages } = setup();
    createParty(context, "leader");
    inviteToParty(context, "leader", "member");
    const invite = messages.get("member")?.find((message) => message.t === "party.invite");
    if (invite?.t !== "party.invite") throw new Error("missing invite");
    answerPartyInvite(context, "member", invite.inviteId, true);

    expect(dissolveParty(context, "member")).toBe("forbidden");
    expect(context.parties.size).toBe(1);

    expect(dissolveParty(context, "leader")).toBe("dissolved");
    expect(context.parties.size).toBe(0);
    expect(context.partyByPlayerId.has("leader")).toBe(false);
    expect(context.partyByPlayerId.has("member")).toBe(false);
  });

  it("refuses to grow a party past PARTY_MAX_MEMBERS", () => {
    const { context } = setup();
    createParty(context, "leader");
    const party = [...context.parties.values()][0];
    if (!party) throw new Error("missing party");
    // Fill it to the cap with synthetic ids, then check the next invite is refused rather than
    // silently overflowing.
    for (let index = party.members.size; index < PARTY_MAX_MEMBERS; index++) {
      party.members.add(`filler-${index}`);
      context.partyByPlayerId.set(`filler-${index}`, party.id);
    }
    expect(party.members.size).toBe(PARTY_MAX_MEMBERS);
    expect(inviteToParty(context, "leader", "member")).toBe("full");
  });

  it("does not rebroadcast an unchanged party, but does send when a member's hp drops", () => {
    const { context, messages } = setup();
    createParty(context, "leader");
    const party = [...context.parties.values()][0];
    if (!party) throw new Error("missing party");

    broadcastPartyStateIfChanged(context, party);
    const afterFirst = messages.get("leader")?.filter((m) => m.t === "party.state").length ?? 0;
    expect(afterFirst).toBeGreaterThan(0);

    // The tick loop calls this 10x/s; an unchanged party must cost nothing.
    broadcastPartyStateIfChanged(context, party);
    broadcastPartyStateIfChanged(context, party);
    expect(messages.get("leader")?.filter((m) => m.t === "party.state").length).toBe(afterFirst);

    const leader = context.playersById.get("leader");
    if (!leader) throw new Error("missing leader");
    leader.hp = 12;
    broadcastPartyStateIfChanged(context, party);
    expect(messages.get("leader")?.filter((m) => m.t === "party.state").length).toBe(
      afterFirst + 1,
    );
  });
});
