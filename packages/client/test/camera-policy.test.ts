import { CAMERA_PARTIAL_YAW_LIMIT } from "@lindocara/renderer/input.js";
import { describe, expect, it } from "vitest";

import { cameraPitchAfterModeDelta, cameraYawAfterModeDelta } from "../src/game/camera-policy.js";

describe("adventure camera policy", () => {
  it("allows full yaw and bounded pitch when orbit mode is enabled", () => {
    expect(cameraYawAfterModeDelta("orbit", 0, Math.PI)).toBeCloseTo(Math.PI);
    expect(cameraPitchAfterModeDelta("orbit", Math.PI / 4, 0.1)).toBeCloseTo(Math.PI / 4 + 0.1);
  });

  it("keeps partial lateral yaw and fixed pitch in the default mode", () => {
    expect(cameraYawAfterModeDelta("hd2d", 0, Math.PI)).toBe(CAMERA_PARTIAL_YAW_LIMIT);
    expect(cameraYawAfterModeDelta("hd2d", 0, -Math.PI)).toBe(-CAMERA_PARTIAL_YAW_LIMIT);
    expect(cameraPitchAfterModeDelta("hd2d", Math.PI / 4, 0.1)).toBeCloseTo(Math.PI / 4);
  });
});
