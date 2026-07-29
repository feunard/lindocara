/**
 * Rogue tuning shared by the pure rules, the authority and presentation. Values live here so the
 * five abilities never grow independent client/server copies.
 */
export const ROGUE_BALANCE = {
  attack: {
    base: 22,
    perLevel: 3,
    range: 58,
  },
  opening: {
    durationMs: 1_500,
    bonusRatio: 0.4,
    executorBonusRatio: 0.75,
    predatorBonusRatio: 0.75,
    executorKillWindowMs: 2_000,
    executorCooldownReductionRatio: 0.5,
  },
  shadowStep: {
    cooldownMs: 4_500,
    selectionRange: 260,
    returnWindowMs: 2_000,
  },
  vanish: {
    cooldownMs: 14_000,
    maximumDurationMs: 8_000,
    predatorShivWindowMs: 2_000,
    predatorPoisonPowerMultiplier: 1.5,
    smokeProtectionMs: 500,
  },
  poisonedShiv: {
    cooldownMs: 6_000,
    range: 58,
    directPower: 14,
    poisonTicks: 5,
    poisonTickPower: 6,
    poisonTickPowerPerLevel: 1,
    poisonIntervalMs: 1_000,
    concentratedVenomMaxStacks: 3,
    ruptureRemainingDamageRatio: 0.6,
  },
  shadowDance: {
    cooldownMs: 11_000,
    selectionRange: 360,
    maximumHits: 5,
    powerPerHit: 32,
    strikeIntervalMs: 180,
    darkHarvestCooldownReductionMs: 1_500,
    thousandCutsPowerRatio: 0.6,
  },
} as const;

/** The poison snapshots one bounded base power per stack when the authoritative hit lands. */
export function roguePoisonTickPower(level: number): number {
  const normalizedLevel = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  return (
    ROGUE_BALANCE.poisonedShiv.poisonTickPower +
    (normalizedLevel - 1) * ROGUE_BALANCE.poisonedShiv.poisonTickPowerPerLevel
  );
}
