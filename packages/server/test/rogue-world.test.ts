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
