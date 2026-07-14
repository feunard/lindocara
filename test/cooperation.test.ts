import { describe, expect, it } from "vitest";
import {
  beginRewardAttribution,
  removePlayerCombatState,
} from "../src/server/world/contribution-system.js";
import { canSeeLoot } from "../src/server/world/interest-system.js";
import type { GroundLoot } from "../src/server/world/world-runtime.js";
import { createMonsters } from "../src/server/world/world-runtime.js";
import {
  addThreat,
  highestThreat,
  isMeaningfulContribution,
  recordContribution,
  splitExperience,
  tauntThreat,
  usefulHealingThreat,
} from "../src/shared/cooperation.js";
import {
  canSpendResource,
  initialResource,
  regenerateResource,
  skillResourceCost,
  spendResource,
} from "../src/shared/resources.js";

describe("cooperative combat rules", () => {
  it("selects the eligible player with the most threat deterministically", () => {
    const table = new Map();
    addThreat(table, "low", 10, 1);
    addThreat(table, "high", 30, 2);
    expect(highestThreat(table, () => true)?.playerId).toBe("high");
    expect(highestThreat(table, (id) => id !== "high")?.playerId).toBe("low");
  });

  it("records useful healing but rejects zero-effect contribution", () => {
    const table = new Map();
    const useful = recordContribution(table, "priest", { usefulHealing: 25 }, 1);
    const overheal = recordContribution(new Map(), "priest", { usefulHealing: 0 }, 1);
    expect(isMeaningfulContribution(useful)).toBe(true);
    expect(isMeaningfulContribution(overheal)).toBe(false);
    expect(usefulHealingThreat(25)).toBe(12.5);
    expect(usefulHealingThreat(0)).toBe(0);
  });

  it("puts a warrior taunt above the current highest threat", () => {
    const table = new Map();
    addThreat(table, "ranger", 80, 1);
    tauntThreat(table, "warrior", 2);
    expect(highestThreat(table, () => true)?.playerId).toBe("warrior");
  });

  it("shares the fixed XP pool and excludes nonparticipants", () => {
    const shares = splitExperience(101, ["a", "b"]);
    expect([...shares.values()].reduce((sum, xp) => sum + xp, 0)).toBe(101);
    expect(shares.has("spectator")).toBe(false);
  });

  it("deduplicates a participant before reward attribution", () => {
    expect([...splitExperience(10, ["a", "a"])]).toEqual([["a", 10]]);
    const monster = createMonsters([
      {
        id: "slime",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: 0,
        y: 0,
        patrolRadius: 10,
      },
    ])[0];
    if (!monster) throw new Error("missing monster");
    expect(beginRewardAttribution(monster)).toBe(true);
    expect(beginRewardAttribution(monster)).toBe(false);
  });

  it("cleans threat and contribution when a player disconnects", () => {
    const monster = createMonsters([
      {
        id: "goblin",
        kind: "goblin",
        species: "spear_goblin",
        zone: "route",
        x: 0,
        y: 0,
        patrolRadius: 10,
      },
    ])[0];
    if (!monster) throw new Error("missing monster");
    addThreat(monster.threat, "player", 20, 1);
    recordContribution(monster.contributions, "player", { damage: 20 }, 1);
    removePlayerCombatState([monster], "player");
    expect(monster.threat.has("player")).toBe(false);
    expect(monster.contributions.has("player")).toBe(false);
  });

  it("keeps personal loot private", () => {
    const loot = {
      id: "loot",
      kind: "gold",
      amount: 1,
      x: 0,
      y: 0,
      expiresAt: 2,
      ownerId: "owner",
    } satisfies GroundLoot;
    expect(canSeeLoot(loot, "owner")).toBe(true);
    expect(canSeeLoot(loot, "thief")).toBe(false);
  });

  it("validates and regenerates priest mana server-side", () => {
    const resource = initialResource("priest");
    if (!resource) throw new Error("priest mana is missing");
    const cost = skillResourceCost("priest", 5);
    expect(spendResource(resource, cost)).toBe(true);
    expect(canSpendResource(resource, resource.max)).toBe(false);
    regenerateResource("priest", resource, 20);
    expect(resource.current).toBe(resource.max);
    expect(skillResourceCost("priest", 1)).toBe(0);
    resource.current = 0;
    expect(canSpendResource(resource, skillResourceCost("priest", 1))).toBe(true);
    expect(initialResource("warrior")).toBeUndefined();
    expect(initialResource("ranger")).toBeUndefined();
  });
});
