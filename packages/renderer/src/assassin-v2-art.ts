import manifest from "./assets/bonus/assassin-v2/manifest.json" with { type: "json" };
import type { CharacterAnimationSample, CharacterMotion } from "./character-animation.js";
import { rasterFrame, rasterMotionClip, rasterSheet } from "./raster-character-art.js";
import type { UnitSheet } from "./tiny-swords-art.js";

export const ASSASSIN_V2_MANIFEST = manifest;
export type AssassinV2Clip = keyof typeof manifest.clips;

// Skills share the exact V1 textures, pose order and authoritative contact frames.
const sources: Record<AssassinV2Clip, string> = {
  idle: new URL("./assets/bonus/assassin-v2/idle.png", import.meta.url).href,
  run: new URL("./assets/bonus/assassin-v2/run.png", import.meta.url).href,
  "dual-slash": new URL("./assets/bonus/assassin-v2/dual-slash.png", import.meta.url).href,
  "shadow-step": new URL("./assets/bonus/assassin-v2/shadow-step.png", import.meta.url).href,
  vanish: new URL("./assets/bonus/assassin-v2/vanish.png", import.meta.url).href,
  "poisoned-shiv": new URL("./assets/bonus/assassin-v2/poisoned-shiv.png", import.meta.url).href,
  "shadow-dance": new URL("./assets/bonus/assassin-v2/shadow-dance.png", import.meta.url).href,
  death: new URL("./assets/bonus/assassin-v2/death.png", import.meta.url).href,
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
  return rasterMotionClip(motion, manifest.clips, sample);
}

export function assassinV2Sheet(name: AssassinV2Clip): UnitSheet {
  return rasterSheet(sources[name], name, manifest.clips[name]);
}

export function allAssassinV2Sheets(): UnitSheet[] {
  return (Object.keys(sources) as AssassinV2Clip[]).map(assassinV2Sheet);
}

export function assassinV2Frame(
  name: AssassinV2Clip,
  sample: CharacterAnimationSample,
): number | undefined {
  return rasterFrame(name, manifest.clips[name], sample);
}

export function assassinV2ActiveFrame(skillId?: string): number {
  const clip = manifest.clips[assassinV2MotionClip("attack", skillId)];
  return "activeFrame" in clip ? clip.activeFrame : 0;
}
