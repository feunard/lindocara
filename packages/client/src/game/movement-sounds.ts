import { MOVEMENT_GAINS, stepSampleFor } from "@lindocara/audio/movement.js";
import type { HeroEvent } from "@lindocara/engine/hd2d/hero-state.js";

/**
 * Which recorded sample each movement event plays, and how loud.
 *
 * This used to synthesise: a bandpass noise burst for a footstep, an oscillator sweep for a jump.
 * It now names a key in the shared bank (`@lindocara/audio`), which holds the takes the lab was
 * actually tuned against — five grass, five sand, three snow, three ice — and jitters pitch and
 * level on every shot. That jitter is why the `take` counter this function used to accept is gone:
 * varying by a rotating ±8% was standing in for having more than one recording, and there is no
 * longer anything to stand in for.
 *
 * The routing stays HERE rather than in the package, deliberately: it is a switch over the rule's
 * own event union, so the compiler is what catches the day a new event is added. The package holds
 * only what both consumers agree on — which ground makes which footstep, and at what level.
 */
export interface MovementSampleCue {
  /** A key in the shared movement bank. */
  key: string;
  /** Level before the bank's own jitter and before the player's SFX volume. */
  gain: number;
}

/** Pure event-to-sample routing. Visual-only events deliberately return null. */
export function movementSoundCue(event: HeroEvent): MovementSampleCue | null {
  switch (event.t) {
    case "pas": {
      const step = stepSampleFor(event.matiere);
      return { key: step.key, gain: step.gain };
    }
    case "brasse":
      return { key: "swim", gain: MOVEMENT_GAINS.swim };
    case "saut":
      return { key: "jump", gain: MOVEMENT_GAINS.jump };
    case "reception":
      // The landing's weight follows the fall, exactly as the camera shake does off the same
      // number: one event, one force, two consequences that must agree.
      return { key: "land", gain: MOVEMENT_GAINS.land * event.force };
    case "entree-eau":
      // Breaking THROUGH the ice is the same fall into the same water — only the sound differs, so
      // only the sound is branched on. The mechanics live in the rule (`enterWater`).
      return event.rupture
        ? { key: "ice.plunge", gain: MOVEMENT_GAINS.icePlunge }
        : { key: "water.enter", gain: MOVEMENT_GAINS.waterEnter };
    case "sortie-eau":
      return { key: "water.leave", gain: MOVEMENT_GAINS.waterLeave };
    case "glace-craque":
      return { key: "ice.crack", gain: MOVEMENT_GAINS.iceCrack };
    case "glace-rompt":
      return { key: "ice.break", gain: MOVEMENT_GAINS.iceBreak };
    case "glider-open":
      return { key: "glider.open", gain: MOVEMENT_GAINS.gliderOpen };
    case "noyade":
    case "trace":
    case "haleine":
    case "glisse":
    case "glider-close":
      return null;
  }
}

/** Glisse is held state, unlike every one-shot cue above. */
export function movementSkidIntensity(events: readonly HeroEvent[]): number {
  let intensity = 0;
  for (const event of events) {
    if (event.t === "glisse") intensity = Math.max(intensity, event.intensite);
  }
  return Math.max(0, Math.min(1, intensity));
}
