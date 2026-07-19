import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import type { AdventureGraph } from "../src/shared/adventure.js";
import { WS_CLOSE } from "../src/shared/close-codes.js";
import { ATTACK_COOLDOWN_MS, MONSTER_STATS, maxHpForLevel } from "../src/shared/game.js";
import { TILE_SIZE } from "../src/shared/tilemap.js";
import { layeredWireTerrain } from "./support/map-fixtures.js";
import {
  Client,
  tileCentre as centre,
  drainHeroRooms,
  heroRoomKey,
  type MapAnchors,
  ORIGIN,
  type TestAccount,
  type TestMapBody,
  type TestParty,
  testAccount,
  testHero,
  testMapInput,
  testParty,
  until,
} from "./support/world-harness.js";

function mapAInput(): TestMapBody {
  return testMapInput("Placed monsters", {
    cols: 20,
    rows: 15,
    spawn: { col: 2, row: 2 },
    exit: { col: 4, row: 2 },
    monsterSpawns: [{ col: 10, row: 8, species: "torch_goblin", patrolRadius: 192 }],
  });
}

function mapBInput(): TestMapBody {
  return testMapInput("The ending", {
    cols: 20,
    rows: 15,
    spawn: { col: 3, row: 3 },
    exit: { col: 5, row: 3 },
  });
}

function prayerMapInput(): TestMapBody {
  const map = testMapInput("Prayer line of sight", {
    cols: 20,
    rows: 15,
    spawn: { col: 2, row: 2 },
    exit: { col: 18, row: 13 },
  });
  return {
    ...map,
    ...layeredWireTerrain(
      Array.from({ length: map.rows }, (_, row) =>
        row === 2 ? `${".".repeat(3)}#${".".repeat(map.cols - 4)}` : ".".repeat(map.cols),
      ),
    ),
  };
}

function novaMapInput(): TestMapBody {
  return testMapInput("Divine Nova", {
    cols: 20,
    rows: 15,
    spawn: { col: 3, row: 3 },
    exit: { col: 18, row: 13 },
    monsterSpawns: [{ col: 4, row: 3, species: "spear_goblin", patrolRadius: 32 }],
  });
}

/** Two maps in a line: mapA's exit leads to mapB's entry, mapB's exit ends the adventure. Binds the
 *  maps' entry/exit EVENT uuids (UX wave #12), read back from the authored bodies via `anchors`. */
function twoMapAdventure(): {
  maps: TestMapBody[];
  graph: (anchors: readonly MapAnchors[]) => AdventureGraph;
} {
  return {
    maps: [mapAInput(), mapBInput()],
    graph: (anchors) => {
      const [mapA, mapB] = anchors;
      if (!mapA || !mapB) throw new Error("expected two seeded maps");
      return {
        start: { mapId: mapA.mapId, entryId: mapA.entryId },
        links: [
          {
            mapId: mapA.mapId,
            exitId: mapA.exitId,
            dest: { mapId: mapB.mapId, entryId: mapB.entryId },
          },
          { mapId: mapB.mapId, exitId: mapB.exitId, dest: "end" },
        ],
      };
    },
  };
}

async function seedParty(label: string): Promise<TestParty & { mapA: string; mapB: string }> {
  const party = await testParty(label, twoMapAdventure());
  const [mapA, mapB] = party.mapIds;
  if (!mapA || !mapB) throw new Error("expected two seeded maps");
  return Object.assign(party, { mapA, mapB });
}

