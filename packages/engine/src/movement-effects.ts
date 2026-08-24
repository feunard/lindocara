/** Temporary movement modifiers granted by authored pickup events. */
export const MOVEMENT_EFFECT_KINDS = [
  "speed_boost",
  "light_gravity",
  "double_jump",
  "speed_slow",
  "heavy_gravity",
  "inverted_controls",
] as const;

export type MovementEffectKind = (typeof MOVEMENT_EFFECT_KINDS)[number];

export const MOVEMENT_EFFECT_DURATION_LIMITS = { min: 1_000, max: 60_000 } as const;
export const MOVEMENT_EFFECT_POWER_LIMITS = { min: 0.25, max: 3 } as const;

export interface MovementEffectDefinition {
  readonly kind: MovementEffectKind;
  readonly durationMs: number;
  /** Multiplier for speed/gravity, or extra jumps for `double_jump`. */
  readonly power: number;
  readonly beneficial: boolean;
}

export const MOVEMENT_EFFECT_DEFAULTS: Readonly<
  Record<MovementEffectKind, MovementEffectDefinition>
> = {
  speed_boost: { kind: "speed_boost", durationMs: 6_000, power: 1.35, beneficial: true },
  light_gravity: { kind: "light_gravity", durationMs: 7_000, power: 0.55, beneficial: true },
  double_jump: { kind: "double_jump", durationMs: 9_000, power: 1, beneficial: true },
  speed_slow: { kind: "speed_slow", durationMs: 5_000, power: 0.65, beneficial: false },
  heavy_gravity: { kind: "heavy_gravity", durationMs: 5_000, power: 1.65, beneficial: false },
  inverted_controls: {
    kind: "inverted_controls",
    durationMs: 4_500,
    power: 1,
    beneficial: false,
  },
};

export interface ActiveMovementEffect {
  readonly kind: MovementEffectKind;
  readonly power: number;
  readonly until: number;
}

export function isMovementEffectKind(value: unknown): value is MovementEffectKind {
  return typeof value === "string" && (MOVEMENT_EFFECT_KINDS as readonly string[]).includes(value);
}

export function validMovementEffectPower(kind: MovementEffectKind, power: number): boolean {
  if (!Number.isFinite(power)) return false;
  if (kind === "double_jump") return Number.isSafeInteger(power) && power >= 1 && power <= 2;
  if (kind === "inverted_controls") return power === 1;
  return power >= MOVEMENT_EFFECT_POWER_LIMITS.min && power <= MOVEMENT_EFFECT_POWER_LIMITS.max;
}
