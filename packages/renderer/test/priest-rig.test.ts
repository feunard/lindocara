import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";

import motionJson from "../src/assets/characters/priest/motion.json?raw";
import rigData from "../src/assets/characters/priest/rig.glb?inline";
import { combatActionPhase } from "../src/combat-art.js";
import type { ActorView } from "../src/hd2d/billboards.js";
import { createPriestPoseApplicator } from "../src/hd2d/priest-pose.js";
import {
  PriestPosePlayer,
  samplePriestPose,
  type MotionAsset,
} from "../src/hd2d/priest-sprites.js";

const motion = JSON.parse(motionJson) as MotionAsset;
const actor: ActorView = {
  id: "priest",
  kind: "player",
  x: 0,
  y: 0,
  z: 0,
  airborne: false,
  swimming: false,
  gliding: false,
  vy: 0,
  facing: "south",
  directionalFacing: { x: 0, z: 1 },
  textureKey: "test",
};

describe("compiled Priest rig", () => {
  it("draws constant-length bones with planted soles at normal speed, also while casting", async () => {
    const decoded = atob(rigData.slice(rigData.indexOf(",") + 1));
    const binary = new ArrayBuffer(decoded.length);
    new Uint8Array(binary).set(Uint8Array.from(decoded, (value) => value.charCodeAt(0)));
    const gltf = await new GLTFLoader().parseAsync(binary, "");
    const apply = createPriestPoseApplicator(gltf.scene),
      position = new THREE.Vector3();
    let maxSlip = 0,
      maxBoneError = 0;
    for (const hz of [30, 60, 144])
      for (const aim of [undefined, { x: 0, z: 1 }, { x: 0, z: -1 }, { x: 1, z: 0 }]) {
        const casting = aim !== undefined;
        const animator = new PriestPosePlayer(motion);
        let previous: Array<{ contact: boolean; x: number; z: number } | null> = [null, null];
        for (let tick = 0; tick <= hz * 3; tick++) {
          const now = (tick * 1000) / hz,
            z = (now / 1000) * 3.65625,
            phase = (z / 1.72) % 1;
          const { pose, heading } = animator.sample(
            { ...actor, z },
            {
              id: actor.id,
              clip: casting ? "prayer" : "run",
              phase: casting ? (now % 960) / 960 : phase,
              ...(aim ? { aim } : {}),
              animation: {
                motion: casting ? "attack" : "run",
                phase,
                elapsedMs: now,
                speed: 3.65625,
                stridePhase: phase,
              },
            },
            now,
          );
          apply(pose);
          gltf.scene.rotation.y = heading;
          gltf.scene.updateMatrixWorld(true);
          for (const [index, side] of [
            [0, -1],
            [1, 1],
          ] as const) {
            const foot = gltf.scene.getObjectByName(`foot${side}`),
              knee = gltf.scene.getObjectByName(`knee${side}`),
              shin = gltf.scene.getObjectByName(`shin${side}`);
            if (!foot || !knee || !shin) throw new Error("Missing leg");
            const actual = foot.getWorldPosition(position).clone(),
              kneePosition = knee.getWorldPosition(position).clone();
            maxBoneError = Math.max(
              maxBoneError,
              Math.abs(kneePosition.distanceTo(actual) - 0.315),
            );
            const sample = pose.feet[index === 0 ? 0 : 1],
              last = previous[index];
            if (sample.contact && last?.contact)
              maxSlip = Math.max(maxSlip, Math.hypot(actual.x - last.x, actual.z + z - last.z));
            previous[index] = { contact: sample.contact, x: actual.x, z: actual.z + z };
          }
        }
      }
    expect(maxBoneError).toBeLessThan(0.00001);
    expect(maxSlip).toBeLessThan(0.005);
  });

  it("keeps world contacts through a turn and settles a stopped swing without snapping", () => {
    const animator = new PriestPosePlayer(motion);
    let x = 0,
      z = 0,
      lastFeet: number[][] | null = null,
      maxStep = 0;
    for (let tick = 0; tick < 120; tick++) {
      const direction = tick < 40 ? 0 : Math.PI / 4,
        speed = tick < 80 ? 3.65625 : 0;
      x += (Math.sin(direction) * speed) / 60;
      z += (Math.cos(direction) * speed) / 60;
      const phase = ((Math.min(tick + 1, 80) * 3.65625) / 60 / 1.72) % 1;
      const { pose, heading } = animator.sample(
        { ...actor, x, z, directionalFacing: { x: Math.sin(direction), z: Math.cos(direction) } },
        {
          id: actor.id,
          clip: speed ? "run" : "idle",
          phase,
          animation: {
            motion: speed ? "run" : "idle",
            phase,
            elapsedMs: (tick * 1000) / 60,
            speed,
            stridePhase: phase,
          },
        },
        (tick * 1000) / 60,
      );
      const feet = pose.feet.map((foot) => [
        x + Math.cos(heading) * foot.position[0] + Math.sin(heading) * foot.position[2],
        z - Math.sin(heading) * foot.position[0] + Math.cos(heading) * foot.position[2],
      ]);
      if (lastFeet)
        for (const side of [0, 1] as const) {
          const a = feet[side],
            b = lastFeet[side];
          if (a && b)
            maxStep = Math.max(
              maxStep,
              Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0)),
            );
        }
      lastFeet = feet;
      if (tick === 119)
        expect(pose.feet.every((foot) => foot.contact && foot.position[1] === 0.07)).toBe(true);
    }
    expect(maxStep).toBeLessThan(0.16);
  });

  it("has continuous loop curves and a stable final death pose", () => {
    for (const name of ["idle", "run", "swim", "glide"] as const) {
      const before = samplePriestPose(motion, name, 1 - 1e-6),
        after = samplePriestPose(motion, name, 0);
      expect(Math.abs(before.pelvis[1] - after.pelvis[1])).toBeLessThan(0.0001);
      expect(Math.abs(before.hands[0][2] - after.hands[0][2])).toBeLessThan(0.0001);
    }
    expect(samplePriestPose(motion, "death", 1)).toEqual(samplePriestPose(motion, "death", 9));
    expect(samplePriestPose(motion, "death", 0.9)).toEqual(samplePriestPose(motion, "death", 1));
  });

  it("inherits the actual casting orientation when a separate corpse replaces the live actor", () => {
    const live = new PriestPosePlayer(motion);
    live.sample(actor, { id: actor.id, clip: "prayer", phase: 0.4, aim: { x: 0, z: -1 } }, 1000);
    const pose = live.lastPose();
    const corpse = new PriestPosePlayer(motion, pose, live.lastHeading());
    const first = corpse.sample(actor, { id: "corpse:priest", clip: "death", phase: 0 }, 1100);
    expect(first.pose).toEqual(pose);
    expect(first.heading).toBe(live.lastHeading());
    const final = corpse.sample(actor, { id: "corpse:priest", clip: "death", phase: 1 }, 2200);
    expect(final.heading).toBe(first.heading);
    expect(final.pose).toEqual(samplePriestPose(motion, "death", 1));
  });

  it("pins fractional poses to accepted impact and held-release times, including haste", () => {
    for (const scale of [0.5, 1, 1.4]) {
      const timeline = {
        startedAt: 1000,
        impactAt: 1000 + 140 * scale,
        recoveryEndsAt: 1000 + 325 * scale,
      };
      expect(combatActionPhase(0.4, timeline, 999)).toBe(0);
      expect(combatActionPhase(0.4, timeline, timeline.impactAt)).toBe(0.4);
      expect(combatActionPhase(0.4, timeline, timeline.recoveryEndsAt)).toBe(1);
      expect(combatActionPhase(0.4, timeline, 1000 + 70 * scale)).toBeCloseTo(0.2);
    }
    const held = { startedAt: 1000, impactAt: 1180, recoveryEndsAt: 2600 };
    expect(combatActionPhase(0.4, held, 1900, 2180)).toBe(0.4);
    expect(combatActionPhase(0.4, held, 2180, 2180)).toBe(0.4);
    expect(combatActionPhase(0.4, held, 2390, 2180)).toBeCloseTo(0.7);
    expect(combatActionPhase(0.4, held, 9000, 2180)).toBe(1);
  });
});
