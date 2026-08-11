/**
 * The adventures CRUD API on Alepha: create (with its atomic default map), list, read, update and
 * delete. Ported from the `/api/adventures*` routes in `packages/server/src/index.ts` (`:828`-
 * `:969`), same idiom as `MapController` — see that controller's docblock for why every body/query/
 * params schema below is deliberately LOOSE rather than the tight shape a client actually sends.
 */
import {
  type AdventureInput,
  parseAdventureInput,
  parseCreateAdventureInput,
} from "@lindocara/engine/adventure.js";
import { $inject, z } from "alepha";
import { $transactional } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, HttpError } from "alepha/server";
import {
  enforceBodySizeCap,
  MAX_ADVENTURE_JSON_BYTES,
  MAX_MAP_JSON_BYTES,
} from "../bodySizeCap.ts";
import { AdventureService } from "../services/AdventureService.ts";
import { rethrowAsAdventureError } from "../services/adventureAuthoring.ts";
import { type MapInput, parseMapBody, rethrowAsMapError } from "../services/mapAuthoring.ts";

const adventureSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  maxPlayers: z.integer(),
  mapCount: z.integer(),
  playable: z.boolean(),
  author: z.string().optional(),
});

/**
 * A create carrying a sandbox map can fail in either half — the adventure shell (`title:`,
 * `players:`) or the map itself (`name:`, `size:`, `spawn:`, ...) — and each family has its own
 * exact machine code. Both mappers rethrow what they do not recognise, so the map mapper runs only
 * on what the adventure mapper let through, and an unknown prefix still escapes as a 500 exactly
 * as it did before either ran.
 */
function rethrowAsCreateAdventureError(error: unknown): never {
  try {
    rethrowAsAdventureError(error);
  } catch (mapped) {
    if (mapped instanceof HttpError) throw mapped;
  }
  rethrowAsMapError(error);
}

export class AdventureController {
  adventureService = $inject(AdventureService);

  /** `GET /api/adventures?scope=play|all` -> `AdventureSummary[]`. Default (no `scope`) is the
   *  owner-scoped editor listing; `scope=all` is the collaborative picker; `scope=play` is the
   *  play-flow "New adventure" carousel — both collaborative listings carry `author`. */
  getAdventures = $action({
    path: "/adventures",
    use: [$secure({})],
    schema: {
      query: z.object({ scope: z.string().optional() }),
      response: z.array(adventureSummarySchema),
    },
    handler: async ({ query, user }) => {
      if (query.scope === "play") return this.adventureService.listPlayableAdventures();
      if (query.scope === "all") return this.adventureService.listAllAdventures();
      return this.adventureService.listAdventures(user.id);
    },
  });

  /** `POST /api/adventures` body `{title,maxPlayers,audio?,registry?,map?}` -> 201
   *  `AdventurePayload & {defaultMap}`. Atomic: the adventure and its default map are created in one
   *  transaction. An optional `map` is the editor's unsaved sandbox reaching its first save — it
   *  becomes the adventure's one map instead of the blank template, in that same transaction. */
  createAdventure = $action({
    method: "POST",
    path: "/adventures",
    use: [$secure({}), $transactional()],
    schema: { body: z.any(), response: z.any() },
    handler: async ({ body, headers, user, reply }) => {
      const rawMap = (body as { map?: unknown } | null)?.map;
      // A body carrying a whole map is a MAP-sized body, not a 64 KiB adventure shell — the same
      // ceiling `PUT /api/maps/:id` enforces, since that is what this request replaces.
      enforceBodySizeCap(
        headers,
        body,
        rawMap === undefined ? MAX_ADVENTURE_JSON_BYTES : MAX_MAP_JSON_BYTES,
      );
      const input = parseCreateAdventureInput(body);
      if (!input) {
        throw new HttpError({ status: 400, error: "adventure_invalid", message: "invalid body" });
      }
      let firstMap: MapInput | undefined;
      if (rawMap !== undefined) {
        const parsed = parseMapBody(rawMap);
        if (!parsed) {
          throw new HttpError({ status: 400, error: "map_invalid", message: "invalid map body" });
        }
        firstMap = parsed;
      }
      try {
        const { adventure, map } = await this.adventureService.createAdventureWithDefaultMap(
          user.id,
          input,
          firstMap,
        );
        reply.setStatus(201);
        return { ...adventure, defaultMap: map };
      } catch (error) {
        rethrowAsCreateAdventureError(error);
      }
    },
  });

  /** `GET /api/adventures/:id` -> `AdventurePayload`. Collaborative: readable by any authenticated
   *  account (the play flow opens anyone's adventure). */
  getAdventure = $action({
    path: "/adventures/:id",
    use: [$secure({})],
    schema: { params: z.object({ id: z.string() }), response: z.any() },
    handler: async ({ params }) => {
      try {
        return await this.adventureService.getAdventure(params.id);
      } catch (error) {
        rethrowAsAdventureError(error);
      }
    },
  });

  /** `PUT /api/adventures/:id` body `AdventureInput` -> `AdventurePayload`. Collaborative: any
   *  authenticated account may edit. */
  updateAdventure = $action({
    method: "PUT",
    path: "/adventures/:id",
    use: [$secure({}), $transactional()],
    schema: { params: z.object({ id: z.string() }), body: z.any(), response: z.any() },
    handler: async ({ params, body, headers }) => {
      enforceBodySizeCap(headers, body, MAX_ADVENTURE_JSON_BYTES);
      const input: AdventureInput | null = parseAdventureInput(body);
      if (!input) {
        throw new HttpError({ status: 400, error: "adventure_invalid", message: "invalid body" });
      }
      try {
        return await this.adventureService.updateAdventure(params.id, input);
      } catch (error) {
        rethrowAsAdventureError(error);
      }
    },
  });

  /** `DELETE /api/adventures/:id?force=true` -> 204. */
  deleteAdventure = $action({
    method: "DELETE",
    path: "/adventures/:id",
    use: [$secure({}), $transactional()],
    schema: {
      params: z.object({ id: z.string() }),
      query: z.object({ force: z.string().optional() }),
    },
    handler: async ({ params, query }) => {
      try {
        await this.adventureService.deleteAdventure(params.id, { force: query.force === "true" });
      } catch (error) {
        rethrowAsAdventureError(error);
      }
    },
  });
}
