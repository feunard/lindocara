import manifest from "./assets/bonus/assassin-v2/manifest.json" with { type: "json" };
import type { CharacterAnimationSample, CharacterMotion } from "./character-animation.js";
import type { UnitSheet } from "./tiny-swords-art.js";

export const ASSASSIN_V2_MANIFEST = manifest;
export type AssassinV2Clip = keyof typeof manifest.clips;

// Skills share the exact V1 textures, pose order and authoritative contact frames.
const sources: Record<AssassinV2Clip, string> = {
  idle: new URL("./assets/bonus/assassin-v2/idle.png", import.meta.url).href,
  run: new URL("./assets/bonus/assassin-v2/run.png", import.meta.url).href,
  "dual-slash": new URL("./assets/bonus/assassin/dual-slash.png", import.meta.url).href,
  "shadow-step": new URL("./assets/bonus/assassin/shadow-step.png", import.meta.url).href,
  vanish: new URL("./assets/bonus/assassin/vanish.png", import.meta.url).href,
  "poisoned-shiv": new URL("./assets/bonus/assassin/poisoned-shiv.png", import.meta.url).href,
  "shadow-dance": new URL("./assets/bonus/assassin/shadow-dance.png", import.meta.url).href,
  death: new URL("./assets/bonus/assassin/death.png", import.meta.url).href,
  jump: new URL("./assets/bonus/assassin-v2/jump.png", import.meta.url).href,
  "jump-run": new URL("./assets/bonus/assassin-v2/jump-run.png", import.meta.url).href,
  fall: new URL("./assets/bonus/assassin-v2/fall.png", import.meta.url).href,
  land: new URL("./assets/bonus/assassin-v2/land.png", import.meta.url).href,
  "land-run": new URL("./assets/bonus/assassin-v2/land-run.png", import.meta.url).href,
  hurt: new URL("./assets/bonus/assassin-v2/hurt.png", import.meta.url).href,
  swim: new URL("./assets/bonus/assassin-v2/swim.png", import.meta.url).href,
  glide: new URL("./assets/bonus/assassin-v2/glide.png", import.meta.url).href,
  stop: new URL("./assets/bonus/assassin-v2/stop.png", import.meta.url).href,
  start: new URL("./assets/bonus/assassin-v2/stop.png", import.meta.url).href,
};

export function assassinV2MotionClip(
  motion: CharacterMotion,
  skillId?: string,
  sample?: CharacterAnimationSample,
): AssassinV2Clip {
  if (motion === "attack") {
    switch (skillId) {
      case "shadow_step":
        return "shadow-step";
      case "vanish":
        return "vanish";
      case "poisoned_shiv":
        return "poisoned-shiv";
      case "shadow_dance":
        return "shadow-dance";
      default:
        return "dual-slash";
    }
  }
  if (!sample) return motion;
  if (
    motion === "idle" &&
    sample.stopPhase !== undefined &&
    sample.elapsedMs < manifest.clips.stop.durationMs
  )
    return "stop";
  if (
    motion === "run" &&
    sample.startedFromIdle &&
    sample.elapsedMs < manifest.clips.start.durationMs
  )
    return "start";
  if (motion === "jump" && sample.takeoffPhase !== undefined) return "jump-run";
  if (motion === "land" && sample.speed > 0.025) return "land-run";
  return motion;
}

export function assassinV2Sheet(name: AssassinV2Clip): UnitSheet {
  const clip = manifest.clips[name];
  return {
    source: sources[name],
    frames: clip.frames,
    frameWidth: clip.frame.width,
    frameHeight: clip.frame.height,
    footOffset: clip.frame.height - clip.frame.anchor.y,
    renderHeight: clip.frame.height / clip.pixelsPerTile,
    directionRows: clip.directionRows,
    sheetColumns: clip.columns,
    directionStride: clip.directionStride,
    ...(["run", "jump-run", "land-run", "start", "stop"].includes(name)
      ? { mirroredPhaseOffset: 0.5 }
      : {}),
  };
}

export function allAssassinV2Sheets(): UnitSheet[] {
  return (Object.keys(sources) as AssassinV2Clip[]).map(assassinV2Sheet);
}

export function assassinV2Frame(
  name: AssassinV2Clip,
  sample: CharacterAnimationSample,
): number | undefined {
  const clip = manifest.clips[name];
  if ("phaseBuckets" in clip) {
    const phase =
      name === "stop"
        ? (sample.stopPhase ?? 0)
        : name === "jump-run"
          ? (sample.takeoffPhase ?? 0)
          : sample.stridePhase;
    const bank = Math.round(phase * clip.phaseBuckets) % clip.phaseBuckets;
    const progress =
      name === "jump-run" ? sample.phase : Math.min(1, sample.elapsedMs / clip.durationMs);
    let frame = Math.min(clip.transitionFrames - 1, Math.floor(progress * clip.transitionFrames));
    if (name === "start") frame = clip.transitionFrames - 1 - frame;
    return bank * clip.transitionFrames + frame;
  }
  if (sample.motion === "run" || sample.motion === "jump" || sample.motion === "fall")
    return Math.min(
      clip.frames - 1,
      Math.floor(sample.phase * (clip.loop ? clip.frames : clip.frames - 1)),
    );
  return undefined;
}

export function assassinV2ActiveFrame(skillId?: string): number {
  const clip = manifest.clips[assassinV2MotionClip("attack", skillId)];
  return "activeFrame" in clip ? clip.activeFrame : 0;
}
