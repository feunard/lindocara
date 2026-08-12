import type { PrimaryColor } from "@lindocara/engine/character.js";
import { actionForClassSlot } from "@lindocara/engine/combat-actions.js";
import {
  type MonsterSpecialTechnique,
  type MonsterSpecies,
  PLAYER_CLASSES,
  type PlayerClass,
} from "@lindocara/engine/game.js";
import type { GroundVector } from "@lindocara/engine/ground.js";
import type { MonsterSpecialImpact, ProjectileKind } from "@lindocara/engine/protocol.js";
import { CLASS_SKILLS } from "@lindocara/engine/skills.js";
import { type EnemySheet, TINY_SWORDS_ENEMIES } from "./enemy-art.js";
import type { ServerCombatTimeline } from "./server-clock.js";
import {
  isPeasantSkillId,
  PEASANT_ABILITY_SHEETS,
  peasantCasterSheet,
  peasantSkillActiveFrame,
  TINY_SWORDS_PEASANT_BOMB_SHEETS,
  TINY_SWORDS_ROGUE_SHEETS,
  TINY_SWORDS_ROOT,
} from "./tiny-swords-art.js";

const HEX_SHAMAN_PROJECTILE_SOURCE = new URL(
  "../../catalog/assets/Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Goblin Raiders/Hex Shaman/Hex Shaman_Projectile.png",
  import.meta.url,
).href;
const HEX_SHAMAN_IMPACT_SOURCE = new URL(
  "../../catalog/assets/Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Goblin Raiders/Hex Shaman/Hex Shaman_Explosion.png",
  import.meta.url,
).href;
const HARPOON_PROJECTILE_SOURCE = new URL(
  "../../catalog/assets/Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Pirate Fish/Harpoon Shark/Harpoon.png",
  import.meta.url,
).href;
const BOMB_PROJECTILE_SOURCE = new URL(
  "../../catalog/assets/Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Pirate Fish/Bomb/Bomb_Idle.png",
  import.meta.url,
).href;
const EARTH_IMPACT_SOURCE = new URL(
  "../../catalog/assets/Tiny Swords (Update 010)/Effects/Explosion/Explosions.png",
  import.meta.url,
).href;

const FACTION: Readonly<Record<PrimaryColor, string>> = {
  azure: "blue",
  ember: "red",
  moss: "yellow",
  violet: "purple",
};

export interface CombatSheetArt {
  source: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  durationMs: number;
  activeFrame: number;
  anchor: { x: number; y: number };
  tint?: number;
  scale?: number;
}

export interface CombatProjectileArt extends CombatSheetArt {
  rotationOffset: number;
  trail?: { color: number; length: number; width: number; glowRadius: number };
}

export interface CombatArtDefinition {
  caster: CombatSheetArt;
  projectile?: CombatProjectileArt;
  impact?: CombatSheetArt;
  zone?: CombatSheetArt;
  /** Optional second authored sheet layered over the primary zone sheet. */
  accent?: CombatSheetArt;
  /** Records every deliberate approximation where the pack has no exact named animation. */
  fallback?: string;
}

export interface MonsterCombatArtDefinition {
  caster: EnemySheet;
  /** Zero-based contact/release frame measured from the species' attack strip. */
  activeFrame: number;
  impact: CombatSheetArt;
}

export type MonsterImpactSound = "weapon" | "magic" | "fire" | "heavy";

export interface MonsterSpecialImpactArtDefinition {
  /** Authored Tiny Swords sheet played once at the resolved impact. */
  effect: CombatSheetArt;
  /** Optional second authored sheet layered over the primary impact. */
  accent?: CombatSheetArt;
  /** Presentation footprint only; authoritative collision stays in `MONSTER_SPECIAL_ACTIONS`. */
  visualRadius: number;
  /** Moves cone/charge effects forward along the frozen authoritative direction. */
  forwardOffset: number;
  sound: MonsterImpactSound;
  shake: {
    intensity: number;
    durationMs: number;
    maxDistance: number;
  };
}

