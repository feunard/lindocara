import { env } from "cloudflare:test";
import { ROGUE_BALANCE } from "@lindocara/engine/rogue.js";
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

const SHADOW_STEP_PREREQUISITES = [
  "rogue.shadow_step.ambush",
  "rogue.shadow_step.reach",
  "rogue.shadow_step.readiness",
] as const;
const VANISH_PREREQUISITES = [
  "rogue.vanish.ambush",
  "rogue.vanish.readiness",
  "rogue.vanish.mastery",
] as const;
const POISONED_SHIV_PREREQUISITES = [
  "rogue.poisoned_shiv.force",
  "rogue.poisoned_shiv.reach",
  "rogue.poisoned_shiv.readiness",
] as const;
const SHADOW_DANCE_PREREQUISITES = [
  "rogue.shadow_dance.force",
  "rogue.shadow_dance.reach",
  "rogue.shadow_dance.readiness",
] as const;

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

function rogueDanceMapInput(
  monsterCount: number,
  wallCol?: number,
  monsterMaxHp = 500,
): TestMapBody {
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
            monsterMaxHp,
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

/** Creates the public Rogue through the same API as the class picker, then applies only the
 * high-level talent fixture a scenario explicitly requested. */
async function rogueHero(
  name: string,
  options: Omit<TestHeroOptions, "class"> & { talents?: readonly string[] } = {},
): Promise<TestHero> {
  const { talents = [], ...heroOptions } = options;
  const hero = await testHero(name, { ...heroOptions, class: "rogue" });
  if (talents.length > 0) {
    await env.DB.prepare("UPDATE hero SET talents = ? WHERE id = ?")
      .bind(JSON.stringify(talents), hero.heroId)
      .run();
  }
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

interface DamageOverTimeDiagnostic {
  kind: "poison";
  sourceId: string;
  targetKind: "monster" | "player";
  targetId: string;
  stacks: number;
  remainingPower: number;
}

async function waitForDamageOverTimeEffect(
  roomKey: string,
  label: string,
  predicate: (effect: DamageOverTimeDiagnostic) => boolean,
): Promise<DamageOverTimeDiagnostic> {
  const room = env.WORLD.getByName(roomKey);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const effect = (await room.roomDiagnostics()).damageOverTime[0];
    if (effect && predicate(effect)) return effect;
    await scheduler.wait(20);
  }
  throw new Error(`timed out waiting for ${label}`);
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

async function resetCombatCooldowns(client: Client, label: string): Promise<void> {
  const offset = client.received.length;
  client.chat("/resetcd");
  await until(label, () =>
    client.received
      .slice(offset)
      .find((message) => message.t === "event" && message.code === "cheat.cooldowns"),
  );
}

async function castNearbyShiv(client: Client, label: string): Promise<void> {
  const offset = client.received.length;
  client.skill(4);
  await until(label, () =>
    client.received
      .slice(offset)
      .find(
        (message) =>
          message.t === "event" &&
          message.code === "combat.hit" &&
          message.params?.skill === "poisoned_shiv" &&
          message.params.poisonTick !== 1,
      ),
  );
}

afterEach(async () => {
  await drainHeroRooms();
});

describe("Rogue authoritative opening and mobility", { timeout: 12_000 }, () => {
  it("plans Shadow Step server-side and consumes Opening only after Dual Slash really lands", async () => {
    const party = await testParty("rogue-opening", { maps: [rogueOpeningMapInput()] });
    const hero = await rogueHero("Shade", {
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
      expect(hit).toMatchObject({ params: { basic: 1 } });
      if (hit.t !== "event") throw new Error("expected Opening hit event");
      const openingDamage = hit.params?.critical === 1 ? 59 : 39;
      expect(hit.params?.damage).toBe(openingDamage);
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
        beforeMissHp - openingDamage,
      );
      expect(client.latestState?.rogue?.openingUntil).toBe(0);
    } finally {
      client.close();
    }
  });

  it("rejects Shadow Step through a wall without moving or starting its cooldown", async () => {
    const party = await testParty("rogue-wall", { maps: [rogueWallMapInput()] });
    const hero = await rogueHero("Walled", {
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
    const hero = await rogueHero("Veil", {
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
    const hero = await rogueHero("Interrupted", {
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
      const damaged = await until("damage reaches the player snapshot", () => {
        const self = client.self();
        return self && self.hp < initialHp ? self : undefined;
      });
      expect(damaged.hp).toBeLessThan(initialHp);
      expect(exited.rogue?.openingUntil).toBe(0);
    } finally {
      client.close();
    }
  });

  it("clears stealth on disconnect and restores only its bounded cooldown", async () => {
    const party = await testParty("rogue-stealth-reconnect");
    const hero = await rogueHero("Reconnect", {
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
    const hero = await rogueHero("Venom", {
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
        "poison ticks and distant kill credit",
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
          return ticks.length >= 4 && reward
            ? ticks.map((message) => (message.t === "event" ? message.params?.damage : undefined))
            : undefined;
        },
        6_500,
      );
      expect(tickDamage.length).toBeGreaterThanOrEqual(4);
      expect(tickDamage.length).toBeLessThanOrEqual(5);
      expect(tickDamage.slice(0, -1).every((damage) => damage === 12)).toBe(true);
      expect(tickDamage.at(-1)).toBeGreaterThan(0);
      expect(tickDamage.at(-1)).toBeLessThanOrEqual(12);
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
    const hero = await rogueHero("CleanReconnect", {
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
    const hero = await rogueHero("NoCut", {
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
    const hero = await rogueHero("FiveCuts", {
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
      expect(sequence.strikes.map((strike) => strike.damage).sort((a, b) => a - b)).toEqual([
        50, 50, 50, 50, 75,
      ]);
      expect(sequence.strikes.map((strike) => strike.impactAt)).toEqual(
        sequence.strikes.map(
          (_strike, index) =>
            sequence.startedAt + index * ROGUE_BALANCE.shadowDance.strikeIntervalMs,
        ),
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
        const strike = sequence.strikes.find((candidate) => candidate.targetId === target.id);
        if (!strike) throw new Error(`missing strike for ${target.id}`);
        expect(
          client.latestSnapshot?.monsters.find((monster) => monster.id === target.id)?.hp,
        ).toBe(500 - strike.damage);
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
    const hero = await rogueHero("OneCut", {
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
      expect(sequence.strikes).toHaveLength(1);
      expect(sequence.strikes[0]).toMatchObject({ targetId: target.id, killed: false });
      expect([50, 75]).toContain(sequence.strikes[0]?.damage);
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
    const hero = await rogueHero("WallCut", {
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

describe("Rogue authoritative evolution choices", { timeout: 20_000 }, () => {
  it("uses Executor Opening on the struck target and halves the remaining Shadow Step cooldown", async () => {
    const party = await testParty("rogue-executor", {
      maps: [roguePoisonMapInput(80)],
    });
    const hero = await rogueHero("Executor", {
      party,
      account: party.host,
      level: 10,
      position: centre(5, 5),
      talents: [...SHADOW_STEP_PREREQUISITES, "rogue.shadow_step.executor"],
    });
    const client = await Client.joinHero(hero);
    try {
      await until("Executor welcome", () => client.welcome);
      client.skill(2);
      const step = await until("Executor Shadow Step", () =>
        client.received.find(
          (message) => message.t === "animation" && message.skillId === "shadow_step",
        ),
      );
      if (step.t !== "animation") throw new Error("expected Executor Shadow Step");
      await scheduler.wait(Math.max(0, step.recoveryEndsAt - Date.now() + 20));

      const hitOffset = client.received.length;
      client.action("attack");
      const hit = await until("Executor Opening kill", () =>
        client.received
          .slice(hitOffset)
          .find(
            (message) =>
              message.t === "event" &&
              message.code === "combat.hit" &&
              message.params?.skill === "dual_slash",
          ),
      );
      if (hit.t !== "event") throw new Error("expected Executor hit");
      expect(hit.params?.damage).toBe(80);
      await until("Executor target death", () => client.latestSnapshot?.monsters.length === 0);
      const state = await until("Executor reduced cooldown", () => {
        const next = client.latestState;
        const remaining =
          (next?.cooldowns?.skillCooldowns[1] ?? 0) - (next?.serverNow ?? Number.NEGATIVE_INFINITY);
        return remaining > 0 && remaining < 2_200 ? next : undefined;
      });
      expect((state.cooldowns?.skillCooldowns[1] ?? 0) - (state.serverNow ?? 0)).toBeLessThan(
        2_200,
      );
    } finally {
      client.close();
    }
  });

  it("returns to the validated departure point without refreshing Opening or its cooldown", async () => {
    const party = await testParty("rogue-shadow-return", {
      maps: [roguePoisonMapInput(500)],
    });
    const origin = centre(5, 5);
    const hero = await rogueHero("Return", {
      party,
      account: party.host,
      level: 10,
      position: origin,
      talents: [...SHADOW_STEP_PREREQUISITES, "rogue.shadow_step.shadow_return"],
    });
    const client = await Client.joinHero(hero);
    try {
      await until("Shadow Return welcome", () => client.welcome);
      client.skill(2);
      const stepped = await until("Shadow Return armed", () => {
        const state = client.latestState;
        const self = client.self();
        const moved =
          self && (Math.abs(self.x - origin.x) >= 0.01 || Math.abs(self.y - origin.y) >= 0.01);
        return moved && (state?.rogue?.shadowReturnUntil ?? 0) > (state?.serverNow ?? 0)
          ? state
          : undefined;
      });
      const openingUntil = stepped.rogue?.openingUntil;
      const cooldownUntil = stepped.cooldowns?.skillCooldowns[1];

      client.skill(2);
      await until("Shadow Return destination", () => {
        const self = client.self();
        return self &&
          Math.abs(self.x - origin.x) < 0.01 &&
          Math.abs(self.y - origin.y) < 0.01 &&
          client.latestState?.rogue?.shadowReturnUntil === 0
          ? self
          : undefined;
      });
      expect(client.latestState?.rogue?.openingUntil).toBe(openingUntil);
      expect(client.latestState?.cooldowns?.skillCooldowns[1]).toBe(cooldownUntil);
    } finally {
      client.close();
    }
  });

  it("crosses a wall only after the separate Shadow Step ultimate is selected", async () => {
    const party = await testParty("rogue-veil-crossing", {
      maps: [rogueWallMapInput()],
    });
    const hero = await rogueHero("VeilCross", {
      party,
      account: party.host,
      level: 10,
      position: centre(4, 5),
      talents: [
        ...SHADOW_STEP_PREREQUISITES,
        "rogue.shadow_step.executor",
        "rogue.shadow_step.veil_crossing",
      ],
    });
    const client = await Client.joinHero(hero);
    try {
      const welcome = await until("Veil Crossing welcome", () => client.welcome);
      const target = welcome.monsters[0];
      if (!target) throw new Error("expected target beyond the wall");

      client.skill(2);
      await until("Veil Crossing animation", () =>
        client.received.find(
          (message) => message.t === "animation" && message.skillId === "shadow_step",
        ),
      );
      const crossed = await until("Veil Crossing destination", () => {
        const self = client.self();
        return self && self.x > target.x ? self : undefined;
      });

      expect(crossed.x).toBeGreaterThan(target.x);
      expect(client.latestState?.cooldowns?.skillCooldowns[1]).toBeGreaterThan(
        client.latestState?.serverNow ?? 0,
      );
      expect(client.latestState?.rogue?.openingUntil).toBeGreaterThan(
        client.latestState?.serverNow ?? 0,
      );
    } finally {
      client.close();
    }
  });

  it("strengthens Predator's exit Opening and snapshots one empowered poison", async () => {
    const party = await testParty("rogue-predator", {
      maps: [roguePoisonMapInput(500)],
    });
    const hero = await rogueHero("Predator", {
      party,
      account: party.host,
      level: 10,
      position: centre(5, 5),
      talents: [...VANISH_PREREQUISITES, "rogue.vanish.predator"],
    });
    const client = await Client.joinHero(hero);
    try {
      await until("Predator welcome", () => client.welcome);
      client.press("right");
      await scheduler.wait(80);
      client.release();
      client.skill(3);
      const vanish = await until("Predator Vanish", () =>
        client.received.find(
          (message) => message.t === "animation" && message.skillId === "vanish",
        ),
      );
      if (vanish.t !== "animation") throw new Error("expected Predator Vanish");
      await until("Predator stealth", () => {
        const state = client.latestState;
        return (state?.rogue?.stealthUntil ?? 0) > (state?.serverNow ?? 0) ? state : undefined;
      });
      await scheduler.wait(Math.max(0, vanish.recoveryEndsAt - Date.now() + 20));

      const attackOffset = client.received.length;
      client.action("attack");
      const attackHit = await until("Predator Opening hit", () =>
        client.received
          .slice(attackOffset)
          .find(
            (message) =>
              message.t === "event" &&
              message.code === "combat.hit" &&
              message.params?.skill === "dual_slash",
          ),
      );
      if (attackHit.t !== "event") throw new Error("expected Predator Opening hit");
      expect(Number(attackHit.params?.damage)).toBeGreaterThanOrEqual(85);
      const attackAnimation = client.received
        .slice(attackOffset)
        .find((message) => message.t === "animation" && message.skillId === "dual_slash");
      if (attackAnimation?.t !== "animation") throw new Error("expected Predator attack animation");
      await scheduler.wait(Math.max(0, attackAnimation.recoveryEndsAt - Date.now() + 20));

      const shivOffset = client.received.length;
      client.skill(4);
      await until("Predator Shiv hit", () =>
        client.received
          .slice(shivOffset)
          .find(
            (message) =>
              message.t === "event" &&
              message.code === "combat.hit" &&
              message.params?.skill === "poisoned_shiv" &&
              message.params.poisonTick !== 1,
          ),
      );
      const poisonTick = await until("Predator empowered poison tick", () =>
        client.received
          .slice(shivOffset)
          .find(
            (message) =>
              message.t === "event" &&
              message.code === "combat.hit" &&
              message.params?.poisonTick === 1,
          ),
      );
      if (poisonTick.t !== "event") throw new Error("expected Predator poison tick");
      expect(poisonTick.params?.damage).toBe(23);
    } finally {
      client.close();
    }
  });

  it("arms a bounded Smoke Screen while dropping existing monster aggro", async () => {
    const party = await testParty("rogue-smoke-screen", {
      maps: [rogueStealthMapInput(6)],
    });
    const hero = await rogueHero("Smoke", {
      party,
      account: party.host,
      level: 10,
      position: centre(5, 5),
      talents: [...VANISH_PREREQUISITES, "rogue.vanish.smoke_screen"],
    });
    const client = await Client.joinHero(hero);
    try {
      await until("Smoke Screen welcome", () => client.welcome);
      await waitForMonsterThreat(hero.roomKey, hero.heroId, true);
      client.skill(3);
      const protectedState = await until("Smoke Screen protection", () => {
        const state = client.latestState;
        const remaining =
          (state?.rogue?.smokeProtectionUntil ?? 0) -
          (state?.serverNow ?? Number.NEGATIVE_INFINITY);
        return remaining > 0 ? state : undefined;
      });
      const protectionRemaining =
        (protectedState.rogue?.smokeProtectionUntil ?? 0) - (protectedState.serverNow ?? 0);
      expect(protectionRemaining).toBeGreaterThan(0);
      expect(protectionRemaining).toBeLessThanOrEqual(500);
      await waitForMonsterThreat(hero.roomKey, hero.heroId, false);
      await until("Smoke Screen expiry", () =>
        client.latestState?.rogue?.smokeProtectionUntil === 0 ? client.latestState : undefined,
      );
    } finally {
      client.close();
    }
  });

  it("caps Concentrated Venom at three live stack schedules", async () => {
    const party = await testParty("rogue-concentrated-venom", {
      maps: [roguePoisonMapInput(1_000)],
    });
    const hero = await rogueHero("Venom", {
      party,
      account: party.host,
      level: 10,
      position: centre(5, 5),
      talents: [...POISONED_SHIV_PREREQUISITES, "rogue.poisoned_shiv.concentrated_venom"],
    });
    const client = await Client.joinHero(hero);
    try {
      await until("Concentrated Venom welcome", () => client.welcome);
      await castPoisonedShiv(client);
      for (let cast = 2; cast <= 4; cast++) {
        await resetCombatCooldowns(client, `Concentrated Venom reset ${cast}`);
        await castNearbyShiv(client, `Concentrated Venom hit ${cast}`);
      }
      const effect = await waitForDamageOverTimeEffect(
        hero.roomKey,
        "three poison stacks",
        (candidate) => candidate.stacks === 3,
      );
      expect(effect).toMatchObject({
        kind: "poison",
        sourceId: hero.heroId,
        stacks: 3,
      });
    } finally {
      client.close();
    }
  });

  it("makes Rupture remove exactly the poison power it explodes", async () => {
    const party = await testParty("rogue-rupture", {
      maps: [roguePoisonMapInput(1_000)],
    });
    const hero = await rogueHero("Rupture", {
      party,
      account: party.host,
      level: 10,
      position: centre(5, 5),
      talents: [...POISONED_SHIV_PREREQUISITES, "rogue.poisoned_shiv.rupture"],
    });
    const client = await Client.joinHero(hero);
    try {
      await until("Rupture welcome", () => client.welcome);
      await castPoisonedShiv(client);
      const before = await waitForDamageOverTimeEffect(
        hero.roomKey,
        "Rupture poison schedule",
        (effect) => effect.remainingPower > 0,
      );
      await resetCombatCooldowns(client, "Rupture cooldown reset");

      const offset = client.received.length;
      client.skill(2);
      const explosion = await until("Rupture explosion", () =>
        client.received
          .slice(offset)
          .find(
            (message) =>
              message.t === "event" &&
              message.code === "combat.hit" &&
              message.params?.poisonRupture === 1,
          ),
      );
      if (explosion.t !== "event") throw new Error("expected Rupture explosion");
      const consumed = Math.round(before.remainingPower * 0.6);
      expect(explosion.params?.damage).toBe(consumed);
      const after = await waitForDamageOverTimeEffect(
        hero.roomKey,
        "Rupture reduced poison schedule",
        (effect) => effect.remainingPower === before.remainingPower - consumed,
      );
      expect(after.remainingPower + Number(explosion.params?.damage)).toBe(before.remainingPower);
    } finally {
      client.close();
    }
  });

  it("reduces Dark Harvest cooldown once per kill without crossing the present", async () => {
    const party = await testParty("rogue-dark-harvest", {
      maps: [rogueDanceMapInput(5, undefined, 50)],
    });
    const hero = await rogueHero("Harvest", {
      party,
      account: party.host,
      level: 10,
      position: centre(5, 5),
      talents: [...SHADOW_DANCE_PREREQUISITES, "rogue.shadow_dance.dark_harvest"],
    });
    const client = await Client.joinHero(hero);
    try {
      await until("Dark Harvest welcome", () => client.welcome);
      client.skill(5);
      const sequence = await until("Dark Harvest sequence", () =>
        client.received.find((message) => message.t === "rogue.shadow_dance"),
      );
      if (sequence.t !== "rogue.shadow_dance") throw new Error("expected Dark Harvest sequence");
      expect(sequence.strikes).toHaveLength(5);
      expect(sequence.strikes.every((strike) => strike.killed)).toBe(true);
      const state = await until("Dark Harvest reduced state", () => {
        const next = client.latestState;
        const remaining =
          (next?.cooldowns?.skillCooldowns[4] ?? 0) - (next?.serverNow ?? Number.NEGATIVE_INFINITY);
        return remaining >= 0 && remaining < 2_500 ? next : undefined;
      });
      const remaining =
        (state.cooldowns?.skillCooldowns[4] ?? 0) - (state.serverNow ?? Number.NEGATIVE_INFINITY);
      expect(remaining).toBeGreaterThanOrEqual(0);
      expect(remaining).toBeLessThan(2_500);
    } finally {
      client.close();
    }
  });

  it("uses Thousand Cuts for four reduced repeats against one boss", async () => {
    const party = await testParty("rogue-thousand-cuts", {
      maps: [rogueDanceMapInput(1)],
    });
    const hero = await rogueHero("Cuts", {
      party,
      account: party.host,
      level: 10,
      position: centre(5, 5),
      talents: [...SHADOW_DANCE_PREREQUISITES, "rogue.shadow_dance.thousand_cuts"],
    });
    const client = await Client.joinHero(hero);
    try {
      await until("Thousand Cuts welcome", () => client.welcome);
      client.skill(5);
      const sequence = await until("Thousand Cuts sequence", () =>
        client.received.find((message) => message.t === "rogue.shadow_dance"),
      );
      if (sequence.t !== "rogue.shadow_dance") throw new Error("expected Thousand Cuts sequence");
      expect(sequence.strikes).toHaveLength(5);
      expect(new Set(sequence.strikes.map((strike) => strike.targetId)).size).toBe(1);
      expect(sequence.strikes.map((strike) => strike.repeated ?? false)).toEqual([
        false,
        true,
        true,
        true,
        true,
      ]);
      const damages = sequence.strikes.map((strike) => strike.damage);
      expect([54, 81]).toContain(damages[0]);
      expect(damages.slice(1).every((damage) => damage === 32 || damage === 48)).toBe(true);
      expect(damages.filter((damage) => damage === 81 || damage === 48)).toHaveLength(1);
    } finally {
      client.close();
    }
  });
});
