/**
 * Why a sample is never played twice the same way.
 *
 * Five footstep takes on a loop are recognisable inside ten seconds — the ear locks onto the
 * sequence, not the sound. Jittering the pitch and the level on every shot is what buys a small
 * bank the illusion of a large one, and it is the reason the lab could ship three snow takes and
 * still not sound like three snow takes.
 *
 * Pure and injectable: `random` is a parameter, never `Math.random` reached for directly, so a test
 * can pin the choice and assert what actually reached the mixer.
 */

/** The lab's measured band (`jouer`, `apps/lab/src/core/audio.ts`): ±8% of playback rate. Wider
 *  starts sounding like a different object; narrower stops hiding the repetition. */
export const RATE_JITTER = 0.08;

/** And ±15% of level, which reads as effort rather than as a volume fault. */
export const GAIN_JITTER = 0.15;

/** Clamps a unit random into [0, 1) so a hostile or buggy generator cannot index out of a bank. */
function unit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1 - Number.EPSILON;
  return value;
}

/** Which take to play, given how many the bank holds for that key. */
export function pickVariant(count: number, random: () => number): number {
  if (!Number.isFinite(count) || count <= 1) return 0;
  return Math.floor(unit(random()) * Math.floor(count));
}

/**
 * The playback rate this shot gets. `rate` is the DELIBERATE transposition the caller asked for —
 * a sheep bleating higher as it is annoyed, the lab's wooden "next" tick lifted out of a footstep —
 * and the jitter multiplies it rather than replacing it, so an authored pitch survives.
 */
export function jitterRate(rate: number, random: () => number): number {
  const base = Number.isFinite(rate) && rate > 0 ? rate : 1;
  return base * (1 - RATE_JITTER + unit(random()) * RATE_JITTER * 2);
}

/** The level this shot gets, on the same principle. */
export function jitterGain(gain: number, random: () => number): number {
  const base = Number.isFinite(gain) && gain > 0 ? gain : 0;
  return base * (1 - GAIN_JITTER + unit(random()) * GAIN_JITTER * 2);
}
