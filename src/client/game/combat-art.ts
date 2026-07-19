import type { PrimaryColor } from "../../shared/character.js";
import { actionForClassSlot } from "../../shared/combat-actions.js";
import type { MonsterSpecies, PlayerClass } from "../../shared/game.js";
import type { ProjectileKind } from "../../shared/protocol.js";
import { CLASS_SKILLS } from "../../shared/skills.js";
import { type EnemySheet, TINY_SWORDS_ENEMIES } from "./enemy-art.js";
import type { ServerCombatTimeline } from "./server-clock.js";
import { TINY_SWORDS_ROOT } from "./tiny-swords-art.js";

const HEX_SHAMAN_PROJECTILE_SOURCE = new URL(
  "../../../assets/Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Goblin Raiders/Hex Shaman/Hex Shaman_Projectile.png",
  import.meta.url,
).href;
const HEX_SHAMAN_IMPACT_SOURCE = new URL(
  "../../../assets/Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Goblin Raiders/Hex Shaman/Hex Shaman_Explosion.png",
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
const MAGIC_PROJECTILE = {
  ...sheet(HEX_SHAMAN_PROJECTILE_SOURCE, 128, 128, 3, 520, 1),
  rotationOffset: 0,
};
const MAGIC_IMPACT = sheet(HEX_SHAMAN_IMPACT_SOURCE, 128, 128, 9, 620, 2);

const GREEN_MAGIC = 0x62e68f;

function styled(art: CombatSheetArt, tint: number, scale = 1): CombatSheetArt {
  return { ...art, tint, scale };
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

function magicProjectile(kind: "radiant_bolt" | "healing_light") {
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
  const classes: readonly PlayerClass[] = ["warrior", "ranger", "priest"];
  for (const color of colors) {
    for (const playerClass of classes) {
      for (const skill of CLASS_SKILLS[playerClass]) {
        const art = combatArt(playerClass, skill.id, color);
        for (const sheet of [art.caster, art.projectile, art.impact, art.zone, art.accent]) {
          if (sheet) unique.set(sheet.source, sheet);
        }
      }
    }
  }
  return [...unique.values()];
}
