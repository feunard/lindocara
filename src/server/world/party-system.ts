import { maxHpForLevel } from "@lindocara/engine/game.js";
import type { PartyState, ServerMessage } from "@lindocara/engine/protocol.js";
import type { PlayerRuntime } from "./world-runtime.js";

export const PARTY_MAX_MEMBERS = 5;
export const PARTY_INVITE_TTL_MS = 30_000;

export interface PartyRuntime {
  id: string;
  leaderId: string;
  members: Set<string>;
  /** The last state actually sent, so an unchanged party costs nothing to rebroadcast. */
  lastBroadcast?: string;
}

export interface PartyInviteRuntime {
  id: string;
  partyId: string;
  inviterId: string;
  inviteeId: string;
  expiresAt: number;
}

export interface PartySystemContext {
  parties: Map<string, PartyRuntime>;
  partyByPlayerId: Map<string, string>;
  invites: Map<string, PartyInviteRuntime>;
  playersById: Map<string, PlayerRuntime>;
  socketByPlayerId: Map<string, WebSocket>;
  send(socket: WebSocket, message: ServerMessage): void;
  now(): number;
}

export type PartyResult =
  | "created"
  | "invited"
  | "joined"
  | "refused"
  | "left"
  | "kicked"
  | "dissolved"
  | "invalid"
  | "forbidden"
  | "full";

export function createParty(context: PartySystemContext, leaderId: string): PartyResult {
  if (context.partyByPlayerId.has(leaderId)) return "invalid";
  const party: PartyRuntime = { id: crypto.randomUUID(), leaderId, members: new Set([leaderId]) };
  context.parties.set(party.id, party);
  context.partyByPlayerId.set(leaderId, party.id);
  broadcastPartyState(context, party);
  return "created";
}

export function inviteToParty(
  context: PartySystemContext,
  inviterId: string,
  inviteeId: string,
): PartyResult {
  const party = partyFor(context, inviterId);
  const invitee = context.playersById.get(inviteeId);
  if (!party || !invitee || inviterId === inviteeId || context.partyByPlayerId.has(inviteeId))
    return "invalid";
  if (party.leaderId !== inviterId) return "forbidden";
  if (party.members.size >= PARTY_MAX_MEMBERS) return "full";
  const inviter = context.playersById.get(inviterId);
  const socket = context.socketByPlayerId.get(inviteeId);
  if (!inviter || !socket) return "invalid";
  const invite: PartyInviteRuntime = {
    id: crypto.randomUUID(),
    partyId: party.id,
    inviterId,
    inviteeId,
    expiresAt: context.now() + PARTY_INVITE_TTL_MS,
  };
  context.invites.set(inviteeId, invite);
  context.send(socket, {
    t: "party.invite",
    inviteId: invite.id,
    fromId: inviter.id,
    from: inviter.nick,
    expiresAt: invite.expiresAt,
  });
  return "invited";
}

export function answerPartyInvite(
  context: PartySystemContext,
  playerId: string,
  inviteId: string,
  accept: boolean,
): PartyResult {
  const invite = context.invites.get(playerId);
  if (!invite || invite.id !== inviteId || invite.expiresAt <= context.now()) {
    if (invite?.expiresAt !== undefined && invite.expiresAt <= context.now())
      context.invites.delete(playerId);
    return "invalid";
  }
  context.invites.delete(playerId);
  if (!accept) return "refused";
  if (context.partyByPlayerId.has(playerId)) return "invalid";
  const party = context.parties.get(invite.partyId);
  if (!party || party.leaderId !== invite.inviterId) return "invalid";
  if (party.members.size >= PARTY_MAX_MEMBERS) return "full";
  party.members.add(playerId);
  context.partyByPlayerId.set(playerId, party.id);
  broadcastPartyState(context, party);
  return "joined";
}

export function leaveParty(context: PartySystemContext, playerId: string): PartyResult {
  const party = partyFor(context, playerId);
  if (!party) return "invalid";
  removeMember(context, party, playerId);
  return party.members.size === 0 ? "dissolved" : "left";
}

export function kickPartyMember(
  context: PartySystemContext,
  leaderId: string,
  playerId: string,
): PartyResult {
  const party = partyFor(context, leaderId);
  if (!party?.members.has(playerId) || playerId === leaderId) return "invalid";
  if (party.leaderId !== leaderId) return "forbidden";
  removeMember(context, party, playerId);
  return "kicked";
}

export function dissolveParty(context: PartySystemContext, leaderId: string): PartyResult {
  const party = partyFor(context, leaderId);
  if (!party) return "invalid";
  if (party.leaderId !== leaderId) return "forbidden";
  for (const memberId of party.members) {
    context.partyByPlayerId.delete(memberId);
    sendPartyState(context, memberId, null);
  }
  context.parties.delete(party.id);
  clearPartyInvites(context, party.id);
  return "dissolved";
}

