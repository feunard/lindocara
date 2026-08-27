import type { AdventureCameraMode } from "@lindocara/engine/adventure.js";
import {
  cameraPartialYawAfterDelta,
  cameraPitchAfterDelta,
  cameraYawAfterDelta,
} from "@lindocara/renderer/input.js";

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
