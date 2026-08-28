import type { AdventureCameraMode } from "@lindocara/engine/adventure.js";
import type { Input } from "@lindocara/engine/simulation.js";
import {
  cameraPartialYawAfterDelta,
  cameraPitchAfterDelta,
  cameraYawAfterDelta,
} from "@lindocara/renderer/input.js";

const CAMERA_HEADING_FOLLOW_SPEED = 4.5;
const CAMERA_SLOPE_FOLLOW_SPEED = 9;
const CAMERA_SLOPE_RETURN_SPEED = 5;
const CAMERA_SLOPE_UP_MAX = 5 * (Math.PI / 180);
const CAMERA_SLOPE_DOWN_MAX = -3 * (Math.PI / 180);

/** Applies the adventure's authored horizontal camera policy. */
export function cameraYawAfterModeDelta(
  mode: AdventureCameraMode,
  currentYaw: number,
  orbitDelta: number,
): number {
  return mode === "orbit"
    ? cameraYawAfterDelta(currentYaw, orbitDelta)
    : cameraPartialYawAfterDelta(currentYaw, orbitDelta);
}

/** Keeps pitch fixed in HD-2D mode and bounded-but-movable in orbit mode. */
export function cameraPitchAfterModeDelta(
  mode: AdventureCameraMode,
  currentPitch: number,
  orbitDelta: number,
): number {
  return cameraPitchAfterDelta(currentPitch, mode === "orbit" ? orbitDelta : 0);
}

/**
 * Direction the camera should regard as forward for the current movement gesture.
 *
 * Backward input is mirrored onto forward for camera purposes: the hero walks backwards without a
 * 180-degree camera turn. Its lateral component is preserved, so back-left/back-right still steer
 * the view in the intuitive side direction.
 */
export function cameraFollowDirection(
  input: Input,
  cameraYaw: number,
): { x: number; z: number } | null {
  const digitalX = Number(input.right) - Number(input.left);
  const digitalZ = Number(input.down) - Number(input.up);
  const sourceX =
    Number.isFinite(input.axisX) && Math.abs(input.axisX ?? 0) > 0.0001
      ? (input.axisX ?? 0)
      : digitalX;
  const sourceZ =
    Number.isFinite(input.axisY) && Math.abs(input.axisY ?? 0) > 0.0001
      ? (input.axisY ?? 0)
      : digitalZ;
  if (Math.hypot(sourceX, sourceZ) < 0.0001) return null;
  const lookZ = sourceZ > 0 ? -sourceZ : sourceZ;
  const yaw = Number.isFinite(cameraYaw) ? cameraYaw : 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: sourceX * cos + lookZ * sin,
    z: -sourceX * sin + lookZ * cos,
  };
}

/**
 * Smoothly places an orbit camera behind the movement gesture's camera-facing direction.
 * A zero vector keeps the player's current manual heading unchanged.
 */
export function cameraYawAfterMovement(
  currentYaw: number,
  deltaX: number,
  deltaZ: number,
  dt: number,
  speed = 1,
): number {
  const distance = Math.hypot(deltaX, deltaZ);
  if (!Number.isFinite(distance) || distance < 0.0001) return currentYaw;
  const safeDt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
  if (safeDt === 0) return currentYaw;
  const targetYaw = Math.atan2(-deltaX, -deltaZ);
  const difference = Math.atan2(Math.sin(targetYaw - currentYaw), Math.cos(targetYaw - currentYaw));
  const safeSpeed = Number.isFinite(speed) ? Math.max(0.25, Math.min(2, speed)) : 1;
  const blend = 1 - Math.exp(-CAMERA_HEADING_FOLLOW_SPEED * safeSpeed * safeDt);
  return cameraYawAfterDelta(currentYaw, difference * blend);
}

/**
 * Adds a small temporary incline cue without changing the player's manually chosen pitch.
 * Elevated flat ground has zero rise/run, so the offset naturally settles back to zero there.
 */
export function cameraSlopePitchOffset(
  currentOffset: number,
  elevationDelta: number,
  horizontalDistance: number,
  airborne: boolean,
  dt: number,
): number {
  const safeDt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
  const moving = Number.isFinite(horizontalDistance) && horizontalDistance >= 0.0001;
  const rising = Number.isFinite(elevationDelta) ? elevationDelta : 0;
  const target =
    !airborne && moving
      ? Math.max(
          CAMERA_SLOPE_DOWN_MAX,
          Math.min(CAMERA_SLOPE_UP_MAX, Math.atan2(rising, horizontalDistance) * 0.18),
        )
      : 0;
  const speed = target === 0 ? CAMERA_SLOPE_RETURN_SPEED : CAMERA_SLOPE_FOLLOW_SPEED;
  const blend = 1 - Math.exp(-speed * safeDt);
  const offset = currentOffset + (target - currentOffset) * blend;
  return Math.max(CAMERA_SLOPE_DOWN_MAX, Math.min(CAMERA_SLOPE_UP_MAX, offset));
}