async function rejectHero(
  session: TestAccount,
  partyId: string,
  heroId: string,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/ws?party=${partyId}&hero=${heroId}`, {
    headers: { Upgrade: "websocket", Cookie: session.cookie },
  });
}

afterEach(async () => {
  await drainHeroRooms();
  await env.DB.exec("DELETE FROM hero");
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
  await env.DB.exec("DELETE FROM character");
  await env.DB.exec("DELETE FROM account");
});

describe("party hero admission and authored runtime", () => {
  // A monster-event's wire id is `mon-<uuid>` (map-zone.ts). `protocol.ts`'s `isWireId` caps every id
  // at 64 chars over `[A-Za-z0-9_-]`; the older map-id-prefixed form overran it. This pins the live
  // snapshot id inside that bound so a future prefix change cannot silently break admission parsing.
  it("mints a monster wire id that is `mon-` bounded and inside the protocol alphabet", {
    timeout: 10_000,
  }, async () => {
    const party = await testParty("monster-wire-id", { maps: [mapAInput()] });
    const hero = await testHero("Scout", { party, account: party.host, position: centre(2, 2) });
    const client = await Client.joinHero(hero);
    try {
      const welcome = await until("monster wire id welcome", () => client.welcome);
      const monster = welcome.monsters[0];
      if (!monster) throw new Error("expected a spawned monster event");
      expect(monster.id).toMatch(/^mon-[0-9a-f-]{36}$/);
      expect(monster.id.length).toBeLessThanOrEqual(64);
      expect(monster.id).toMatch(/^[A-Za-z0-9_-]+$/);
    } finally {
      await client.close();
    }
  });

  it("executes private authoritative test commands for a hero", { timeout: 15_000 }, async () => {
    const party = await testParty("cheat-commands");
    const hero = await testHero("Tester", {
      party,
      account: party.host,
      class: "ranger",
      level: 1,
    });
    const client = await Client.joinHero(hero);
    await until("cheat welcome", () => client.welcome);

    client.chat("/up10");
    await until("level cheat event", () =>
      client.received.find((message) => message.t === "event" && message.code === "cheat.level"),
    );
    const levelled = await until("level ten snapshot", () =>
      client.self()?.level === 10 ? client.self() : undefined,
    );
    expect(levelled.class).toBe("ranger");
    expect(levelled.hp).toBe(maxHpForLevel(10));

    client.chat("/ghost");
    await until("forced ghost", () =>
      client.self()?.life === "ghost" ? client.self() : undefined,
    );
    client.chat("/revive");
    const revived = await until("cheat revive", () =>
      client.self()?.life === "alive" ? client.self() : undefined,
    );
    expect(revived.hp).toBe(maxHpForLevel(10));
    expect(
      client.received.some((message) => message.t === "chat" && message.text.startsWith("/")),
    ).toBe(false);
  });

  it("toggles Iron Guard, blocks every other action, and starts cooldown on exit", {
    timeout: 10_000,
  }, async () => {
    const party = await testParty("iron-guard-toggle");
    const hero = await testHero("Bulwark", {
      party,
      account: party.host,
      class: "warrior",
      level: 10,
    });
    const client = await Client.joinHero(hero);
    try {
      await until("iron guard welcome", () => client.welcome);
      client.skill(2);
      await until("iron guard active snapshot", () =>
        client.self()?.guarding === true ? client.self() : undefined,
      );

      client.action("attack");
      client.skill(3);
      client.skill(4);
      client.skill(5);
      await scheduler.wait(700);
      expect(
        client.received.some(
          (message) =>
            message.t === "animation" &&
            (message.skillId === "cleave" ||
              message.skillId === "shield_bash" ||
              message.skillId === "battle_cry" ||
              message.skillId === "whirlwind"),
        ),
      ).toBe(false);

      client.skill(2);
      await until("iron guard disabled snapshot", () =>
        client.self()?.guarding === false ? client.self() : undefined,
      );
      const cooldown = await until("iron guard exit cooldown", () => {
        const state = client.latestState;
        const deadline = state?.cooldowns?.skillCooldowns[1] ?? 0;
        return deadline > (state?.serverNow ?? 0) ? deadline : undefined;
      });
      expect(cooldown).toBeGreaterThan(Date.now());

      client.action("attack");
      await until("cleave available after leaving guard", () =>
        client.received.find(
          (message) => message.t === "animation" && message.skillId === "cleave",
        ),
      );
    } finally {
      client.close();
    }
  });

  it("uses Battle Cry as an area taunt without dealing damage", { timeout: 10_000 }, async () => {
    const party = await testParty("battle-cry-taunt", { maps: [novaMapInput()] });
    const hero = await testHero("Provoker", {
      party,
      account: party.host,
      class: "warrior",
      level: 10,
      position: centre(3, 3),
    });
    const client = await Client.joinHero(hero);
    try {
      const welcome = await until("battle cry welcome", () => client.welcome);
      const monster = welcome.monsters[0];
      if (!monster) throw new Error("expected Battle Cry monster");
      const stub = env.WORLD.getByName(hero.roomKey);
      const beforeThreat =
        (await stub.roomDiagnostics()).monsters
          .find((candidate) => candidate.id === monster.id)
          ?.threat.find((entry) => entry.playerId === hero.heroId)?.amount ?? 0;

      client.skill(4);
      await scheduler.wait(500);
      const afterThreat = (await stub.roomDiagnostics()).monsters
        .find((candidate) => candidate.id === monster.id)
        ?.threat.find((entry) => entry.playerId === hero.heroId)?.amount;
      expect(afterThreat).toBeGreaterThanOrEqual(beforeThreat + 25);
      const after = client.latestSnapshot?.monsters.find(
        (candidate) => candidate.id === monster.id,
      );
      expect(after?.hp).toBe(monster.hp);
      expect(
        client.received.some(
          (message) =>
            message.t === "event" &&
            message.code === "combat.hit" &&
            message.params?.skill === "battle_cry",
        ),
      ).toBe(false);
    } finally {
      client.close();
    }
  });

  it("keeps Lumen Step in place without held movement", { timeout: 10_000 }, async () => {
    const party = await testParty("stationary-lumen");
    const hero = await testHero("Stilllight", {
      party,
      account: party.host,
      class: "priest",
      level: 5,
    });
    const client = await Client.joinHero(hero);
    try {
      const welcome = await until("stationary lumen welcome", () => client.welcome);
      const before = welcome.players.find((player) => player.id === hero.heroId);
      if (!before) throw new Error("missing stationary priest");

      client.skill(3);
      await until("stationary lumen animation", () =>
        client.received.find((message) => message.t === "animation" && message.skillId === "blink"),
      );
      client.skillRelease(3);
      await until("stationary lumen release", () => {
        const action = client.self()?.action;
        return action?.skillId === "blink" && action.channelEndsAt !== undefined
          ? action
          : undefined;
      });
      await scheduler.wait(750);
      const after = client.self();
      if (!after) throw new Error("missing priest after Lumen Step");
      expect(after.x).toBeCloseTo(before.x, 2);
      expect(after.y).toBeCloseTo(before.y, 2);
    } finally {
      client.close();
    }
  });

  it("keeps Lumen Step held across direction changes and rematerializes only on release", {
    timeout: 10_000,
  }, async () => {
    const party = await testParty("directed-lumen");
    const hero = await testHero("Cloudstep", {
      party,
      account: party.host,
      class: "priest",
      level: 5,
    });
    const client = await Client.joinHero(hero);
    try {
      await until("directed lumen welcome", () => client.welcome);
      const start = client.self();
      if (!start) throw new Error("missing directed priest");
      client.press("right");
      await until("right movement applied before Lumen Step", () => {
        const current = client.self();
        return current && current.x > start.x + 1 ? current : undefined;
      });
      const beforeCast = client.self();
      if (!beforeCast) throw new Error("missing priest before directed Lumen Step");

      client.skill(3);
      await until("directed lumen animation", () =>
        client.received.find((message) => message.t === "animation" && message.skillId === "blink"),
      );
      const afterRight = await until("rightward Lumen cloud movement", () => {
        const current = client.self();
        return current && current.x - beforeCast.x > 24 ? current : undefined;
      });
      expect(afterRight.action).toMatchObject({ skillId: "blink" });
      expect(afterRight.action?.channelEndsAt).toBeUndefined();

      client.press("down");
      const afterTurn = await until("Lumen direction changes while still held", () => {
        const current = client.self();
        return current && current.y - afterRight.y > 24 ? current : undefined;
      });
      expect(afterTurn.action).toMatchObject({
        skillId: "blink",
        direction: { x: 0, y: 1 },
      });
      expect(afterTurn.action?.channelEndsAt).toBeUndefined();

      client.skillRelease(3);
      client.release();
      const released = await until("Lumen release becomes authoritative", () => {
        const action = client.self()?.action;
        return action?.skillId === "blink" && action.channelEndsAt !== undefined
          ? action
          : undefined;
      });
      expect(released.channelEndsAt).toBeGreaterThanOrEqual(released.impactAt);
      await until("Lumen recovery completes", () =>
        client.self()?.action === null ? true : undefined,
      );
    } finally {
      client.close();
    }
  });

  it("accepts an empty Cleave and consumes its cooldown at launch", {
    timeout: 10_000,
  }, async () => {
    const party = await testParty("cleave-whiff");
    const hero = await testHero("Whiff", { party, account: party.host, class: "warrior" });
    const client = await Client.joinHero(hero);
    try {
      const welcome = await until("empty cleave welcome", () => client.welcome);
      expect(welcome.monsters).toEqual([]);

      client.action("attack");
      const animation = await until("empty cleave animation", () =>
        client.received.find(
          (message) =>
            message.t === "animation" &&
            message.actorId === hero.heroId &&
            message.skillId === "cleave",
        ),
      );
      if (animation.t !== "animation") throw new Error("expected cleave animation");
      const cooldownState = await until("empty cleave cooldown", () =>
        client.received.find(
          (message) =>
            message.t === "state" &&
            (message.self.cooldowns?.attackUntil ?? 0) > (message.self.serverNow ?? 0),
        ),
      );
      if (cooldownState.t !== "state") throw new Error("expected cooldown state");
      expect(cooldownState.self.cooldowns?.attackUntil).toBe(
        animation.startedAt + ATTACK_COOLDOWN_MS,
      );

      client.action("attack");
      await scheduler.wait(100);
      expect(
        client.received.filter(
          (message) => message.t === "animation" && message.skillId === "cleave",
        ),
      ).toHaveLength(1);
      expect(
        client.received.some((message) => message.t === "event" && message.code === "combat.hit"),
      ).toBe(false);
    } finally {
      client.close();
    }
  });

  it("resolves Cleave only at its active frame and never hits behind the hero", {
    timeout: 10_000,
  }, async () => {
    const map = testMapInput("Cleave geometry", {
      cols: 20,
      rows: 15,
      spawn: { col: 5, row: 5 },
      exit: { col: 18, row: 13 },
      monsterSpawns: [
        { col: 6, row: 5, species: "spear_goblin", patrolRadius: 32 },
        { col: 4, row: 5, species: "spear_goblin", patrolRadius: 32 },
      ],
    });
    const party = await testParty("cleave-facing", { maps: [map] });
    const hero = await testHero("Facing", {
      party,
      account: party.host,
      class: "warrior",
      position: centre(5, 5),
    });
    const client = await Client.joinHero(hero);
    try {
      const welcome = await until("cleave geometry welcome", () => client.welcome);
      const self = welcome.players.find((player) => player.id === hero.heroId);
      if (!self) throw new Error("missing cleave hero");
      const front = welcome.monsters.find((monster) => monster.x > self.x);
      const behind = welcome.monsters.find((monster) => monster.x < self.x);
      if (!front || !behind) throw new Error("missing front/back cleave fixtures");

      client.action("attack");
      await until("cleave start", () =>
        client.received.find(
          (message) => message.t === "animation" && message.skillId === "cleave",
        ),
      );
      expect(
        client.received.some((message) => message.t === "event" && message.code === "combat.hit"),
      ).toBe(false);

      await until("front monster cleaved", () => {
        const monster = client.latestSnapshot?.monsters.find(
          (candidate) => candidate.id === front.id,
        );
        return monster && monster.hp < front.hp ? monster : undefined;
      });
      await scheduler.wait(150);
      expect(
        client.latestSnapshot?.monsters.find((candidate) => candidate.id === behind.id)?.hp,
      ).toBe(behind.hp);
    } finally {
      client.close();
    }
  });

  it("hydrates placed monsters and crosses an exit to the server-selected entry", async () => {
    const party = await seedParty("route");
    const hero = await testHero("Mira", {
      party,
      class: "priest",
      position: centre(4, 2),
    });

    const first = await Client.joinHero(hero);
    const welcome = await until("authored-map welcome", () => first.welcome);
    expect(welcome.world.zoneId).toBe(party.mapA);
    expect(welcome.monsters).toHaveLength(1);
    expect(welcome.monsters[0]?.species).toBe("torch_goblin");
    const sourceDiagnostics = await env.WORLD.getByName(
      heroRoomKey(party.partyId, party.mapA),
    ).roomDiagnostics();
    expect(sourceDiagnostics.monsters).toEqual([
      expect.objectContaining({ species: "torch_goblin", patrolRadius: 192 }),
    ]);

    const close = await until("authoritative map transition", () => first.closeInfo ?? undefined);
    expect(close.code).toBe(WS_CLOSE.ZONE_TRANSITION);
    const second = await Client.joinHero(hero);
    const destination = await until("destination welcome", () => second.welcome);
    expect(destination.world.zoneId).toBe(party.mapB);
    expect(destination.monsters).toEqual([]);
    expect(second.self()).toMatchObject(centre(3, 3));
    const persisted = await env.DB.prepare("SELECT map_id, x, y FROM hero WHERE id = ?")
      .bind(hero.heroId)
      .first<{ map_id: string; x: number; y: number }>();
    expect(persisted?.map_id).toBe(party.mapB);
    expect(persisted?.x).toBeCloseTo(centre(3, 3).x, 1);
    expect(persisted?.y).toBeCloseTo(centre(3, 3).y, 1);
  });

  it("cancels source-room projectiles during a map transition and does not restore them", {
    timeout: 10_000,
  }, async () => {
    const party = await seedParty("projectile-transition");
    const exit = centre(4, 2);
    const hero = await testHero("Runner", {
      party,
      class: "ranger",
      position: { x: 4 * TILE_SIZE - 2, y: exit.y },
    });

    const source = await Client.joinHero(hero);
    await until("source welcome", () => source.welcome);
    source.action("attack");
    await until("source projectile", () =>
      source.latestSnapshot?.projectiles.find((projectile) => projectile.ownerId === hero.heroId),
    );
    source.press("right");
    const close = await until("transition with a projectile", () => source.closeInfo ?? undefined);
    expect(close.code).toBe(WS_CLOSE.ZONE_TRANSITION);

    const unloaded = await env.WORLD.getByName(hero.roomKey).roomDiagnostics();
    expect(unloaded.projectiles).toEqual([]);
    const destination = await Client.joinHero(hero);
    const welcome = await until(
      "destination welcome without a projectile",
      () => destination.welcome,
    );
    expect(welcome.world.zoneId).toBe(party.mapB);
    expect(welcome.projectiles).toEqual([]);
    destination.close();
  });

  it("renders an authoritative arrow for party peers and ignores client-selected victims", {
    timeout: 10_000,
  }, async () => {
    const party = await seedParty("combat");
    const hero = await testHero("Hunter", {
      party,
      account: party.host,
      class: "ranger",
      position: centre(7, 8),
    });
    const observerHero = await testHero("Observer", {
      party,
      class: "warrior",
      position: centre(6, 8),
    });

    const client = await Client.joinHero(hero);
    const observer = await Client.joinHero(observerHero);
    const welcome = await until("combat welcome", () => client.welcome);
    await until("observer welcome", () => observer.welcome);
    const placed = welcome.monsters[0];
    expect(placed?.id).toMatch(/^[A-Za-z0-9_-]+$/);
    if (!placed) throw new Error("expected an authored monster");

    client.sendRaw(JSON.stringify({ t: "attack", targetId: placed.id }));
    await scheduler.wait(100);
    expect(client.latestSnapshot?.monsters.find((monster) => monster.id === placed.id)?.hp).toBe(
      placed.hp,
    );

    client.action("attack");
    const arrow = await until("party peer sees the arrow", () =>
      observer.latestSnapshot?.projectiles.find(
        (projectile) => projectile.ownerId === hero.heroId && projectile.kind === "arrow",
      ),
    );
    expect(arrow.direction).toMatchObject({ x: 1, y: 0 });
    expect(arrow.color).toBe("azure");
    const damaged = await until("placed monster damage", () => {
      const monster = client.latestSnapshot?.monsters.find(
        (candidate) => candidate.id === placed.id,
      );
      return monster && monster.hp < placed.hp ? monster : undefined;
    });
    expect(damaged.hp).toBe(placed.hp - 16);
    const peerImpact = await until("party peer sees the authoritative impact", () =>
      observer.received.find(
        (message) =>
          message.t === "event" &&
          message.code === "combat.hit" &&
          message.params?.actorId === hero.heroId,
      ),
    );
    expect(peerImpact).toMatchObject({ params: { damage: 16, skill: "quick_shot" } });
    client.close();
    observer.close();
  });

  /**
   * Combat on an authored map has to run in both directions. It did not: `terrainFromMap` used to
   * declare the whole map a safe zone, and `monster-system` reads that rect as "monsters may not
   * touch a player here" — so on every D1 map, i.e. the entire live gameplay path, no player ever
   * entered a monster's threat table and `damagePlayer` was unreachable. Every existing test built
   * its own `TerrainGeometry` by hand, so nothing exercised the geometry heroes actually play on.
   */
  it("lets a placed monster acquire threat, close in and wound a hero on an authored map", async () => {
    const party = await seedParty("aggro");
    const hero = await testHero("Bait", {
      party,
      class: "warrior",
      position: centre(9, 8),
    });

    const client = await Client.joinHero(hero);
    const welcome = await until("aggro welcome", () => client.welcome);
    const placed = welcome.monsters[0];
    if (!placed) throw new Error("expected an authored monster");
    expect(welcome.players.find((player) => player.id === hero.heroId)?.hp).toBe(maxHpForLevel(1));

    // Threat first: the monster must actually chase, not merely happen to stand on the hero.
    const closed = await until("monster closes on the hero", () => {
      const monster = client.latestSnapshot?.monsters.find((m) => m.id === placed.id);
      const self = client.self();
      if (!monster || !self) return undefined;
      return Math.hypot(monster.x - self.x, monster.y - self.y) < 64 ? monster : undefined;
    });
    expect(closed.x).not.toBe(placed.x);

    const wounded = await until("hero wounded by the placed monster", () => {
      const self = client.self();
      return self && self.hp < maxHpForLevel(1) ? self : undefined;
    });
    expect(wounded.hp).toBeLessThanOrEqual(maxHpForLevel(1) - MONSTER_STATS.goblin.damage);
  });

  it("lets a hero dodge a placed monster during its authoritative anticipation", {
    timeout: 15_000,
  }, async () => {
    const party = await seedParty("dodge");
    const hero = await testHero("Dodger", {
      party,
      class: "ranger",
      position: centre(9, 8),
    });
    const client = await Client.joinHero(hero);
    const welcome = await until("dodge welcome", () => client.welcome);
    const initialHp = welcome.players.find((player) => player.id === hero.heroId)?.hp;
    if (initialHp === undefined) throw new Error("expected the dodger's HP");

    const animation = await until("monster anticipation", () =>
      client.received.find(
        (message) =>
          message.t === "animation" &&
          message.actorKind === "monster" &&
          message.action === "attack",
      ),
    );
    if (animation.t !== "animation") throw new Error("expected a monster animation");
    expect(animation.startedAt).toBeLessThan(animation.impactAt);
    expect(animation.direction.x).toBeLessThan(-0.8);

    client.press("left");
    await scheduler.wait(Math.max(100, animation.impactAt - Date.now() + 120));
    client.release();
    expect(client.self()?.hp).toBe(initialHp);
    const attackingMonster = client.latestSnapshot?.monsters.find(
      (monster) => monster.action?.id === animation.actionId,
    );
    if (attackingMonster?.action) {
      expect(attackingMonster.action.direction).toEqual(animation.direction);
    }
    client.close();
  });

  it("makes the active Lumen cloud immune to monster damage until release", {
    timeout: 15_000,
  }, async () => {
    const party = await seedParty("lumen-invulnerability");
    const hero = await testHero("Mist", {
      party,
      class: "priest",
      level: 5,
      position: centre(9, 8),
    });
    const client = await Client.joinHero(hero);
    try {
      const welcome = await until("Lumen immunity welcome", () => client.welcome);
      const initialHp = welcome.players.find((player) => player.id === hero.heroId)?.hp;
      if (initialHp === undefined) throw new Error("expected Lumen priest HP");
      const monsterAttack = await until("monster attacks Lumen priest", () =>
        client.received.find(
          (message) =>
            message.t === "animation" &&
            message.actorKind === "monster" &&
            message.action === "attack",
        ),
      );
      if (monsterAttack.t !== "animation") throw new Error("expected monster attack animation");

      const hpBeforeCloud = client.self()?.hp;
      if (hpBeforeCloud === undefined) throw new Error("expected HP before Lumen cloud");
      const hurtBefore = client.received.filter(
        (message) => message.t === "event" && message.code === "combat.hurt",
      ).length;
      client.skill(3);
      await until("Lumen cloud active", () => {
        const action = client.self()?.action;
        return action?.skillId === "blink" && action.resolved ? action : undefined;
      });
      await scheduler.wait(Math.max(100, monsterAttack.impactAt - Date.now() + 150));
      expect(client.self()?.hp).toBe(hpBeforeCloud);
      expect(
        client.received.filter(
          (message) => message.t === "event" && message.code === "combat.hurt",
        ),
      ).toHaveLength(hurtBefore);

      client.skillRelease(3);
      await until("Lumen priest rematerializes", () =>
        client.self()?.action === null ? true : undefined,
      );
      const wounded = await until("damage resumes after Lumen release", () => {
        const self = client.self();
        return self && self.hp < hpBeforeCloud ? self : undefined;
      });
      expect(wounded.hp).toBeLessThan(hpBeforeCloud);
    } finally {
      client.close();
    }
  });

  it("heals the priest and visible party allies with Prayer but not through a wall", {
    timeout: 15_000,
  }, async () => {
    const party = await testParty("prayer", { maps: [prayerMapInput()], color: "red" });
    const priestHero = await testHero("Prayer", {
      party,
      account: party.host,
      class: "priest",
      level: 7,
      hp: 40,
      position: centre(2, 2),
    });
    const visibleHero = await testHero("Visible", {
      party,
      color: "yellow",
      level: 7,
      hp: 40,
      position: centre(2, 4),
    });
    const blockedHero = await testHero("Blocked", {
      party,
      color: "purple",
      level: 7,
      hp: 40,
      position: centre(4, 2),
    });
    const priest = await Client.joinHero(priestHero);
    const visible = await Client.joinHero(visibleHero);
    const blocked = await Client.joinHero(blockedHero);
    await until(
      "Prayer party welcomed",
      () => priest.welcome && visible.welcome && blocked.welcome,
    );

    priest.skill(4);
    await until("Prayer heals its visible recipients", () => {
      const caster = priest.self();
      const ally = visible.self();
      return caster && ally && caster.hp > 40 && ally.hp > 40 ? { caster, ally } : undefined;
    });
    await scheduler.wait(300);
    expect(blocked.self()?.hp).toBe(40);
    expect(
      priest.received.find((message) => message.t === "event" && message.code === "heal.cast"),
    ).toMatchObject({ params: { color: "ember" } });
    expect(
      visible.received.find((message) => message.t === "event" && message.code === "heal.received"),
    ).toMatchObject({ params: { color: "ember" } });
    priest.close();
    visible.close();
    blocked.close();
  });

  it("keeps Mend ownership metadata while healing only its ally", { timeout: 15_000 }, async () => {
    const party = await testParty("mend-colour", { color: "purple" });
    const priestHero = await testHero("VioletMend", {
      party,
      account: party.host,
      class: "priest",
      level: 3,
      hp: 40,
      position: centre(2, 2),
    });
    const allyHero = await testHero("AzureAlly", {
      party,
      color: "blue",
      level: 3,
      hp: 40,
      position: centre(4, 2),
    });
    const priest = await Client.joinHero(priestHero);
    const ally = await Client.joinHero(allyHero);
    await until("Mend colour party welcomed", () => priest.welcome && ally.welcome);

    priest.skill(2);
    const projectile = await until("violet healing projectile", () =>
      ally.latestSnapshot?.projectiles.find(
        (candidate) =>
          candidate.ownerId === priestHero.heroId && candidate.kind === "healing_light",
      ),
    );
    expect(projectile.color).toBe("violet");
    const received = await until("violet Mend impact", () =>
      ally.received.find((message) => message.t === "event" && message.code === "heal.received"),
    );
    expect(received).toMatchObject({
      params: { color: "violet", name: "VioletMend", skill: "mend" },
    });
    await until("Mend colour state catches up", () => {
      const caster = priest.self();
      const target = ally.self();
      return caster && target && caster.hp === 40 && target.hp > 40 ? true : undefined;
    });
    priest.close();
    ally.close();
  });

  it("resolves Divine Nova once per nearby ally and monster", { timeout: 15_000 }, async () => {
    const party = await testParty("nova", { maps: [novaMapInput()], color: "red" });
    const priestHero = await testHero("Nova", {
      party,
      account: party.host,
      class: "priest",
      level: 10,
      hp: 40,
      position: centre(3, 3),
    });
    const allyHero = await testHero("NovaAlly", {
      party,
      color: "yellow",
      level: 10,
      hp: 40,
      position: centre(2, 3),
    });
    const priest = await Client.joinHero(priestHero);
    const ally = await Client.joinHero(allyHero);
    const welcome = await until("Nova party welcomed", () =>
      priest.welcome && ally.welcome ? priest.welcome : undefined,
    );
    const monster = welcome.monsters[0];
    if (!monster) throw new Error("expected Nova's monster");

    priest.skill(5);
    const result = await until("Nova heals and damages", () => {
      const caster = priest.self();
      const friend = ally.self();
      const target = priest.latestSnapshot?.monsters.find((entry) => entry.id === monster.id);
      return caster &&
        friend &&
        target &&
        caster.hp > 40 &&
        friend.hp > 40 &&
        target.hp < monster.hp
        ? { caster, friend, target }
        : undefined;
    });
    expect(result.target.hp).toBe(monster.hp - 44);
    await scheduler.wait(300);
    expect(
      priest.received.filter((message) => message.t === "event" && message.code === "combat.hit"),
    ).toHaveLength(1);
    expect(
      ally.received.find((message) => message.t === "event" && message.code === "heal.received"),
    ).toMatchObject({ params: { color: "ember" } });
    priest.close();
    ally.close();
  });

  it("isolates two parties playing the same adventure and fences duplicate hero connections", {
    timeout: 15_000,
  }, async () => {
    const party = await seedParty("isolation");
    const secondParty = await testParty("isolation2", { host: party.host, adventure: party });
    const firstHero = await testHero("First", { party, class: "ranger" });
    const secondHero = await testHero("Second", { party: secondParty, class: "ranger" });

    const first = await Client.joinHero(firstHero);
    const second = await Client.joinHero(secondHero);
    await until("both isolated welcomes", () => first.welcome && second.welcome);
    expect(first.welcome?.players.map((player) => player.id)).toEqual([firstHero.heroId]);
    expect(second.welcome?.players.map((player) => player.id)).toEqual([secondHero.heroId]);
    const firstRoom = await env.WORLD.getByName(firstHero.roomKey).roomDiagnostics();
    const secondRoom = await env.WORLD.getByName(secondHero.roomKey).roomDiagnostics();
    expect(firstRoom.playerIds).toEqual([firstHero.heroId]);
    expect(secondRoom.playerIds).toEqual([secondHero.heroId]);

    first.action("attack");
    const isolatedArrow = await until("first party owns its arrow", () =>
      first.latestSnapshot?.projectiles.find(
        (projectile) => projectile.ownerId === firstHero.heroId,
      ),
    );
    expect(isolatedArrow.kind).toBe("arrow");
    expect(second.latestSnapshot?.projectiles).toEqual([]);
    const otherRoom = await env.WORLD.getByName(secondHero.roomKey).roomDiagnostics();
    expect(otherRoom.projectiles).toEqual([]);

    const replacement = await Client.joinHero(firstHero);
    await until("replacement welcome", () => replacement.welcome);
    const replaced = await until("old hero fenced", () => first.closeInfo ?? undefined);
    expect(replaced.code).toBe(WS_CLOSE.CHARACTER_REPLACED);
  });

  it("rejects foreign heroes and maps member colour to the Tiny Swords appearance", async () => {
    const party = await seedParty("host");
    const outsider = await testAccount("outsider");
    const hostHero = await testHero("Host", { party, account: party.host, class: "warrior" });
    const memberHero = await testHero("Red", { party, class: "ranger", color: "red" });

    expect((await rejectHero(outsider, party.partyId, hostHero.heroId)).status).toBe(403);
    expect((await rejectHero(hostHero, party.partyId, memberHero.heroId)).status).toBe(403);
    const red = await Client.joinHero(memberHero);
    const welcome = await until("red hero welcome", () => red.welcome);
    expect(
      welcome.players.find((player) => player.id === memberHero.heroId)?.appearance.primaryColor,
    ).toBe("ember");
  });

  it("repairs an out-of-adventure map and resumes persisted hero position and core stats", async () => {
    const party = await seedParty("resume");
    const hero = await testHero("Persistent", {
      party,
      class: "warrior",
      position: { x: 999, y: 999 },
      level: 3,
      xp: 17,
      hp: 73,
    });
    await env.DB.prepare("UPDATE hero SET map_id = ? WHERE id = ?")
      .bind(crypto.randomUUID(), hero.heroId)
      .run();

    const repaired = await Client.joinHero(hero);
    const repairedWelcome = await until("repaired hero welcome", () => repaired.welcome);
    expect(repairedWelcome.world.zoneId).toBe(party.mapA);
    expect(repaired.self()).toMatchObject({ ...centre(2, 2), level: 3, hp: 73 });
    expect(repaired.latestState?.xp).toBe(17);
    repaired.press("right");
    await until("hero moved before resume", () => {
      const self = repaired.self();
      return self && self.x > centre(2, 2).x + 10 ? self : undefined;
    });
    repaired.release();
    await scheduler.wait(400);
    const resting = await until("hero resting position", () => repaired.self());
    repaired.close();
    await until("hero disconnected", () => repaired.closeInfo ?? undefined);

    const resumed = await Client.joinHero(hero);
    await until("resumed hero welcome", () => resumed.welcome);
    expect(resumed.self()?.x).toBeCloseTo(resting.x, 0);
    expect(resumed.self()).toMatchObject({ level: 3, hp: 73 });
    expect(resumed.latestState?.xp).toBe(17);
  }, 10_000);

  it("broadcasts party chat across map rooms and completes END exactly once", async () => {
    const party = await seedParty("victory");
    const hostHero = await testHero("Scout", { party, account: party.host, class: "warrior" });
    const finisher = await testHero("Finisher", {
      party,
      class: "priest",
      color: "purple",
      mapId: party.mapB,
      position: centre(5, 3),
    });

    const scout = await Client.joinHero(hostHero);
    const ender = await Client.joinHero(finisher);
    await until("two map rooms welcomed", () => scout.welcome && ender.welcome);
    scout.partyChat("Across rooms");
    const remoteChat = await until("cross-room party chat", () =>
      ender.received.find(
        (message) =>
          message.t === "chat" && message.channel === "party" && message.text === "Across rooms",
      ),
    );
    expect(remoteChat).toMatchObject({ from: "Scout" });
    scout.chat("Only here");
    await scheduler.wait(250);
    expect(
      ender.received.some(
        (message) =>
          message.t === "chat" && message.channel === "local" && message.text === "Only here",
      ),
    ).toBe(false);

    await until("victory in source room", () =>
      scout.received.find(
        (message) => message.t === "event" && message.code === "adventure.victory",
      ),
    );
    await until("victory in ending room", () =>
      ender.received.find(
        (message) => message.t === "event" && message.code === "adventure.victory",
      ),
    );
    expect(ender.closeInfo).toBeNull();
    await scheduler.wait(900);
    expect(
      ender.received.filter(
        (message) => message.t === "event" && message.code === "adventure.victory",
      ),
    ).toHaveLength(1);
    const completed = await env.DB.prepare("SELECT status FROM party WHERE id = ?")
      .bind(party.partyId)
      .first<{ status: string }>();
    expect(completed?.status).toBe("completed");
  }, 10_000);

  it("stops and resets an authored room after its last hero leaves", async () => {
    const party = await seedParty("unload");
    const hero = await testHero("Visitor", { party, class: "warrior" });
    const client = await Client.joinHero(hero);
    await until("room started", () => client.welcome);
    const stub = env.WORLD.getByName(hero.roomKey);
    expect((await stub.roomDiagnostics()).tickActive).toBe(true);
    client.close();
    await until("room client closed", () => client.closeInfo ?? undefined);
    await until("room tick stopped", async () => {
      const diagnostics = await stub.roomDiagnostics();
      return diagnostics.tickActive ? undefined : diagnostics;
    });
    const unloaded = await stub.roomDiagnostics();
    expect(unloaded.playerIds).toEqual([]);
    expect(unloaded.monsters).toEqual([
      expect.objectContaining({ species: "torch_goblin", patrolRadius: 192 }),
    ]);
  });
});

/**
 * A hero room is named `${partyId}:${mapId}` and admission refuses any other room key, so the
 * persistent party — not the in-room `party.*` runtime, which no hero can ever build — is what
 * "who is in my party" has to mean when a monster pays out.
 */
function rewardMapInput(): TestMapBody {
  return testMapInput("Shared kill", {
    cols: 40,
    rows: 15,
    spawn: { col: 2, row: 2 },
    exit: { col: 38, row: 13 },
    // The smallest legal patrol, so the goblin stays inside a level-10 warrior's reach.
    monsterSpawns: [{ col: 10, row: 8, species: "torch_goblin", patrolRadius: 32 }],
  });
}

describe("cooperative rewards inside a party room", () => {
  it("splits experience with an idle hero party member but never loot or kill credit", async () => {
    const party = await testParty("coopxp", { maps: [rewardMapInput()] });
    // On top of the goblin: a level-10 warrior hits for 66, so one swing settles a 48 HP goblin.
    const killerHero = await testHero("Striker", {
      party,
      account: party.host,
      class: "warrior",
      level: 10,
      position: centre(10, 8),
    });
    // 576 px away: inside REWARD_DISTANCE (900) and outside MONSTER_AGGRO_RANGE (210), so this
    // hero cannot even accumulate the proximity threat that would make it a contributor.
    const idleHero = await testHero("Idler", {
      party,
      class: "warrior",
      level: 10,
      position: centre(19, 8),
    });
    // 1472 px away: a party member, but too far to be paid.
    const farHero = await testHero("Distant", {
      party,
      class: "warrior",
      level: 10,
      position: centre(33, 8),
    });

    const killer = await Client.joinHero(killerHero);
    const idle = await Client.joinHero(idleHero);
    const far = await Client.joinHero(farHero);
    await until("three heroes welcomed", () => killer.welcome && idle.welcome && far.welcome);
    const monster = killer.welcome?.monsters[0];
    if (!monster) throw new Error("expected the authored goblin");

    let lastAttackAt = 0;
    const killed = await until("the killer defeats the goblin", () => {
      if (Date.now() - lastAttackAt >= ATTACK_COOLDOWN_MS) {
        lastAttackAt = Date.now();
        killer.action("attack");
      }
      return killer.received.find(
        (message) => message.t === "event" && message.code === "monster.defeated",
      );
    });

    // A goblin is worth 28 XP. Two eligible heroes means 14 each — the killer keeping all 28 is
    // exactly the symptom of the party never being consulted.
    expect(killed).toMatchObject({ params: { xp: 14 } });
    const shared = await until("the idle member shares the kill", () =>
      idle.received.find((message) => message.t === "event" && message.code === "monster.defeated"),
    );
    expect(shared).toMatchObject({ params: { xp: 14 } });
    await until("the idle member banks its share", () => idle.latestState?.xp === 14);

    // Loot and quest credit are minted per recipient, so they stay with the contributor. Loot is
    // only ever sent to its owner, so an empty list is proof of absence rather than of distance.
    await scheduler.wait(1_000);
    expect(idle.latestSnapshot?.loot ?? []).toEqual([]);
    expect(
      idle.received.some((message) => message.t === "event" && message.code === "loot.picked"),
    ).toBe(false);
    expect(
      idle.received.some((message) => message.t === "event" && message.code.startsWith("quest.")),
    ).toBe(false);
    // The killer did earn a drop. It lands at the goblin's feet, where the killer is standing, so
    // it is often collected the same tick it appears — accept either sighting.
    expect(
      (killer.latestSnapshot?.loot.length ?? 0) > 0 ||
        killer.received.some((message) => message.t === "event" && message.code === "loot.picked"),
    ).toBe(true);

    // Distance still gates the party: standing in the next postcode earns nothing at all.
    expect(
      far.received.some((message) => message.t === "event" && message.code === "monster.defeated"),
    ).toBe(false);
    expect(far.latestState?.xp).toBe(0);
  }, 20_000);
});

/**
 * The party roster a hero sees is the persistent party its room is named after. `party.*` is
 * refused for heroes, so the in-room party runtime is permanently empty here: a roster built from
 * it would leave every hero believing it adventures alone.
 */
function rosterMapInput(): TestMapBody {
  return testMapInput("Roster", {
    cols: 20,
    rows: 15,
    spawn: { col: 2, row: 2 },
    exit: { col: 18, row: 13 },
  });
}

describe("party state inside a hero room", () => {
  it("lists every hero of the persistent party sharing the room", async () => {
    const party = await testParty("roster", { maps: [rosterMapInput()] });
    const firstHero = await testHero("Ana", {
      party,
      account: party.host,
      level: 10,
      position: centre(2, 2),
    });
    const secondHero = await testHero("Bo", { party, level: 10, position: centre(4, 2) });

    const first = await Client.joinHero(firstHero);
    const second = await Client.joinHero(secondHero);
    await until("both heroes welcomed", () => first.welcome && second.welcome);
    const firstId = first.welcome?.selfId;
    const secondId = second.welcome?.selfId;
    if (!firstId || !secondId) throw new Error("expected both heroes to know their own id");

    const expected = [firstId, secondId].sort();
    for (const [label, client] of [
      ["the first hero", first],
      ["the second hero", second],
    ] as const) {
      const roster = await until(`${label} sees the whole party`, () =>
        client.received.find(
          (message) => message.t === "party.state" && message.party?.members.length === 2,
        ),
      );
      if (roster.t !== "party.state" || !roster.party) throw new Error("expected a party state");
      expect(roster.party.id).toBe(party.partyId);
      expect(roster.party.members.map((member) => member.id).sort()).toEqual(expected);
      expect(roster.party.members.map((member) => member.nick).sort()).toEqual(["Ana", "Bo"]);
      for (const member of roster.party.members) {
        expect(member.maxHp).toBe(maxHpForLevel(10));
        expect(member.hp).toBe(maxHpForLevel(10));
        expect(member.life).toBe("alive");
      }
    }
  }, 20_000);

  it("keeps a member's health bar live rather than freezing it at admission", async () => {
    const party = await testParty("wounded", { maps: [rosterMapInput()] });
    const watcherHero = await testHero("Watcher", {
      party,
      account: party.host,
      level: 10,
      position: centre(2, 2),
    });
    // Wounded before it ever connects, so the roster has somewhere to move to.
    const woundedHero = await testHero("Wounded", {
      party,
      level: 10,
      hp: 50,
      position: centre(4, 2),
    });

    const watcher = await Client.joinHero(watcherHero);
    const wounded = await Client.joinHero(woundedHero);
    await until("both heroes welcomed", () => watcher.welcome && wounded.welcome);
    const woundedId = wounded.welcome?.selfId;
    if (!woundedId) throw new Error("expected the wounded hero to know its own id");

    const before = await until("the watcher sees its ally wounded", () =>
      watcher.received.find(
        (message) =>
          message.t === "party.state" &&
          message.party?.members.some((member) => member.id === woundedId && member.hp === 50),
      ),
    );
    if (before.t !== "party.state") throw new Error("expected a party state");

    // A potion is an authoritative heal: the server decides how much and tells the room.
    wounded.usePotion();
    const after = await until("the watcher sees the potion land", () =>
      watcher.received.find(
        (message) =>
          message.t === "party.state" &&
          message.party?.members.some((member) => member.id === woundedId && member.hp > 50),
      ),
    );
    if (after.t !== "party.state" || !after.party) throw new Error("expected a party state");
    const healed = after.party.members.find((member) => member.id === woundedId);
    expect(healed?.hp).toBeGreaterThan(50);
    expect(healed?.hp).toBeLessThanOrEqual(maxHpForLevel(10));
  }, 20_000);

  it("re-sends the roster only when it changes", async () => {
    const party = await testParty("quiet", { maps: [rosterMapInput()] });
    const firstHero = await testHero("Still", {
      party,
      account: party.host,
      level: 10,
      position: centre(2, 2),
    });
    const secondHero = await testHero("Statue", { party, level: 10, position: centre(4, 2) });

    const first = await Client.joinHero(firstHero);
    const second = await Client.joinHero(secondHero);
    await until("both heroes welcomed", () => first.welcome && second.welcome);
    await until("the roster lists both heroes", () =>
      first.received.find(
        (message) => message.t === "party.state" && message.party?.members.length === 2,
      ),
    );

    // Nothing about an idle party changes, but the tick loop runs 10 network ticks a second. A
    // roster rebroadcast per tick would show up here as a pile of identical messages.
    const before = first.received.filter((message) => message.t === "party.state").length;
    await scheduler.wait(1_500);
    const after = first.received.filter((message) => message.t === "party.state").length;
    expect(after).toBe(before);
  }, 20_000);
});
