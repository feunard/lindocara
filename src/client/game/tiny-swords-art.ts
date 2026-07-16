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
 * The pack's own props, at the pack's own sizes.
 *
 * **Every frame size here is deliberate and must not be "fitted" to a box.** Tiny Swords is drawn
 * as one coherent set against a 64px grid: a unit frame is 192, a big tree 256, a bush 128, a
 * pebble 64. Those numbers *are* the scale system — draw each at its native size and a knight
 * stands correctly against a tree without anyone choosing a number. Scale them to fit arbitrary
 * boxes and you have thrown away the only thing making the art agree with itself, and no amount of
 * per-prop tuning gets it back.
 *
 * Measured, not guessed — `assets/index.json` records the sheet dimensions and frame runs.
 */
export interface DecorSheet {
  readonly source: string;
  /** Width and height of one frame. Sheets are single-row horizontal strips. */
  readonly frame: number;
  readonly frames: number;
  /** Empty pixels between the object's base and the bottom of its frame. A sheet drawn with its
   *  frame flush to the ground floats by exactly this much; subtract it to stand the object on the
   *  cell instead of the frame. Measured from the sheet, not guessed. */
  readonly foot: number;
}

const TERRAIN_ROOT = `${TINY_SWORDS_ROOT}/terrain`;
const DECO_ROOT = `${TINY_SWORDS_ROOT}/deco`;

/**
 * The forest's trees — `Tree3` and `Tree4` only, and that is a measurement, not a preference.
 *
 * A forest cell is one tree standing on two grid squares: a solid trunk, and the canopy above it
 * you walk under. Only these two are drawn to fit that. Measured from their own sheets:
 *
 * | sheet | content    | tiles     |
 * | ----- | ---------- | --------- |
 * | Tree3 | 90x146     | 1.4 x 2.3 |
 * | Tree4 | 80x122     | 1.2 x 1.9 |
 * | Tree1 | 219x190    | 3.4 x 3.0 |
 * | Tree2 | 213x244    | 3.3 x 3.8 |
 *
 * Tree1/Tree2 are three-and-a-half tiles wide. Put one on a 64px cell and it covers its
 * neighbours whole — which is exactly what the forest looked like before this. They are feature
 * trees for a landmark, not forest fill, and they are left out here until something places them
 * deliberately.
 */
export const TINY_SWORDS_TREES: readonly DecorSheet[] = [
  { source: `${TERRAIN_ROOT}/Tree3.png`, frame: 192, frames: 8, foot: 22 },
  { source: `${TERRAIN_ROOT}/Tree4.png`, frame: 192, frames: 8, foot: 24 },
] as const;

export const TINY_SWORDS_BUSHES: readonly DecorSheet[] = [
  { source: `${TERRAIN_ROOT}/Bushe1.png`, frame: 128, frames: 8, foot: 49 },
  { source: `${TERRAIN_ROOT}/Bushe2.png`, frame: 128, frames: 8, foot: 52 },
  { source: `${TERRAIN_ROOT}/Bushe3.png`, frame: 128, frames: 8, foot: 44 },
  { source: `${TERRAIN_ROOT}/Bushe4.png`, frame: 128, frames: 8, foot: 49 },
] as const;

/** Still sprites — no strip, no frames. */
export const TINY_SWORDS_ROCKS: readonly string[] = [
  `${TERRAIN_ROOT}/Rock1.png`,
  `${TERRAIN_ROOT}/Rock2.png`,
  `${TERRAIN_ROOT}/Rock3.png`,
  `${TERRAIN_ROOT}/Rock4.png`,
] as const;

/** 192x256, with the stump itself sitting at the BOTTOM of the frame — it shares the felled tree's
 *  framing so the two line up. Anchor it like a tree, not like a 192x256 box of stump. */
export const TINY_SWORDS_STUMPS: readonly string[] = [
  `${TERRAIN_ROOT}/Stump 1.png`,
  `${TERRAIN_ROOT}/Stump 2.png`,
  `${TERRAIN_ROOT}/Stump 3.png`,
  `${TERRAIN_ROOT}/Stump 4.png`,
] as const;

/** `Deco/01..18`, all 64px unless noted. Named by what they actually are — the pack numbers them. */
export const TINY_SWORDS_DECO = {
  mushrooms: [`${DECO_ROOT}/01.png`, `${DECO_ROOT}/02.png`, `${DECO_ROOT}/03.png`],
  pebbles: [`${DECO_ROOT}/04.png`, `${DECO_ROOT}/05.png`, `${DECO_ROOT}/06.png`],
  shrubs: [
    `${DECO_ROOT}/07.png`,
    `${DECO_ROOT}/08.png`,
    `${DECO_ROOT}/09.png`,
    `${DECO_ROOT}/10.png`,
    `${DECO_ROOT}/11.png`,
  ],
  pumpkins: [`${DECO_ROOT}/12.png`, `${DECO_ROOT}/13.png`],
  bones: [`${DECO_ROOT}/14.png`, `${DECO_ROOT}/15.png`],
} as const;

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

/**
 * The pack's own roadside signpost (`Deco/17`), 64x128.
 *
 * This was `UI Elements/Banners/Banner.png` — which is 448x448 and belongs in a menu, not staked in
 * a field. It only ever looked right because it was scaled to 126x72 on the way in; once every prop
 * draws at native size, a UI asset in the world is a blank parchment slab four tiles wide. The deco
 * signpost is the thing Pixel Frog drew for this job, and it is already at world scale.
 */
export const TINY_SWORDS_SIGN_BOARD = `${TINY_SWORDS_ROOT}/deco/17.png`;

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
