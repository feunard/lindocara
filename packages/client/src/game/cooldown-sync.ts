import {
  type CombatCooldownState,
  emptyCombatCooldowns,
  normalizeCombatCooldowns,
} from "@lindocara/engine/cooldowns.js";
import type { SkillSlot } from "@lindocara/engine/skills.js";
import type { ServerClock } from "@lindocara/renderer/server-clock.js";

export interface ClientCooldownDeadlines {
  attackUntil: number;
  healUntil: number;
  skills: Record<SkillSlot, number>;
}

/** Projects the server-owned recast window without turning it into a speculative client cooldown. */
export function clientShadowReturnDeadline(shadowReturnUntil: number, clock: ServerClock): number {
  const sample = clock.currentSample();
  if (!sample || shadowReturnUntil <= sample.serverNow) return 0;
  return clock.toLocal(shadowReturnUntil) ?? 0;
}

/** A follow-up can bypass its base cooldown only inside the complete server-authored window. */
export function activeReactivationDeadline(
  availableAt: number,
  expiresAt: number,
  now: number,
): number {
  return availableAt <= now && expiresAt > now ? expiresAt : 0;
}

/** Shadow Return is a server-authorized second activation inside the base skill's cooldown. */
export function skillCooldownBlocksCast(
  cooldownUntil: number,
  shadowReturnUntil: number,
  now: number,
): boolean {
  return cooldownUntil > now && shadowReturnUntil <= now;
}

/** Converts absolute server time into this page's monotonic performance clock. */
export function clientCooldownDeadlines(
  value: CombatCooldownState | undefined,
  clock: ServerClock,
): ClientCooldownDeadlines {
  const sample = clock.currentSample();
  if (!sample) {
    return { attackUntil: 0, healUntil: 0, skills: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
  }
  const serverNow = sample.serverNow;
  const cooldowns = value ? normalizeCombatCooldowns(value, serverNow) : emptyCombatCooldowns();
  const localDeadline = (deadline: number) =>
    deadline <= serverNow ? 0 : (clock.toLocal(deadline) ?? 0);
  return {
    attackUntil: localDeadline(cooldowns.attackUntil),
    healUntil: localDeadline(cooldowns.healUntil),
    skills: {
      1: localDeadline(cooldowns.skillCooldowns[0] ?? 0),
      2: localDeadline(cooldowns.skillCooldowns[1] ?? 0),
      3: localDeadline(cooldowns.skillCooldowns[2] ?? 0),
      4: localDeadline(cooldowns.skillCooldowns[3] ?? 0),
      5: localDeadline(cooldowns.skillCooldowns[4] ?? 0),
    },
  };
}
