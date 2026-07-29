/**
 * The maps CRUD API on Alepha: create, list, read, update, delete and flip the front-door flag.
 * Ported from the `/api/maps*` routes in `packages/server/src/index.ts` (see `:1141`-`:1167` for the
 * route table this mirrors).
 *
 * Every body/query/params schema below is deliberately LOOSE (`z.any()`/plain optional
 * `z.string()`), never the tight shape a client actually sends. Two reasons, both load-bearing:
 *
 * - **Ordering.** Alepha runs schema validation before `use: [$secure({})]` gets a chance to reject
 *   an unauthenticated caller (see `ActionPrimitive.run`, `.vendor/alepha/src/server/core/
 *   primitives/$action.ts`). A strict `params.id: z.uuid()` would 400 a non-uuid id like the retired
 *   `BUILTIN_MAP_ID` sentinel or the literal `"whatever"` `maps-api.test.ts`'s session-gate test
 *   sends — BEFORE the 401 that same test (and the builtin-floor 404 test) requires ever runs.
 * - **Exact machine codes.** Legacy validation is deliberately "shape only" at the wire boundary
 *   (`parseMapData`'s own docblock) — the real semantic gate is `validateMapInput`, ported to
 *   `mapAuthoring.ts`. A zod-enforced body schema would answer a malformed payload with whatever
 *   generic validation-error shape Alepha produces, not the exact `map_invalid`/`map_name`/
 *   `map_size`/... family the brief requires. So every field is parsed and validated by hand here
 *   (via `mapAuthoring.ts`'s ported `parseMapBody`/`parseCreateMapBody`/`validateMapInput`) and
 *   every failure is re-thrown as the exact legacy `HttpError` by `rethrowAsMapError`.
 */
import { type AdventureInput, parseAdventureInput } from "@lindocara/engine/adventure.js";
import { isUuid } from "@lindocara/engine/identifiers.js";
import { $inject, z } from "alepha";
import { $transactional } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, HttpError } from "alepha/server";
import { enforceBodySizeCap, MAX_MAP_JSON_BYTES } from "../bodySizeCap.ts";
import { MapService } from "../services/MapService.ts";
import { parseCreateMapBody, parseMapBody, rethrowAsMapError } from "../services/mapAuthoring.ts";

const mapSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  revision: z.integer(),
  cols: z.integer(),
  rows: z.integer(),
  isFirst: z.boolean(),
});

export class MapController {
  mapService = $inject(MapService);

  /** `GET /api/maps?adventure=<uuid>` */
  getMaps = $action({
    path: "/maps",
    use: [$secure({})],
    schema: {
      query: z.object({ adventure: z.string().optional() }),
      response: z.array(mapSummarySchema),
    },
    handler: async ({ query }) => {
      if (!query.adventure || !isUuid(query.adventure)) {
        throw new HttpError({
          status: 400,
          error: "map_invalid",
          message: "adventure query param required",
        });
      }
      return this.mapService.listMaps(query.adventure);
    },
  });

  /** `POST /api/maps` body `{adventureId,name,cols?,rows?}` -> 201 `MapPayload` */
  createMap = $action({
    method: "POST",
    path: "/maps",
    use: [$secure({}), $transactional()],
    schema: { body: z.any(), response: z.any() },
    handler: async ({ body, headers, reply }) => {
      enforceBodySizeCap(headers, body, MAX_MAP_JSON_BYTES);
      const input = parseCreateMapBody(body);
      if (!input) {
        throw new HttpError({ status: 400, error: "map_invalid", message: "invalid create body" });
      }
      try {
        const created = await this.mapService.createMap(
          input.adventureId,
          input.name,
          input.cols,
          input.rows,
        );
        reply.setStatus(201);
        return created;
      } catch (error) {
        rethrowAsMapError(error);
      }
    },
  });

  /** `GET /api/maps/:id` */
  getMap = $action({
    path: "/maps/:id",
    use: [$secure({})],
    schema: { params: z.object({ id: z.string() }), response: z.any() },
    handler: async ({ params }) => {
      try {
        return await this.mapService.getMap(params.id);
      } catch (error) {
        rethrowAsMapError(error);
      }
    },
  });

  /** `PUT /api/maps/:id` body `MapSaveInput & {adventure?, expectedRevision?}` -> `MapPayload` */
  updateMap = $action({
    method: "PUT",
    path: "/maps/:id",
    use: [$secure({}), $transactional()],
    schema: { params: z.object({ id: z.string() }), body: z.any(), response: z.any() },
    handler: async ({ params, body, headers }) => {
      enforceBodySizeCap(headers, body, MAX_MAP_JSON_BYTES);
      const input = parseMapBody(body);
      if (!input) {
        throw new HttpError({ status: 400, error: "map_invalid", message: "invalid map body" });
      }
      const rawAdventure = (body as { adventure?: unknown } | null)?.adventure;
      let proposedAdventure: AdventureInput | undefined;
      if (rawAdventure !== undefined) {
        const parsed = parseAdventureInput(rawAdventure);
        if (!parsed) {
          throw new HttpError({
            status: 400,
            error: "adventure_invalid",
            message: "invalid adventure",
          });
        }
        proposedAdventure = parsed;
      }
      const rawExpectedRevision = (body as { expectedRevision?: unknown } | null)?.expectedRevision;
      let expectedRevision: number | undefined;
      if (rawExpectedRevision !== undefined) {
        if (!Number.isSafeInteger(rawExpectedRevision) || (rawExpectedRevision as number) < 1) {
          throw new HttpError({
            status: 400,
            error: "map_invalid",
            message: "invalid expectedRevision",
          });
        }
        expectedRevision = rawExpectedRevision as number;
      }
      try {
        return await this.mapService.updateMap(
          params.id,
          input,
          expectedRevision,
          proposedAdventure,
        );
      } catch (error) {
        rethrowAsMapError(error);
      }
    },
  });

  /** `DELETE /api/maps/:id?force=true` -> 204 */
  deleteMap = $action({
    method: "DELETE",
    path: "/maps/:id",
    use: [$secure({}), $transactional()],
    schema: {
      params: z.object({ id: z.string() }),
      query: z.object({ force: z.string().optional() }),
    },
    handler: async ({ params, query }) => {
      try {
        await this.mapService.deleteMap(params.id, { force: query.force === "true" });
      } catch (error) {
        rethrowAsMapError(error);
      }
    },
  });

  /** `POST /api/maps/:id/first` -> 204 */
  setFirst = $action({
    method: "POST",
    path: "/maps/:id/first",
    use: [$secure({}), $transactional()],
    schema: { params: z.object({ id: z.string() }) },
    handler: async ({ params }) => {
      try {
        await this.mapService.setFirstMap(params.id);
      } catch (error) {
        rethrowAsMapError(error);
      }
    },
  });
}