/** Select a visual frame while pinning the declared contact frame to the server impact instant. */
export function combatActionFrameIndex(
  frameCount: number,
  activeFrame: number,
  timeline: ServerCombatTimeline,
  now: number,
): number {
  const lastFrame = Math.max(0, Math.trunc(frameCount) - 1);
  const contact = Math.max(0, Math.min(lastFrame, Math.trunc(activeFrame)));
  if (lastFrame === 0) return 0;
  if (now < timeline.impactAt) {
    const duration = Math.max(1, timeline.impactAt - timeline.startedAt);
    const progress = Math.max(0, Math.min(0.999_999, (now - timeline.startedAt) / duration));
    return Math.min(contact, Math.floor(progress * Math.max(1, contact)));
  }
  const duration = Math.max(1, timeline.recoveryEndsAt - timeline.impactAt);
  const progress = Math.max(0, Math.min(0.999_999, (now - timeline.impactAt) / duration));
  return Math.min(lastFrame, contact + Math.floor(progress * (lastFrame - contact + 1)));
}

/** Replays one complete authored attack strip between each ordered authoritative contact. */
export function multiImpactActionFrameIndex(
  frameCount: number,
  activeFrame: number,
  timeline: ServerCombatTimeline,
  impactTimes: readonly number[],
  now: number,
): number {
  if (impactTimes.length < 2) return combatActionFrameIndex(frameCount, activeFrame, timeline, now);
  const lastFrame = Math.max(0, Math.trunc(frameCount) - 1);
  const contact = Math.max(0, Math.min(lastFrame, Math.trunc(activeFrame)));
  const firstImpactAt = impactTimes[0];
  if (firstImpactAt === undefined || lastFrame === 0 || now < firstImpactAt)
    return combatActionFrameIndex(frameCount, activeFrame, timeline, now);

  for (let index = impactTimes.length - 1; index >= 0; index -= 1) {
    const impactAt = impactTimes[index];
    if (impactAt === undefined || now < impactAt) continue;
    const nextImpactAt = impactTimes[index + 1];
    if (nextImpactAt === undefined) {
      return combatActionFrameIndex(
        frameCount,
        activeFrame,
        {
          startedAt: impactAt,
          impactAt,
          recoveryEndsAt: timeline.recoveryEndsAt,
        },
        now,
      );
    }
    const progress = Math.max(0, Math.min(0.999_999, (now - impactAt) / (nextImpactAt - impactAt)));
    return (contact + Math.floor(progress * frameCount)) % frameCount;
  }
  return 0;
}

function unitSource(
  color: PrimaryColor,
  folder: "warrior" | "archer" | "monk",
  file: string,
): string {
  return `${TINY_SWORDS_ROOT}/units/${FACTION[color]}/${folder}/${file}`;
}

function sheet(
  source: string,
  frameWidth: number,
  frameHeight: number,
  frames: number,
  durationMs: number,
  activeFrame: number,
): CombatSheetArt {
  return {
    source,
    frameWidth,
    frameHeight,
    frames,
    durationMs,
    activeFrame,
    anchor: { x: 0.5, y: 0.5 },
  };
}

function unitSheet(
  source: string,
  frames: number,
  durationMs: number,
  activeFrame: number,
): CombatSheetArt {
  return sheet(source, 192, 192, frames, durationMs, activeFrame);
}

const DUST = sheet(`${TINY_SWORDS_ROOT}/effects/Dust_02.png`, 64, 64, 10, 600, 1);
const EXPLOSION = sheet(`${TINY_SWORDS_ROOT}/effects/Explosion_01.png`, 192, 192, 8, 620, 2);
const EXPLOSION_BURST = sheet(`${TINY_SWORDS_ROOT}/effects/Explosion_02.png`, 192, 192, 10, 760, 2);
const EARTH_IMPACT = sheet(EARTH_IMPACT_SOURCE, 192, 192, 9, 800, 2);
const MAGIC_PROJECTILE = {
  ...sheet(HEX_SHAMAN_PROJECTILE_SOURCE, 128, 128, 3, 520, 1),
  rotationOffset: 0,
};
const MAGIC_IMPACT = sheet(HEX_SHAMAN_IMPACT_SOURCE, 128, 128, 9, 620, 2);

