import { z } from "alepha";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

/**
 * `GET /api/whoami` — the minimal `$secure`-gated probe every later
 * controller task (Tasks 6-11) depends on: `UnauthorizedError` (401) with no
 * credentials, `{ id }` (the realm's user uuid, from `AppSecurityProvider`'s
 * `$realm`) once authenticated. Kept as a permanent, real endpoint rather
 * than a test-only harness because it proves the exact `$secure({}) ->
 * user.id` seam the rest of the server API is built on.
 */
export class MeController {
  whoami = $action({
    path: "/whoami",
    use: [$secure({})],
    schema: {
      response: z.object({ id: z.string() }),
    },
    handler: ({ user }) => ({ id: user.id }),
  });
}
