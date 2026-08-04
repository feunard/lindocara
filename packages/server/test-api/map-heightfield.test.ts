/**
 * The `maps.heightfield` column round-tripped through `MapService`, ahead of Task 5 wiring it
 * onto the wire. Only a service-level check: no controller route authors this yet (see
 * `MapService.saveHeightfield`'s docblock) — the write path exists purely so the Task 5 generator
 * script has somewhere to put a heightfield.
 *
 * Uses `MapService` directly (`alepha.inject`), the same unauthenticated-probe idiom
 * `entities-authoring.test.ts` established for entity-level coverage ahead of a controller route,
 * rather than going through `MapController`'s HTTP surface, which has nothing to exercise here.
 */
import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { adventures } from "../src/api/entities/adventures.ts";
import { MapService } from "../src/api/services/MapService.ts";
import { createTestApp } from "./helpers.ts";

// Meets the realm's default password policy — mirrors `auth.test.ts`.
const PASSWORD = "Sup3rSecret";

class SeedProbe {
  adventures = $repository(adventures);
}

let alepha: ReturnType<typeof createTestApp>;
let probe: SeedProbe;
let mapService: MapService;
let userCount = 0;

beforeEach(async () => {
  alepha = createTestApp();
  probe = alepha.inject(SeedProbe);
  mapService = alepha.inject(MapService);
  await alepha.start();
});

afterEach(async () => {
  await alepha.stop();
});

/** Registers a real user (the adventure's owning FK) and seeds one adventure for it — same
 *  two-phase registration idiom `entities-authoring.test.ts`/`maps.test.ts` use. */
async function newAdventure(prefix: string): Promise<string> {
  userCount += 1;
  const username = `${prefix}${userCount}`;
  const users = alepha.inject(UserController);
  const intent = await users.createRegistrationIntent.fetch({
    body: { username, password: PASSWORD },
  });
  const registered = await users.createUserFromIntent.fetch({
    body: { intentId: intent.data.intentId },
  });
  const adventure = await probe.adventures.create({
    userId: registered.data.id,
    title: "Adv",
    graph: JSON.stringify({ start: null, links: [] }),
  });
  return adventure.id;
}

describe("map heightfield storage", () => {
  test("round-trips a stored heightfield through the map payload", async () => {
    const adventureId = await newAdventure("heightfield");
    const encoded =
      '{"version":1,"size":1,"levelHeight":0.5,"waterLevel":0,"levels":[0],"materials":["herbe"],"colliders":[],"spawns":[],"elements":[],"events":[]}';
    const map = await mapService.createMap(adventureId, "Test Map");

    await mapService.saveHeightfield(map.id, encoded);

    const payload = await mapService.getMap(map.id);
    expect(payload.heightfield).toBe(encoded);
  });

  test("reports no heightfield as null, not as an empty string", async () => {
    const adventureId = await newAdventure("heightfieldnull");
    const map = await mapService.createMap(adventureId, "Test Map");

    const payload = await mapService.getMap(map.id);
    expect(payload.heightfield).toBeNull();
  });
});