const GREEN_MAGIC = 0x62e68f;

function peasantAbilityEffect(
  skillId: keyof typeof PEASANT_ABILITY_SHEETS,
  durationMs: number,
  scale: number,
): CombatSheetArt {
  const art = PEASANT_ABILITY_SHEETS[skillId];
  return {
    ...sheet(art.source, art.frameWidth, art.frameHeight, art.frames, durationMs, art.activeFrame),
    scale,
  };
}

/** The original makeshift-camp illustration survived the PixiJS retirement in the renderer
 * package. Keep it in the combat preload set: the camp is a persistent consequence of a hero
 * skill, not generic map scenery, and must be ready on the first authoritative camp frame. */
export const PEASANT_CAMP_ART: CombatSheetArt = {
  source: new URL("./assets/peasant/makeshift-camp.png", import.meta.url).href,
  frameWidth: 1_254,
  frameHeight: 1_254,
  frames: 1,
  durationMs: 1_000,
  activeFrame: 0,
  anchor: { x: 0.5, y: 0.09 },
  // 1 254 px at the ordinary effect ratio would fill the screen. This preserves the old camp's
  // landmark footprint while speaking the HD-2D scene's tile scale.
  scale: 0.205,
};

function styled(art: CombatSheetArt, tint: number, scale = 1): CombatSheetArt {
  return { ...art, tint, scale };
}

const PEASANT_BOMB_PROJECTILE: CombatProjectileArt = {
  ...sheet(
    TINY_SWORDS_PEASANT_BOMB_SHEETS.projectile.source,
    TINY_SWORDS_PEASANT_BOMB_SHEETS.projectile.frameWidth,
    TINY_SWORDS_PEASANT_BOMB_SHEETS.projectile.frameHeight,
    TINY_SWORDS_PEASANT_BOMB_SHEETS.projectile.frames,
    650,
    TINY_SWORDS_PEASANT_BOMB_SHEETS.projectile.activeFrame,
  ),
  rotationOffset: 0,
  scale: 0.58,
  trail: { color: 0xff8d4a, length: 18, width: 3, glowRadius: 6 },
};
const PEASANT_BOMB_IMPACT = peasantAbilityEffect("homemade_bomb", 720, 1.28);

/** Visual-only impact vocabulary. Every special technique is named explicitly: no asset name,
 * path or species heuristic selects gameplay or presentation. */
