import { randomInt } from "node:crypto";
import { BODY_PARSER_OPTIONS_SEED } from "@lindocara/server/api/bodySizeCap.js";
import { LindocaraApi } from "@lindocara/server/api/index.js";
import { Alepha } from "alepha";
import { NodeHttpServerProvider, ServerProvider } from "alepha/server";

// Fetch follows the WHATWG blocked-port list, whose highest reserved port is 10080. Windows may
// allocate port 0 from a dynamic range beginning at 1024, so an otherwise healthy test server can
// sporadically receive (for example) port 6000 and every action then fails with `fetch: bad port`.
// Select from the safe range and retry collisions across Vitest workers without patching the
// vendored framework.
const FIRST_FETCH_SAFE_EPHEMERAL_PORT = 10_081;
const MAX_EPHEMERAL_PORT_ATTEMPTS = 64;

class FetchSafeTestHttpServerProvider extends NodeHttpServerProvider {
  protected override async listen(): Promise<void> {
    if (this.alepha.store.get("alepha.node.server")) return;
    if (this.env.SERVER_PORT !== 3000) {
      await super.listen();
      return;
    }

    for (let attempt = 0; attempt < MAX_EPHEMERAL_PORT_ATTEMPTS; attempt += 1) {
      const candidate = randomInt(FIRST_FETCH_SAFE_EPHEMERAL_PORT, 65_536);
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => {
            this.server.removeListener("listening", onListening);
            reject(error);
          };
          const onListening = () => {
            this.server.removeListener("error", onError);
            resolve();
          };
          this.server.once("error", onError);
          this.server.once("listening", onListening);
          this.server.listen(candidate, this.env.SERVER_HOST);
        });
        this.alepha.store.set("alepha.node.server", this.server);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      }
    }

    throw new Error("Unable to allocate a fetch-safe ephemeral test port");
  }
}

/**
 * Starts a fresh Alepha instance wired to the new server API module, against an in-memory
 * database. Every later tranche-1 test imports this rather than re-wiring `Alepha.create()`
 * itself, so the app composition (modules, env) stays in one place as it grows.
 *
 * `BODY_PARSER_OPTIONS_SEED` raises Alepha's global body-size ceiling (default 100_000 bytes) to
 * the 4 MiB this app needs for a map save — see `bodySizeCap.ts`'s docblock for the full story and
 * why per-route caps narrower than that (adventures, small bodies) are enforced separately, inside
 * each route's own handler via `enforceBodySizeCap`. The equivalent WebSocket transport cap
 * (`websocketTransportCap.ts`) is no longer a pre-boot seed: it is read through `$env` by
 * `WebSocketTransportCapProvider`, which `LindocaraApi.services` already registers, so
 * `realtime-transport-cap.test.ts` gets it for free through `LindocaraApi` below.
 *
 * `{ ...BODY_PARSER_OPTIONS_SEED }`, not the shared constant itself: `Alepha.create(state)` hands
 * `state` straight to `new StateManager(state)`, which stores it BY REFERENCE as its whole app
 * store (`.vendor/alepha/src/core/providers/StateManager.ts`'s constructor is a bare
 * `this.store = store`, no clone) — and `Alepha.create()` itself mutates that same object
 * (`state.env = {...}`). Passing the module-level seed object directly would make every test's
 * "fresh" Alepha instance share the literal same store object with every other test that ran
 * before it in this process, leaking server handles, DB state and everything else through it. A
 * shallow copy per call keeps only the (never-mutated) nested options values shared, which is
 * safe.
 *
 * `WorldRoom.env` (`NAVIGATION_DEBUG`/`CHEATS_ENABLED`) resolves through `$env` too, which caches
 * per Alepha instance — set `process.env.CHEATS_ENABLED` BEFORE calling this, never after
 * `.start()`, or the room will keep whatever value was current at boot (matching real Cloudflare
 * Workers semantics: there is no live env to mutate mid-request). A test needing a different
 * value than the one already booted must `await alepha.stop()` and call this again.
 */
export function createTestApp() {
  process.env.DATABASE_URL = ":memory:";
  return Alepha.create({ ...BODY_PARSER_OPTIONS_SEED })
    .with({ provide: ServerProvider, use: FetchSafeTestHttpServerProvider })
    .with(LindocaraApi);
}

/** The side of {@link provingHeightfield}'s grid, in cells. */
export const PROVING_SIZE = 16;

/**
 * A flat, entirely walkable heightfield with one spawn at the grid centre.
 *
 * **Every suite that opens a real `/ws/world` needs one.** A map with no usable heightfield cannot
 * produce a zone at all (`zoneFromMapPayload` throws, `WorldRoom.createState` catches it into a
 * `location: null` state), so every join of a map created through `POST /api/adventures` — which
 * seeds a tile map and no heightfield — is refused 4007. Storing this on the adventure's default
 * map (`MapService.saveHeightfield`) is what makes such a room joinable.
 *
 * Deliberately featureless: level-0 ground everywhere, no water, no colliders. Nothing about the
 * terrain can make a movement, combat or persistence test fail for a reason that has nothing to do
 * with what it is asserting. A suite that needs relief builds its own grid instead of tuning this.
 *
 * `spawn` defaults to the grid CENTRE, which is `0, 0` in tile units — and that default is a trap
 * for any test asserting the world's UNITS rather than its rules. Zero times any scale factor is
 * still zero, so a hero standing on it satisfies a bound like `|x| <= size / 2` whether the wire is
 * shipping tiles or pixels. A test whose subject is the units must ask for an off-centre spawn.
 */
export function provingHeightfield(
  size = PROVING_SIZE,
  spawn: { x: number; z: number } = { x: 0, z: 0 },
): string {
  return JSON.stringify({
    version: 1,
    size,
    levelHeight: 0.9,
    waterLevel: -0.05,
    levels: new Array(size * size).fill(0),
    materials: new Array(size * size).fill("herbe"),
    colliders: [],
    spawns: [{ name: "default", x: spawn.x, z: spawn.z }],
    elements: [],
    events: [],
  });
}
