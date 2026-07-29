import { env } from "cloudflare:test";
import { layeredWireTerrain } from "@lindocara/testing/map-fixtures.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  Client,
  tileCentre as centre,
  drainHeroRooms,
  type TestHero,
  type TestHeroOptions,
  type TestMapBody,
  testHero,
  testMapInput,
  testParty,
  until,
  waitForRoomSockets,
} from "./world-harness.js";

function rogueOpeningMapInput(): TestMapBody {
  return testMapInput("Rogue opening", {
    cols: 20,
    rows: 15,
    spawn: { col: 4, row: 5 },
    exit: { col: 18, row: 13 },
    monsterSpawns: [{ col: 7, row: 5, species: "mire_troll", patrolRadius: 32 }],
  });
}

function rogueWallMapInput(): TestMapBody {
  const map = testMapInput("Rogue wall", {
    cols: 20,
    rows: 15,
    spawn: { col: 4, row: 5 },
    exit: { col: 18, row: 13 },
    monsterSpawns: [{ col: 8, row: 5, species: "mire_troll", patrolRadius: 32 }],
  });
  return {
    ...map,
    ...layeredWireTerrain(
      Array.from({ length: map.rows }, (_, row) =>
        row === 5 ? `${".".repeat(6)}#${".".repeat(map.cols - 7)}` : ".".repeat(map.cols),
      ),
    ),
  };
}

function rogueStealthMapInput(monsterCol: number): TestMapBody {
  return testMapInput("Rogue stealth", {
    cols: 20,
    rows: 15,
    spawn: { col: 5, row: 5 },
    exit: { col: 18, row: 13 },
    monsterSpawns: [{ col: monsterCol, row: 5, species: "mire_troll", patrolRadius: 32 }],
  });
}

function roguePoisonMapInput(monsterMaxHp: number): TestMapBody {
  const map = testMapInput("Rogue poison", {
    cols: 20,
    rows: 15,
    spawn: { col: 5, row: 5 },
    exit: { col: 18, row: 13 },
    monsterSpawns: [{ col: 6, row: 5, species: "mire_troll", patrolRadius: 32 }],
  });
  return {
    ...map,
    events: map.events.map((event) =>
      event.kind === "monster"
        ? {
            ...event,
            monsterMaxHp,
            monsterDamage: 1,
            monsterSpeed: 20,
            monsterXp: 28,
            monsterRespawnMode: "never" as const,
          }
        : event,
    ),
  };
}

function rogueDanceMapInput(monsterCount: number, wallCol?: number): TestMapBody {
  const cols = 24;
  const rows = 15;
  const map = testMapInput("Rogue dance", {
    cols,
    rows,
    spawn: { col: 5, row: 5 },
    exit: { col: 22, row: 13 },
    monsterSpawns: Array.from({ length: monsterCount }, (_, index) => ({
      col: 7 + index * 2,
      row: 5,
      species: "mire_troll" as const,
      patrolRadius: 32,
    })),
  });
  const tuned = {
    ...map,
    events: map.events.map((event) =>
      event.kind === "monster"
        ? {
            ...event,
            monsterMaxHp: 500,
            monsterDamage: 1,
            monsterSpeed: 20,
            monsterXp: 0,
            monsterRespawnMode: "never" as const,
          }
        : event,
    ),
  };
  if (wallCol === undefined) return tuned;
  return {
    ...tuned,
    ...layeredWireTerrain(
      Array.from(
        { length: rows },
        () => `${".".repeat(wallCol)}#${".".repeat(cols - wallCol - 1)}`,
      ),
    ),
  };
}

/**
 * Commit 6 deliberately keeps Rogue out of the public create input. Runtime integration still
 * needs a real D1 hero and WebSocket, so create a normal fixture then switch only its stored class
 * before admission. Profile loading normalizes the incompatible starter weapon back to daggers.
 */
async function hiddenRogueHero(
  name: string,
  options: Omit<TestHeroOptions, "class"> = {},
): Promise<TestHero> {
  const hero = await testHero(name, { ...options, class: "warrior" });
  await env.DB.prepare("UPDATE hero SET class = 'rogue' WHERE id = ?").bind(hero.heroId).run();
  await env.DB.prepare("DELETE FROM hero_skill WHERE hero_id = ?").bind(hero.heroId).run();
  return hero;
}

