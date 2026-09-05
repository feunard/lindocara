import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { PLAYER_ACTIONS } from "@lindocara/engine/combat-actions.js";
import { parseCreateHeroInput } from "@lindocara/engine/hero.js";
import type { PlayerSnapshot } from "@lindocara/engine/protocol.js";
import { describe, expect, it } from "vitest";

import {
  ASSASSIN_V2_MANIFEST as manifest,
  assassinV2ActiveFrame,
  assassinV2Frame,
  assassinV2MotionClip,
  assassinV2Sheet,
} from "../src/assassin-v2-art.js";
import { CharacterAnimationTracker } from "../src/character-animation.js";
import { combatActionFrameIndex } from "../src/combat-art.js";
import { playerActorView } from "../src/hd2d/game-renderer.js";
import {
  ASSASSIN_SKILL_SHEETS,
  ASSASSIN_SKILL_ACTIVE_FRAMES,
  isAssassinSkillId,
  unitSheet,
} from "../src/tiny-swords-art.js";

const player: PlayerSnapshot = {
  id: "assassin",
  nick: "test",
  class: "rogue",
  appearance: { body: "assassin_v2", primaryColor: "violet" },
  equipment: starterEquipmentFor("rogue"),
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

describe("Assassin 2 authored animation", () => {
  it("remains an optional Rogue body alongside the original, including input validation", () => {
    expect(parseCreateHeroInput({ name: "Nyx", class: "rogue", body: "assassin_v2" })?.body).toBe(
      "assassin_v2",
    );
    expect(parseCreateHeroInput({ name: "Nyx", class: "warrior", body: "assassin_v2" })).toBeNull();
    expect(unitSheet("rogue", { ...player.appearance, body: "assassin" }, "run").frames).toBe(10);
    expect(unitSheet("rogue", player.appearance, "run").frames).toBe(36);
  });

  it("pins every real Rogue release to the declared contact pose", () => {
    for (const action of PLAYER_ACTIONS.rogue) {
      const name = assassinV2MotionClip("attack", action.skillId),
        clip = manifest.clips[name];
      if (!("activeFrame" in clip)) throw new Error(`Missing contact: ${name}`);
      if (!isAssassinSkillId(action.skillId))
        throw new Error(`Unexpected Rogue skill: ${action.skillId}`);
      const original = ASSASSIN_SKILL_SHEETS[action.skillId];
      expect(assassinV2Sheet(name)).toMatchObject({
        source: original.source,
        frames: original.frames,
        frameWidth: original.frameWidth,
        frameHeight: original.frameHeight,
        footOffset: original.footOffset,
      });
      expect(assassinV2ActiveFrame(action.skillId)).toBe(
        ASSASSIN_SKILL_ACTIVE_FRAMES[action.skillId],
      );
      const timeline = {
        startedAt: 1000,
        impactAt: 1000 + action.anticipationMs,
        recoveryEndsAt: 1000 + action.anticipationMs + action.recoveryMs,
      };
      expect(clip.durationMs).toBe(action.anticipationMs + action.recoveryMs);
      expect(
        combatActionFrameIndex(clip.frames, clip.activeFrame, timeline, timeline.impactAt),
      ).toBe(clip.activeFrame);
      expect(
        combatActionFrameIndex(clip.frames, clip.activeFrame, timeline, timeline.recoveryEndsAt),
      ).toBe(clip.frames - 1);
    }
  });

  it("spends Euclidean distance through diagonals and mirrored turns at 30, 60 and 144 Hz", () => {
    for (const hz of [30, 60, 144]) {
      const tracker = new CharacterAnimationTracker();
      let x = 0,
        z = 0;
      tracker.sample(player, 0, manifest.strideDistance, options);
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
      }
    }
  });

  it("keeps strides during melee, excludes a granted blink and settles from the departing phase", () => {
    const tracker = new CharacterAnimationTracker();
    tracker.sample(player, 0, manifest.strideDistance, options);
    const running = tracker.sample({ ...player, x: 0.2 }, 40, manifest.strideDistance, options);
    const stopped = tracker.sample({ ...player, x: 0.2 }, 56, manifest.strideDistance, options);
    expect(stopped.stopPhase).toBe(running.stridePhase);
    expect(assassinV2MotionClip(stopped.motion, undefined, stopped)).toBe("stop");
    const end = tracker.sample({ ...player, x: 0.2 }, 200, manifest.strideDistance, options);
    expect(assassinV2MotionClip(end.motion, undefined, end)).toBe("idle");
    const action = {
      id: "hit",
      kind: "skill" as const,
      skillId: "dual_slash",
      startedAt: 200,
      impactAt: 305,
      recoveryEndsAt: 525,
      resolved: false,
      direction: { x: 1, z: 0 },
    };
    const melee = tracker.sample(
      { ...player, x: 0.4, action },
      240,
      manifest.strideDistance,
      options,
    );
    expect(melee.stridePhase).toBeCloseTo(0.4 / manifest.strideDistance);
    expect(assassinV2MotionClip(melee.motion, action.skillId, melee)).toBe("dual-slash");
    const blink = tracker.sample(
      { ...player, x: 0.8, action: { ...action, skillId: "shadow_step" } },
      256,
      manifest.strideDistance,
      options,
    );
    expect(blink.stridePhase).toBe(melee.stridePhase);
  });

  it("completes landings and hit reactions while moving, and never substitutes cropped legs in the air", () => {
    const tracker = new CharacterAnimationTracker();
    tracker.sample({ ...player, airborne: true, vy: -3 }, 0, manifest.strideDistance, options);
    expect(tracker.sample({ ...player, x: 0.1 }, 16, manifest.strideDistance, options).motion).toBe(
      "land",
    );
    expect(
      tracker.sample({ ...player, x: 0.4 }, 80, manifest.strideDistance, options).elapsedMs,
    ).toBe(64);
    expect(
      tracker.sample({ ...player, x: 0.8 }, 220, manifest.strideDistance, options).motion,
    ).toBe("run");
    expect(
      tracker.sample({ ...player, x: 1, hp: 90 }, 260, manifest.strideDistance, options).motion,
    ).toBe("hurt");
    const airborne = {
      ...player,
      airborne: true,
      action: {
        id: "slash",
        kind: "skill" as const,
        skillId: "dual_slash",
        direction: { x: 1, z: 0 },
        startedAt: 0,
        impactAt: 105,
        recoveryEndsAt: 325,
        resolved: false,
      },
    };
    const sample = {
      motion: "attack" as const,
      phase: 0,
      elapsedMs: 0,
      speed: 5,
      stridePhase: 0.25,
    };
    const view = playerActorView(airborne, 0, "attack", 325, true, sample);
    expect(view.textureKey).toBe(assassinV2Sheet("dual-slash").source);
    expect(view.authoredAirborne).toBe(false);
    expect(assassinV2Frame("run", { ...sample, motion: "run", phase: 0.75 })).toBe(27);
  });

  it("carries takeoff phase through a turn and joins the shared apex and moving landing", () => {
    const tracker = new CharacterAnimationTracker();
    tracker.sample(player, 0, manifest.strideDistance, options);
    const run = tracker.sample({ ...player, x: 0.65 }, 150, manifest.strideDistance, options);
    const launch = tracker.sample(
      { ...player, x: 0.72, airborne: true, vy: 9 },
      166,
      manifest.strideDistance,
      options,
    );
    expect(launch.takeoffPhase).toBe(run.stridePhase);
    expect(assassinV2MotionClip("jump", undefined, launch)).toBe("jump-run");
    const turn = tracker.sample(
      { ...player, x: 0.8, airborne: true, vy: 3, facing: { x: -1, z: 0 } },
      360,
      manifest.strideDistance,
      options,
    );
    expect(turn.takeoffPhase).toBe(launch.takeoffPhase);
    expect(turn.stridePhase).toBe(run.stridePhase);
    const fall = tracker.sample(
      { ...player, x: 0.9, airborne: true, vy: -0.1 },
      460,
      manifest.strideDistance,
      options,
    );
    expect(assassinV2MotionClip(fall.motion, undefined, fall)).toBe("fall");
    const land = tracker.sample({ ...player, x: 1 }, 600, manifest.strideDistance, options);
    expect(assassinV2MotionClip(land.motion, undefined, land)).toBe("land-run");
    expect(assassinV2Sheet("start").source).toBe(assassinV2Sheet("stop").source);
  });
});
