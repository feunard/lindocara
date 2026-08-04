import type { CharacterAppearance, Equipment, PrimaryColor } from "@lindocara/engine/character.js";
import type { ConsumableId } from "@lindocara/engine/consumables.js";
import { PLAYER_CLASSES, type PlayerClass } from "@lindocara/engine/game.js";
import type { SkillSlot } from "@lindocara/engine/skills.js";
import { tinySwordsSourceUrl } from "./tiny-swords-assets.js";

export const TINY_SWORDS_ROOT = "/assets/lindocara/tiny-swords";
export const TINY_SWORDS_UNIT_FRAME = 192;
export type UnitMotion = "idle" | "run" | "attack";

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
/**
 * Which of the pack's five ground palettes the authored-map tileset draws from.
 *
 * `Tilemap_color1..5` are the SAME 9x6 sheet — same groups, same cliff band, same ramps, pixel for
 * pixel — recoloured. Only the grass hue differs, so this is a free choice: no slot, id or brush
 * anywhere depends on which one is loaded, and every saved map repaints itself the moment it
 * changes. `color3` is the green Pixel Frog's own promo art uses; `color1` (which shipped first) is
 * the palest, yellowest of the five and is what made authored maps read as flat khaki.
 *
 * The other four are shipped alongside it because they are the cheapest biome lever we have —
 * `color5` is a cold teal, `color4` an olive marsh — and swapping the file is the whole change.
 */
export const TINY_SWORDS_GROUND_PALETTES = [
  "color1",
  "color2",
  "color3",
  "color4",
  "color5",
] as const;
export type TinySwordsGroundPalette = (typeof TINY_SWORDS_GROUND_PALETTES)[number];

export const TINY_SWORDS_GROUND_PALETTE: TinySwordsGroundPalette = "color3";

export const TINY_SWORDS_TERRAIN = {
  flat: `${TINY_SWORDS_ROOT}/terrain/Tilemap_Flat.png`,
  water: `${TINY_SWORDS_ROOT}/terrain/Water.png`,
  foam: `${TINY_SWORDS_ROOT}/terrain/Foam.png`,
  tileset: `${TINY_SWORDS_ROOT}/terrain/Tilemap_${TINY_SWORDS_GROUND_PALETTE}.png`,
  shadow: new URL(
    "../../catalog/assets/Tiny Swords (Free Pack)/Terrain/Tileset/Shadow.png",
    import.meta.url,
  ).href,
};

/**
 * Point the ground sheet at another of the five palettes. Comparison tooling only.
 *
 * `Renderer.create` loads the terrain textures once, so this has to run BEFORE a renderer is built
 * and does nothing to one already running — which is exactly the contract the dev preview route
 * wants (`?preview=1&palette=color5` reloads the page). An unknown name is ignored rather than
 * throwing: this is reached from a URL, and a typo must not blank the screen.
 */
export function setGroundPalette(palette: string): boolean {
  if (!(TINY_SWORDS_GROUND_PALETTES as readonly string[]).includes(palette)) return false;
  TINY_SWORDS_TERRAIN.tileset = `${TINY_SWORDS_ROOT}/terrain/Tilemap_${palette}.png`;
  return true;
}

/** `Foam.png` is eight 192x192 frames; the blob itself is ~82px, centred. Drawn centred under a
 *  64px land tile it bleeds ~9px into the water on every side, and the union of the blobs under a
 *  landmass is what draws its shoreline. */
