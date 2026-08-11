export type ActorMotion = "idle" | "run" | "attack";

/**
 * How long ONE frame of a looping strip is held, per motion, in milliseconds.
 *
 * These are `apps/lab/src/settings.ts`'s `HERO.anims` cadences inverted — idle at 7 fps, run at
 * 12 fps — expressed per frame rather than per cycle because that is what survives a sheet with a
 * different frame count. The lab's warrior runs on six frames; another actor's run strip may not,
 * and a per-CYCLE duration would silently slow the longer strip down.
 *
 * Before these existed, every looping strip in the game shared one hardcoded 145 ms — right for
 * idle (≈7 fps, by coincidence of it being derived from the idle clip) and badly wrong for run,
 * which played at 6.9 fps instead of 12. The hero's body moved at full speed while its legs
 * cycled at 57%, which is exactly what reads as skating. Nothing failed, and nothing could:
 * a cadence is not something a typecheck or a snapshot test can be wrong about.
 *
 * `attack` is a fallback only. A real attack carries the server's own action timeline as
 * `animationDurationMs`, which takes precedence over any cadence here.
 */
export const ACTOR_FRAME_MS: Readonly<Record<ActorMotion, number>> = {
  idle: 1_000 / 7,
  run: 1_000 / 12,
  attack: 1_000 / 15,
};

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