export const MONSTER_SPECIAL_IMPACT_ART = {
  ground_slam: {
    effect: styled(EARTH_IMPACT, 0xd7a25d, 1.35),
    accent: styled(DUST, 0xc89a61, 2.1),
    visualRadius: 112,
    forwardOffset: 0,
    sound: "heavy",
    shake: { intensity: 7, durationMs: 280, maxDistance: 390 },
  },
  shadow_cone: {
    effect: styled(MAGIC_IMPACT, 0x7f55bf, 1.35),
    visualRadius: 112,
    forwardOffset: 58,
    sound: "magic",
    shake: { intensity: 2.5, durationMs: 190, maxDistance: 300 },
  },
  soul_drain: {
    effect: styled(MAGIC_IMPACT, 0x6f4a9f, 1.5),
    visualRadius: 128,
    forwardOffset: 0,
    sound: "magic",
    shake: { intensity: 2, durationMs: 180, maxDistance: 280 },
  },
  spear_fan: {
    effect: styled(DUST, 0xd8c18a, 1.8),
    visualRadius: 100,
    forwardOffset: 58,
    sound: "weapon",
    shake: { intensity: 2.5, durationMs: 170, maxDistance: 280 },
  },
  fire_burst: {
    effect: styled(EXPLOSION_BURST, 0xff8f45, 1.45),
    accent: styled(EXPLOSION, 0xffc05b, 1.05),
    visualRadius: 120,
    forwardOffset: 0,
    sound: "fire",
    shake: { intensity: 5, durationMs: 240, maxDistance: 350 },
  },
  marauder_frenzy: {
    effect: styled(DUST, 0xd7a463, 2),
    accent: styled(EXPLOSION, 0xc97743, 0.9),
    visualRadius: 112,
    forwardOffset: 52,
    sound: "weapon",
    shake: { intensity: 3.5, durationMs: 210, maxDistance: 320 },
  },
  bone_cleave: {
    effect: styled(DUST, 0xd7ded1, 1.9),
    visualRadius: 112,
    forwardOffset: 62,
    sound: "weapon",
    shake: { intensity: 3, durationMs: 190, maxDistance: 310 },
  },
  grave_siphon: {
    effect: styled(MAGIC_IMPACT, 0x7fbc91, 1.55),
    visualRadius: 140,
    forwardOffset: 0,
    sound: "magic",
    shake: { intensity: 2.5, durationMs: 210, maxDistance: 320 },
  },
  horn_charge: {
    effect: styled(EARTH_IMPACT, 0xb98a54, 1.3),
    accent: styled(DUST, 0xd2a66d, 2.25),
    visualRadius: 120,
    forwardOffset: 82,
    sound: "heavy",
    shake: { intensity: 5.5, durationMs: 260, maxDistance: 380 },
  },
  labyrinth_stomp: {
    effect: styled(EARTH_IMPACT, 0xc5985c, 1.75),
    accent: styled(DUST, 0xcaa56e, 2.6),
    visualRadius: 155,
    forwardOffset: 0,
    sound: "heavy",
    shake: { intensity: 8.5, durationMs: 340, maxDistance: 460 },
  },
  troll_quake: {
    effect: styled(EARTH_IMPACT, 0xb9854d, 2.05),
    accent: styled(DUST, 0xd0a467, 3),
    visualRadius: 180,
    forwardOffset: 0,
    sound: "heavy",
    shake: { intensity: 10, durationMs: 400, maxDistance: 520 },
  },
  troll_sweep: {
    effect: styled(EARTH_IMPACT, 0xb98e58, 1.45),
    accent: styled(DUST, 0xcaa36d, 2.45),
    visualRadius: 135,
    forwardOffset: 72,
    sound: "heavy",
    shake: { intensity: 6, durationMs: 290, maxDistance: 410 },
  },
  hex_burst: {
    effect: styled(MAGIC_IMPACT, 0xc65cff, 1.85),
    accent: styled(EXPLOSION, 0x9b45df, 0.9),
    visualRadius: 170,
    forwardOffset: 0,
    sound: "magic",
    shake: { intensity: 4, durationMs: 230, maxDistance: 360 },
  },
  tusk_charge: {
    effect: styled(DUST, 0xc99a62, 2.1),
    visualRadius: 110,
    forwardOffset: 68,
    sound: "heavy",
    shake: { intensity: 4.5, durationMs: 240, maxDistance: 350 },
  },
  mounted_trample: {
    effect: styled(EARTH_IMPACT, 0xc39458, 1.35),
    accent: styled(DUST, 0xd3a96c, 2.35),
    visualRadius: 125,
    forwardOffset: 76,
    sound: "heavy",
    shake: { intensity: 5, durationMs: 270, maxDistance: 380 },
  },
} as const satisfies Readonly<
  Record<Exclude<MonsterSpecialTechnique, "none">, MonsterSpecialImpactArtDefinition>
>;

export function monsterSpecialImpactArt(
  technique: Exclude<MonsterSpecialTechnique, "none">,
): MonsterSpecialImpactArtDefinition {
  return MONSTER_SPECIAL_IMPACT_ART[technique];
}

export function monsterSpecialImpactPosition(
  impact: Pick<MonsterSpecialImpact, "x" | "z" | "direction" | "technique">,
): GroundVector {
  const profile = monsterSpecialImpactArt(impact.technique);
  return {
    x: impact.x + impact.direction.x * profile.forwardOffset,
    z: impact.z + impact.direction.z * profile.forwardOffset,
  };
}

/** Neutral authored-teleporter VFX, shared by every class and distinct from combat outcomes. */
export function teleportEffectArt(): CombatSheetArt {
  return styled(DUST, 0xb48cff, 1.5);
}

