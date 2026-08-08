import type { HeroEvent } from "@lindocara/engine/hd2d/hero-state.js";
import type { TerrainMaterial } from "@lindocara/engine/hd2d/terrain-query.js";

export type MovementSoundCue =
  | { kind: "noise"; duration: number; frequency: number; q: number; volume: number }
  | {
      kind: "tone";
      duration: number;
      frequency: number;
      endFrequency: number;
      volume: number;
    };

const STEP: Record<TerrainMaterial, { frequency: number; duration: number; volume: number }> = {
  herbe: { frequency: 620, duration: 0.055, volume: 0.032 },
  sable: { frequency: 1_050, duration: 0.07, volume: 0.028 },
  neige: { frequency: 430, duration: 0.085, volume: 0.034 },
  glace: { frequency: 1_850, duration: 0.045, volume: 0.024 },
  "glace-fine": { frequency: 2_150, duration: 0.05, volume: 0.026 },
};

/** Pure event-to-acoustics routing. Visual-only events deliberately return null. */
export function movementSoundCue(event: HeroEvent, take: number): MovementSoundCue | null {
  switch (event.t) {
    case "pas": {
      const step = STEP[event.matiere];
      const variation = 1 + ((((take % 3) + 3) % 3) - 1) * 0.08;
      return {
        kind: "noise",
        duration: step.duration,
        frequency: step.frequency * variation,
        q: 0.8,
        volume: step.volume,
      };
    }
    case "brasse":
      return { kind: "noise", duration: 0.16, frequency: 820, q: 0.55, volume: 0.05 };
    case "saut":
      return { kind: "tone", duration: 0.11, frequency: 170, endFrequency: 320, volume: 0.03 };
    case "reception":
      return {
        kind: "noise",
        duration: 0.13,
        frequency: 260,
        q: 0.75,
        volume: Math.min(0.075, 0.025 + event.force * 0.004),
      };
    case "entree-eau":
      return {
        kind: "noise",
        duration: event.rupture ? 0.34 : 0.27,
        frequency: event.rupture ? 1_100 : 720,
        q: 0.45,
        volume: event.rupture ? 0.085 : 0.065,
      };
    case "sortie-eau":
      return { kind: "noise", duration: 0.2, frequency: 760, q: 0.5, volume: 0.045 };
    case "glace-craque":
      return { kind: "noise", duration: 0.12, frequency: 2_100, q: 1.6, volume: 0.045 };
    case "glace-rompt":
      return { kind: "noise", duration: 0.3, frequency: 1_250, q: 1.2, volume: 0.075 };
    case "glider-open":
      return { kind: "noise", duration: 0.2, frequency: 1_450, q: 0.7, volume: 0.04 };
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