async function waitForMonsterThreat(
  roomKey: string,
  playerId: string,
  present: boolean,
): Promise<void> {
  const room = env.WORLD.getByName(roomKey);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const diagnostics = await room.roomDiagnostics();
    const found = diagnostics.monsters.some((monster) =>
      monster.threat.some((entry) => entry.playerId === playerId),
    );
    if (found === present) return;
    await scheduler.wait(20);
  }
  throw new Error(`timed out waiting for monster threat present=${present}`);
}

async function waitForDamageOverTime(roomKey: string, count: number): Promise<void> {
  const room = env.WORLD.getByName(roomKey);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const diagnostics = await room.roomDiagnostics();
    if (diagnostics.damageOverTime.length === count) return;
    await scheduler.wait(20);
  }
  throw new Error(`timed out waiting for ${count} damage-over-time effects`);
}

async function castPoisonedShiv(client: Client): Promise<number> {
  client.skill(2);
  const step = await until("poison setup Shadow Step", () =>
    client.received.find(
      (message) => message.t === "animation" && message.skillId === "shadow_step",
    ),
  );
  if (step.t !== "animation") throw new Error("expected poison setup Shadow Step");
  await scheduler.wait(Math.max(0, step.recoveryEndsAt - Date.now() + 20));

  const eventOffset = client.received.length;
  client.skill(4);
  await until("Poisoned Shiv direct impact", () =>
    client.received
      .slice(eventOffset)
      .find(
        (message) =>
          message.t === "event" &&
          message.code === "combat.hit" &&
          message.params?.skill === "poisoned_shiv" &&
          message.params.poisonTick !== 1,
      ),
  );
  return eventOffset;
}

afterEach(async () => {
  await drainHeroRooms();
});

describe("Rogue authoritative opening and mobility", { timeout: 12_000 }, () => {
  it("plans Shadow Step server-side and consumes Opening only after Dual Slash really lands", async () => {
    const party = await testParty("rogue-opening", { maps: [rogueOpeningMapInput()] });
    const hero = await hiddenRogueHero("Shade", {
      party,
      account: party.host,
      level: 3,
      position: centre(4, 5),
    });
    const client = await Client.joinHero(hero);
    try {
      const welcome = await until("rogue opening welcome", () => client.welcome);
      const target = welcome.monsters[0];
      if (!target) throw new Error("expected the Shadow Step target");
      expect(client.self()).toMatchObject({
        class: "rogue",
        equipment: { mainHand: "shadow_daggers", offHand: null },
      });

      client.skill(2);
      const stepAnimation = await until("Shadow Step animation", () =>
        client.received.find(
          (message) => message.t === "animation" && message.skillId === "shadow_step",
        ),
      );
      if (stepAnimation.t !== "animation") throw new Error("expected Shadow Step animation");
      await until("authoritative Shadow Step", () => {
        const self = client.self();
        return self && self.x > target.x ? self : undefined;
      });
      const opening = await until("Shadow Step grants Opening", () => {
        const state = client.latestState;
        const deadline = state?.rogue?.openingUntil ?? 0;
        return deadline > (state?.serverNow ?? 0) ? deadline : undefined;
      });
      await scheduler.wait(Math.max(0, stepAnimation.recoveryEndsAt - Date.now() + 20));

      // Turn away and miss. Starting the attack still spends its normal 325 ms cadence, but the
      // server must retain Opening because no valid monster was hit.
      client.press("right");
      await scheduler.wait(60);
      client.release();
      const beforeMissHp =
        client.latestSnapshot?.monsters.find((monster) => monster.id === target.id)?.hp ??
        target.hp;
      const eventsBeforeMiss = client.received.length;
      client.action("attack");
      await until("missed Dual Slash animation", () =>
        client.received
          .slice(eventsBeforeMiss)
          .find((message) => message.t === "animation" && message.skillId === "dual_slash"),
      );
      await scheduler.wait(350);
      expect(client.latestSnapshot?.monsters.find((monster) => monster.id === target.id)?.hp).toBe(
        beforeMissHp,
      );
      expect(
        client.received
          .slice(eventsBeforeMiss)
          .some(
            (message) =>
              message.t === "event" &&
              message.code === "combat.hit" &&
              message.params?.skill === "dual_slash",
          ),
      ).toBe(false);
      expect(client.latestState?.rogue?.openingUntil).toBe(opening);

      // Face back toward the server-selected target. Two dagger animation frames still produce one
      // damage event and one 28 * 1.4 = 39 authoritative damage resolution.
      client.press("left");
      await scheduler.wait(60);
      client.release();
      const eventsBeforeHit = client.received.length;
      client.action("attack");
      const hit = await until("Opening Dual Slash lands", () =>
        client.received
          .slice(eventsBeforeHit)
          .find(
            (message) =>
              message.t === "event" &&
              message.code === "combat.hit" &&
              message.params?.skill === "dual_slash",
          ),
      );
      expect(hit).toMatchObject({ params: { damage: 39, basic: 1 } });
      await scheduler.wait(150);
      expect(
        client.received
          .slice(eventsBeforeHit)
          .filter(
            (message) =>
              message.t === "event" &&
              message.code === "combat.hit" &&
              message.params?.skill === "dual_slash",
          ),
      ).toHaveLength(1);
      expect(client.latestSnapshot?.monsters.find((monster) => monster.id === target.id)?.hp).toBe(
        beforeMissHp - 39,
      );
      expect(client.latestState?.rogue?.openingUntil).toBe(0);
    } finally {
      client.close();
    }
  });

  it("rejects Shadow Step through a wall without moving or starting its cooldown", async () => {
    const party = await testParty("rogue-wall", { maps: [rogueWallMapInput()] });
    const hero = await hiddenRogueHero("Walled", {
      party,
      account: party.host,
      level: 3,
      position: centre(4, 5),
    });
    const client = await Client.joinHero(hero);
    try {
      const welcome = await until("walled Rogue welcome", () => client.welcome);
      const start = welcome.players.find((player) => player.id === hero.heroId);
      if (!start) throw new Error("expected the walled Rogue");

      client.skill(2);
      await until("no visible Shadow Step target", () =>
        client.received.find(
          (message) => message.t === "event" && message.code === "skill.no_target",
        ),
      );
      await scheduler.wait(250);
      expect(client.self()).toMatchObject({ x: start.x, y: start.y });
      expect(client.latestState?.cooldowns?.skillCooldowns[1]).toBe(0);
      expect(
        client.received.some(
          (message) => message.t === "animation" && message.skillId === "shadow_step",
        ),
      ).toBe(false);
      expect(client.latestState?.rogue?.openingUntil).toBe(0);
    } finally {
      client.close();
    }
  });
});

