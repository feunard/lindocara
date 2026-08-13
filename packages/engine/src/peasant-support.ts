import {
  type PartyMaterialAmounts,
  type PartyMaterials,
  spendPartyMaterials,
} from "./party-harvest-state.js";
import { TILE_SIZE } from "./tilemap.js";

export const PEASANT_SUPPORT_SKILL_SLOTS = [4, 5] as const;
export type PeasantSupportSkillSlot = (typeof PEASANT_SUPPORT_SKILL_SLOTS)[number];

export type PeasantSupportSkillId = "makeshift_camp" | "homemade_bomb";

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
  4: {
    id: "makeshift_camp",
    slot: 4,
    cost: { wood: 1, stone: 1, meat: 1 },
    radius: 96 / TILE_SIZE,
    durationMs: 30_000,
    power: 60,
  },
  5: {
    id: "homemade_bomb",
    slot: 5,
    cost: { iron: 1, stone: 1 },
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
