import {
  type CombatCooldownState,
  emptyCombatCooldowns,
  normalizeCombatCooldowns,
} from "../../shared/cooldowns.js";
import type { SkillSlot } from "../../shared/skills.js";

export interface ClientCooldownDeadlines {
  attackUntil: number;
  healUntil: number;
  skills: Record<SkillSlot, number>;
}

/** Converts absolute server time into this page's monotonic performance clock. */
export function clientCooldownDeadlines(
  value: CombatCooldownState | undefined,
  serverNow: number,
  clientNow: number,
): ClientCooldownDeadlines {
  const cooldowns = value ? normalizeCombatCooldowns(value, serverNow) : emptyCombatCooldowns();
  const localDeadline = (deadline: number) =>
    deadline <= serverNow ? 0 : clientNow + (deadline - serverNow);
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
