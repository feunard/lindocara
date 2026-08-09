import { NO_INPUT } from "@lindocara/engine/simulation.js";
import { cameraOrbitOffset } from "@lindocara/renderer/hd2d/scene.js";
import {
  CAMERA_YAW_RANGE,
  cameraOrbitDelta,
  limitedCameraYaw,
  rotateMovementInput,
  trackCameraOrbit,
} from "@lindocara/renderer/input.js";
import { describe, expect, it } from "vitest";

describe("camera orbit input", () => {
  it("combines right-drag pixels with a dead-zoned right stick", () => {
    expect(cameraOrbitDelta(30, 0.1, 1 / 60)).toBeCloseTo(0.18);
    expect(cameraOrbitDelta(0, 1, 0.5)).toBeCloseTo(0.18);
    expect(cameraOrbitDelta(Number.NaN, Number.NaN, Number.NaN)).toBe(0);
  });

  it("consumes a right-button drag once and suppresses the context menu", () => {
    const canvas = document.createElement("canvas");
    const tracker = trackCameraOrbit(canvas);
    canvas.dispatchEvent(
      new MouseEvent("pointerdown", { button: 2, clientX: 10, cancelable: true }),
    );
    canvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 40, cancelable: true }));
    canvas.dispatchEvent(new MouseEvent("pointerup", { button: 2 }));
    const contextMenu = new MouseEvent("contextmenu", { cancelable: true });
    canvas.dispatchEvent(contextMenu);

    const drag = tracker.takeSample(0);
    expect(drag.delta).toBeCloseTo(0.18);
    expect(drag.orbiting).toBe(true);
    expect(tracker.takeSample(0)).toEqual({ delta: 0, orbiting: false });
    expect(contextMenu.defaultPrevented).toBe(true);
    tracker.stop();
  });

  it("matches the lab's bounded glance and exponential return", () => {
    expect(limitedCameraYaw(0, Math.PI, true, 1 / 60)).toBeCloseTo(CAMERA_YAW_RANGE);
    expect(limitedCameraYaw(0, -Math.PI, true, 1 / 60)).toBeCloseTo(-CAMERA_YAW_RANGE);
    expect(limitedCameraYaw(CAMERA_YAW_RANGE, 0, false, 0.5)).toBeCloseTo(
      CAMERA_YAW_RANGE * Math.exp(-3),
    );
  });
});

describe("camera-relative movement", () => {
  it("keeps up pointed toward the top of the screen after a quarter turn", () => {
    const input = rotateMovementInput({ ...NO_INPUT, up: true }, Math.PI / 2);

    expect(input.axisX).toBeCloseTo(-1);
    expect(input.axisY).toBe(0);
    expect(input.left).toBe(true);
    expect(input.up).toBe(false);
  });

  it("rotates continuous stick values without changing their magnitude", () => {
    const input = rotateMovementInput({ ...NO_INPUT, axisX: 0.5, axisY: -0.25 }, Math.PI / 3);

    expect(Math.hypot(input.axisX ?? 0, input.axisY ?? 0)).toBeCloseTo(Math.hypot(0.5, 0.25));
  });
});

describe("camera orbit geometry", () => {
  it("orbits at constant distance and pitch", () => {
    const front = cameraOrbitOffset(0, 40, Math.PI / 4);
    const side = cameraOrbitOffset(Math.PI / 2, 40, Math.PI / 4);

    expect(front.x).toBeCloseTo(0);
    expect(front.z).toBeGreaterThan(0);
    expect(side.x).toBeCloseTo(front.z);
    expect(side.z).toBeCloseTo(0);
    expect(Math.hypot(side.x, side.y, side.z)).toBeCloseTo(40);
  });
});
