import { DurableObject } from "cloudflare:workers";
import type { ServerMessage } from "../shared/protocol.js";

/**
 * Durable coordinator addressed by party id. It owns the persistent session directory and fans
 * party-wide messages out to the currently loaded map rooms. Simulation remains in the existing
 * World room implementation, which keeps the proven combat/tick systems isolated by
 * `${partyId}:${mapId}` while making the party, rather than a global map, the routing root.
 */
export class GameSession extends DurableObject<Env> {
  async #rememberRoom(partyId: string, roomKey: string): Promise<void> {
    const storedPartyId = await this.ctx.storage.get<string>("partyId");
    if (storedPartyId !== undefined && storedPartyId !== partyId) {
      throw new Error("game session party identity mismatch");
    }
    const rooms = new Set((await this.ctx.storage.get<string[]>("rooms")) ?? []);
    rooms.add(roomKey);
    await this.ctx.storage.put({ partyId, rooms: [...rooms] });
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    const partyId = request.headers.get("x-party-id");
    const roomKey = request.headers.get("x-room-key");
    const mapId = request.headers.get("x-zone-id");
    if (!partyId || !roomKey || !mapId || roomKey !== `${partyId}:${mapId}`) {
      return new Response("invalid game session room", { status: 400 });
    }
    await this.#rememberRoom(partyId, roomKey);
    return this.env.WORLD.getByName(roomKey).fetch(request);
  }

  /** Party chat and victory use this path; no browser message can call it directly. */
  async broadcast(partyId: string, message: ServerMessage): Promise<void> {
    const storedPartyId = await this.ctx.storage.get<string>("partyId");
    if (storedPartyId !== partyId) return;
    const rooms = (await this.ctx.storage.get<string[]>("rooms")) ?? [];
    await Promise.all(
      rooms.map((roomKey) => this.env.WORLD.getByName(roomKey).broadcastParty(partyId, message)),
    );
  }
}
