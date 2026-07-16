import type { CharacterAppearance, Equipment, PrimaryColor } from "../../shared/character.js";
import type { PlayerClass } from "../../shared/game.js";
import type { SkillSlot } from "../../shared/skills.js";

export const TINY_SWORDS_ROOT = "/assets/lindocara/tiny-swords";
export const TINY_SWORDS_UNIT_FRAME = 192;

/**
 * The land sheet at its native 64px. `Tilemap_Flat.png` is a 4x4 autotile block (see
 * `autotile.ts`).
 *
 * `Water.png` is one flat colour — 64x64 of RGB(71,171,169) and nothing else. That is not a
 * placeholder: Tiny Swords draws the sea as a flat "BG Color" layer and puts *all* the motion in
 * the foam that rings each shoreline (the pack's own tilemap documentation labels the layers
 * `BG Color` -> `Water Foam` -> `Flat Ground`). Do not reach for a scrolling texture here — a
 * uniform colour cannot scroll visibly, which is the trap the previous photographic ocean surface
 * fell into.
 */
export const TINY_SWORDS_TERRAIN = {
  flat: `${TINY_SWORDS_ROOT}/terrain/Tilemap_Flat.png`,
  water: `${TINY_SWORDS_ROOT}/terrain/Water.png`,
  foam: `${TINY_SWORDS_ROOT}/terrain/Foam.png`,
};

/** `Foam.png` is eight 192x192 frames; the blob itself is ~82px, centred. Drawn centred under a
 *  64px land tile it bleeds ~9px into the water on every side, and the union of the blobs under a
 *  landmass is what draws its shoreline. */
export const TINY_SWORDS_FOAM_FRAME = 192;
export const TINY_SWORDS_FOAM_FRAMES = 8;

/**
 * Deliberately curated across Tiny Swords factions: roof colour gives each city district an
 * identity while the shared silhouettes/palette keep the town visually coherent.
 */
export const TINY_SWORDS_BUILDINGS = [
  `${TINY_SWORDS_ROOT}/buildings/House1.png`,
  `${TINY_SWORDS_ROOT}/buildings/House2.png`,
  `${TINY_SWORDS_ROOT}/buildings/House3.png`,
  `${TINY_SWORDS_ROOT}/buildings/Barracks.png`,
  `${TINY_SWORDS_ROOT}/buildings/Monastery.png`,
  `${TINY_SWORDS_ROOT}/buildings/Tower.png`,
  `${TINY_SWORDS_ROOT}/buildings/Castle.png`,
  new URL(
    "../../../assets/Tiny Swords (Free Pack)/Buildings/Red Buildings/House1.png",
    import.meta.url,
  ).href,
  new URL(
    "../../../assets/Tiny Swords (Free Pack)/Buildings/Yellow Buildings/Barracks.png",
    import.meta.url,
  ).href,
  new URL(
    "../../../assets/Tiny Swords (Free Pack)/Buildings/Purple Buildings/Monastery.png",
    import.meta.url,
  ).href,
  new URL(
    "../../../assets/Tiny Swords (Free Pack)/Buildings/Red Buildings/House3.png",
    import.meta.url,
  ).href,
  new URL(
    "../../../assets/Tiny Swords (Free Pack)/Buildings/Yellow Buildings/House2.png",
    import.meta.url,
  ).href,
] as const;

export const TINY_SWORDS_SIGN_BOARD = new URL(
  "../../../assets/Tiny Swords (Free Pack)/UI Elements/UI Elements/Banners/Banner.png",
  import.meta.url,
).href;

/**
 * Quest-site resources (wood/gold/meat), cropped from the same Tiny Swords Terrain/Resources
 * sheets as everything else here. Formerly lived in `vendor-art.ts` alongside the (now-replaced)
 * monster art; moved here because these three are not monster art and must survive the deletion
 * of the CraftPix/ForgottenMemories/Resurrected-RPG/Icons32x32 packs.
 */
export const TINY_SWORDS_QUEST_ART = {
  wood: `${TINY_SWORDS_ROOT}/quests/wood.png`,
  gold: `${TINY_SWORDS_ROOT}/quests/gold.png`,
  meat: `${TINY_SWORDS_ROOT}/quests/meat.png`,
} as const;

export const TINY_SWORDS_EFFECTS = {
  fire: `${TINY_SWORDS_ROOT}/effects/Fire_01.png`,
  explosion: `${TINY_SWORDS_ROOT}/effects/Explosion_01.png`,
  dust: `${TINY_SWORDS_ROOT}/effects/Dust_01.png`,
  splash: `${TINY_SWORDS_ROOT}/effects/Water Splash.png`,
  heal: `${TINY_SWORDS_ROOT}/units/blue/monk/Heal_Effect.png`,
  arrow: `${TINY_SWORDS_ROOT}/units/blue/archer/Arrow.png`,
} as const;

