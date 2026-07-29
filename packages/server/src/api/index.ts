import { $module } from "alepha";
import { HealthController } from "./controllers/HealthController.js";

// `LindocaraApi` is the module every later tranche 1 controller registers
// into. `$module()` already returns a Service class — mirroring
// `apps/lore/src/api/index.ts` (the reference module declaration) rather
// than the brief's class-wrapper sketch, which does not match the real
// `$module` shape (see `.vendor/alepha/src/core/primitives/$module.ts`).
export const LindocaraApi = $module({
  name: "lindocara.api",
  services: [HealthController],
});
