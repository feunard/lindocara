/**
 * How loud each movement sample plays, and which ground makes which footstep.
 *
 * This is the LEVELLING the lab arrived at by ear, kept beside the samples it was tuned against —
 * the numbers are worthless apart from the files, and the files sound wrong apart from the numbers.
 *
 * The routing from a `HeroEvent` to one of these keys deliberately stays with each consumer: it is
 * a `switch` over the rule's own union, and keeping it there is what makes the compiler catch the
 * day a new event is added. This module holds only what is genuinely the same on both sides, and
 * takes the material as a plain string so the package keeps depending on nothing at all.
 */

/** The bank key and level for one kind of ground. */
export interface StepSample {
  key: string;
  gain: number;
}

const STEPS: Record<string, StepSample> = {
  herbe: { key: "step.grass", gain: 0.9 },
  sable: { key: "step.sand", gain: 0.75 },
  // Muffled: a step in snow has none of the dry bite of a step on ice.
  neige: { key: "step.snow", gain: 0.85 },
  glace: { key: "step.ice", gain: 0.95 },
};

/** Unknown ground falls back to grass rather than to silence: a hero that walks without a sound
 *  reads as a bug, and a map is free to grow a material this table has not met yet. */
export function stepSampleFor(material: string): StepSample {
  return STEPS[material] ?? { key: "step.grass", gain: 0.9 };
}

/**
 * The one-shot levels, as tuned in the lab.
 *
 * `land` is a BASE: the caller multiplies it by the rule's landing weight, so a hop and a plunge
 * are the same sample at different weights — the same number that drives the camera shake.
 */
export const MOVEMENT_GAINS = {
  jump: 0.8,
  land: 0.55,
  waterEnter: 0.9,
  waterLeave: 0.7,
  swim: 0.55,
  gliderOpen: 0.7,
} as const;

/** The skid's level at full intensity. Always multiplied by the 0..1 slide, never used raw. */
export const SKID_MAX_GAIN = 0.6;

/**
 * The rain bed's ceiling, well under the skid's.
 *
 * Weather is the one loop that plays for as long as an author leaves it on, so it is mixed to sit
 * UNDER footsteps and combat rather than beside them: a bed at the skid's level is the loudest
 * thing in a quiet scene and the first thing a player mutes.
 */
export const RAIN_MAX_GAIN = 0.28;

/** A clap is an EVENT under a bed, so it sits above the rain without reaching combat's level. */
export const THUNDER_MAX_GAIN = 0.55;