function actionDuration(playerClass: PlayerClass, skillId: string): number {
  const slot = CLASS_SKILLS[playerClass].find((skill) => skill.id === skillId)?.slot ?? 1;
  const action = actionForClassSlot(playerClass, slot);
  return action.anticipationMs + action.recoveryMs;
}

function casterArt(playerClass: PlayerClass, skillId: string, color: PrimaryColor): CombatSheetArt {
  const duration = actionDuration(playerClass, skillId);
  if (playerClass === "warrior") {
    if (skillId === "iron_guard")
      return unitSheet(unitSource(color, "warrior", "Warrior_Guard.png"), 6, duration, 1);
    const file = skillId === "cleave" ? "Warrior_Attack1.png" : "Warrior_Attack2.png";
    return unitSheet(unitSource(color, "warrior", file), 4, duration, 1);
  }
  if (playerClass === "ranger")
    return unitSheet(unitSource(color, "archer", "Archer_Shoot.png"), 8, duration, 3);
  if (playerClass === "rogue")
    return sheet(
      TINY_SWORDS_ROGUE_SHEETS.attack.source,
      TINY_SWORDS_ROGUE_SHEETS.attack.frameWidth,
      TINY_SWORDS_ROGUE_SHEETS.attack.frameHeight,
      TINY_SWORDS_ROGUE_SHEETS.attack.frames,
      duration,
      3,
    );
  if (playerClass === "peasant") {
    if (!isPeasantSkillId(skillId)) throw new Error(`Unknown Peasant skill art: ${skillId}`);
    const peasant = peasantCasterSheet(color, skillId);
    return sheet(
      peasant.source,
      peasant.frameWidth,
      peasant.frameHeight,
      peasant.frames,
      duration,
      peasantSkillActiveFrame(skillId),
    );
  }
  return unitSheet(unitSource(color, "monk", "Heal.png"), 11, duration, 3);
}

function arrow(color: PrimaryColor, kind: ProjectileKind): CombatProjectileArt {
  const base: CombatProjectileArt = {
    ...sheet(unitSource(color, "archer", "Arrow.png"), 64, 64, 1, 1_000, 0),
    rotationOffset: 0,
  };
  if (kind === "piercing_arrow")
    return {
      ...base,
      tint: 0x71dcff,
      scale: 1.16,
      trail: { color: 0x5dd9ff, length: 34, width: 3, glowRadius: 8 },
    };
  if (kind === "volley_arrow")
    return {
      ...base,
      tint: 0xffdc72,
      scale: 0.82,
      trail: { color: 0xffcf58, length: 18, width: 2, glowRadius: 4 },
    };
  if (kind === "heartseeker")
    return {
      ...base,
      durationMs: 1_050,
      tint: 0xff557d,
      scale: 1.78,
      trail: { color: 0xff416c, length: 72, width: 7, glowRadius: 16 },
    };
  return base;
}

function magicProjectile(kind: "radiant_bolt" | "healing_light" | "hex_orb") {
  if (kind === "hex_orb") {
    return {
      ...MAGIC_PROJECTILE,
      tint: 0xc65cff,
      scale: 0.72,
      trail: { color: 0x9b45df, length: 34, width: 5, glowRadius: 12 },
    };
  }
  if (kind === "healing_light") {
    return {
      ...MAGIC_PROJECTILE,
      rotationOffset: 0,
      tint: GREEN_MAGIC,
      scale: 0.82,
      trail: { color: GREEN_MAGIC, length: 30, width: 4, glowRadius: 10 },
    };
  }
  return MAGIC_PROJECTILE;
}

