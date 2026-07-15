import type { GuardSnapshot, MonsterSnapshot, PlayerSnapshot } from "../../shared/protocol.js";
import { type SkillEffect, skillTargetKind } from "../../shared/skills.js";

export type CombatTarget =
  | { kind: "monster"; id: string }
  | { kind: "player"; id: string }
  | { kind: "guard"; id: string };

export type SkillTargetResolution =
  | { ok: true; targetId?: string }
  | { ok: false; required: "hostile" | "friendly" };

export type BasicAttackTargetResolution =
  | { ok: true; target: MonsterSnapshot }
  | { ok: false; reason: "no_target" | "out_of_range" };

export function resolveSkillTarget(
  effect: SkillEffect,
  target: CombatTarget | null,
): SkillTargetResolution {
  const required = skillTargetKind(effect);
  if (required === "none") return { ok: true };
  if (required === "hostile" && target?.kind === "monster") {
    return { ok: true, targetId: target.id };
  }
  if (required === "friendly" && (target?.kind === "player" || target?.kind === "guard")) {
    return { ok: true, targetId: target.id };
  }
  return { ok: false, required };
}

/** Tab targeting is deterministic across snapshot reordering: nearest first, then stable id. */
export function cycleMonsterTarget(
  monsters: readonly MonsterSnapshot[],
  self: PlayerSnapshot | undefined,
  currentId: string | undefined,
  reverse = false,
): CombatTarget | null {
  if (!self) return null;
  const candidates = monsters
    .filter((monster) => !monster.dead)
    .map((monster) => ({
      monster,
      distance: Math.hypot(monster.x - self.x, monster.y - self.y),
    }))
    .sort((a, b) => a.distance - b.distance || a.monster.id.localeCompare(b.monster.id));
  if (candidates.length === 0) return null;
  const currentIndex = candidates.findIndex(({ monster }) => monster.id === currentId);
  const step = reverse ? -1 : 1;
  const nextIndex =
    currentIndex < 0
      ? reverse
        ? candidates.length - 1
        : 0
      : (currentIndex + step + candidates.length) % candidates.length;
  const next = candidates[nextIndex]?.monster;
  return next ? { kind: "monster", id: next.id } : null;
}

/** Offensive actions keep an explicit living enemy, otherwise they acquire the nearest one. */
export function offensiveTarget(
  monsters: readonly MonsterSnapshot[],
  self: PlayerSnapshot | undefined,
  current: CombatTarget | null,
): Extract<CombatTarget, { kind: "monster" }> | null {
  if (
    current?.kind === "monster" &&
    monsters.some((monster) => monster.id === current.id && !monster.dead)
  ) {
    return current;
  }
  const nearest = cycleMonsterTarget(monsters, self, undefined);
  return nearest?.kind === "monster" ? nearest : null;
}

/** Basic attacks never acquire a target implicitly and never start outside their real range. */
export function resolveBasicAttackTarget(
  monsters: readonly MonsterSnapshot[],
  self: PlayerSnapshot | undefined,
  current: CombatTarget | null,
  range: number,
): BasicAttackTargetResolution {
  if (!self || current?.kind !== "monster") return { ok: false, reason: "no_target" };
  const target = monsters.find((monster) => monster.id === current.id && !monster.dead);
  if (!target) return { ok: false, reason: "no_target" };
  if (Math.hypot(target.x - self.x, target.y - self.y) > range) {
    return { ok: false, reason: "out_of_range" };
  }
  return { ok: true, target };
}

export function targetExists(
  target: CombatTarget,
  players: readonly PlayerSnapshot[],
  monsters: readonly MonsterSnapshot[],
  guards: readonly GuardSnapshot[] = [],
): boolean {
  if (target.kind === "monster")
    return monsters.some((monster) => monster.id === target.id && !monster.dead);
  if (target.kind === "guard") return guards.some((guard) => guard.id === target.id);
  return players.some((player) => player.id === target.id);
}
