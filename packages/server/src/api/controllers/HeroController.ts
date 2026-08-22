/**
 * The heroes API on Alepha, nested under a party: list the caller's own heroes, create one (spawn
 * position server-decided from the party's adventure), and delete the caller's own hero. Ported
 * from the `/api/parties/:id/heroes*` routes in `packages/server/src/index.ts` (`:1039`-`:1082`),
 * same loose-schema idiom as `PartyController`/`MapController`.
 */
import { parseCreateHeroInput } from "@lindocara/engine/hero.js";
import { $inject, z } from "alepha";
import { $transactional } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, HttpError } from "alepha/server";

import { enforceBodySizeCap, MAX_API_JSON_BYTES } from "../bodySizeCap.ts";
import { rethrowAsHeroError } from "../services/heroAuthoring.ts";
import { HeroService } from "../services/HeroService.ts";

export class HeroController {
  heroService = $inject(HeroService);

  /** `GET /api/parties/:id/heroes` -> `StoredHero[]`, scoped to the caller's own heroes. */
  getHeroes = $action({
    path: "/parties/:id/heroes",
    use: [$secure({})],
    schema: { params: z.object({ id: z.string() }), response: z.any() },
    handler: async ({ params, user }) => this.heroService.listHeroes(user.id, params.id),
  });

  /** `POST /api/parties/:id/heroes` body `{name,class}` -> 201 `StoredHero`. Spawn map/position is
   *  server-decided (the party's adventure's first map), never client input. */
  createHero = $action({
    method: "POST",
    path: "/parties/:id/heroes",
    use: [$secure({}), $transactional()],
    schema: { params: z.object({ id: z.string() }), body: z.any(), response: z.any() },
    handler: async ({ params, body, headers, user, reply }) => {
      enforceBodySizeCap(headers, body, MAX_API_JSON_BYTES);
      const input = parseCreateHeroInput(body);
      if (!input) {
        throw new HttpError({ status: 400, error: "hero_invalid", message: "invalid body" });
      }
      try {
        const created = await this.heroService.createHero(user.id, params.id, input);
        reply.setStatus(201);
        return created;
      } catch (error) {
        rethrowAsHeroError(error);
      }
    },
  });

  /** `DELETE /api/parties/:pid/heroes/:hid` -> 204. Only the caller's own hero. */
  deleteHero = $action({
    method: "DELETE",
    path: "/parties/:pid/heroes/:hid",
    use: [$secure({}), $transactional()],
    schema: { params: z.object({ pid: z.string(), hid: z.string() }) },
    handler: async ({ params, user }) => {
      try {
        await this.heroService.deleteHero(user.id, params.pid, params.hid);
      } catch (error) {
        rethrowAsHeroError(error);
      }
    },
  });
}
