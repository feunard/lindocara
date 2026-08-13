import {
  type PartyMaterialAmounts,
  type PartyMaterials,
  spendPartyMaterials,
} from "./party-harvest-state.js";
import { TILE_SIZE } from "./tilemap.js";

export const PEASANT_SUPPORT_SKILL_SLOTS = [3, 4, 5] as const;
export type PeasantSupportSkillSlot = (typeof PEASANT_SUPPORT_SKILL_SLOTS)[number];

export type PeasantSupportSkillId = "butchers_cut" | "makeshift_camp" | "homemade_bomb";

export const PEASANT_RATION_DROP_COUNT = 3;
export const PEASANT_RATION_LAUNCH_RADIUS = 20;
export const PEASANT_RATION_FLIGHT_MS = 1_600;
export const PEASANT_RATION_ARC_HEIGHT = 2;
/** Time a missed ration remains fully visible and collectible after touching the ground. */
export const PEASANT_RATION_GROUND_LIFETIME_MS = 30_000;
/** Short authoritative grace period during which the grounded ration fades out. */
export const PEASANT_RATION_FADE_MS = 1_000;
export const PEASANT_RATION_HEAL_RATIO = 0.1;
export const PEASANT_RATION_MANA_RATIO = 0.05;

export interface PeasantSupportSkillConfig {
  id: PeasantSupportSkillId;
  slot: PeasantSupportSkillSlot;
  /** Party-wide stock reserved and spent atomically by the authoritative party/world saga. */
  cost: Readonly<PartyMaterialAmounts>;
  /** World-space effect radius, in TILE UNITS since the game's geometry moved off pixels. */
  radius: number;
  /** Camp lifetime for slot 4; fuse duration for slot 5. */
  durationMs: number;
  /** Modest total group heal for the camp; modest explosion damage for the bomb. */
  power: number;
}

/**
 * Shared Peasant support-loop contract.
 *
 * This is shared balance data only. The client may use it to explain affordability, but only the
 * server may spend materials, create the camp/bomb, or apply healing and damage.
 */
export const PEASANT_SUPPORT_SKILLS: Readonly<
  Record<PeasantSupportSkillSlot, PeasantSupportSkillConfig>
> = {
  3: {
    id: "butchers_cut",
    slot: 3,
    cost: { meat: PEASANT_RATION_DROP_COUNT },
    radius: PEASANT_RATION_LAUNCH_RADIUS,
    durationMs: PEASANT_RATION_GROUND_LIFETIME_MS,
    power: PEASANT_RATION_HEAL_RATIO * 100,
  },
  4: {
    id: "makeshift_camp",
    slot: 4,
    cost: { wood: 1, stone: 1, meat: 1 },
    radius: 10,
    durationMs: 30_000,
    power: 60,
  },
  5: {
    id: "homemade_bomb",
    slot: 5,
    cost: { stone: 2 },
    radius: 110 / TILE_SIZE,
    durationMs: 650,
    power: 85,
  },
};

export function isPeasantSupportSkillSlot(value: number): value is PeasantSupportSkillSlot {
  return (PEASANT_SUPPORT_SKILL_SLOTS as readonly number[]).includes(value);
}

export function peasantSupportSkill(slot: number): PeasantSupportSkillConfig | null {
  return isPeasantSupportSkillSlot(slot) ? PEASANT_SUPPORT_SKILLS[slot] : null;
}

/** Presentation-safe base affordability. Talent-aware callers resolve their typed plan first. */
export function canAffordPeasantSupportSkill(
  materials: PartyMaterials | undefined,
  slot: number,
): boolean {
  const config = peasantSupportSkill(slot);
  return (
    materials !== undefined &&
    config !== null &&
    spendPartyMaterials(materials, config.cost) !== null
  );
}