export const TINY_SWORDS_FOAM_FRAME = 192;
export const TINY_SWORDS_FOAM_FRAMES = 8;
/** Native canvas of the official shadow sprite (the guide prose calls it 128px). */
export const TINY_SWORDS_SHADOW_FRAME = 192;

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
    "../../catalog/assets/Tiny Swords (Free Pack)/Buildings/Red Buildings/House1.png",
    import.meta.url,
  ).href,
  new URL(
    "../../catalog/assets/Tiny Swords (Free Pack)/Buildings/Yellow Buildings/Barracks.png",
    import.meta.url,
  ).href,
  new URL(
    "../../catalog/assets/Tiny Swords (Free Pack)/Buildings/Purple Buildings/Monastery.png",
    import.meta.url,
  ).href,
  new URL(
    "../../catalog/assets/Tiny Swords (Free Pack)/Buildings/Red Buildings/House3.png",
    import.meta.url,
  ).href,
  new URL(
    "../../catalog/assets/Tiny Swords (Free Pack)/Buildings/Yellow Buildings/House2.png",
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
  explosionBurst: `${TINY_SWORDS_ROOT}/effects/Explosion_02.png`,
  dust: `${TINY_SWORDS_ROOT}/effects/Dust_01.png`,
  dustStrong: `${TINY_SWORDS_ROOT}/effects/Dust_02.png`,
  splash: `${TINY_SWORDS_ROOT}/effects/Water Splash.png`,
  heal: `${TINY_SWORDS_ROOT}/units/blue/monk/Heal_Effect.png`,
  arrow: `${TINY_SWORDS_ROOT}/units/blue/archer/Arrow.png`,
} as const;

export const TINY_SWORDS_SKILL_ICONS = Array.from(
  { length: 12 },
  (_, index) => `${TINY_SWORDS_ROOT}/ui/Icon_${String(index + 1).padStart(2, "0")}.png`,
);

const CONSUMABLE_ICON_INDEX: Readonly<Record<ConsumableId, number>> = {
  health_potion: 10,
  mana_potion: 3,
  damage_elixir: 5,
  oblivion_draught: 12,
  invisibility_potion: 8,
  resurrection_potion: 4,
};

export function consumableIconSource(item: ConsumableId): string {
  return `${TINY_SWORDS_ROOT}/ui/Icon_${String(CONSUMABLE_ICON_INDEX[item]).padStart(2, "0")}.png`;
}

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

const HEX_SHAMAN_PROJECTILE_ICON = new URL(
  "../../catalog/assets/Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Goblin Raiders/Hex Shaman/Hex Shaman_Projectile.png",
  import.meta.url,
).href;

/** The hooded, twin-dagger Thief requested for the Rogue, resolved directly from the generated
 * Tiny Swords catalogue's vendor source paths. Every strip is six authored 192x192 frames. */
export const TINY_SWORDS_ROGUE_SHEETS = {
  idle: {
    source: new URL(
      "../../catalog/assets/Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Thief/Thief_Idle.png",
      import.meta.url,
    ).href,
    frames: 6,
    frameWidth: 192,
    frameHeight: 192,
    footOffset: 60,
  },
  run: {
    source: new URL(
      "../../catalog/assets/Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Thief/Thief_Run.png",
      import.meta.url,
    ).href,
    frames: 6,
    frameWidth: 192,
    frameHeight: 192,
    footOffset: 59,
  },
  attack: {
    source: new URL(
      "../../catalog/assets/Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Thief/Thief_Attack.png",
      import.meta.url,
    ).href,
    frames: 6,
    frameWidth: 192,
    frameHeight: 192,
    footOffset: 56,
  },
} as const satisfies Readonly<
  Record<
    UnitMotion,
    {
      source: string;
      frames: number;
      frameWidth: number;
      frameHeight: number;
      footOffset: number;
    }
  >
>;

const SKILL_ICON_INDEX: Readonly<Record<PlayerClass, readonly number[]>> = {
  warrior: [5, 6, 5, 11, 5],
  ranger: [7, 7, 7, 6, 7],
  priest: [7, 7, 6, 7, 3],
  rogue: [5, 6, 8, 12, 5],
  peasant: [5, 5, 5, 11, 11],
};

export function skillIconSource(playerClass: PlayerClass, slot: SkillSlot): string {
  return skillIconArt(playerClass, slot).source;
}

export interface SkillIconArt {
  source: string;
  frames: number;
  frame: number;
  variant: string;
}

