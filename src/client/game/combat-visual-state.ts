export interface MutableVisualActionState {
  actionId?: string;
  actionSkillId?: string;
  actionStartedAt?: number;
  actionImpactAt?: number;
  actionEndsAt?: number;
  actionDirection?: { x: number; y: number };
  effectPlayedActionId?: string;
  guardVisualUntil?: number;
}

/** Clears every actor-owned visual that could otherwise reach a future impact frame. */
export function clearVisualAction(state: MutableVisualActionState): string | null {
  const actionId = state.actionId ?? null;
  delete state.actionId;
  delete state.actionSkillId;
  delete state.actionStartedAt;
  delete state.actionImpactAt;
  delete state.actionEndsAt;
  delete state.actionDirection;
  delete state.effectPlayedActionId;
  delete state.guardVisualUntil;
  return actionId;
}

/** Snapshot state fences conflicting animation events while explicit cancellation blocks stale ids. */
export class CombatVisualAuthority {
  #snapshotActionIds = new Map<string, string | null>();
  #cancelledActionIds = new Set<string>();

  recordSnapshot(actorId: string, actionId: string | null): void {
    this.#snapshotActionIds.set(actorId, actionId);
  }

  acceptsAnimation(actorId: string, actionId: string): boolean {
    const snapshotActionId = this.#snapshotActionIds.get(actorId);
    return (
      !this.#cancelledActionIds.has(actionId) &&
      (snapshotActionId === undefined || snapshotActionId === null || snapshotActionId === actionId)
    );
  }

  acceptsAction(actionId: string): boolean {
    return !this.#cancelledActionIds.has(actionId);
  }

  cancel(actionId: string | null): void {
    if (!actionId) return;
    this.#cancelledActionIds.add(actionId);
    while (this.#cancelledActionIds.size > 256) {
      const oldest = this.#cancelledActionIds.values().next().value;
      if (typeof oldest !== "string") break;
      this.#cancelledActionIds.delete(oldest);
    }
  }

  clearSnapshots(): void {
    this.#snapshotActionIds.clear();
  }
}
