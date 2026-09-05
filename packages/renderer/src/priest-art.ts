import manifest from "./assets/characters/priest/manifest.json";
import type { CharacterMotion } from "./character-animation.js";
import type { UnitSheet } from "./tiny-swords-art.js";

export const PRIEST_MANIFEST = manifest;
export type PriestClip = keyof typeof manifest.clips;

const SOURCES: Readonly<Record<PriestClip, string>> = {
  idle: new URL("./assets/characters/priest/idle.png", import.meta.url).href,
  run: new URL("./assets/characters/priest/run.png", import.meta.url).href,
  jump: new URL("./assets/characters/priest/jump.png", import.meta.url).href,
  fall: new URL("./assets/characters/priest/fall.png", import.meta.url).href,
  land: new URL("./assets/characters/priest/land.png", import.meta.url).href,
  swim: new URL("./assets/characters/priest/swim.png", import.meta.url).href,
  glide: new URL("./assets/characters/priest/glide.png", import.meta.url).href,
  hurt: new URL("./assets/characters/priest/hurt.png", import.meta.url).href,
  "radiant-bolt": new URL("./assets/characters/priest/radiant-bolt.png", import.meta.url).href,
  mend: new URL("./assets/characters/priest/mend.png", import.meta.url).href,
  blink: new URL("./assets/characters/priest/blink.png", import.meta.url).href,
  prayer: new URL("./assets/characters/priest/prayer.png", import.meta.url).href,
  "divine-nova": new URL("./assets/characters/priest/divine-nova.png", import.meta.url).href,
  death: new URL("./assets/characters/priest/death.png", import.meta.url).href,
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

export function priestSheet(clip: PriestClip): UnitSheet {
  const frame = manifest.clips[clip].frame;
  return {
    source: SOURCES[clip],
    frames: manifest.clips[clip].frames,
    frameWidth: frame.width,
    frameHeight: frame.height,
    footOffset: frame.height - frame.anchor.y,
    directionRows: manifest.directions.length,
    directionLayout: "full",
    renderHeight: frame.worldHeight,
  };
}

export function priestMotionClip(motion: CharacterMotion, skillId?: string): PriestClip {
  return motion === "attack"
    ? skillId && isPriestSkillId(skillId)
      ? PRIEST_SKILL_CLIPS[skillId]
      : "radiant-bolt"
    : motion;
}

export function priestSkillActiveFrame(skill: PriestSkillId): number {
  return manifest.clips[PRIEST_SKILL_CLIPS[skill]].releaseFrame;
}

export function allPriestSheets(): UnitSheet[] {
  // The idle atlas serves afterimages. Hero selection uses its own square portrait. Motion uses the compact
  // compiled rig; the other PNGs are delivery/preview exports, not eagerly decoded textures.
  return [priestSheet("idle")];
}