/** Mirrors the actual combat asset/effect used by each skill instead of generic inventory icons. */
export function skillIconArt(playerClass: PlayerClass, slot: SkillSlot): SkillIconArt {
  if (playerClass === "peasant") {
    const skillId = peasantSkillIdForSlot(slot);
    if (skillId === "homemade_bomb")
      return {
        source: TINY_SWORDS_PEASANT_BOMB_SHEETS.icon.source,
        frames: TINY_SWORDS_PEASANT_BOMB_SHEETS.icon.frames,
        frame: TINY_SWORDS_PEASANT_BOMB_SHEETS.icon.activeFrame,
        variant: "homemade-bomb",
      };
    const tool = peasantToolSheet("azure", skillId);
    return {
      source: tool.source,
      frames: tool.frames,
      frame: peasantSkillActiveFrame(skillId),
      variant: skillId.replaceAll("_", "-"),
    };
  }
  if (playerClass === "rogue") {
    if (slot === 1 || slot === 5)
      return {
        source: TINY_SWORDS_ROGUE_SHEETS.attack.source,
        frames: TINY_SWORDS_ROGUE_SHEETS.attack.frames,
        frame: slot === 1 ? 3 : 2,
        variant: slot === 1 ? "dual-slash" : "shadow-dance",
      };
    if (slot === 4)
      return {
        source: HEX_SHAMAN_PROJECTILE_ICON,
        frames: 3,
        frame: 0,
        variant: "poisoned-shiv",
      };
    return {
      source: TINY_SWORDS_EFFECTS.dustStrong,
      frames: 10,
      frame: slot === 2 ? 2 : 5,
      variant: slot === 2 ? "shadow-step" : "vanish",
    };
  }
  if (playerClass === "ranger") {
    if (slot === 4)
      return { source: TINY_SWORDS_EFFECTS.dustStrong, frames: 10, frame: 2, variant: "dash" };
    const variants = ["quick-shot", "piercing-arrow", "volley", "dash", "heartseeker"];
    return {
      source: TINY_SWORDS_EFFECTS.arrow,
      frames: 1,
      frame: 0,
      variant: variants[slot - 1] ?? "quick-shot",
    };
  }
  if (playerClass === "priest") {
    if (slot === 1)
      return { source: HEX_SHAMAN_PROJECTILE_ICON, frames: 3, frame: 0, variant: "radiant" };
    if (slot === 2)
      return { source: HEX_SHAMAN_PROJECTILE_ICON, frames: 3, frame: 0, variant: "mend" };
    if (slot === 3)
      return { source: TINY_SWORDS_EFFECTS.dustStrong, frames: 10, frame: 2, variant: "blink" };
    if (slot === 4)
      return { source: TINY_SWORDS_EFFECTS.heal, frames: 11, frame: 4, variant: "prayer" };
    return { source: TINY_SWORDS_EFFECTS.heal, frames: 11, frame: 5, variant: "nova" };
  }
  if (slot === 3)
    return { source: TINY_SWORDS_EFFECTS.dustStrong, frames: 10, frame: 2, variant: "charge" };
  if (slot === 4 || slot === 5)
    return {
      source: TINY_SWORDS_EFFECTS.explosionBurst,
      frames: 10,
      frame: slot === 4 ? 2 : 3,
      variant: slot === 4 ? "battle-cry" : "whirlwind",
    };
  const icon = SKILL_ICON_INDEX[playerClass][slot - 1] ?? 11;
  return {
    source: `${TINY_SWORDS_ROOT}/ui/Icon_${String(icon).padStart(2, "0")}.png`,
    frames: 1,
    frame: 0,
    variant: `warrior-${slot}`,
  };
}

const FACTION: Readonly<Record<PrimaryColor, string>> = {
  azure: "blue",
  ember: "red",
  moss: "yellow",
  violet: "purple",
};

