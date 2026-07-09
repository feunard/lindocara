import { describe, expect, it } from "vitest";
import {
  applyDamage,
  applyExperience,
  attackDamageForLevel,
  isWalkable,
  maxHpForLevel,
  OBSTACLES,
  resolveTerrain,
  spawnPosition,
  withinRange,
  xpForNextLevel,
} from "../src/shared/game.js";

describe("authoritative game rules", () => {
  it("keeps the sanctuary spawn in a walkable position", () => {
    expect(isWalkable(spawnPosition())).toBe(true);
  });

  it("blocks movement through terrain while preserving movement on the free axis", () => {
    const wall = OBSTACLES[0];
    if (!wall) throw new Error("test map needs an obstacle");
    const from = { x: wall.x - 33, y: wall.y + 20 };
    const resolved = resolveTerrain(from, { x: from.x + 10, y: from.y + 15 });
    expect(resolved.x).toBe(from.x);
    expect(resolved.y).toBeGreaterThan(from.y);
    expect(isWalkable(resolved)).toBe(true);
  });

  it("never accepts restored or simulated positions inside obstacles", () => {
    const wall = OBSTACLES[0];
    if (!wall) throw new Error("test map needs an obstacle");
    expect(isWalkable({ x: wall.x + 10, y: wall.y + 10 })).toBe(false);
  });

  it("levels across multiple thresholds and keeps leftover XP", () => {
    const gained = xpForNextLevel(1) + xpForNextLevel(2) + 17;
    expect(applyExperience(1, 0, gained)).toEqual({ level: 3, xp: 17, levelsGained: 2 });
  });

  it("increases health and attack damage with level", () => {
    expect(maxHpForLevel(5)).toBeGreaterThan(maxHpForLevel(1));
    expect(attackDamageForLevel(5)).toBeGreaterThan(attackDamageForLevel(1));
  });

  it("applies combat damage without allowing healing or negative HP", () => {
    expect(applyDamage(50, 12)).toEqual({ hp: 38, killed: false });
    expect(applyDamage(10, 999)).toEqual({ hp: 0, killed: true });
    expect(applyDamage(50, -100)).toEqual({ hp: 50, killed: false });
  });

  it("validates combat and interaction range geometrically", () => {
    expect(withinRange({ x: 0, y: 0 }, { x: 30, y: 40 }, 50)).toBe(true);
    expect(withinRange({ x: 0, y: 0 }, { x: 30, y: 40 }, 49)).toBe(false);
  });
});
