import type { WorldPosition } from "@lindocara/engine/ground.js";

export interface ProjectileLaunch {
  offset: WorldPosition;
  startedAt: number;
}

export interface ProjectileMuzzle {
  position: WorldPosition;
  updatedAt: number;
}

export const PROJECTILE_LAUNCH_BLEND_MS = 160;

/** Correct only the visual launch. The authoritative sweep, collisions and hit timing stay intact. */
export function projectileLaunch(
  muzzle: WorldPosition,
  receivedPosition: WorldPosition,
  now: number,
): ProjectileLaunch {
  return {
    offset: {
      x: muzzle.x - receivedPosition.x,
      y: muzzle.y - receivedPosition.y,
      z: muzzle.z - receivedPosition.z,
    },
    startedAt: now,
  };
}

/** The ground trajectory rejoins the server sweep smoothly. The authored emission height is
 * a presentation offset, like the ordinary projectile lift; it must not dive to ankle height. */
export function launchedProjectilePosition(
  authoritative: WorldPosition,
  launch: ProjectileLaunch | undefined,
  now: number,
): WorldPosition {
  if (!launch) return authoritative;
  const t = Math.max(0, Math.min(1, (now - launch.startedAt) / PROJECTILE_LAUNCH_BLEND_MS));
  const weight = 1 - t * t * (3 - 2 * t);
  return {
    x: authoritative.x + launch.offset.x * weight,
    y: authoritative.y + launch.offset.y,
    z: authoritative.z + launch.offset.z * weight,
  };
}
