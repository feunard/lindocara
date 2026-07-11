import type { CharacterAppearance, Equipment, PrimaryColor } from "../../shared/character.js";
import type { PlayerClass } from "../../shared/game.js";
import type { SkillSlot } from "../../shared/skills.js";

export const TINY_SWORDS_ROOT = "/assets/lindocara/tiny-swords";
export const TINY_SWORDS_UNIT_FRAME = 192;

export const TINY_SWORDS_BUILDINGS = [
  "House1.png",
  "House2.png",
  "House3.png",
  "Barracks.png",
  "Monastery.png",
  "Tower.png",
  "Castle.png",
].map((file) => `${TINY_SWORDS_ROOT}/buildings/${file}`);

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
