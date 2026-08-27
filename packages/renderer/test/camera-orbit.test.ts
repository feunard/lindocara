import { NO_INPUT } from "@lindocara/engine/simulation.js";
import { cameraOrbitOffset } from "@lindocara/renderer/hd2d/scene.js";
import {
  CAMERA_PARTIAL_YAW_LIMIT,
  CAMERA_PITCH_MAX,
  CAMERA_PITCH_MIN,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN,
  cameraOrbitDelta,
  cameraPartialYawAfterDelta,
  cameraPitchAfterDelta,
  cameraYawAfterDelta,
  cameraZoomAfterWheel,
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

  it("consumes a two-axis right-button drag and wheel once", () => {
    const canvas = document.createElement("canvas");
    const tracker = trackCameraOrbit(canvas);
    canvas.dispatchEvent(
      new MouseEvent("pointerdown", { button: 2, clientX: 10, clientY: 10, cancelable: true }),
    );
    canvas.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 40, clientY: 30, cancelable: true }),
    );
    canvas.dispatchEvent(new MouseEvent("pointerup", { button: 2 }));
    const wheel = new WheelEvent("wheel", { deltaY: 120, cancelable: true });
    canvas.dispatchEvent(wheel);
    const contextMenu = new MouseEvent("contextmenu", { cancelable: true });
    canvas.dispatchEvent(contextMenu);

    const drag = tracker.takeSample(0);
    expect(drag.yawDelta).toBeCloseTo(0.18);
    expect(drag.pitchDelta).toBeCloseTo(-0.12);
    expect(drag.wheelPixels).toBe(120);
    expect(tracker.takeSample(0)).toEqual({ yawDelta: 0, pitchDelta: 0, wheelPixels: 0 });
    expect(contextMenu.defaultPrevented).toBe(true);
    expect(wheel.defaultPrevented).toBe(true);
    tracker.stop();
  });

  it("keeps a full horizontal orbit instead of returning to the default heading", () => {
    expect(cameraYawAfterDelta(0, Math.PI)).toBeCloseTo(Math.PI);
    expect(cameraYawAfterDelta(Math.PI, Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    expect(cameraYawAfterDelta(-1.2, 0)).toBeCloseTo(-1.2);
  });

  it("keeps the default camera inside a partial lateral viewing arc", () => {
    expect(cameraPartialYawAfterDelta(0, Math.PI / 6)).toBeCloseTo(Math.PI / 6);
    expect(cameraPartialYawAfterDelta(0, Math.PI)).toBe(CAMERA_PARTIAL_YAW_LIMIT);
    expect(cameraPartialYawAfterDelta(0, -Math.PI)).toBe(-CAMERA_PARTIAL_YAW_LIMIT);
    expect(cameraPartialYawAfterDelta(Number.NaN, Number.NaN)).toBe(0);
  });

  it("clamps the vertical viewing angle and wheel zoom to playable ranges", () => {
    expect(cameraPitchAfterDelta(CAMERA_PITCH_MIN, -1)).toBe(CAMERA_PITCH_MIN);
    expect(cameraPitchAfterDelta(CAMERA_PITCH_MAX, 1)).toBe(CAMERA_PITCH_MAX);
    expect(cameraZoomAfterWheel(100, 10_000)).toBe(CAMERA_ZOOM_MIN);
    expect(cameraZoomAfterWheel(100, -10_000)).toBe(CAMERA_ZOOM_MAX);
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
