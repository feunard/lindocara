/**
 * The heroes API on Alepha, nested under a party: session gate, create on the party's adventure's
 * first map (server-decided spawn), the non-member `hero_not_member` fence, the per-account hero
 * cap, resolvable starter items/equipment/quest/skills (closing Task 7's carried-over
 * `item_definition` gap — see `HeroService`'s own docblock), scoped listing and own-hero-only
 * delete. Drives the real HTTP server, same idiom as `parties.test.ts`/`maps.test.ts`.
 *
 * Business rules are ported from `packages/server/test/heroes.test.ts` and
 * `packages/server/test/heroes-api.test.ts` (read in full before writing this file).
 *
 * **Divergence from the task brief's own wording, per this task's binding-legacy instruction**: the
 * brief describes the cap scenario as "second hero for one account in one party -> 409 hero_cap",
 * but the actual legacy source of truth (`@lindocara/engine/hero.js`'s `MAX_HEROES_PER_PARTY = 3`,
 * and `packages/server/test/heroes.test.ts`'s own "caps at three heroes per player" test) caps at
 * THREE heroes per account per party, not one. `HeroService` ports the real legacy cap; the test
 * below exercises it at its real boundary (three succeed, a fourth is refused).
 *
 * The "createHero > spawns on..." block also covers all three tiers of `HeroService`'s ported
 * `resolveHeroStart` (a fix-review addition — see `HeroService`'s own docblock for the exact
 * precedence: spawn event, then graph start, then map default).
 */