export const TINY_SWORDS_SKILL_ICONS = Array.from(
  { length: 12 },
  (_, index) => `${TINY_SWORDS_ROOT}/ui/Icon_${String(index + 1).padStart(2, "0")}.png`,
);

export const TINY_SWORDS_HUD = {
  bigBarBase: `${TINY_SWORDS_ROOT}/ui/BigBar_Base.png`,
  bigBarFill: `${TINY_SWORDS_ROOT}/ui/BigBar_Fill.png`,
  smallBarBase: `${TINY_SWORDS_ROOT}/ui/SmallBar_Base.png`,
  smallBarFill: `${TINY_SWORDS_ROOT}/ui/SmallBar_Fill.png`,
  skillSlot: `${TINY_SWORDS_ROOT}/ui/Banner_Slots.png`,
} as const;

export const TINY_SWORDS_EFFECT_SHEETS = {
  fire: { source: `${TINY_SWORDS_ROOT}/effects/Fire_01.png`, frame: 64, frames: 8 },
  dust: { source: `${TINY_SWORDS_ROOT}/effects/Dust_01.png`, frame: 64, frames: 8 },
  explosion: { source: `${TINY_SWORDS_ROOT}/effects/Explosion_01.png`, frame: 192, frames: 8 },
  heal: { source: `${TINY_SWORDS_ROOT}/units/blue/monk/Heal_Effect.png`, frame: 192, frames: 11 },
} as const;

const SKILL_ICON_INDEX: Readonly<Record<PlayerClass, readonly number[]>> = {
  warrior: [5, 6, 5, 11, 5],
  ranger: [7, 7, 7, 6, 7],
  priest: [7, 7, 6, 7, 3],
};

export function skillIconSource(playerClass: PlayerClass, slot: SkillSlot): string {
  if (playerClass === "ranger" && slot !== 4) return TINY_SWORDS_EFFECTS.arrow;
  const icon = SKILL_ICON_INDEX[playerClass][slot - 1] ?? 11;
  return `${TINY_SWORDS_ROOT}/ui/Icon_${String(icon).padStart(2, "0")}.png`;
}

const FACTION: Readonly<Record<PrimaryColor, string>> = {
  azure: "blue",
  ember: "red",
  moss: "yellow",
  violet: "purple",
};

const UNIT_FOLDER: Readonly<Record<PlayerClass, string>> = {
  warrior: "warrior",
  ranger: "archer",
  priest: "monk",
};

const FILES = {
  warrior: {
    idle: ["Warrior_Idle.png", 8],
    run: ["Warrior_Run.png", 6],
    attack: ["Warrior_Attack1.png", 4],
  },
  ranger: {
    idle: ["Archer_Idle.png", 6],
    run: ["Archer_Run.png", 4],
    attack: ["Archer_Shoot.png", 8],
  },
  priest: {
    idle: ["Idle.png", 6],
    run: ["Run.png", 4],
    attack: ["Heal.png", 11],
  },
} as const;

export type UnitMotion = "idle" | "run" | "attack";

export interface UnitSheet {
  source: string;
  frames: number;
}

export function classForEquipment(equipment: Equipment): PlayerClass {
  if (equipment.mainHand === "hunter_bow") return "ranger";
  if (equipment.mainHand === "heartwood_staff") return "priest";
  return "warrior";
}

export function unitSheet(
  playerClass: PlayerClass,
  appearance: CharacterAppearance,
  motion: UnitMotion,
): UnitSheet {
  const [file, frames] = FILES[playerClass][motion];
  return {
    source: `${TINY_SWORDS_ROOT}/units/${FACTION[appearance.primaryColor]}/${UNIT_FOLDER[playerClass]}/${file}`,
    frames,
  };
}

export function allUnitSheets(): UnitSheet[] {
  const result = new Map<string, UnitSheet>();
  for (const playerClass of ["warrior", "ranger", "priest"] as const) {
    for (const primaryColor of ["azure", "ember", "moss", "violet"] as const) {
      for (const motion of ["idle", "run", "attack"] as const) {
        const sheet = unitSheet(
          playerClass,
          {
            body: "wayfarer",
            primaryColor,
          },
          motion,
        );
        result.set(sheet.source, sheet);
      }
    }
  }
  return [...result.values()];
}
