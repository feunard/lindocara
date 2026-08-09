export type ActorMotion = "idle" | "run" | "attack";

export interface ActorMotionSample {
  motion: ActorMotion;
  direction: { x: number; z: number } | null;
}

interface TrackedActor {
  x: number;
  z: number;
  at: number;
}

/** Derives presentation motion from successive rendered positions, never from gameplay outcomes. */
export class ActorMotionTracker {
  readonly #actors = new Map<string, TrackedActor>();

  sample(id: string, x: number, z: number, attacking: boolean, now: number): ActorMotionSample {
    const previous = this.#actors.get(id);
    const dx = previous ? x - previous.x : 0;
    const dz = previous ? z - previous.z : 0;
    const distance = Math.hypot(dx, dz);
    const moved =
      previous !== undefined && now >= previous.at && now - previous.at <= 500 && distance > 0.0001;
    this.#actors.set(id, { x, z, at: now });
    return {
      motion: attacking ? "attack" : moved ? "run" : "idle",
      direction: moved ? { x: dx / distance, z: dz / distance } : null,
    };
  }

  retain(ids: ReadonlySet<string>): void {
    for (const id of this.#actors.keys()) {
      if (!ids.has(id)) this.#actors.delete(id);
    }
  }

  reset(): void {
    this.#actors.clear();
  }
}
