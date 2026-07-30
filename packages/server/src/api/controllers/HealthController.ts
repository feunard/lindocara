import { z } from "alepha";
import { $action } from "alepha/server";

export class HealthController {
  /**
   * Named `apiHealth` (not `health`) because Alepha's own ServerHealthProvider
   * registers a `health` route in the workerd graph — duplicate action names
   * fail the ServerLinksProvider configure hook at boot.
   */
  apiHealth = $action({
    path: "/health",
    schema: { response: z.object({ ok: z.boolean() }) },
    handler: async () => ({ ok: true }),
  });
}
