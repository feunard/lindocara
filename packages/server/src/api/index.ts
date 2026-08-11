import { $module } from "alepha";
import { CacheProvider } from "alepha/cache";
import { AlephaCacheDatabase, DatabaseCacheProvider } from "alepha/cache/database";
import { AlephaWebSocket } from "alepha/websocket";
import { AdventureController } from "./controllers/AdventureController.js";
import { HealthController } from "./controllers/HealthController.js";
import { HeroController } from "./controllers/HeroController.js";
import { JoinController } from "./controllers/JoinController.js";
import { MapController } from "./controllers/MapController.js";
import { MeController } from "./controllers/MeController.js";
import { PartyController } from "./controllers/PartyController.js";
import { TestSessionController } from "./controllers/TestSessionController.js";
import { AdminRoleProvider } from "./providers/AdminRoleProvider.js";
import { AppSecurityProvider } from "./providers/AppSecurityProvider.js";
import { HeightfieldBackfillProvider } from "./providers/HeightfieldBackfillProvider.js";
import { PartyRoom } from "./realtime/PartyRoom.js";
import { PresenceRoom } from "./realtime/PresenceRoom.js";
import { WorldRoom } from "./realtime/WorldRoom.js";
import { WebSocketTransportCapProvider } from "./websocketTransportCap.js";

// `LindocaraApi` is the module every later tranche 1 controller registers
// into. `$module()` already returns a Service class — mirroring
// `apps/lore/src/api/index.ts` (the reference module declaration) rather
// than the brief's class-wrapper sketch, which does not match the real
// `$module` shape (see `.vendor/alepha/src/core/primitives/$module.ts`).
//
// `AppSecurityProvider` MUST be listed here explicitly (see its own
// docblock): nothing else injects it, so leaving it out means `$realm()`
// never runs.
//
// `AlephaWebSocket` is imported here rather than in `apps/main`: the realtime
// rooms below are this module's services, so the module that registers them
// also brings the runtime that serves their `$room`s (the ws upgrade handler,
// the room engines, the topic fan-out). Without it, `$inject` would fall back
// to the abstract `WebSocketServerProvider` and every room registration would
// crash at startup.
//
// The three realtime rooms MUST be listed (Task 4): nothing else constructs
// them, so an unlisted room means no `/ws/world` endpoint, no presence lease
// authority and no party coordinator in the running app.
//
// `WebSocketTransportCapProvider` MUST also be listed explicitly (see its own
// docblock): nothing else constructs it, so leaving it out means the
// transport-level WebSocket frame cap silently reverts to the framework's
// 1 MiB default instead of this app's 16 KiB one.
//
// The global `CacheProvider` substitution is security-critical. Alepha's
// workerd default is Cloudflare KV, but this app does not provision a KV
// namespace: leaving the default in place makes `SessionService`'s defensive
// login limiter catch the missing-binding error and fail open. The SQL cache
// keeps both IP and account counters strongly consistent in the new D1, while
// `AlephaCacheDatabase` registers the `cache_entries` entity/provider before
// any auth request can use it.
export const LindocaraApi = $module({
  name: "lindocara.api",
  imports: [AlephaWebSocket, AlephaCacheDatabase],
  register: (alepha) => {
    alepha.with({
      provide: CacheProvider,
      use: DatabaseCacheProvider,
    });
  },
  services: [
    HealthController,
    AppSecurityProvider,
    AdminRoleProvider,
    HeightfieldBackfillProvider,
    MeController,
    MapController,
    AdventureController,
    PartyController,
    HeroController,
    TestSessionController,
    JoinController,
    PresenceRoom,
    PartyRoom,
    WorldRoom,
    WebSocketTransportCapProvider,
  ],
});
