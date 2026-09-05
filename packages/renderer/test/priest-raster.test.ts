import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { PLAYER_ACTIONS } from "@lindocara/engine/combat-actions.js";
import type { PlayerSnapshot } from "@lindocara/engine/protocol.js";
import { describe, expect, it } from "vitest";

import { CharacterAnimationTracker } from "../src/character-animation.js";
import { combatActionFrameIndex } from "../src/combat-art.js";
import { directionalFrame } from "../src/hd2d/billboards.js";
import { playerActorView } from "../src/hd2d/game-renderer.js";
import {
  PRIEST_MANIFEST as manifest,
  isPriestSkillId,
  priestFrame,
  priestMotionClip,
  priestSheet,
  priestSkillActiveFrame,
  priestWeaponOffset,
} from "../src/priest-art.js";

const player: PlayerSnapshot = {
  id: "priest",
  nick: "test",
  class: "priest",
  appearance: { body: "priest", primaryColor: "azure" },
  equipment: starterEquipmentFor("priest"),
  level: 1,
  hp: 100,
  maxHp: 100,
  life: "alive",
  x: 0,
  y: 0,
  z: 0,
  facing: { x: 0, z: 1 },
  airborne: false,
  swimming: false,
  gliding: false,
  vy: 0,
  action: null,
};
const options = { coordinatedTransitions: true };

