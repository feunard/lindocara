import {
  DEFAULT_CAMERA_SETTINGS,
  getCameraSettings,
  setCameraSettings,
} from "@lindocara/renderer/camera-settings.js";
import { afterEach, describe, expect, it } from "vitest";

describe("camera settings", () => {
  afterEach(() => setCameraSettings(DEFAULT_CAMERA_SETTINGS));

  it("persists independent bounded camera speed multipliers", () => {
    setCameraSettings({
      followSpeed: 1.4,
      horizontalSensitivity: 0,
      verticalSensitivity: 4,
    });

    expect(getCameraSettings()).toEqual({
      followSpeed: 1.4,
      horizontalSensitivity: 0.25,
      verticalSensitivity: 2,
    });
    expect(JSON.parse(localStorage.getItem("lindocara.camera") ?? "null")).toEqual(
      getCameraSettings(),
    );
  });
});
