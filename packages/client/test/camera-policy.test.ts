import { CAMERA_PARTIAL_YAW_LIMIT } from "@lindocara/renderer/input.js";
import { describe, expect, it } from "vitest";

import {
  cameraFollowsMovement,
  cameraFollowDirection,
  cameraPitchAfterModeDelta,
  cameraSlopePitchOffset,
  cameraYawAfterModeDelta,
  cameraYawAfterMovement,
} from "../src/game/camera-policy.js";

describe("adventure camera policy", () => {
  it("leaves gamepad heading entirely to the right stick", () => {
    expect(cameraFollowsMovement("gamepad")).toBe(false);
    expect(cameraFollowsMovement("keyboard")).toBe(true);
  });
  it("allows full yaw and bounded pitch when orbit mode is enabled", () => {
    expect(cameraYawAfterModeDelta("orbit", 0, Math.PI)).toBeCloseTo(Math.PI);
    expect(cameraPitchAfterModeDelta("orbit", Math.PI / 4, 0.1)).toBeCloseTo(Math.PI / 4 + 0.1);
  });

  it("keeps partial lateral yaw and fixed pitch in the default mode", () => {
    expect(cameraYawAfterModeDelta("hd2d", 0, Math.PI)).toBe(CAMERA_PARTIAL_YAW_LIMIT);
    expect(cameraYawAfterModeDelta("hd2d", 0, -Math.PI)).toBe(-CAMERA_PARTIAL_YAW_LIMIT);
    expect(cameraPitchAfterModeDelta("hd2d", Math.PI / 4, 0.1)).toBeCloseTo(Math.PI / 4);
  });

  it("smoothly follows multidirectional movement in full orbit mode", () => {
    const towardRight = cameraYawAfterMovement(0, 1, 0, 1 / 60);
    const towardLeft = cameraYawAfterMovement(0, -1, 0, 1 / 60);

    expect(towardRight).toBeLessThan(0);
    expect(towardLeft).toBeGreaterThan(0);
    expect(cameraYawAfterMovement(0.7, 0, 0, 1 / 60)).toBe(0.7);
    expect(Math.abs(cameraYawAfterMovement(0, 1, 0, 1 / 60, 2))).toBeGreaterThan(
      Math.abs(towardRight),
    );
  });

  it("treats backward as forward without losing its lateral steering", () => {
    expect(cameraFollowDirection({ up: true, down: false, left: false, right: false }, 0)).toEqual({
      x: 0,
      z: -1,
    });
    expect(cameraFollowDirection({ up: false, down: true, left: false, right: false }, 0)).toEqual({
      x: 0,
      z: -1,
    });
    expect(cameraFollowDirection({ up: false, down: true, left: false, right: true }, 0)).toEqual({
      x: 1,
      z: -1,
    });
  });

  it("tilts in opposite directions for ascent and descent, then returns to the manual baseline", () => {
    const climbing = cameraSlopePitchOffset(0, 0.25, 0.25, false, 1 / 30);
    const descending = cameraSlopePitchOffset(0, -0.25, 0.25, false, 1 / 30);
    const landing = cameraSlopePitchOffset(climbing, 0, 0.25, false, 1);

    expect(climbing).toBeGreaterThan(0);
    expect(descending).toBeLessThan(0);
    expect(landing).toBeLessThan(climbing);
    expect(cameraSlopePitchOffset(0, 0.25, 0.25, true, 1 / 30)).toBe(0);
  });

  it("keeps the exact camera angle while crossing a raised liquid edge", () => {
    const current = 0.037;
    expect(cameraSlopePitchOffset(current, -2.75, 0.08, false, 1 / 60, true)).toBe(current);
  });
});
