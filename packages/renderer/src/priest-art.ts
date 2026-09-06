import manifest from "./assets/bonus/priest-prototype/manifest.json" with { type: "json" };
import type { CharacterAnimationSample, CharacterMotion } from "./character-animation.js";
import {
  rasterFrame,
  rasterMotionClip,
  rasterSheet,
  rasterSocketOffset,
} from "./raster-character-art.js";
import type { UnitSheet } from "./tiny-swords-art.js";

export const PRIEST_MANIFEST = manifest;
export type PriestClip = keyof typeof manifest.clips;

const SOURCES: Readonly<Record<PriestClip, string>> = {
  idle: new URL("./assets/bonus/priest-prototype/idle.png", import.meta.url).href,
  run: new URL("./assets/bonus/priest-prototype/run.png", import.meta.url).href,
  jump: new URL("./assets/bonus/priest-prototype/jump.png", import.meta.url).href,
  fall: new URL("./assets/bonus/priest-prototype/fall.png", import.meta.url).href,
  land: new URL("./assets/bonus/priest-prototype/land.png", import.meta.url).href,
  swim: new URL("./assets/bonus/priest-prototype/swim.png", import.meta.url).href,
  glide: new URL("./assets/bonus/priest-prototype/glide.png", import.meta.url).href,
  hurt: new URL("./assets/bonus/priest-prototype/hurt.png", import.meta.url).href,
  "jump-run": new URL("./assets/bonus/priest-prototype/jump-run.png", import.meta.url).href,
  "land-run": new URL("./assets/bonus/priest-prototype/land-run.png", import.meta.url).href,
  stop: new URL("./assets/bonus/priest-prototype/stop.png", import.meta.url).href,
  start: new URL("./assets/bonus/priest-prototype/stop.png", import.meta.url).href,
  "radiant-bolt": new URL("./assets/bonus/priest-prototype/radiant-bolt.png", import.meta.url).href,
  mend: new URL("./assets/bonus/priest-prototype/mend.png", import.meta.url).href,
  blink: new URL("./assets/bonus/priest-prototype/blink.png", import.meta.url).href,
  prayer: new URL("./assets/bonus/priest-prototype/prayer.png", import.meta.url).href,
  "divine-nova": new URL("./assets/bonus/priest-prototype/divine-nova.png", import.meta.url).href,
  death: new URL("./assets/bonus/priest-prototype/death.png", import.meta.url).href,
};

export const PRIEST_SKILL_CLIPS = {
  radiant_bolt: "radiant-bolt",
  mend: "mend",
  blink: "blink",
  prayer: "prayer",
  divine_nova: "divine-nova",
} as const;
export type PriestSkillId = keyof typeof PRIEST_SKILL_CLIPS;

export function isPriestSkillId(value: string): value is PriestSkillId {
  return Object.hasOwn(PRIEST_SKILL_CLIPS, value);
}

export function priestSheet(name: PriestClip): UnitSheet {
  return { ...rasterSheet(SOURCES[name], name, manifest.clips[name]), groundedFootprint: true };
}

export function priestMotionClip(
  motion: CharacterMotion,
  skillId?: string,
  sample?: CharacterAnimationSample,
): PriestClip {
  if (motion === "attack")
    return skillId && isPriestSkillId(skillId) ? PRIEST_SKILL_CLIPS[skillId] : "radiant-bolt";
  return rasterMotionClip(motion, manifest.clips, sample);
}

export function priestFrame(
  name: PriestClip,
  sample: CharacterAnimationSample,
): number | undefined {
  return rasterFrame(name, manifest.clips[name], sample);
}

export function priestSkillActiveFrame(skill: PriestSkillId): number {
  return manifest.clips[PRIEST_SKILL_CLIPS[skill]].activeFrame;
}

export function allPriestSheets(): UnitSheet[] {
  return (Object.keys(SOURCES) as PriestClip[]).map(priestSheet);
}

/** The orb centre in the displayed frame, including mirrored views and camera pitch. */
export function priestWeaponOffset(
  clip: PriestClip,
  row: number,
  frame: number,
  flipped: boolean,
  yaw: number,
  pitch: number,
  stretch: number,
): { x: number; y: number; z: number } | null {
  const definition = manifest.clips[clip];
  const index = Math.max(0, Math.min(definition.frames - 1, Math.floor(frame)));
  const socket = definition.weaponSockets[row]?.[index];
  return socket
    ? rasterSocketOffset(
        socket,
        manifest.sourceFrame.anchor,
        definition.pixelsPerTile,
        flipped,
        yaw,
        pitch,
        stretch,
      )
    : null;
}
