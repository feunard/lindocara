/**
 * The engine end of D1 maps: joining, the persisted fallback move, and reconnection — against the
 * real Durable Object, exactly like test/world.test.ts. test/maps.test.ts already covers the pure
 * storage rules (front door, placement); this file covers what happens once a stored map has to
 * actually run a room.
 */
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { createDb } from "../src/server/db/index.js";
import { createMap, deleteMap, type MapInput } from "../src/server/maps.js";
import { WS_CLOSE } from "../src/shared/close-codes.js";
import { bakeCollision, mapSpawnPoint } from "../src/shared/map-data.js";
import { encodeTileMap } from "../src/shared/tilemap-codec.js";
import { layeredTerrain } from "./support/map-fixtures.js";
import { Client, testCharacter, until } from "./support/world-harness.js";

/** 20x15 respects the future size floor. A grass island in a one-cell-thick water border, with
 *  one tree and one stone standing on the grass — small enough to read at a glance. */
const ISLAND_COLS = 20;
const ISLAND_ROWS = 15;
function islandBlocks(): string[] {
  const blocks: string[] = [];
  for (let row = 0; row < ISLAND_ROWS; row++) {
    blocks.push(
      row === 0 || row === ISLAND_ROWS - 1
        ? "#".repeat(ISLAND_COLS)
        : `#${".".repeat(ISLAND_COLS - 2)}#`,
    );
  }
  return blocks;
}

const islandInput: MapInput = {
  name: "Island",
  ...layeredTerrain(islandBlocks()),
  elements: [
    { col: 5, row: 5, assetId: "resource.terrain-resources-wood-trees.tree3" },
    { col: 7, row: 5, assetId: "decoration.terrain-decorations-rocks.rock2" },
  ],
  spawn: { col: 2, row: 2 },
};

const smallInput: MapInput = {
  name: "Small",
  ...layeredTerrain(islandBlocks()),
  elements: [],
  spawn: { col: 2, row: 2 },
};

