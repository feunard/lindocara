import { normalizeDirection } from "@lindocara/engine/directional-combat.js";
import type { CombatActionKind } from "@lindocara/engine/protocol.js";
import type { Vec2 } from "@lindocara/engine/simulation.js";
import type { CombatActionRuntime, MonsterRuntime, PlayerRuntime } from "./world-runtime.js";

export interface StartCombatActionOptions {
  kind: CombatActionKind;
  skillId?: string;
  slot?: number;
  direction: Vec2;
  now: number;
  anticipationMs: number;
  recoveryMs: number;
  mobilityDistance?: number;
  channelDurationMs?: number;
}

export function startCombatAction(
  actor: PlayerRuntime | MonsterRuntime,
  options: StartCombatActionOptions,
): CombatActionRuntime | null {
  if (actor.action && actor.action.recoveryEndsAt > options.now) return null;
  const impactAt = options.now + Math.max(0, options.anticipationMs);
  const recoveryMs = Math.max(0, options.recoveryMs);
  const channelDurationMs = Math.max(0, options.channelDurationMs ?? 0);
  const channelMaxEndsAt = Math.max(impactAt, options.now + channelDurationMs);
  const action: CombatActionRuntime = {
    id: crypto.randomUUID(),
    kind: options.kind,
    ...(options.skillId ? { skillId: options.skillId } : {}),
    ...(options.slot === undefined ? {} : { slot: options.slot }),
    direction: normalizeDirection(options.direction),
    startedAt: options.now,
    impactAt,
    recoveryEndsAt:
      options.channelDurationMs === undefined
        ? impactAt + recoveryMs
        : channelMaxEndsAt + recoveryMs,
    ...(options.channelDurationMs === undefined
      ? {}
      : { channelMaxEndsAt, channelRecoveryMs: recoveryMs }),
    resolved: false,
    ...(options.mobilityDistance === undefined
      ? {}
      : { mobilityDistance: Math.max(0, options.mobilityDistance) }),
  };
  actor.action = action;
  return action;
}

/** Ends a held action without accepting a client position or direction. */
export function finishHeldCombatAction(actor: PlayerRuntime, now: number, slot?: number): boolean {
  const action = actor.action;
  if (
    !action ||
    action.channelMaxEndsAt === undefined ||
    action.channelEndsAt !== undefined ||
    (slot !== undefined && action.slot !== slot)
  )
    return false;
  const channelEndsAt = Math.max(action.impactAt, Math.min(now, action.channelMaxEndsAt));
  action.channelEndsAt = channelEndsAt;
  action.recoveryEndsAt = channelEndsAt + (action.channelRecoveryMs ?? 0);
  actor.dirty = true;
  return true;
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