describe("Rogue authoritative stealth", { timeout: 15_000 }, () => {
  it("drops aggro, withholds the position from peers, and starts cooldown on offensive exit", async () => {
    const party = await testParty("rogue-stealth-peer", { maps: [rogueStealthMapInput(7)] });
    const hero = await hiddenRogueHero("Veil", {
      party,
      account: party.host,
      level: 5,
      position: centre(5, 5),
    });
    const observerHero = await testHero("Witness", {
      party,
      level: 5,
      position: centre(1, 5),
    });
    const rogue = await Client.joinHero(hero);
    const observer = await Client.joinHero(observerHero);
    try {
      await until("stealth Rogue welcome", () => rogue.welcome);
      await until("stealth observer welcome", () => observer.welcome);
      await until("observer initially sees Rogue", () =>
        observer.latestSnapshot?.players.find((player) => player.id === hero.heroId),
      );
      await waitForMonsterThreat(hero.roomKey, hero.heroId, true);

      rogue.skill(3);
      const vanishAnimation = await until("Vanish animation", () =>
        rogue.received.find((message) => message.t === "animation" && message.skillId === "vanish"),
      );
      if (vanishAnimation.t !== "animation") throw new Error("expected Vanish animation");
      await until("local Rogue enters stealth", () => {
        const state = rogue.latestState;
        return (state?.rogue?.stealthUntil ?? 0) > (state?.serverNow ?? 0) ? state : undefined;
      });
      expect(rogue.latestState?.cooldowns?.skillCooldowns[2]).toBe(0);
      await until("local Rogue is visually faded", () =>
        rogue.self()?.invisible === true ? rogue.self() : undefined,
      );
      await until("peer no longer receives Rogue position", () =>
        observer.latestSnapshot?.players.some((player) => player.id === hero.heroId)
          ? undefined
          : observer.latestSnapshot,
      );
      await waitForMonsterThreat(hero.roomKey, hero.heroId, false);

      await scheduler.wait(Math.max(0, vanishAnimation.recoveryEndsAt - Date.now() + 20));
      rogue.press("left");
      await scheduler.wait(60);
      rogue.release();
      expect(rogue.latestState?.rogue?.stealthUntil).toBeGreaterThan(
        rogue.latestState?.serverNow ?? 0,
      );

      rogue.action("attack");
      const exited = await until("offensive Vanish exit", () => {
        const state = rogue.latestState;
        const cooldown = state?.cooldowns?.skillCooldowns[2] ?? 0;
        const opening = state?.rogue?.openingUntil ?? 0;
        return state?.rogue?.stealthUntil === 0 &&
          cooldown > (state.serverNow ?? 0) &&
          opening > (state.serverNow ?? 0)
          ? state
          : undefined;
      });
      expect(
        (exited.cooldowns?.skillCooldowns[2] ?? 0) - (exited.serverNow ?? 0),
      ).toBeGreaterThanOrEqual(13_500);
      await until("peer sees Rogue reappear", () =>
        observer.latestSnapshot?.players.find(
          (player) => player.id === hero.heroId && player.invisible !== true,
        ),
      );
    } finally {
      rogue.close();
      observer.close();
    }
  });

  it("lets an already wound-up monster hit and break Vanish without granting Opening", async () => {
    const party = await testParty("rogue-stealth-hit", { maps: [rogueStealthMapInput(6)] });
    const hero = await hiddenRogueHero("Interrupted", {
      party,
      account: party.host,
      level: 5,
      position: centre(5, 5),
    });
    const client = await Client.joinHero(hero);
    try {
      const welcome = await until("incoming hit Rogue welcome", () => client.welcome);
      const initialHp = welcome.players.find((player) => player.id === hero.heroId)?.hp;
      if (initialHp === undefined) throw new Error("expected incoming hit Rogue");
      await until("monster begins its authoritative wind-up", () =>
        client.received.find(
          (message) => message.t === "animation" && message.actorKind === "monster",
        ),
      );

      client.skill(3);
      await until("Vanish enters before impact", () => {
        const state = client.latestState;
        return (state?.rogue?.stealthUntil ?? 0) > (state?.serverNow ?? 0) ? state : undefined;
      });
      await until("local stealth snapshot before impact", () =>
        client.self()?.invisible === true ? client.self() : undefined,
      );
      await until("wound-up strike still damages Rogue", () =>
        client.received.find((message) => message.t === "event" && message.code === "combat.hurt"),
      );
      const exited = await until("damage exits Vanish", () => {
        const state = client.latestState;
        return state?.rogue?.stealthUntil === 0 &&
          (state.cooldowns?.skillCooldowns[2] ?? 0) > (state.serverNow ?? 0)
          ? state
          : undefined;
      });
      expect(client.self()?.hp).toBeLessThan(initialHp);
      expect(exited.rogue?.openingUntil).toBe(0);
    } finally {
      client.close();
    }
  });

  it("clears stealth on disconnect and restores only its bounded cooldown", async () => {
    const party = await testParty("rogue-stealth-reconnect");
    const hero = await hiddenRogueHero("Reconnect", {
      party,
      account: party.host,
      level: 5,
    });
    const first = await Client.joinHero(hero);
    await until("reconnect Rogue welcome", () => first.welcome);
    first.skill(3);
    await until("reconnect Rogue enters stealth", () => {
      const state = first.latestState;
      return (state?.rogue?.stealthUntil ?? 0) > (state?.serverNow ?? 0) ? state : undefined;
    });
    first.close();
    await waitForRoomSockets(hero.roomKey, 0);

    const second = await Client.joinHero(hero);
    try {
      const welcome = await until("reconnected Rogue welcome", () => second.welcome);
      expect(welcome.self.rogue?.stealthUntil).toBe(0);
      expect(welcome.self.rogue?.openingUntil).toBe(0);
      expect(welcome.self.cooldowns?.skillCooldowns[2]).toBeGreaterThan(
        welcome.self.serverNow ?? 0,
      );
      expect(second.self()?.invisible).toBe(false);
    } finally {
      second.close();
    }
  });
});

