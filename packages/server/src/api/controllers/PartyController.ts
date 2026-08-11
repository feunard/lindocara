/**
 * The parties API on Alepha: cursor-paginated public listing, create-from-any-adventure (server-
 * assigned colour, creator auto-joined), join (colour server-assigned, never client-chosen),
 * member abandonment, and host-only delete. Ported from the `/api/parties*` routes in
 * `packages/server/src/index.ts`
 * (`:971`-`:1037`), same loose-schema idiom as `MapController`/`AdventureController` — see
 * `MapController`'s own docblock for why `join`/`delete` declare no body schema and `createParty`'s
 * body is `z.any()` rather than a tight shape: the real semantic gate is `PartyService` + the ported
 * `rethrowAsPartyError`, not zod.
 */
import { parseCreatePartyInput } from "@lindocara/engine/party.js";
import { $inject, z } from "alepha";
import { $transactional } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, HttpError } from "alepha/server";
import { enforceBodySizeCap, MAX_API_JSON_BYTES } from "../bodySizeCap.ts";
import { PartyService } from "../services/PartyService.ts";
import { rethrowAsPartyError } from "../services/partyAuthoring.ts";

export class PartyController {
  partyService = $inject(PartyService);

  /** `GET /api/parties?cursor&limit` -> `{items: PartyListing[], nextCursor: string|null}`. */
  getParties = $action({
    path: "/parties",
    use: [$secure({})],
    schema: {
      query: z.object({ cursor: z.string().optional(), limit: z.string().optional() }),
      response: z.any(),
    },
    handler: async ({ query, user }) => {
      const limit = query.limit === undefined ? undefined : Number(query.limit);
      try {
        return await this.partyService.listPartiesPage(user.id, {
          ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
          ...(limit !== undefined ? { limit } : {}),
        });
      } catch (error) {
        rethrowAsPartyError(error);
      }
    },
  });

  /** `POST /api/parties` body `{adventureId,name?}` -> 201 `StoredParty`. Creator auto-joins with a
   *  server-assigned colour; any client-suppliable `color` on the body is ignored. */
  createParty = $action({
    method: "POST",
    path: "/parties",
    use: [$secure({}), $transactional()],
    schema: { body: z.any(), response: z.any() },
    handler: async ({ body, headers, user, reply }) => {
      enforceBodySizeCap(headers, body, MAX_API_JSON_BYTES);
      const input = parseCreatePartyInput(body);
      if (!input) {
        throw new HttpError({ status: 400, error: "party_invalid", message: "invalid body" });
      }
      try {
        const created = await this.partyService.createParty(user.id, {
          adventureId: input.adventureId,
          name: input.name,
        });
        reply.setStatus(201);
        return created;
      } catch (error) {
        rethrowAsPartyError(error);
      }
    },
  });

  /** `POST /api/parties/:id/join` -> 204. Needs no body: the server assigns the colour. */
  joinParty = $action({
    method: "POST",
    path: "/parties/:id/join",
    use: [$secure({}), $transactional()],
    schema: { params: z.object({ id: z.string() }) },
    handler: async ({ params, user }) => {
      try {
        await this.partyService.joinParty(user.id, params.id);
      } catch (error) {
        rethrowAsPartyError(error);
      }
    },
  });

  /** `DELETE /api/parties/:id/membership` -> 204. Removes only the caller from an open party. */
  abandonParty = $action({
    method: "DELETE",
    path: "/parties/:id/membership",
    use: [$secure({}), $transactional()],
    schema: { params: z.object({ id: z.string() }) },
    handler: async ({ params, user }) => {
      try {
        await this.partyService.abandonParty(user.id, params.id);
      } catch (error) {
        rethrowAsPartyError(error);
      }
    },
  });

  /** `DELETE /api/parties/:id` -> 204. Host-only. */
  deleteParty = $action({
    method: "DELETE",
    path: "/parties/:id",
    use: [$secure({}), $transactional()],
    schema: { params: z.object({ id: z.string() }) },
    handler: async ({ params, user }) => {
      try {
        await this.partyService.deleteParty(user.id, params.id);
      } catch (error) {
        rethrowAsPartyError(error);
      }
    },
  });
}
