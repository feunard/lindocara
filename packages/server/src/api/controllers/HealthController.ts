import { z } from "alepha";
import { $action } from "alepha/server";

export class HealthController {
  health = $action({
    path: "/health",
    schema: { response: z.object({ ok: z.boolean() }) },
    handler: async () => ({ ok: true }),
  });
}