describe("Rogue authoritative poison", { timeout: 15_000 }, () => {
  it("ticks five times after the Rogue leaves and awards the distant poison kill", async () => {
    const party = await testParty("rogue-poison-credit", {
      maps: [roguePoisonMapInput(85)],
    });
    const hero = await hiddenRogueHero("Venom", {
      party,
      account: party.host,
      level: 7,
      position: centre(5, 5),
    });
    const client = await Client.joinHero(hero);
    try {
      const welcome = await until("poison credit welcome", () => client.welcome);
      const target = welcome.monsters[0];
      if (!target) throw new Error("expected poison target");
      const eventOffset = await castPoisonedShiv(client);

      await waitForDamageOverTime(hero.roomKey, 1);
      client.press("right");
      await scheduler.wait(4_200);
      client.release();

      const tickDamage = await until(
        "five poison ticks and distant kill credit",
        () => {
          const ticks = client.received
            .slice(eventOffset)
            .filter(
              (message) =>
                message.t === "event" &&
                message.code === "combat.hit" &&
                message.params?.skill === "poisoned_shiv" &&
                message.params.poisonTick === 1,
            );
          const reward = client.received
            .slice(eventOffset)
            .find((message) => message.t === "event" && message.code === "monster.defeated");
          return ticks.length === 5 && reward
            ? ticks.map((message) => (message.t === "event" ? message.params?.damage : undefined))
            : undefined;
        },
        6_500,
      );
      expect(tickDamage).toEqual([12, 12, 12, 12, 11]);
      expect(client.latestState?.xp).toBeGreaterThan(0);
      const diagnostics = await env.WORLD.getByName(hero.roomKey).roomDiagnostics();
      expect(diagnostics.loot.some((loot) => loot.ownerId === hero.heroId)).toBe(true);
      expect(diagnostics.damageOverTime).toEqual([]);
    } finally {
      client.close();
    }
  });

  it("removes pending poison on disconnect and never restores it on reconnect", async () => {
    const party = await testParty("rogue-poison-reconnect", {
      maps: [roguePoisonMapInput(145)],
    });
    const hero = await hiddenRogueHero("CleanReconnect", {
      party,
      account: party.host,
      level: 7,
      position: centre(5, 5),
    });
    const observerHero = await testHero("PoisonWitness", {
      party,
      level: 7,
      position: centre(2, 5),
    });
    const rogue = await Client.joinHero(hero);
    const observer = await Client.joinHero(observerHero);
    try {
      const welcome = await until("poison reconnect welcome", () => rogue.welcome);
      const target = welcome.monsters[0];
      if (!target) throw new Error("expected reconnect poison target");
      await until("poison observer welcome", () => observer.welcome);
      await castPoisonedShiv(rogue);
      const damagedHp = await until("observer sees direct Shiv damage", () => {
        const hp = observer.latestSnapshot?.monsters.find(
          (monster) => monster.id === target.id,
        )?.hp;
        return hp !== undefined && hp < target.hp ? hp : undefined;
      });

      rogue.close();
      await waitForDamageOverTime(hero.roomKey, 0);
      await scheduler.wait(1_300);
      expect(
        observer.latestSnapshot?.monsters.find((monster) => monster.id === target.id)?.hp,
      ).toBe(damagedHp);

      const reconnected = await Client.joinHero(hero);
      try {
        await until("poison Rogue reconnects", () => reconnected.welcome);
        expect((await env.WORLD.getByName(hero.roomKey).roomDiagnostics()).damageOverTime).toEqual(
          [],
        );
      } finally {
        reconnected.close();
      }
    } finally {
      rogue.close();
      observer.close();
    }
  });
});

