import type { PlayerSnapshot } from "@lindocara/engine/protocol.js";

export type CharacterMotion =
  | "idle"
  | "run"
  | "attack"
  | "jump"
  | "fall"
  | "land"
  | "swim"
  | "glide"
  | "hurt";

export interface CharacterAnimationSample {
  motion: CharacterMotion;
  phase: number;
  elapsedMs: number;
  speed: number;
  stridePhase: number;
}

interface TrackedCharacter {
  x: number;
  z: number;
  at: number;
  hp: number;
  airborne: boolean;
  motion: CharacterMotion;
  startedAt: number;
  stridePhase: number;
  sample: CharacterAnimationSample;
}

/**
 * Presentation clock for an authored character. Ground distance is the locomotion clock;
 * direction and camera yaw deliberately are not keys, so turning never restarts a stride.
 * Airborne travel, teleports and suspension gaps cannot spend ground strides.
 */
export class CharacterAnimationTracker {
  readonly #actors = new Map<string, TrackedCharacter>();

  sample(player: PlayerSnapshot, now: number, strideDistance: number): CharacterAnimationSample {
    const previous = this.#actors.get(player.id);
    if (previous && now === previous.at) return previous.sample;
    const elapsed = previous ? now - previous.at : 0;
    const distance = previous ? Math.hypot(player.x - previous.x, player.z - previous.z) : 0;
    const continuous =
      previous !== undefined &&
      elapsed > 0 &&
      elapsed <= 250 &&
      Number.isFinite(distance) &&
      distance <= Math.max(0.8, elapsed * 0.016);
    const speed = continuous ? (distance * 1_000) / elapsed : 0;
    const moving = continuous && speed > 0.025;
    const grounded = !player.airborne && !player.swimming && !player.gliding;
    let stridePhase = previous?.stridePhase ?? 0;
    if (moving && grounded && !previous?.airborne && strideDistance > 0) {
      stridePhase = (stridePhase + distance / strideDistance) % 1;
    }
    let motion: CharacterMotion;
    if (player.action) motion = "attack";
    else if (player.swimming) motion = "swim";
    else if (player.gliding) motion = "glide";
    else if (player.airborne) motion = (player.vy ?? 0) > 0 ? "jump" : "fall";
    else if (moving) motion = "run";
    else if (previous?.airborne || (previous?.motion === "land" && now - previous.startedAt < 180))
      motion = "land";
    else if (
      (previous && player.hp < previous.hp) ||
      (previous?.motion === "hurt" && now - previous.startedAt < 200)
    )
      motion = "hurt";
    else motion = "idle";
    const startedAt = previous?.motion === motion ? previous.startedAt : now;
    const elapsedMs = Math.max(0, now - startedAt);
    const phase =
      motion === "run"
        ? stridePhase
        : motion === "jump"
          ? Math.max(0, Math.min(1, 1 - (player.vy ?? 0) / 9))
          : motion === "fall"
            ? Math.max(0, Math.min(1, -(player.vy ?? 0) / 9))
            : 0;
    const sample = { motion, phase, elapsedMs, speed, stridePhase };
    this.#actors.set(player.id, {
      x: player.x,
      z: player.z,
      at: now,
      hp: player.hp,
      airborne: player.airborne,
      motion,
      startedAt,
      stridePhase,
      sample,
    });
    return sample;
  }

  hasSeen(id: string): boolean {
    return this.#actors.has(id);
  }

  retain(ids: ReadonlySet<string>): void {
    for (const id of this.#actors.keys()) if (!ids.has(id)) this.#actors.delete(id);
  }

  reset(): void {
    this.#actors.clear();
  }
}
