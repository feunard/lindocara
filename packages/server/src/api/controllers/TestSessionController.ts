/**
 * Adventure test sessions on Alepha: an editor-owned, disposable playtest that provisions a hidden
 * real party+hero on the caller's chosen adventure/map, exactly like a live game session would, and
 * tears the whole envelope down on delete or replacement. Ported from the
 * `/api/adventures/:id/test-sessions` and `/api/adventure-test-sessions/:id` routes in
 * `packages/server/src/index.ts` (`:846`-`:878`), same loose-schema idiom as
 * `AdventureController`/`PartyController`/`HeroController` — see `MapController`'s own docblock for
 * why every body/params schema below is deliberately LOOSE rather than the tight shape a client
 * actually sends.
 *
 * **Collaborative, not author-only** — see `TestSessionService`'s own docblock for why this
 * deliberately does NOT gate create on `adventure.userId === user.id`, contrary to this task's own
 * brief wording: the legacy source it ports has no such check. `DELETE` IS ownership-fenced (a
 * session's own `userId`), matching legacy.
 *
 * **The 422 diagnostics body is returned directly, not thrown as an `HttpError`.** Alepha's
 * `HttpError`/`errorSchema` (`.vendor/alepha/src/server/core/schemas/errorSchema.ts`) has no
 * arbitrary structured-payload field — only `error`/`status`/`message`/`details` (a plain string)/
 * `requestId`/`cause` — so a `diagnostics: QuestDiagnostic[]` array cannot round-trip through it.
 * The success path already returns a plain object via `reply.setStatus(...)` + a returned value
 * (`response: z.any()`), so the 422 case reuses that same mechanism instead of `HttpError`, exactly
 * matching the legacy Worker route's own `json({error, diagnostics}, {status: 422})`.
 */
import {
  type CreateAdventureTestSessionInput,
  parseCreateAdventureTestSessionInput,
} from "@lindocara/engine/adventure-test.js";
import { $inject, z } from "alepha";
import { $transactional } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, HttpError } from "alepha/server";

import { enforceBodySizeCap, MAX_API_JSON_BYTES } from "../bodySizeCap.ts";
import { rethrowAsTestSessionError } from "../services/testSessionAuthoring.ts";
import { TestSessionService } from "../services/TestSessionService.ts";

export class TestSessionController {
  testSessionService = $inject(TestSessionService);

  /** `POST /api/adventures/:id/test-sessions` body `{startMapId,heroClass,heroBody?}` -> 201
   *  `AdventureTestSession`, or 422 `{error:"adventure_test_invalid", diagnostics}` when the
   *  adventure's authored quests fail validation. */
  createTestSession = $action({
    method: "POST",
    path: "/adventures/:id/test-sessions",
    use: [$secure({}), $transactional()],
    schema: { params: z.object({ id: z.string() }), body: z.any(), response: z.any() },
    handler: async ({ params, body, headers, user, reply }) => {
      enforceBodySizeCap(headers, body, MAX_API_JSON_BYTES);
      const input: CreateAdventureTestSessionInput | null =
        parseCreateAdventureTestSessionInput(body);
      if (!input) {
        throw new HttpError({
          status: 400,
          error: "adventure_test_invalid",
          message: "invalid body",
        });
      }
      try {
        const result = await this.testSessionService.createTestSession(user.id, params.id, input);
        if (!result.ok) {
          reply.setStatus(422);
          return { error: "adventure_test_invalid", diagnostics: result.diagnostics };
        }
        reply.setStatus(201);
        return result.session;
      } catch (error) {
        rethrowAsTestSessionError(error);
      }
    },
  });

  /** `DELETE /api/adventure-test-sessions/:id` -> 204. Ownership-fenced: only the caller's own
   *  session. */
  deleteTestSession = $action({
    method: "DELETE",
    path: "/adventure-test-sessions/:id",
    use: [$secure({}), $transactional()],
    schema: { params: z.object({ id: z.string() }) },
    handler: async ({ params, user }) => {
      try {
        await this.testSessionService.deleteTestSession(user.id, params.id);
      } catch (error) {
        rethrowAsTestSessionError(error);
      }
    },
  });
}
