/** Shared sea-guardian balance, in the heightfield's tile-unit world. */
export const SEA_GUARDIAN_ID = "sea-guardian";

/** Stable wire id for one authored guardian; UUID event ids keep this below the 64-char wire cap. */
export function seaGuardianRuntimeId(eventId: string): string {
  return `${SEA_GUARDIAN_ID}_${eventId}`;
}
export const SEA_GUARDIAN_PATH_REFRESH_MS = 250;
export const SEA_GUARDIAN_PATROL_SPEED = 2.4;
export const SEA_GUARDIAN_CHASE_SPEED = 8;
export const SEA_GUARDIAN_DEVOUR_RANGE = 1.15;
export const SEA_GUARDIAN_ATTACK_DURATION_MS = 850;

/** One heightfield tile is the gameplay metre for proximity rules. */
export const SEA_GUARDIAN_AMBIENCE_RADIUS = 100;

export type SeaGuardianState = "patrol" | "chase" | "attack";