import { MAX_HEROES_PER_PARTY } from "@lindocara/engine/hero.js";
import { EMPTY_MARKERS } from "@lindocara/engine/map-data.js";
import type { MapEvent } from "@lindocara/engine/map-events.js";
import { functionalEvent } from "@lindocara/engine/map-events.js";
import { MAP_MIN_COLS, MAP_MIN_ROWS } from "@lindocara/engine/map-limits.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { layeredWireTerrain } from "@lindocara/testing/map-fixtures.js";
import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { ServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { heroEquipment } from "../src/api/entities/heroEquipment.ts";
import { heroes } from "../src/api/entities/heroes.ts";
import { heroItems } from "../src/api/entities/heroItems.ts";
import { heroQuests } from "../src/api/entities/heroQuests.ts";
import { heroSkills } from "../src/api/entities/heroSkills.ts";
import { itemDefinitions } from "../src/api/entities/itemDefinitions.ts";
import { createTestApp } from "./helpers.ts";

const PASSWORD = "Sup3rSecret";

class SeedProbe {
  heroes = $repository(heroes);
  heroItems = $repository(heroItems);
  heroEquipment = $repository(heroEquipment);
  heroQuests = $repository(heroQuests);
  heroSkills = $repository(heroSkills);
  itemDefinitions = $repository(itemDefinitions);
}

function blocks(): string[] {
  return Array.from({ length: MAP_MIN_ROWS }, () => ".".repeat(MAP_MIN_COLS));
}

function mapBody(name: string, events: MapEvent[] = []): Record<string, unknown> {
  return {
    name,
    ...layeredWireTerrain(blocks()),
    elements: [],
    spawn: { col: 0, row: 0 },
    markers: EMPTY_MARKERS,
    events,
  };
}

let alepha: ReturnType<typeof createTestApp>;
let probe: SeedProbe;
let hostname: string;
let userCount = 0;

beforeEach(async () => {
  alepha = createTestApp();
  probe = alepha.inject(SeedProbe);
  await alepha.start();
  hostname = alepha.inject(ServerProvider).hostname;
});

afterEach(async () => {
  await alepha.stop();
});

async function registerAndLogin(prefix: string): Promise<{ userId: string; token: string }> {
  userCount += 1;
  const username = `${prefix}${userCount}`;
  const users = alepha.inject(UserController);
  const intent = await users.createRegistrationIntent.fetch({
    body: { username, password: PASSWORD },
  });
  const registered = await users.createUserFromIntent.fetch({
    body: { intentId: intent.data.intentId },
  });
  const login = await fetch(`${hostname}/_auth/token?provider=credentials`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const tokens = (await login.json()) as { access_token: string };
  return { userId: registered.data.id, token: tokens.access_token };
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

/** `POST /api/adventures` creates its atomic default map too, so the adventure is immediately
 *  playable — the resulting map is `MAP_MIN_COLS x MAP_MIN_ROWS`, spawn dead centre. */
async function newPlayableAdventure(token: string): Promise<string> {
  const created = await newPlayableAdventureWithMap(token);
  return created.adventureId;
}

async function newPlayableAdventureWithMap(
  token: string,
): Promise<{ adventureId: string; mapId: string }> {
  const response = await authedFetch("/api/adventures", token, {
    method: "POST",
    body: JSON.stringify({ title: "Donjon", maxPlayers: 4 }),
  });
  expect(response.status).toBe(201);
  const created = (await response.json()) as { id: string; defaultMap: { id: string } };
  return { adventureId: created.id, mapId: created.defaultMap.id };
}

async function newParty(token: string, adventureId: string): Promise<string> {
  const response = await authedFetch("/api/parties", token, {
    method: "POST",
    body: JSON.stringify({ adventureId }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

describe("session gate", () => {
  test("401s every hero route without a bearer token", async () => {
    const routes: [string, string][] = [
      ["GET", "/api/parties/whatever/heroes"],
      ["POST", "/api/parties/whatever/heroes"],
      ["DELETE", "/api/parties/whatever/heroes/whatever"],
    ];
    for (const [method, path] of routes) {
      const needsBody = method === "POST";
      const response = await fetch(`${hostname}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(needsBody ? { body: JSON.stringify({}) } : {}),
      });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("createHero", () => {
  test("Tier 3 fallback: spawns at the map's own default spawn point when no graph.start or spawn event exists", async () => {
    const { token } = await registerAndLogin("herospawn");
    const adventureId = await newPlayableAdventure(token);
    const adventureRes = await authedFetch(`/api/adventures/${adventureId}`, token);
    const adventure = (await adventureRes.json()) as { mapIds: string[] };
    const partyId = await newParty(token, adventureId);

    const response = await authedFetch(`/api/parties/${partyId}/heroes`, token, {
      method: "POST",
      body: JSON.stringify({ name: "Mira", class: "priest" }),
    });
    expect(response.status).toBe(201);
    const hero = (await response.json()) as {
      partyId: string;
      userId: string;
      name: string;
      class: string;
      mapId: string;
      x: number;
      y: number;
      level: number;
      hp: number;
      life: string;
    };
    const expectedSpawnCol = Math.floor(MAP_MIN_COLS / 2);
    const expectedSpawnRow = Math.floor(MAP_MIN_ROWS / 2);
    expect(hero).toMatchObject({
      partyId,
      name: "Mira",
      class: "priest",
      mapId: adventure.mapIds[0],
      x: expectedSpawnCol * TILE_SIZE + TILE_SIZE / 2,
      y: expectedSpawnRow * TILE_SIZE + TILE_SIZE / 2,
      level: 1,
      hp: 100,
      life: "alive",
    });
  });

  test("Tier 2: spawns at the graph.start entry's cell when set and no spawn event exists", async () => {
    const { token } = await registerAndLogin("herograph");
    const { adventureId, mapId } = await newPlayableAdventureWithMap(token);
    const entryId = crypto.randomUUID();
    const entry = functionalEvent({ id: entryId, col: 5, row: 5, ordinal: 1, kind: "entry" });
    const authored = await authedFetch(`/api/maps/${mapId}`, token, {
      method: "PUT",
      body: JSON.stringify(mapBody("A", [entry])),
    });
    expect(authored.status).toBe(200);
    const graphed = await authedFetch(`/api/adventures/${adventureId}`, token, {
      method: "PUT",
      body: JSON.stringify({
        title: "Donjon",
        maxPlayers: 4,
        graph: { start: { mapId, entryId }, links: [] },
      }),
    });
    expect(graphed.status).toBe(200);

    const partyId = await newParty(token, adventureId);
    const response = await authedFetch(`/api/parties/${partyId}/heroes`, token, {
      method: "POST",
      body: JSON.stringify({ name: "Trailblazer", class: "warrior" }),
    });
    expect(response.status).toBe(201);
    const hero = (await response.json()) as { mapId: string; x: number; y: number };
    expect(hero).toMatchObject({
      mapId,
      x: 5 * TILE_SIZE + TILE_SIZE / 2,
      y: 5 * TILE_SIZE + TILE_SIZE / 2,
    });
  });

  test("Tier 1: a spawn event wins over graph.start when both exist", async () => {
    const { token } = await registerAndLogin("herospevt");
    const { adventureId, mapId } = await newPlayableAdventureWithMap(token);
    const entryId = crypto.randomUUID();
    const entry = functionalEvent({ id: entryId, col: 5, row: 5, ordinal: 1, kind: "entry" });
    const spawnEventId = crypto.randomUUID();
    const spawnEvent = functionalEvent({
      id: spawnEventId,
      col: 8,
      row: 3,
      ordinal: 2,
      kind: "spawn",
    });
    const authored = await authedFetch(`/api/maps/${mapId}`, token, {
      method: "PUT",
      body: JSON.stringify(mapBody("A", [entry, spawnEvent])),
    });
    expect(authored.status).toBe(200);
    // A graph.start is ALSO set, pointing at the entry — if Tier 1 (spawn event) did not win over
    // Tier 2 (graph start), the hero would land on the entry's cell (5,5) instead of (8,3).
    const graphed = await authedFetch(`/api/adventures/${adventureId}`, token, {
      method: "PUT",
      body: JSON.stringify({
        title: "Donjon",
        maxPlayers: 4,
        graph: { start: { mapId, entryId }, links: [] },
      }),
    });
    expect(graphed.status).toBe(200);

    const partyId = await newParty(token, adventureId);
    const response = await authedFetch(`/api/parties/${partyId}/heroes`, token, {
      method: "POST",
      body: JSON.stringify({ name: "Bornhere", class: "warrior" }),
    });
    expect(response.status).toBe(201);
    const hero = (await response.json()) as { mapId: string; x: number; y: number };
    expect(hero).toMatchObject({
      mapId,
      x: 8 * TILE_SIZE + TILE_SIZE / 2,
      y: 3 * TILE_SIZE + TILE_SIZE / 2,
    });
  });

  test("creates a hero with resolvable starter items, equipment, quest and skills", async () => {
    const { token } = await registerAndLogin("herowarrior");
    const adventureId = await newPlayableAdventure(token);
    const partyId = await newParty(token, adventureId);

    const response = await authedFetch(`/api/parties/${partyId}/heroes`, token, {
      method: "POST",
      body: JSON.stringify({ name: "Bram", class: "warrior" }),
    });
    expect(response.status).toBe(201);
    const hero = (await response.json()) as { id: string };

    const items = await probe.heroItems.findMany({ where: { heroId: { eq: hero.id } } });
    expect(items.map((item) => item.itemDefinitionId).sort()).toEqual(
      ["health_potion", "oak_shield", "weathered_sword"].sort(),
    );
    // Every hero_item row's itemDefinitionId resolves to a real item_definition row — the FK Task 10
    // added actually holds, and the on-demand seeding in `HeroService.ensureItemDefinitionsSeeded`
    // populated the catalogue before these rows were written.
    const definitions = await probe.itemDefinitions.findMany({
      where: { id: { inArray: items.map((item) => item.itemDefinitionId) } },
    });
    expect(definitions).toHaveLength(items.length);
    expect(definitions.find((d) => d.id === "weathered_sword")).toMatchObject({
      type: "weapon",
      equipmentSlot: "main_hand",
      allowedClass: "warrior",
    });

    const equipment = await probe.heroEquipment.findMany({ where: { heroId: { eq: hero.id } } });
    expect(equipment.map((row) => row.slot).sort()).toEqual(["main_hand", "off_hand"]);
    // Every equipment row's heroItemId resolves to one of this SAME hero's own hero_item rows (the
    // service-layer ownership invariant `heroEquipment.ts`'s docblock documents, since a real
    // composite FK could not be ported).
    const itemIds = new Set(items.map((item) => item.id));
    for (const row of equipment) expect(itemIds.has(row.heroItemId)).toBe(true);

    const quests = await probe.heroQuests.findMany({ where: { heroId: { eq: hero.id } } });
    expect(quests).toMatchObject([
      { questId: "three_offerings", status: "available", progress: 0 },
    ]);

    const skills = await probe.heroSkills.findMany({ where: { heroId: { eq: hero.id } } });
    expect(skills).toHaveLength(5);
    expect(skills.filter((skill) => skill.unlocked)).toHaveLength(1);
    expect(skills.find((skill) => skill.slot === 1)).toMatchObject({
      unlocked: true,
      equipped: true,
    });
  });

  test("refuses a non-member with hero_not_member", async () => {
    const { token: hostToken } = await registerAndLogin("heronomh");
    const adventureId = await newPlayableAdventure(hostToken);
    const partyId = await newParty(hostToken, adventureId);

    const { token: outsiderToken } = await registerAndLogin("heronomo");
    const response = await authedFetch(`/api/parties/${partyId}/heroes`, outsiderToken, {
      method: "POST",
      body: JSON.stringify({ name: "Sneak", class: "warrior" }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "hero_not_member" });
  });

  test(`caps at ${MAX_HEROES_PER_PARTY} heroes per account per party`, async () => {
    const { token } = await registerAndLogin("herocap");
    const adventureId = await newPlayableAdventure(token);
    const partyId = await newParty(token, adventureId);

    for (let index = 0; index < MAX_HEROES_PER_PARTY; index += 1) {
      const response = await authedFetch(`/api/parties/${partyId}/heroes`, token, {
        method: "POST",
        body: JSON.stringify({ name: `Hero${index}`, class: "warrior" }),
      });
      expect(response.status, `hero ${index}`).toBe(201);
    }
    // At the cap: the atomic conditional-INSERT guard (not just the friendly count() fast-path) must
    // refuse a create attempted exactly at the boundary and leave the row count unchanged.
    const overflow = await authedFetch(`/api/parties/${partyId}/heroes`, token, {
      method: "POST",
      body: JSON.stringify({ name: "Once too many", class: "warrior" }),
    });
    expect(overflow.status).toBe(409);
    expect(await overflow.json()).toMatchObject({ error: "hero_cap" });
    const survivingHeroes = await probe.heroes.findMany({ where: { partyId: { eq: partyId } } });
    expect(survivingHeroes).toHaveLength(MAX_HEROES_PER_PARTY);
  });

  test("400s an invalid create body", async () => {
    const { token } = await registerAndLogin("heroinvalid");
    const adventureId = await newPlayableAdventure(token);
    const partyId = await newParty(token, adventureId);
    const response = await authedFetch(`/api/parties/${partyId}/heroes`, token, {
      method: "POST",
      body: JSON.stringify({ name: "", class: "warrior" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "hero_invalid" });
  });
});

describe("listHeroes / deleteHero", () => {
  test("scopes the list to the caller and deletes only the caller's own hero", async () => {
    const { token: hostToken } = await registerAndLogin("herolisthost");
    const adventureId = await newPlayableAdventure(hostToken);
    const partyId = await newParty(hostToken, adventureId);
    const { token: mateToken } = await registerAndLogin("herolistmate");
    await authedFetch(`/api/parties/${partyId}/join`, mateToken, { method: "POST" });

    const mine = await authedFetch(`/api/parties/${partyId}/heroes`, hostToken, {
      method: "POST",
      body: JSON.stringify({ name: "Mine", class: "warrior" }),
    });
    const mineHero = (await mine.json()) as { id: string };
    await authedFetch(`/api/parties/${partyId}/heroes`, mateToken, {
      method: "POST",
      body: JSON.stringify({ name: "Matey", class: "ranger" }),
    });

    const hostList = await authedFetch(`/api/parties/${partyId}/heroes`, hostToken);
    expect((await hostList.json()) as unknown[]).toHaveLength(1);
    const mateList = (await (
      await authedFetch(`/api/parties/${partyId}/heroes`, mateToken)
    ).json()) as {
      name: string;
    }[];
    expect(mateList[0]?.name).toBe("Matey");

    const refused = await authedFetch(`/api/parties/${partyId}/heroes/${mineHero.id}`, mateToken, {
      method: "DELETE",
    });
    expect(refused.status).toBe(404);
    expect(await refused.json()).toMatchObject({ error: "hero_not_found" });

    const deleted = await authedFetch(`/api/parties/${partyId}/heroes/${mineHero.id}`, hostToken, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
    const afterDelete = await authedFetch(`/api/parties/${partyId}/heroes`, hostToken);
    expect((await afterDelete.json()) as unknown[]).toHaveLength(0);
  });
});
