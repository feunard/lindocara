import { npcMovementDurationMs, sampleNpcMovementTween } from "@lindocara/engine/event-movement.js";
import type { WorldEventSnapshot } from "@lindocara/engine/protocol.js";

interface EventMotionState {
  from: { col: number; row: number };
  to: { col: number; row: number };
  startedAt: number;
  durationMs: number;
}

export interface WorldEventMotionSample {
  col: number;
  row: number;
  moving: boolean;
  direction: { x: number; z: number } | null;
}

/** Renderer-only interpolation between authoritative event cells. */
export class WorldEventMotionTracker {
  readonly #events = new Map<string, EventMotionState>();

  sample(
    event: Pick<WorldEventSnapshot, "id" | "col" | "row" | "moveSpeed" | "moveFrequency">,
    now: number,
  ): WorldEventMotionSample {
    const target = { col: event.col, row: event.row };
    let state = this.#events.get(event.id);
    if (!state) {
      state = { from: target, to: target, startedAt: now, durationMs: 1 };
      this.#events.set(event.id, state);
    } else if (state.to.col !== target.col || state.to.row !== target.row) {
      const current = sampleNpcMovementTween(
        state.from,
        state.to,
        state.startedAt,
        state.durationMs,
        now,
      );
      state = {
        from: { col: current.col, row: current.row },
        to: target,
        startedAt: now,
        durationMs: npcMovementDurationMs(event.moveSpeed, event.moveFrequency),
      };
      this.#events.set(event.id, state);
    }

    const tween = sampleNpcMovementTween(
      state.from,
      state.to,
      state.startedAt,
      state.durationMs,
      now,
    );
    const dx = state.to.col - state.from.col;
    const dz = state.to.row - state.from.row;
    const distance = Math.hypot(dx, dz);
    return {
      ...tween,
      direction: tween.moving && distance > 0 ? { x: dx / distance, z: dz / distance } : null,
    };
  }

  retain(ids: ReadonlySet<string>): void {
    for (const id of this.#events.keys()) {
      if (!ids.has(id)) this.#events.delete(id);
    }
  }

  reset(): void {
    this.#events.clear();
  }
}