describe("Rogue authoritative Shadow Dance", { timeout: 15_000 }, () => {
  it("fails without a server-selected target and spends no cooldown", async () => {
    const party = await testParty("rogue-dance-empty", {
      maps: [rogueDanceMapInput(0)],
    });
    const hero = await hiddenRogueHero("NoCut", {
      party,
      account: party.host,
      level: 10,
      position: centre(5, 5),
    });
    const client = await Client.joinHero(hero);
    try {
      await until("empty Dance welcome", () => client.welcome);
      client.skill(5);
      await until("empty Dance refusal", () =>
        client.received.find(
          (message) =>
            message.t === "event" &&
            message.code === "skill.no_target" &&
            message.params?.skill === "shadow_dance",
        ),
      );
      expect(client.latestState?.cooldowns?.skillCooldowns[4]).toBe(0);
      expect(
        client.received.some(
          (message) => message.t === "animation" && message.skillId === "shadow_dance",
        ),
      ).toBe(false);
    } finally {
      client.close();
    }
  });

  it("publishes one complete five-target route and resolves each distinct target once", async () => {
    const party = await testParty("rogue-dance-five", {
      maps: [rogueDanceMapInput(5)],
    });
    const hero = await hiddenRogueHero("FiveCuts", {
      party,
      account: party.host,
      level: 10,
      position: centre(5, 5),
    });
    const client = await Client.joinHero(hero);
    try {
      const welcome = await until("five-target Dance welcome", () => client.welcome);
      expect(welcome.monsters).toHaveLength(5);
      const eventOffset = client.received.length;
      client.skill(5);
      const sequence = await until("five-target Shadow Dance result", () =>
        client.received.slice(eventOffset).find((message) => message.t === "rogue.shadow_dance"),
      );
      if (sequence.t !== "rogue.shadow_dance") throw new Error("expected Shadow Dance result");

      expect(sequence.strikes).toHaveLength(5);
      expect(new Set(sequence.strikes.map((strike) => strike.targetId)).size).toBe(5);
      expect(sequence.strikes.map((strike) => strike.damage)).toEqual([50, 50, 50, 50, 50]);
      expect(sequence.strikes.map((strike) => strike.impactAt)).toEqual(
        sequence.strikes.map((_strike, index) => sequence.startedAt + index * 90),
      );
      expect(sequence.finalPosition).toEqual(sequence.strikes.at(-1)?.landing);
      expect(
        client.received
          .slice(eventOffset)
          .some(
            (message) =>
              message.t === "event" &&
              message.code === "combat.hit" &&
              message.params?.skill === "shadow_dance",
          ),
      ).toBe(false);

      await until("Shadow Dance final authoritative position", () => {
        const self = client.self();
        return self &&
          Math.abs(self.x - sequence.finalPosition.x) < 0.01 &&
          Math.abs(self.y - sequence.finalPosition.y) < 0.01
          ? self
          : undefined;
      });
      client.press("left");
      await scheduler.wait(180);
      client.release();
      expect(client.self()?.x).toBeCloseTo(sequence.finalPosition.x, 2);
      expect(client.self()?.y).toBeCloseTo(sequence.finalPosition.y, 2);
      for (const target of welcome.monsters) {
        expect(
          client.latestSnapshot?.monsters.find((monster) => monster.id === target.id)?.hp,
        ).toBe(450);
      }
      expect(client.latestState?.cooldowns?.skillCooldowns[4]).toBeGreaterThan(
        client.latestState?.serverNow ?? 0,
      );
    } finally {
      client.close();
    }
  });

  it("hits a lone target only once in the base version", async () => {
    const party = await testParty("rogue-dance-single", {
      maps: [rogueDanceMapInput(1)],
    });
    const hero = await hiddenRogueHero("OneCut", {
      party,
      account: party.host,
      level: 10,
      position: centre(5, 5),
    });
    const client = await Client.joinHero(hero);
    try {
      const welcome = await until("single-target Dance welcome", () => client.welcome);
      const target = welcome.monsters[0];
      if (!target) throw new Error("expected lone Dance target");
      client.skill(5);
      const sequence = await until("single-target Shadow Dance result", () =>
        client.received.find((message) => message.t === "rogue.shadow_dance"),
      );
      if (sequence.t !== "rogue.shadow_dance") throw new Error("expected Shadow Dance result");
      expect(sequence.strikes).toEqual([
        expect.objectContaining({ targetId: target.id, damage: 50, killed: false }),
      ]);
      await until("single Dance damage snapshot", () => {
        const current = client.latestSnapshot?.monsters.find((monster) => monster.id === target.id);
        return current?.hp === 450 ? current : undefined;
      });
    } finally {
      client.close();
    }
  });

  it("stops its route at an authored wall instead of crossing to the next target", async () => {
    const party = await testParty("rogue-dance-wall", {
      maps: [rogueDanceMapInput(2, 8)],
    });
    const hero = await hiddenRogueHero("WallCut", {
      party,
      account: party.host,
      level: 10,
      position: centre(5, 5),
    });
    const client = await Client.joinHero(hero);
    try {
      const welcome = await until("walled Dance welcome", () => client.welcome);
      expect(welcome.monsters).toHaveLength(2);
      client.skill(5);
      const sequence = await until("walled Shadow Dance result", () =>
        client.received.find((message) => message.t === "rogue.shadow_dance"),
      );
      if (sequence.t !== "rogue.shadow_dance") throw new Error("expected Shadow Dance result");
      expect(sequence.strikes).toHaveLength(1);
      const hitId = sequence.strikes[0]?.targetId;
      const untouched = welcome.monsters.find((monster) => monster.id !== hitId);
      if (!untouched) throw new Error("expected target across wall");
      await scheduler.wait(250);
      expect(
        client.latestSnapshot?.monsters.find((monster) => monster.id === untouched.id)?.hp,
      ).toBe(500);
    } finally {
      client.close();
    }
  });
});