describe("Priest raster integration", () => {
  it("binds every actual Priest skill to its authoritative release and full recovery", () => {
    for (const action of PLAYER_ACTIONS.priest) {
      if (!isPriestSkillId(action.skillId)) throw new Error(`Unanimated skill: ${action.skillId}`);
      const name = priestMotionClip("attack", action.skillId),
        clip = manifest.clips[name];
      const active = priestSkillActiveFrame(action.skillId);
      const timeline = {
        startedAt: 1000,
        impactAt: 1000 + action.anticipationMs,
        recoveryEndsAt: 1000 + action.anticipationMs + action.recoveryMs,
      };
      expect(clip.durationMs).toBe(action.anticipationMs + action.recoveryMs);
      expect(combatActionFrameIndex(clip.frames, active, timeline, timeline.startedAt)).toBe(0);
      expect(combatActionFrameIndex(clip.frames, active, timeline, timeline.impactAt)).toBe(active);
      expect(combatActionFrameIndex(clip.frames, active, timeline, timeline.recoveryEndsAt)).toBe(
        clip.frames - 1,
      );
      expect(priestSheet(name).source).toContain("/bonus/priest-prototype/");
      for (let direction = 0; direction < 8; direction++) {
        const angle = (direction * Math.PI) / 4;
        for (const yaw of [0, 0.7, 2.2]) {
          const view = directionalFrame({ x: Math.sin(angle), z: Math.cos(angle) }, yaw);
          const socket = priestWeaponOffset(name, view.row, active, view.flipped, yaw, 0.7, 0.85);
          expect(socket).not.toBeNull();
          expect(socket?.y).toBeGreaterThan(0.65);
        }
      }
    }
  });

  it("retains distance phase through all headings at 30, 60 and 144 Hz without diagonal acceleration", () => {
    for (const hz of [30, 60, 144]) {
      const tracker = new CharacterAnimationTracker();
      tracker.sample(player, 0, manifest.strideDistance, options);
      let x = 0,
        z = 0;
      for (let tick = 1; tick <= hz; tick++) {
        const angle = (Math.floor(tick / (hz / 8)) * Math.PI) / 4;
        x += (Math.sin(angle) * manifest.referenceSpeed) / hz;
        z += (Math.cos(angle) * manifest.referenceSpeed) / hz;
        const sample = tracker.sample(
          { ...player, x, z, facing: { x: Math.sin(angle), z: Math.cos(angle) } },
          (tick * 1000) / hz,
          manifest.strideDistance,
          options,
        );
        expect(sample.stridePhase).toBeCloseTo(
          ((tick * manifest.referenceSpeed) / hz / manifest.strideDistance) % 1,
          9,
        );
        expect(sample.elapsedMs).toBeCloseTo(((tick - 1) * 1000) / hz, 9);
      }
    }
  });

  it("retains takeoff phase, completes a moving landing and settles exactly once", () => {
    const tracker = new CharacterAnimationTracker();
    tracker.sample(player, 0, manifest.strideDistance, options);
    const run = tracker.sample({ ...player, x: 0.6 }, 160, manifest.strideDistance, options);
    const jump = tracker.sample(
      { ...player, x: 0.65, airborne: true, vy: 9 },
      176,
      manifest.strideDistance,
      options,
    );
    expect(jump.takeoffPhase).toBe(run.stridePhase);
    expect(priestMotionClip(jump.motion, undefined, jump)).toBe("jump-run");
    const turn = tracker.sample(
      { ...player, x: 0.9, airborne: true, vy: 3, facing: { x: -1, z: 0 } },
      350,
      manifest.strideDistance,
      options,
    );
    expect(turn.takeoffPhase).toBe(jump.takeoffPhase);
    expect(turn.stridePhase).toBe(run.stridePhase);
    const bankFrame = priestFrame("jump-run", turn);
    expect(bankFrame).toBeGreaterThanOrEqual(0);
    expect(bankFrame).toBeLessThan(manifest.clips["jump-run"].frames);
    tracker.sample(
      { ...player, x: 1, airborne: true, vy: -4 },
      500,
      manifest.strideDistance,
      options,
    );
    const land = tracker.sample({ ...player, x: 1.1 }, 580, manifest.strideDistance, options);
    expect(priestMotionClip(land.motion, undefined, land)).toBe("land-run");
    expect(
      tracker.sample({ ...player, x: 1.4 }, 670, manifest.strideDistance, options).motion,
    ).toBe("land");
    const resumed = tracker.sample({ ...player, x: 1.8 }, 800, manifest.strideDistance, options);
    expect(resumed.motion).toBe("run");
    const stop = tracker.sample({ ...player, x: 1.8 }, 816, manifest.strideDistance, options);
    expect(stop.stopPhase).toBe(resumed.stridePhase);
    expect(priestMotionClip(stop.motion, undefined, stop)).toBe("stop");
    const idle = tracker.sample({ ...player, x: 1.8 }, 960, manifest.strideDistance, options);
    expect(priestMotionClip(idle.motion, undefined, idle)).toBe("idle");
  });

  it("locks the casting heading and renders authored air poses without a second body deformation", () => {
    const action = {
      id: "cast",
      kind: "skill" as const,
      skillId: "radiant_bolt",
      startedAt: 0,
      impactAt: 140,
      recoveryEndsAt: 325,
      resolved: false,
      direction: { x: 1, z: 0 },
    };
    const sample = {
      motion: "attack" as const,
      phase: 0,
      elapsedMs: 0,
      speed: 0,
      stridePhase: 0.3,
    };
    const view = playerActorView(
      { ...player, action, airborne: true, facing: { x: -1, z: 0 } },
      0,
      "attack",
      325,
      true,
      sample,
    );
    expect(view.directionalFacing).toEqual(action.direction);
    expect(view.authoredAirborne).toBe(true);
    expect(view.renderHeight).toBe(priestSheet("radiant-bolt").renderHeight);
    const tracker = new CharacterAnimationTracker();
    tracker.sample(player, 0, manifest.strideDistance, options);
    const before = tracker.sample({ ...player, x: 0.2 }, 50, manifest.strideDistance, options);
    const blink = tracker.sample(
      { ...player, x: 0.8, action: { ...action, skillId: "blink" } },
      100,
      manifest.strideDistance,
      options,
    );
    expect(blink.stridePhase).toBe(before.stridePhase);
  });
});
