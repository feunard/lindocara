import { $module } from "alepha";
import { HealthController } from "./controllers/HealthController.js";
import { MapController } from "./controllers/MapController.js";
import { MeController } from "./controllers/MeController.js";
import { SecurityProvider } from "./providers/SecurityProvider.js";

// `LindocaraApi` is the module every later tranche 1 controller registers
// into. `$module()` already returns a Service class — mirroring
// `apps/lore/src/api/index.ts` (the reference module declaration) rather
// than the brief's class-wrapper sketch, which does not match the real
// `$module` shape (see `.vendor/alepha/src/core/primitives/$module.ts`).
//
// `SecurityProvider` MUST be listed here explicitly (see its own docblock):
// nothing else injects it, so leaving it out means `$realm()` never runs.
export const LindocaraApi = $module({
  name: "lindocara.api",
  services: [HealthController, SecurityProvider, MeController, MapController],
});