export function projectileArt(kind: ProjectileKind, color: PrimaryColor): CombatProjectileArt {
  if (
    kind === "arrow" ||
    kind === "piercing_arrow" ||
    kind === "volley_arrow" ||
    kind === "heartseeker"
  )
    return arrow(color, kind);
  if (kind === "enemy_harpoon")
    return {
      ...sheet(HARPOON_PROJECTILE_SOURCE, 64, 64, 1, 1_000, 0),
      rotationOffset: 0,
      scale: 1.05,
    };
  if (kind === "enemy_bomb")
    return {
      ...sheet(BOMB_PROJECTILE_SOURCE, 192, 192, 8, 650, 3),
      rotationOffset: 0,
      scale: 0.46,
      trail: { color: 0xff8d4a, length: 18, width: 3, glowRadius: 6 },
    };
  if (kind === "homemade_bomb") return PEASANT_BOMB_PROJECTILE;
  return magicProjectile(kind);
}

export function combatArt(
  playerClass: PlayerClass,
  skillId: string,
  color: PrimaryColor,
): CombatArtDefinition {
  const caster = casterArt(playerClass, skillId, color);
  if (playerClass === "warrior") {
    if (skillId === "iron_guard") return { caster };
    if (skillId === "shield_bash") return { caster, impact: styled(DUST, 0xffd66b, 1.3) };
    if (skillId === "battle_cry")
      return {
        caster,
        zone: styled(EXPLOSION_BURST, 0xff9f3f, 1.55),
        accent: styled(DUST, 0xffd477, 2.05),
      };
    if (skillId === "whirlwind")
      return {
        caster,
        zone: styled(EXPLOSION_BURST, 0xffdf72, 1.78),
        accent: styled(EXPLOSION, 0xfff2bd, 1.42),
      };
    return { caster, impact: EXPLOSION };
  }
  if (playerClass === "ranger") {
    if (skillId === "dash") return { caster, impact: styled(DUST, 0x6ad9ff, 1.25) };
    const kind =
      skillId === "piercing_arrow"
        ? "piercing_arrow"
        : skillId === "volley"
          ? "volley_arrow"
          : skillId === "heartseeker"
            ? "heartseeker"
            : "arrow";
    const impact =
      kind === "piercing_arrow"
        ? styled(EXPLOSION, 0x71dcff, 0.72)
        : kind === "volley_arrow"
          ? styled(EXPLOSION, 0xffdc72, 0.86)
          : kind === "heartseeker"
            ? styled(MAGIC_IMPACT, 0xff557d, 1.18)
            : EXPLOSION;
    return {
      caster,
      projectile: projectileArt(kind, color),
      impact: kind === "heartseeker" ? styled(MAGIC_IMPACT, 0xff416c, 1.65) : impact,
      ...(kind === "heartseeker" ? { zone: styled(MAGIC_IMPACT, 0xff557d, 1.18) } : {}),
    };
  }
  if (playerClass === "rogue") {
    const fallback =
      "Tiny Swords ne fournit pas de geste dédié à cette technique : Thief_Attack porte les deux dagues, complété par les effets existants du pack.";
    if (skillId === "dual_slash")
      return {
        caster,
        impact: styled(DUST, 0xa875ff, 0.82),
        fallback,
      };
    if (skillId === "shadow_step")
      return {
        caster,
        impact: styled(DUST, 0x8050c8, 1.28),
        fallback,
      };
    if (skillId === "vanish")
      return {
        caster,
        zone: styled(DUST, 0x6e45a8, 1.52),
        accent: styled(MAGIC_IMPACT, 0x9d72dd, 0.72),
        fallback,
      };
    if (skillId === "poisoned_shiv")
      return {
        caster,
        impact: styled(MAGIC_IMPACT, GREEN_MAGIC, 0.76),
        fallback,
      };
    return {
      caster,
      zone: styled(MAGIC_IMPACT, 0x8f55d9, 1.18),
      accent: styled(DUST, 0xc58cff, 1.58),
      fallback,
    };
  }
  if (playerClass === "peasant") {
    if (skillId === "woodcutters_swing")
      return {
        caster,
        impact: peasantAbilityEffect("woodcutters_swing", 520, 0.92),
      };
    if (skillId === "prospectors_pick")
      return {
        caster,
        zone: peasantAbilityEffect("prospectors_pick", 820, 1.28),
      };
    if (skillId === "butchers_cut")
      return {
        caster,
        zone: peasantAbilityEffect("butchers_cut", 780, 1.18),
      };
    if (skillId === "makeshift_camp")
      return {
        caster,
        zone: peasantAbilityEffect("makeshift_camp", 940, 1.34),
      };
    if (skillId === "homemade_bomb")
      return {
        caster,
        projectile: PEASANT_BOMB_PROJECTILE,
        impact: PEASANT_BOMB_IMPACT,
      };
    throw new Error(`Unknown Peasant skill art: ${skillId}`);
  }
  if (skillId === "radiant_bolt")
    return {
      caster,
      projectile: projectileArt("radiant_bolt", color),
      impact: MAGIC_IMPACT,
    };
  if (skillId === "mend")
    return {
      caster,
      projectile: projectileArt("healing_light", color),
      impact: styled(MAGIC_IMPACT, GREEN_MAGIC, 0.86),
      fallback: "Le projectile magique est teinté en vert pour former la lumière de soin.",
    };
  // Exact pre-HD-2D Lumen cloud: the rounded ten-frame Dust_02 strip, violet-tinted. The terrain
  // cloud briefly used by the first port was sky decoration and never belonged to this skill.
  if (skillId === "blink") return { caster, impact: styled(DUST, 0xb48cff, 1.35) };
  return {
    caster,
    zone: {
      ...unitSheet(unitSource(color, "monk", "Heal_Effect.png"), 11, 760, 4),
      ...(skillId === "divine_nova" ? { tint: 0xc88cff, scale: 1.72 } : {}),
    },
    ...(skillId === "divine_nova"
      ? {
          impact: styled(EXPLOSION, 0xe1b0ff, 1.65),
          accent: styled(EXPLOSION_BURST, 0xb875ff, 1.88),
        }
      : {}),
  };
}

