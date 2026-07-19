export interface MutableVisualActionState {
  actionId?: string;
  actionSkillId?: string;
  actionTalented?: boolean;
  actionStartedAt?: number;
  actionImpactAt?: number;
  actionChannelEndsAt?: number;
  actionEndsAt?: number;
  actionDirection?: { x: number; y: number };
  effectPlayedActionId?: string;
}

/** Clears every actor-owned visual that could otherwise reach a future impact frame. */
export function clearVisualAction(state: MutableVisualActionState): string | null {
  const actionId = state.actionId ?? null;
  delete state.actionId;
  delete state.actionSkillId;
  delete state.actionTalented;
  delete state.actionStartedAt;
  delete state.actionImpactAt;
  delete state.actionChannelEndsAt;
  delete state.actionEndsAt;
  delete state.actionDirection;
  delete state.effectPlayedActionId;
  return actionId;
}

/** Ordered server animation events are accepted unless their action id was explicitly cancelled. */
export class CombatVisualAuthority {
  #snapshotActionIds = new Map<string, string | null>();
  #latestAnimations = new Map<string, { actionId: string; seenInSnapshot: boolean }>();
  #cancelledActionIds = new Set<string>();

  /**
   * Records the newest action carried by the rendered snapshot.
   *
   * Animation messages and world snapshots share an ordered socket, but the renderer samples a
   * buffered snapshot on every frame. Immediately after an animation arrives, that buffer can
   * therefore still expose the older `null` (or the preceding action) for several frames. Such a
   * snapshot must not roll the newer event back. Once the event's action has appeared in a
   * snapshot, a later change is authoritative again and may clear or replace it.
   */
  recordSnapshot(actorId: string, actionId: string | null): boolean {
    this.#snapshotActionIds.set(actorId, actionId);
    const latestAnimation = this.#latestAnimations.get(actorId);
    if (!latestAnimation) return true;
    if (actionId === latestAnimation.actionId) {
      latestAnimation.seenInSnapshot = true;
      return true;
    }
    if (!latestAnimation.seenInSnapshot) return false;
    this.#latestAnimations.delete(actorId);
    return true;
  }

  acceptsAnimation(actorId: string, actionId: string): boolean {
    if (this.#cancelledActionIds.has(actionId)) return false;
    this.#latestAnimations.set(actorId, {
      actionId,
      seenInSnapshot: this.#snapshotActionIds.get(actorId) === actionId,
    });
    return true;
  }

  acceptsAction(actionId: string): boolean {
    return !this.#cancelledActionIds.has(actionId);
  }

  cancel(actionId: string | null): void {
    if (!actionId) return;
    for (const [actorId, animation] of this.#latestAnimations) {
      if (animation.actionId === actionId) this.#latestAnimations.delete(actorId);
    }
    this.#cancelledActionIds.add(actionId);
    while (this.#cancelledActionIds.size > 256) {
      const oldest = this.#cancelledActionIds.values().next().value;
      if (typeof oldest !== "string") break;
      this.#cancelledActionIds.delete(oldest);
    }
  }

  clearSnapshots(): void {
    this.#snapshotActionIds.clear();
    this.#latestAnimations.clear();
  }
}