const UNIT_FOLDER: Readonly<Record<Exclude<PlayerClass, "rogue" | "peasant">, string>> = {
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

export interface UnitSheet {
  source: string;
  frames: number;
  frameWidth: number;
  frameHeight: number;
  footOffset: number;
}

const PEASANT_FACTION_FOLDER: Readonly<Record<PrimaryColor, string>> = {
  azure: "Blue Units",
  ember: "Red Units",
  moss: "Yellow Units",
  violet: "Purple Units",
};

export const PEASANT_SKILL_IDS = [
  "woodcutters_swing",
  "prospectors_pick",
  "butchers_cut",
  "makeshift_camp",
  "homemade_bomb",
] as const;
export type PeasantSkillId = (typeof PEASANT_SKILL_IDS)[number];
export type PeasantToolSkillId = Exclude<PeasantSkillId, "homemade_bomb">;

const PEASANT_SKILL_BY_SLOT: Readonly<Record<SkillSlot, PeasantSkillId>> = {
  1: "woodcutters_swing",
  2: "prospectors_pick",
  3: "butchers_cut",
  4: "makeshift_camp",
  5: "homemade_bomb",
};

interface PeasantToolSpec {
  readonly file: string;
  readonly frames: number;
  readonly footOffset: number;
  readonly activeFrame: number;
}

/**
 * Explicit presentation contract for every Peasant tool action. Asset names never select the
 * technique: the engine skill id does. Tiny Swords has no Pawn shovel interaction, so the authored
 * hammer strip is deliberately used for construction rather than silently falling back to Axe.
 */
export const PEASANT_TOOL_SPECS = {
  woodcutters_swing: {
    file: "Pawn_Interact Axe.png",
    frames: 6,
    footOffset: 57,
    activeFrame: 3,
  },
  prospectors_pick: {
    file: "Pawn_Interact Pickaxe.png",
    frames: 6,
    footOffset: 57,
    activeFrame: 3,
  },
  butchers_cut: {
    file: "Pawn_Interact Knife.png",
    frames: 4,
    footOffset: 51,
    activeFrame: 2,
  },
  makeshift_camp: {
    file: "Pawn_Interact Hammer.png",
    frames: 3,
    footOffset: 54,
    activeFrame: 1,
  },
} as const satisfies Readonly<Record<PeasantToolSkillId, PeasantToolSpec>>;

const PEASANT_BASE_FILES = {
  idle: ["Pawn_Idle.png", 8, 57],
  run: ["Pawn_Run.png", 6, 57],
} as const satisfies Readonly<
  Record<Exclude<UnitMotion, "attack">, readonly [string, number, number]>
>;

export const PEASANT_CARRY_PRIORITY = ["gold", "meat", "wood"] as const;
export type PeasantCarryKind = (typeof PEASANT_CARRY_PRIORITY)[number];
export type PeasantCarryMotion = Exclude<UnitMotion, "attack">;

const PEASANT_CARRY_FILES = {
  gold: { idle: "Pawn_Idle Gold.png", run: "Pawn_Run Gold.png" },
  meat: { idle: "Pawn_Idle Meat.png", run: "Pawn_Run Meat.png" },
  wood: { idle: "Pawn_Idle Wood.png", run: "Pawn_Run Wood.png" },
} as const satisfies Readonly<Record<PeasantCarryKind, Record<PeasantCarryMotion, string>>>;

export const TINY_SWORDS_PEASANT_BOMB_SHEETS = {
  icon: {
    source: tinySwordsSourceUrl(
      "Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Pirate Fish/Bomb/Bomb_FuseLit.png",
    ),
    frames: 4,
    frameWidth: 128,
    frameHeight: 128,
    activeFrame: 0,
  },
  projectile: {
    source: tinySwordsSourceUrl(
      "Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Pirate Fish/Bomb/Bomb_Spinning.png",
    ),
    frames: 4,
    frameWidth: 128,
    frameHeight: 128,
    activeFrame: 0,
  },
  impact: {
    source: TINY_SWORDS_EFFECTS.explosion,
    frames: 8,
    frameWidth: 192,
    frameHeight: 192,
    activeFrame: 2,
  },
} as const;

function peasantSource(color: PrimaryColor, file: string): string {
  return tinySwordsSourceUrl(
    `Tiny Swords (Free Pack)/Units/${PEASANT_FACTION_FOLDER[color]}/Pawn/${file}`,
  );
}

function peasantSheet(
  color: PrimaryColor,
  file: string,
  frames: number,
  footOffset: number,
): UnitSheet {
  return {
    source: peasantSource(color, file),
    frames,
    frameWidth: TINY_SWORDS_UNIT_FRAME,
    frameHeight: TINY_SWORDS_UNIT_FRAME,
    footOffset,
  };
}

export function isPeasantSkillId(value: string): value is PeasantSkillId {
  return (PEASANT_SKILL_IDS as readonly string[]).includes(value);
}

export function peasantSkillIdForSlot(slot: SkillSlot): PeasantSkillId {
  return PEASANT_SKILL_BY_SLOT[slot];
}

export function peasantSkillActiveFrame(skillId: PeasantSkillId): number {
  return skillId === "homemade_bomb" ? 0 : PEASANT_TOOL_SPECS[skillId].activeFrame;
}

export function peasantToolSheet(color: PrimaryColor, skillId: PeasantToolSkillId): UnitSheet {
  const spec = PEASANT_TOOL_SPECS[skillId];
  return peasantSheet(color, spec.file, spec.frames, spec.footOffset);
}

export function peasantCasterSheet(color: PrimaryColor, skillId: PeasantSkillId): UnitSheet {
  if (skillId === "homemade_bomb") return peasantUnitSheet(color, "idle");
  return peasantToolSheet(color, skillId);
}

/** Selects at most one carried-resource strip without making asset availability a gameplay rule. */
export function prioritizedPeasantCarry(
  carried: readonly PeasantCarryKind[],
): PeasantCarryKind | undefined {
  return PEASANT_CARRY_PRIORITY.find((kind) => carried.includes(kind));
}

export function peasantCarrySheet(
  color: PrimaryColor,
  kind: PeasantCarryKind,
  motion: PeasantCarryMotion,
): UnitSheet {
  return peasantSheet(color, PEASANT_CARRY_FILES[kind][motion], motion === "idle" ? 8 : 6, 57);
}

function peasantUnitSheet(color: PrimaryColor, motion: UnitMotion): UnitSheet {
  if (motion === "attack") return peasantToolSheet(color, "woodcutters_swing");
  const [file, frames, footOffset] = PEASANT_BASE_FILES[motion];
  return peasantSheet(color, file, frames, footOffset);
}

export function classForEquipment(equipment: Equipment): PlayerClass {
  if (equipment.mainHand === "hunter_bow") return "ranger";
  if (equipment.mainHand === "heartwood_staff") return "priest";
  if (equipment.mainHand === "shadow_daggers") return "rogue";
  if (equipment.mainHand === "worn_toolkit") return "peasant";
  return "warrior";
}

export function unitSheet(
  playerClass: PlayerClass,
  appearance: CharacterAppearance,
  motion: UnitMotion,
): UnitSheet {
  if (playerClass === "rogue") return TINY_SWORDS_ROGUE_SHEETS[motion];
  if (playerClass === "peasant") return peasantUnitSheet(appearance.primaryColor, motion);
  const [file, frames] = FILES[playerClass][motion];
  return {
    source: `${TINY_SWORDS_ROOT}/units/${FACTION[appearance.primaryColor]}/${UNIT_FOLDER[playerClass]}/${file}`,
    frames,
    frameWidth: TINY_SWORDS_UNIT_FRAME,
    frameHeight: TINY_SWORDS_UNIT_FRAME,
    footOffset: 56,
  };
}

export function allUnitSheets(): UnitSheet[] {
  const result = new Map<string, UnitSheet>();
  for (const playerClass of PLAYER_CLASSES) {
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
  for (const primaryColor of ["azure", "ember", "moss", "violet"] as const) {
    for (const skillId of Object.keys(PEASANT_TOOL_SPECS) as PeasantToolSkillId[]) {
      const tool = peasantToolSheet(primaryColor, skillId);
      result.set(tool.source, tool);
    }
    for (const kind of PEASANT_CARRY_PRIORITY) {
      for (const motion of ["idle", "run"] as const) {
        const carry = peasantCarrySheet(primaryColor, kind, motion);
        result.set(carry.source, carry);
      }
    }
  }
  return [...result.values()];
}
