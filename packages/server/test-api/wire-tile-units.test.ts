/**
 * The wire, in tile units — the claim this increment's Phase A ends on.
 *
 * Everything here is asserted against a REAL room over a REAL WebSocket, and every frame is read
 * through `parseServerMessage`, never a bare `JSON.parse`. That distinction is not stylistic: the
 * parser is the single wire truth (`packages/server/AGENTS.md`) and it is what the browser actually
 * runs (`packages/client/src/game/net.ts`), so a frame it refuses is a frame no client ever sees —
 * a `welcome` that fails validation does not merely draw wrong, it makes the room UNJOINABLE. The
 * previous increment shipped exactly that, because one test parsed its welcome with `JSON.parse`.
 *
 * The magnitude assertion below is the other half. **Nothing observable proves the units are
 * right**: a world uniformly wrong by a factor of 64 looks entirely plausible in a screenshot, and
 * every coordinate is a `number` either way. A position bounded by the grid's own half-side is the
 * cheap guard — a hero at `x: 2176` is a pixel coordinate that survived, and a hero at `x: 0` on an
 * origin-centred grid is where it should be.
 */
import { decodeMap } from "@lindocara/engine/hd2d/map-data.js";
import { parseServerMessage, type ServerMessage } from "@lindocara/engine/protocol.js";
import { UserController } from "alepha/api/users";
import { ServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { MapService } from "../src/api/services/MapService.ts";
import { createTestApp, PROVING_SIZE, provingHeightfield } from "./helpers.ts";

// Meets the realm's default password policy — mirrors `auth.test.ts`.
const PASSWORD = "Sup3rSecret";

/**
 * The proving map's spawn, deliberately OFF-CENTRE.
 *
 * The grid centre is `0, 0`, and zero times any scale factor is still zero: a hero standing there
 * satisfies `|x| <= size / 2` whether the wire ships tiles or pixels, which makes the magnitude
 * guard below assert nothing at all. Proven by mutation — scaling the emitted position by
 * `TILE_SIZE` in `interest-system.ts` left every assertion in this file green until the spawn moved
 * off the origin. Both coordinates are non-zero, and they differ, so a swapped axis is loud too.
 */
const SPAWN = { x: 3, z: -2 };

let alepha: ReturnType<typeof createTestApp>;
let mapService: MapService;
let hostname: string;
let userCount = 0;
let openSockets: WebSocket[];

beforeEach(async () => {
  alepha = createTestApp();
  mapService = alepha.inject(MapService);
  openSockets = [];
  await alepha.start();
  hostname = alepha.inject(ServerProvider).hostname;
});

afterEach(async () => {
  for (const socket of openSockets) {
    try {
      socket.close();
    } catch {
      // Already closed.
    }
  }
  await alepha.stop();
});

async function registerAndLogin(prefix: string): Promise<string> {
  userCount += 1;
  const username = `${prefix}${userCount}`;
  const users = alepha.inject(UserController);
  const intent = await users.createRegistrationIntent.fetch({
    body: { username, password: PASSWORD },
  });
  await users.createUserFromIntent.fetch({ body: { intentId: intent.data.intentId } });
  const login = await fetch(`${hostname}/_auth/token?provider=credentials`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  return ((await login.json()) as { access_token: string }).access_token;
}

function authedFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${hostname}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

/** One account with an adventure, a party on it and one hero, and a heightfield on its map — the
 *  ordinary HTTP flow, plus the one thing a room cannot exist without. */
async function newPlayableHero(
  prefix: string,
): Promise<{ token: string; roomId: string; heroId: string }> {
  const token = await registerAndLogin(prefix);
  const adventureResponse = await authedFetch("/api/adventures", token, {
    method: "POST",
    body: JSON.stringify({ title: "Proving", maxPlayers: 4 }),
  });
  expect(adventureResponse.status).toBe(201);
  const adventure = (await adventureResponse.json()) as { id: string; defaultMap: { id: string } };
  // BEFORE the hero exists, which is the real order: a map is authored, then played. Hero creation
  // reads the map's own heightfield spawn for the row's starting position
  // (`HeroService.resolveHeroStart`), so a heightfield stored afterwards would leave the row at the
  // grid origin and the second test below would be asserting the fixture rather than the code.
  await mapService.saveHeightfield(
    adventure.defaultMap.id,
    provingHeightfield(PROVING_SIZE, SPAWN),
  );
  const partyResponse = await authedFetch("/api/parties", token, {
    method: "POST",
    body: JSON.stringify({ adventureId: adventure.id }),
  });
  expect(partyResponse.status).toBe(201);
  const partyId = ((await partyResponse.json()) as { id: string }).id;
  const heroResponse = await authedFetch(`/api/parties/${partyId}/heroes`, token, {
    method: "POST",
    body: JSON.stringify({ name: "Mira", class: "priest" }),
  });
  expect(heroResponse.status).toBe(201);
  const heroId = ((await heroResponse.json()) as { id: string }).id;
  return { token, roomId: `${partyId}:${adventure.defaultMap.id}`, heroId };
}

/** Opens a real `/ws/world` socket and resolves with the first `welcome`, read through the real
 *  parser. A refused frame REJECTS rather than resolving: that is the unjoinable-room case, and it
 *  has to look like a failure here rather than like a timeout. */
function waitForWelcome(roomId: string, heroId: string, token: string): Promise<ServerMessage> {
  const socket = new WebSocket(
    `${hostname.replace(/^http/, "ws")}/ws/world?roomId=${roomId}&hero=${heroId}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  openSockets.push(socket);
  return new Promise<ServerMessage>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for 'welcome'")), 5_000);
    socket.on("message", (data) => {
      const raw = data.toString();
      const message = parseServerMessage(raw);
      if (message === null) {
        const kind = (JSON.parse(raw) as { t?: unknown }).t;
        clearTimeout(timer);
        reject(new Error(`the wire refused a '${String(kind)}' frame: a client would drop it`));
        return;
      }
      if (message.t !== "welcome") return;
      clearTimeout(timer);
      resolve(message);
    });
    socket.on("close", (code) => {
      clearTimeout(timer);
      reject(new Error(`socket closed before welcome (${code})`));
    });
  });
}

describe("the wire ships tile units and no pixel projection", () => {
  test("ships every position in tile units and no pixel projection", async () => {
    const { token, roomId, heroId } = await newPlayableHero("wiretile");
    const welcome = await waitForWelcome(roomId, heroId, token);
    if (welcome.t !== "welcome") throw new Error("unreachable");

    // The terrain, and the only terrain: it decodes, and the room agrees with it about its size.
    const decoded = decodeMap(welcome.world.heightfield);
    expect(decoded?.size).toBe(PROVING_SIZE);
    expect(welcome.world.size).toBe(PROVING_SIZE);

    // The pixel projection is GONE, not merely unread. `tiles` and `colliders` were shipped
    // alongside the heightfield by the previous increment precisely so they could die here, and a
    // server still emitting them would be a server still baking a second, disagreeing geometry.
    const world = welcome.world as unknown as Record<string, unknown>;
    expect(world.tiles).toBeUndefined();
    expect(world.colliders).toBeUndefined();
    expect(world.obstacles).toBeUndefined();
    expect(world.safeZone).toBeUndefined();
    expect(world.width).toBeUndefined();
    expect(world.height).toBeUndefined();

    const self = welcome.players.find((player) => player.id === heroId);
    if (!self) throw new Error("the welcome carried no self player");

    // THE MAGNITUDE GUARD. A grid runs `-size/2`..`+size/2` on both ground axes, so a legal
    // position is bounded by 8 on a 16-cell grid. A world that stayed in pixels would put this
    // hero in the hundreds or thousands and every other assertion here would still pass.
    const half = PROVING_SIZE / 2;
    expect(Math.abs(self.x)).toBeLessThanOrEqual(half);
    expect(Math.abs(self.z)).toBeLessThanOrEqual(half);
    // And it is the map's own authored spawn, to the tile. This is what makes the bound above
    // bite: at `3, -2` a wire that stayed in pixels reports 192 and -128, and both fail.
    expect(self.x).toBe(SPAWN.x);
    expect(self.z).toBe(SPAWN.z);
    // The flat proving grid's ground is level 0 throughout, so that is the elevation underfoot.
    expect(self.y).toBe(0);

    // All three axes travel. A snapshot missing `z` would collapse the world onto one ground axis,
    // and `x`/`y` alone typecheck perfectly because every axis is a `number`.
    expect(typeof self.x).toBe("number");
    expect(typeof self.y).toBe("number");
    expect(typeof self.z).toBe("number");

    // A facing is a GROUND heading: `x` and `z`, never an elevation. The one-field-name difference
    // is the only thing standing between a converted world and a world on its side.
    const facing = self.facing as unknown as Record<string, unknown>;
    expect(typeof facing.z).toBe("number");
    expect(facing.y).toBeUndefined();
    expect(Math.hypot(self.facing.x, self.facing.z)).toBeCloseTo(1, 6);
  });

  test("a new hero starts at the map's own spawn, not at the grid origin", async () => {
    // A hero's row is created from the map's own heightfield spawn, and admission then seats the
    // body on standable ground from there (`mapEntryPosition`). The proving map's spawn is
    // deliberately NOT the origin, so a hero arriving at `0, 0` would mean one of the two ignored
    // the authored spawn and fell back to the grid centre — which on an island map is open sea, and
    // which nothing else in the suite would catch.
    const { token, roomId, heroId } = await newPlayableHero("wirespawn");
    const welcome = await waitForWelcome(roomId, heroId, token);
    if (welcome.t !== "welcome") throw new Error("unreachable");

    const self = welcome.players.find((player) => player.id === heroId);
    if (!self) throw new Error("the welcome carried no self player");
    expect({ x: self.x, y: self.y, z: self.z }).toEqual({ x: SPAWN.x, y: 0, z: SPAWN.z });
  });

  test("the parser refuses a snapshot that lost an axis", () => {
    // The frame hygiene behind the assertions above: a `welcome` whose self player carries only the
    // two pixel axes is a half-converted sender, and it is DROPPED rather than read as a world with
    // its ground `z` at zero. Built by hand rather than captured, because no server in this build
    // can produce one any more — which is exactly why the parser has to keep refusing it.
    const heightfield = provingHeightfield(4);
    const world = {
      zoneId: "map",
      revision: 0,
      zoneNameKey: "Proving",
      heightfield,
      elements: [],
      tilesetId: "tiny-swords",
      layers: ["0*16", "0*16", "0*16"],
      events: [],
      size: 4,
      questNpc: { id: "none", x: 0, y: 0 },
      questNpcs: [],
      questSites: [],
      cemeteries: [],
      portals: [],
      merchant: null,
    };
    const player = {
      id: "11111111-1111-4111-8111-111111111111",
      nick: "Mira",
      x: 0,
      y: 0,
      z: 0,
      airborne: false,
      swimming: false,
      gliding: false,
      hp: 10,
      maxHp: 10,
      level: 1,
      appearance: { body: "wayfarer", primaryColor: "azure" },
      class: "priest",
      equipment: { mainHand: "weathered_sword", offHand: null },
      life: "alive",
      facing: { x: 1, z: 0 },
      action: null,
    };
    const frame = (self: Record<string, unknown>) =>
      JSON.stringify({
        t: "welcome",
        selfId: player.id,
        tick: 0,
        world,
        self: {
          xp: 0,
          xpToNext: 100,
          inventory: { potions: 0, gold: 0, crystals: 0 },
          quest: { status: "available", progress: 0, target: 3 },
          life: "alive",
          corpse: null,
          displacement: { seq: 0, x: 0, y: 0, z: 0 },
        },
        players: [self],
        monsters: [],
        guards: [],
        loot: [],
        corpses: [],
        projectiles: [],
      });

    expect(parseServerMessage(frame(player))).not.toBeNull();
    const { z: _z, ...withoutGroundAxis } = player;
    expect(parseServerMessage(frame(withoutGroundAxis))).toBeNull();
    const pixelFacing = { ...player, facing: { x: 1, y: 0 } };
    expect(parseServerMessage(frame(pixelFacing))).toBeNull();
  });
});
