import { normalizeDirection } from "../../shared/directional-combat.js";
import type { CombatActionKind } from "../../shared/protocol.js";
import type { Vec2 } from "../../shared/simulation.js";
import type { CombatActionRuntime, MonsterRuntime, PlayerRuntime } from "./world-runtime.js";

export interface StartCombatActionOptions {
  kind: CombatActionKind;
  skillId?: string;
  slot?: number;
  direction: Vec2;
  now: number;
  anticipationMs: number;
  recoveryMs: number;
}

export function startCombatAction(
  actor: PlayerRuntime | MonsterRuntime,
  options: StartCombatActionOptions,
): CombatActionRuntime | null {
  if (actor.action && actor.action.recoveryEndsAt > options.now) return null;
  const action: CombatActionRuntime = {
    id: crypto.randomUUID(),
    kind: options.kind,
    ...(options.skillId ? { skillId: options.skillId } : {}),
    ...(options.slot === undefined ? {} : { slot: options.slot }),
    direction: normalizeDirection(options.direction),
    startedAt: options.now,
    impactAt: options.now + Math.max(0, options.anticipationMs),
    recoveryEndsAt:
      options.now + Math.max(0, options.anticipationMs) + Math.max(0, options.recoveryMs),
    resolved: false,
  };
  actor.action = action;
  return action;
}

export function advanceCombatActions<T extends PlayerRuntime | MonsterRuntime>(
  actors: Iterable<T>,
  now: number,
  resolve: (actor: T, action: CombatActionRuntime) => void,
): void {
  for (const actor of actors) {
    const action = actor.action;
    if (!action) continue;
    if (!action.resolved && now >= action.impactAt) {
      action.resolved = true;
      resolve(actor, action);
    }
    if (now >= action.recoveryEndsAt) actor.action = null;
  }
}

export function cancelCombatAction(actor: PlayerRuntime | MonsterRuntime): void {
  actor.action = null;
}