export function removePlayerFromParties(context: PartySystemContext, playerId: string): void {
  context.invites.delete(playerId);
  for (const [inviteeId, invite] of context.invites) {
    if (invite.inviterId === playerId) context.invites.delete(inviteeId);
  }
  const party = partyFor(context, playerId);
  if (party) removeMember(context, party, playerId);
}

export function sendPartyChat(
  context: PartySystemContext,
  sender: PlayerRuntime,
  text: string,
): boolean {
  const party = partyFor(context, sender.id);
  if (!party) return false;
  for (const memberId of party.members) {
    const socket = context.socketByPlayerId.get(memberId);
    if (socket) context.send(socket, { t: "chat", channel: "party", from: sender.nick, text });
  }
  return true;
}

export function broadcastPartyState(context: PartySystemContext, party: PartyRuntime): void {
  const state = partyState(context, party);
  party.lastBroadcast = JSON.stringify(state);
  for (const memberId of party.members) sendPartyState(context, memberId, state);
}

/**
 * The tick loop rebroadcasts every party on every snapshot tick, and `partyState()` rebuilds its
 * array each call — so the payload is usually identical to the last one. Sending it anyway costs
 * bandwidth for every member of every party, forever, whether or not anything happened.
 */
export function broadcastPartyStateIfChanged(
  context: PartySystemContext,
  party: PartyRuntime,
): void {
  const state = partyState(context, party);
  const encoded = JSON.stringify(state);
  if (encoded === party.lastBroadcast) return;
  party.lastBroadcast = encoded;
  for (const memberId of party.members) sendPartyState(context, memberId, state);
}

export function partyIdFor(context: PartySystemContext, playerId: string): string | undefined {
  return context.partyByPlayerId.get(playerId);
}

function partyFor(context: PartySystemContext, playerId: string): PartyRuntime | undefined {
  const id = context.partyByPlayerId.get(playerId);
  return id ? context.parties.get(id) : undefined;
}

function removeMember(context: PartySystemContext, party: PartyRuntime, playerId: string): void {
  party.members.delete(playerId);
  context.partyByPlayerId.delete(playerId);
  sendPartyState(context, playerId, null);
  if (party.members.size === 0) {
    context.parties.delete(party.id);
    clearPartyInvites(context, party.id);
    return;
  }
  if (party.leaderId === playerId) party.leaderId = [...party.members].sort()[0] ?? party.leaderId;
  broadcastPartyState(context, party);
}

function memberState(player: PlayerRuntime): PartyState["members"][number] {
  return {
    id: player.id,
    nick: player.nick,
    hp: player.hp,
    maxHp: maxHpForLevel(player.level),
    life: player.life,
  };
}

function partyState(context: PartySystemContext, party: PartyRuntime): PartyState {
  return {
    id: party.id,
    leaderId: party.leaderId,
    members: [...party.members].sort().flatMap((id) => {
      const player = context.playersById.get(id);
      return player ? [memberState(player)] : [];
    }),
  };
}

/**
 * The roster a hero sees: the persistent party its room is named after.
 *
 * A hero room is keyed `${partyId}:${mapId}` and admission refuses any other room key, so every
 * hero simulated here belongs to the same persistent party by construction. Heroes cannot build an
 * in-room party either — `party.*` is refused for them — so `parties`/`partyByPlayerId` stay
 * permanently empty in a hero room and a roster read from them would say "you adventure alone".
 *
 * `leaderId` is deliberately empty. A persistent party's leader is its host ACCOUNT
 * (`party.host_account_id`), and `PartyState.leaderId` is a player id; one account may own up to
 * `MAX_HEROES_PER_PARTY` heroes and may have none of them in this room, so no hero here faithfully
 * stands for it. Naming an arbitrary one would invent a leader the persistent model does not have.
 *
 * Members are the heroes in THIS room. A party spread over several maps has one room per map and
 * no room can see another's occupants; fanning a party-wide roster out is `GameSession`'s job.
 */
export function heroPartyState(partyId: string, members: readonly PlayerRuntime[]): PartyState {
  return {
    id: partyId,
    leaderId: "",
    members: [...members].sort((a, b) => a.id.localeCompare(b.id)).map(memberState),
  };
}

function sendPartyState(
  context: PartySystemContext,
  playerId: string,
  party: PartyState | null,
): void {
  const socket = context.socketByPlayerId.get(playerId);
  if (socket) context.send(socket, { t: "party.state", party });
}

function clearPartyInvites(context: PartySystemContext, partyId: string): void {
  for (const [inviteeId, invite] of context.invites) {
    if (invite.partyId === partyId) context.invites.delete(inviteeId);
  }
}