describe("D1 maps end-to-end", () => {
  // The pool does not isolate storage between tests. Elements before maps (FK), mirroring
  // test/maps.test.ts — a leftover map would corrupt "first map"/"empty database" resolution for
  // every test after it, in this file and any other.
  afterEach(async () => {
    await env.DB.exec("DELETE FROM map_element");
    await env.DB.exec("DELETE FROM map");
  });

  it("welcomes a character onto their D1 map with its tiles and elements", async () => {
    const db = createDb(env.DB);
    const session = await testCharacter("mapper");
    const stored = await createMap(db, session.accountId, islandInput);
    await env.DB.prepare("UPDATE character SET zone_id = ? WHERE id = ?")
      .bind(stored.id, session.characterId)
      .run();
    const client = await Client.joinCharacter(session);
    try {
      const welcome = await until("mapper welcome", () => client.welcome);
      expect(welcome.world.zoneId).toBe(stored.id);
      expect(welcome.world.tiles).toEqual(encodeTileMap(bakeCollision(stored)));
      expect(welcome.world.elements).toEqual(stored.elements);
    } finally {
      client.close();
    }
  });

  it("relocates a character whose map was deleted to the first map, at its spawn", async () => {
    const db = createDb(env.DB);
    const session = await testCharacter("relocatee");
    const first = await createMap(db, session.accountId, { ...smallInput, name: "First" });
    const gone = await createMap(db, session.accountId, { ...smallInput, name: "Gone" });
    await env.DB.prepare("UPDATE character SET zone_id = ? WHERE id = ?")
      .bind(gone.id, session.characterId)
      .run();
    await deleteMap(db, session.accountId, gone.id);

    const client = await Client.joinCharacter(session);
    try {
      const welcome = await until("relocated welcome", () => client.welcome);
      expect(welcome.world.zoneId).toBe(first.id);
      const spawn = mapSpawnPoint(first);
      const self = await until("relocated position", () => client.self());
      expect(self.x).toBeCloseTo(spawn.x, 1);
      expect(self.y).toBeCloseTo(spawn.y, 1);

      // The move is persisted, not just visible in this session's welcome.
      const row = await env.DB.prepare("SELECT zone_id, instance_id FROM character WHERE id = ?")
        .bind(session.characterId)
        .first<{ zone_id: string; instance_id: string }>();
      expect(row?.zone_id).toBe(first.id);
      expect(row?.instance_id).toBe("main");
    } finally {
      client.close();
    }
  });

  it("falls back to the built-in floor on an empty database", async () => {
    const session = await testCharacter("floorwalker", { zoneId: "no-such-map" });
    const client = await Client.joinCharacter(session);
    try {
      const welcome = await until("builtin welcome", () => client.welcome);
      expect(welcome.world.zoneId).toBe("builtin");
    } finally {
      client.close();
    }
  });

  it("returns to the same map and position across a disconnect", async () => {
    const db = createDb(env.DB);
    const session = await testCharacter("returner");
    const stored = await createMap(db, session.accountId, smallInput);
    await env.DB.prepare("UPDATE character SET zone_id = ? WHERE id = ?")
      .bind(stored.id, session.characterId)
      .run();

    const first = await Client.joinCharacter(session);
    await until("returner welcome", () => first.welcome);
    first.press("right");
    await until("returner moved", () => {
      const self = first.self();
      return self && self.x > mapSpawnPoint(stored).x + 12 ? self : undefined;
    });
    first.release();
    // Rest before capturing: rejoin restores the in-memory resting position, not an early
    // snapshot taken while the pump still held "right".
    await scheduler.wait(400);
    const resting = await until("returner resting position", () => first.self());

    first.close();
    // `webSocketClose` awaits the save (and presence release) before it finishes the close
    // handshake, so waiting for the client's own close event — not the room's socket count — is
    // the correct signal that the save has landed. See "expires a ward run that elapsed while
    // disconnected" in world.test.ts for the same idiom.
    await until("returner disconnect closed", () => first.closeInfo ?? undefined);
    await scheduler.wait(100);

    const second = await Client.joinCharacter(session);
    try {
      const welcome = await until("returner rejoin welcome", () => second.welcome);
      expect(welcome.world.zoneId).toBe(stored.id);
      const self = welcome.players.find((player) => player.id === welcome.selfId);
      expect(self?.x).toBeCloseTo(resting.x, 1);
      expect(self?.y).toBeCloseTo(resting.y, 1);
    } finally {
      second.close();
    }
  });

  // The honest race — a map deleted between admission and room load — cannot be forced without a
  // real concurrent delete: the front door (index.ts's handleJoin) resolves `resolveMapFor` before
  // the room ever sees the request, so a second join for a deleted map id falls back rather than
  // reaching the room at all (see test/world.test.ts's "self-heals a corrupt zone id..."). So this
  // covers `#locateRoom`'s null branch directly instead: the room's own `fetch` is called with
  // headers naming a map id that was never created, bypassing the front door entirely, to prove
  // the room's own defense-in-depth still closes the socket. (`runInDurableObject` cannot drive
  // this: the runtime only returns a `webSocket` response for a request that went through a real
  // protocol-level upgrade, which a fabricated `Request` handed to `instance.fetch` does not have —
  // `stub.fetch`, a real dispatch through the Durable Object binding, does.)
  it("closes with INVALID_LOCATION when the room's own location lookup finds nothing", async () => {
    const missingMapId = crypto.randomUUID();
    const stub = env.WORLD.getByName(`${missingMapId}:main`);
    const response = await stub.fetch("https://lindocara.test/api/ws", {
      headers: {
        Upgrade: "websocket",
        "x-character-id": crypto.randomUUID(),
        "x-connection-id": crypto.randomUUID(),
        "x-room-key": `${missingMapId}:main`,
        "x-zone-id": missingMapId,
        "x-instance-id": "main",
        "x-session-epoch": "1",
      },
    });
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    if (!socket) throw new Error("expected a websocket in the 101 response");
    const client = new Client(socket);
    const closeInfo = await until("invalid location close", () => client.closeInfo ?? undefined);
    expect(closeInfo.code).toBe(WS_CLOSE.INVALID_LOCATION);
  });
});
