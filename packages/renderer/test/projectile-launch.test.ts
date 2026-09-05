import { describe, expect, it } from "vitest";

import {
  launchedProjectilePosition,
  projectileLaunch,
  PROJECTILE_LAUNCH_BLEND_MS,
} from "../src/projectile-launch.js";
import { rasterSocketOffset } from "../src/raster-character-art.js";

describe("raster weapon launch", () => {
  it("reconstructs the same weapon point through eight directions, mirrors and camera yaw", () => {
    for (let heading = 0; heading < 8; heading++) {
      const yaw = (heading * Math.PI) / 4;
      for (const flip of [false, true]) {
        const offset = rasterSocketOffset(
          { x: 128, y: 72 },
          { x: 96, y: 136 },
          64,
          flip,
          yaw,
          Math.PI / 6,
          1,
        );
        expect(Math.hypot(offset.x, offset.z)).toBeCloseTo(0.5);
        expect(offset.x * Math.cos(yaw) - offset.z * Math.sin(yaw)).toBeCloseTo(flip ? -0.5 : 0.5);
        expect(offset.y * Math.cos(Math.PI / 6)).toBeCloseTo(1);
        const muzzle = { x: 3 + offset.x, y: 2 + offset.y, z: 5 + offset.z };
        const snapshot = { x: 3.7, y: 2.5, z: 5.2 };
        const launch = projectileLaunch(muzzle, snapshot, 100);
        expect(launchedProjectilePosition(snapshot, launch, 100)).toEqual(muzzle);
        expect(
          launchedProjectilePosition(snapshot, launch, 100 + PROJECTILE_LAUNCH_BLEND_MS),
        ).toEqual({ ...snapshot, y: muzzle.y });
      }
    }
  });

  it("keeps the server position untouched, including after the initial handoff", () => {
    const snapshot = { x: 3, y: 0, z: 4 };
    const before = { ...snapshot };
    const launch = projectileLaunch({ x: 1, y: 1, z: 1 }, snapshot, 1000);
    expect(launchedProjectilePosition(snapshot, undefined, 1100)).toBe(snapshot);
    launchedProjectilePosition(snapshot, launch, 1080);
    expect(snapshot).toEqual(before);
    expect(launchedProjectilePosition(snapshot, launch, 2000)).toEqual({ ...snapshot, y: 1 });
  });
});
