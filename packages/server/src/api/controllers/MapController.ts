/**
 * The maps CRUD API on Alepha: create, list, read, update, delete, flip the front-door flag and
 * write the heightfield. Ported from the `/api/maps*` routes in `packages/server/src/index.ts` (see
 * `:1141`-`:1167` for the route table this mirrors) — every route but the last, which is the remote
 * terrain-seeding escape hatch for an instance whose database this process cannot open.
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
import {
  enforceBodySizeCap,
  MAX_HEIGHTFIELD_JSON_BYTES,
  MAX_MAP_JSON_BYTES,
} from "../bodySizeCap.ts";
import { MapService } from "../services/MapService.ts";
import {
  parseCreateMapBody,
  parseHeightfieldBody,
  parseMapBody,
  rethrowAsMapError,
} from "../services/mapAuthoring.ts";

const mapSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  author: z.string(),
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
    handler: async ({ query, user }) => {
      if (!query.adventure || !isUuid(query.adventure)) {
        throw new HttpError({
          status: 400,
          error: "map_invalid",
          message: "adventure query param required",
        });
      }
      return this.mapService.listMapsForUser(user.id, query.adventure);
    },
  });

  /** `POST /api/maps` body `{adventureId,name,cols?,rows?}` -> 201 `MapPayload` */
  createMap = $action({
    method: "POST",
    path: "/maps",
    use: [$secure({}), $transactional()],
    schema: { body: z.any(), response: z.any() },
    handler: async ({ body, headers, reply, user }) => {
      enforceBodySizeCap(headers, body, MAX_MAP_JSON_BYTES);
      const input = parseCreateMapBody(body);
      if (!input) {
        throw new HttpError({ status: 400, error: "map_invalid", message: "invalid create body" });
      }
      try {
        const created = await this.mapService.createMapForUser(
          user.id,
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
    handler: async ({ params, user }) => {
      try {
        return await this.mapService.getMapForUser(user.id, params.id);
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
    handler: async ({ params, body, headers, user }) => {
      enforceBodySizeCap(headers, body, MAX_MAP_JSON_BYTES);
      const input = parseMapBody(body);
      if (!input) {
        throw new HttpError({ status: 400, error: "map_invalid", message: "invalid map body" });
      }
      const rawHeightfield = (body as { heightfield?: unknown } | null)?.heightfield;
      let heightfield: string | undefined;
      if (rawHeightfield !== undefined) {
        const parsed = parseHeightfieldBody({ heightfield: rawHeightfield });
        if (!parsed.ok) {
          throw new HttpError({
            status: parsed.status,
            error: parsed.error,
            message: parsed.message,
          });
        }
        heightfield = parsed.heightfield;
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
        return await this.mapService.updateMapForUser(
          user.id,
          params.id,
          heightfield === undefined ? input : { ...input, heightfield },
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
    handler: async ({ params, query, user }) => {
      try {
        await this.mapService.deleteMapForUser(user.id, params.id, {
          force: query.force === "true",
        });
      } catch (error) {
        rethrowAsMapError(error);
      }
    },
  });

  /**
   * `PUT /api/maps/:id/heightfield` body `{heightfield}` -> 204
   *
   * The direct way a generated heightfield reaches a DEPLOYED instance. Normal map saves compile
   * terrain from their authoring document; this route exists for proving maps generated elsewhere.
   *
   * `PUT`, not `POST`: the body IS the resource's whole new state and re-sending it converges on
   * that same state — which is exactly how the seed script is used (regenerate, re-stamp, reload).
   * The map's `revision` still moves on every write, deliberately; see
   * `MapService.saveHeightfield`'s docblock for why skipping that bump would leave a live session
   * drawing the previous terrain forever.
   *
   * Owner-fenced like the rest of the map surface — `MapService.saveHeightfieldForUser`
   * carries the reasoning and the machine code (404 `map_not_found`).
   *
   * Bounded on the STRING, not on the request: `MAX_HEIGHTFIELD_BYTES` (1.5 MiB of decoded
   * heightfield) and no more colliders/spawns/props/events than the grid has cells — both in
   * `parseHeightfieldBody`, because a header cap describes a compressed wire while the framework
   * inflates before this runs. What is stored here is re-sent verbatim in every `welcome`, so an
   * unbounded write is not one map's problem — it is every joining client's.
   */
  saveHeightfield = $action({
    method: "PUT",
    path: "/maps/:id/heightfield",
    use: [$secure({}), $transactional()],
    schema: { params: z.object({ id: z.string() }), body: z.any() },
    handler: async ({ params, body, headers, user }) => {
      // An early exit, NOT the bound. `MAX_HEIGHTFIELD_JSON_BYTES` rather than
      // `MAX_MAP_JSON_BYTES` because the latter equals Alepha's global parser ceiling and would
      // make this line a documented no-op — but this reads `content-length`, which for a
      // `Content-Encoding: gzip` request describes the COMPRESSED wire while the framework inflates
      // before this handler runs. A few KB of gzip therefore satisfies it and still carries
      // megabytes. The real bound is `MAX_HEIGHTFIELD_BYTES`, measured by `parseHeightfieldBody`
      // on the decoded string; this only spares the parse for a large uncompressed body.
      enforceBodySizeCap(headers, body, MAX_HEIGHTFIELD_JSON_BYTES);
      // Validated HERE, before the service, for the same reason `updateMap` above parses its own
      // body: this is the wire boundary, and the exact `map_*` code a malformed payload answers
      // with is part of the route's contract (see this file's docblock). The check itself is pure
      // and lives with the other parsers in `mapAuthoring.ts`.
      const parsed = parseHeightfieldBody(body);
      if (!parsed.ok) {
        throw new HttpError({
          status: parsed.status,
          error: parsed.error,
          message: parsed.message,
        });
      }
      try {
        await this.mapService.saveHeightfieldForUser(user.id, params.id, parsed.heightfield);
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
    handler: async ({ params, user }) => {
      try {
        await this.mapService.setFirstMapForUser(user.id, params.id);
      } catch (error) {
        rethrowAsMapError(error);
      }
    },
  });
}
