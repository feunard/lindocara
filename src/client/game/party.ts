/**
 * Resolving a typed name to a player id, as a pure function.
 *
 * The server only accepts a UUID for `party.invite` / `party.kick`, and it counts anything else
 * as a malformed frame — five in a row and you are disconnected (MAX_MALFORMED). So `/invite Bob`
 * has to become an id *before* it reaches the socket, or the chat command kicks the player who
 * used it.
 */
import type { PlayerSnapshot } from "../../shared/protocol.js";

export type PartyTargetResolution =
  | { ok: true; playerId: string }
  | { ok: false; reason: "unknown" | "self" };

/**
 * Nearby players are the only ones the client knows about (area of interest), and they are the
 * only ones the server would accept anyway: the party system resolves invitees inside the room.
 *
 * A raw id is passed through, so the roster buttons keep working. A name is matched
 * case-insensitively, because nobody types "Aelwyn" with the capital in the right place.
 */
export function resolvePartyTarget(
  players: readonly PlayerSnapshot[],
  query: string,
  selfId: string | null,
): PartyTargetResolution {
  const wanted = query.trim();
  if (wanted.length === 0) return { ok: false, reason: "unknown" };

  const byId = players.find((player) => player.id === wanted);
  const target =
    byId ?? players.find((player) => player.nick.toLowerCase() === wanted.toLowerCase());
  if (!target) return { ok: false, reason: "unknown" };
  if (target.id === selfId) return { ok: false, reason: "self" };
  return { ok: true, playerId: target.id };
}