const MONSTER_ACTIVE_FRAME: Readonly<Record<MonsterSpecies, number>> = {
  spear_goblin: 3,
  torch_goblin: 3,
  gnoll_marauder: 5,
  skull_guard: 3,
  skull_crusader: 3,
  skull_warden: 3,
  minotaur_brute: 7,
  mire_troll: 2,
  gate_troll: 2,
  // The frame the strike lands on, inside each attack sheet: the shaman releases late in its 10, the
  // pig connects mid-charge in its 4 (its run sheet doubles as the charge), the rider mid-thrust in 7.
  hex_shaman: 6,
  war_pig: 2,
  pig_rider: 3,
};

/** Exact species attack strip plus its measured contact frame and closest neutral contact effect. */
export function monsterCombatArt(species: MonsterSpecies): MonsterCombatArtDefinition {
  return {
    caster: TINY_SWORDS_ENEMIES[species].attack,
    activeFrame: MONSTER_ACTIVE_FRAME[species],
    impact: EXPLOSION,
  };
}

export function allCombatSheets(): CombatSheetArt[] {
  const unique = new Map<string, CombatSheetArt>();
  const colors: readonly PrimaryColor[] = ["azure", "ember", "moss", "violet"];
  for (const color of colors) {
    for (const playerClass of PLAYER_CLASSES) {
      for (const skill of CLASS_SKILLS[playerClass]) {
        const art = combatArt(playerClass, skill.id, color);
        for (const sheet of [art.caster, art.projectile, art.impact, art.zone, art.accent]) {
          if (sheet) unique.set(sheet.source, sheet);
        }
      }
    }
  }
  for (const kind of ["hex_orb", "enemy_harpoon", "enemy_bomb"] as const) {
    const projectile = projectileArt(kind, "ember");
    unique.set(projectile.source, projectile);
  }
  for (const profile of Object.values(MONSTER_SPECIAL_IMPACT_ART)) {
    const definition: MonsterSpecialImpactArtDefinition = profile;
    unique.set(definition.effect.source, definition.effect);
    if (definition.accent) unique.set(definition.accent.source, definition.accent);
  }
  const teleport = teleportEffectArt();
  unique.set(teleport.source, teleport);
  unique.set(PEASANT_CAMP_ART.source, PEASANT_CAMP_ART);
  return [...unique.values()];
}
