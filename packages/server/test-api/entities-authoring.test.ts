import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { afterEach, beforeEach, test } from "vitest";
import { adventures } from "../src/api/entities/adventures.ts";
import { mapElements } from "../src/api/entities/mapElements.ts";
import { mapEventPages } from "../src/api/entities/mapEventPages.ts";
import { mapEvents } from "../src/api/entities/mapEvents.ts";
import { maps } from "../src/api/entities/maps.ts";
import { createTestApp } from "./helpers.ts";

// Meets the realm's default password policy — mirrors `auth.test.ts`.
const PASSWORD = "Sup3rSecret";

/** A small test-local service, mirroring the framework's own `CharacterProbe` idiom
 *  (`apps/lore/test/campaign-relations.spec.ts`): `$repository()` fields give direct,
 *  unauthenticated access to the entities under test, ahead of the controllers Tasks 8-11 add. */
class EntitiesProbe {
  adventures = $repository(adventures);
  maps = $repository(maps);
  mapElements = $repository(mapElements);
  mapEvents = $repository(mapEvents);
  mapEventPages = $repository(mapEventPages);
}

let alepha: ReturnType<typeof createTestApp>;
let probe: EntitiesProbe;

beforeEach(async () => {
  alepha = createTestApp();
  // Injected (and its $repository fields constructed) before start(), so every entity is
  // registered with the database provider before schema sync runs — the same ordering
  // `CharacterProbe` relies on in the framework's own tests.
  probe = alepha.inject(EntitiesProbe);
  await alepha.start();
});

afterEach(async () => {
  await alepha.stop();
});

/** Registers a user through the real realm flow (same two-phase idiom as `auth.test.ts`) and
 *  returns its server-minted id, the FK target every authoring row needs. */
async function createUser(username: string): Promise<string> {
  const users = alepha.inject(UserController);
  const intent = await users.createRegistrationIntent.fetch({
    body: { username, password: PASSWORD },
  });
  const registered = await users.createUserFromIntent.fetch({
    body: { intentId: intent.data.intentId },
  });
  return registered.data.id;
}

test("adventure + first map round-trip with revision", async ({ expect }) => {
  const userId = await createUser("author1");

  const adventure = await probe.adventures.create({
    userId,
    title: "Test Adventure",
    graph: JSON.stringify({ start: { mapId: "" }, bindings: [] }),
  });
  expect(adventure.maxPlayers).toBe(4);
  expect(adventure.version).toBe(1);
  expect(adventure.registry).toBe("");

  const map = await probe.maps.create({
    userId,
    adventureId: adventure.id,
    name: "Map1",
    cols: 10,
    rows: 10,
    tilesetId: "tiny-swords",
    layers: JSON.stringify(["", "", ""]),
    spawnCol: 1,
    spawnRow: 1,
    revision: 1,
    isFirst: true,
  });

  const readAdventure = await probe.adventures.getById(adventure.id);
  expect(readAdventure.title).toBe("Test Adventure");
  expect(readAdventure.userId).toBe(userId);

  const readMap = await probe.maps.getById(map.id);
  expect(readMap.adventureId).toBe(adventure.id);
  expect(readMap.revision).toBe(1);
  expect(readMap.isFirst).toBe(true);
  expect(readMap.layers).toBe(JSON.stringify(["", "", ""]));

  // FK cascade: deleting the adventure deletes the map.
  await probe.adventures.deleteById(adventure.id);
  const mapsAfterDelete = await probe.maps.findMany({
    where: { adventureId: { eq: adventure.id } },
  });
  expect(mapsAfterDelete).toHaveLength(0);
});

test("mapElements identity is (mapId, col, row, offsetX, offsetY)", async ({ expect }) => {
  const userId = await createUser("author2");
  const adventure = await probe.adventures.create({
    userId,
    title: "Element Adventure",
    graph: JSON.stringify({ start: { mapId: "" }, bindings: [] }),
  });
  const map = await probe.maps.create({
    userId,
    adventureId: adventure.id,
    name: "Map1",
    cols: 10,
    rows: 10,
    layers: JSON.stringify(["", "", ""]),
    spawnCol: 1,
    spawnRow: 1,
  });

  await probe.mapElements.create({
    mapId: map.id,
    col: 3,
    row: 4,
    offsetX: 1,
    offsetY: 2,
    kind: "tree_1",
  });

  // Same (mapId, col, row, offsetX, offsetY) is rejected — a cell+offset holds one decoration.
  await expect(
    probe.mapElements.create({
      mapId: map.id,
      col: 3,
      row: 4,
      offsetX: 1,
      offsetY: 2,
      kind: "bush_1",
    }),
  ).rejects.toThrow();

  // A different offset on the same cell is a distinct slot.
  await probe.mapElements.create({
    mapId: map.id,
    col: 3,
    row: 4,
    offsetX: 2,
    offsetY: 2,
    kind: "bush_1",
  });

  const elements = await probe.mapElements.findMany({ where: { mapId: { eq: map.id } } });
  expect(elements).toHaveLength(2);
});

test("mapEventPages position is unique per event", async ({ expect }) => {
  const userId = await createUser("author3");
  const adventure = await probe.adventures.create({
    userId,
    title: "Event Adventure",
    graph: JSON.stringify({ start: { mapId: "" }, bindings: [] }),
  });
  const map = await probe.maps.create({
    userId,
    adventureId: adventure.id,
    name: "Map1",
    cols: 10,
    rows: 10,
    layers: JSON.stringify(["", "", ""]),
    spawnCol: 1,
    spawnRow: 1,
  });
  const event = await probe.mapEvents.create({
    mapId: map.id,
    col: 2,
    row: 2,
    name: "Chest",
    ordinal: 1,
  });

  const page: Parameters<typeof probe.mapEventPages.create>[0] = {
    eventId: event.id,
    position: 1,
    moveType: "fixed",
    moveSpeed: 3,
    moveFreq: 3,
    optMoveAnim: false,
    optStopAnim: false,
    optDirFix: false,
    optThrough: false,
    optOnTop: false,
    trigger: "action",
  };

  await probe.mapEventPages.create(page);

  // Same (eventId, position) is rejected — a page's durable identity is that pair.
  await expect(probe.mapEventPages.create(page)).rejects.toThrow();

  // A second, distinct position on the same event is fine.
  await probe.mapEventPages.create({ ...page, position: 2 });

  const pages = await probe.mapEventPages.findMany({ where: { eventId: { eq: event.id } } });
  expect(pages).toHaveLength(2);

  // FK cascade: deleting the event deletes its pages too.
  await probe.mapEvents.deleteById(event.id);
  const pagesAfterDelete = await probe.mapEventPages.findMany({
    where: { eventId: { eq: event.id } },
  });
  expect(pagesAfterDelete).toHaveLength(0);
});
