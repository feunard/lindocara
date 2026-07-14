import type { MonsterSnapshot, PlayerSnapshot } from "../../shared/protocol.js";
import { type SkillEffect, skillTargetKind } from "../../shared/skills.js";

export type CombatTarget = { kind: "monster"; id: string } | { kind: "player"; id: string };

export type SkillTargetResolution =
  | { ok: true; targetId?: string }
  | { ok: false; required: "hostile" | "friendly" };

export function resolveSkillTarget(
  effect: SkillEffect,
  target: CombatTarget | null,
): SkillTargetResolution {
  const required = skillTargetKind(effect);
  if (required === "none") return { ok: true };
  if (required === "hostile" && target?.kind === "monster") {
    return { ok: true, targetId: target.id };
  }
  if (required === "friendly" && target?.kind === "player") {
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

export function targetExists(
  target: CombatTarget,
  players: readonly PlayerSnapshot[],
  monsters: readonly MonsterSnapshot[],
): boolean {
  return target.kind === "monster"
    ? monsters.some((monster) => monster.id === target.id && !monster.dead)
    : players.some((player) => player.id === target.id);
}
