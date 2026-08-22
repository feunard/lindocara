import { describe, expect, it } from "vitest";

import { createMoodBlend, createMoodMixer, type MoodConfig } from "../src/mood.js";

const base: MoodConfig = {
  exposure: 1,
  sky: { top: "#3d8fd0", horizon: "#a8dced", glow: "#fff4d2", glowStrength: 0.5, stars: 0 },
  fog: { near: 34, far: 86 },
  sun: { color: "#ffffff", intensity: 2.6, position: [-18, 22, 12] },
  rim: { color: "#cfe6ff", intensity: 0.85, position: [17, 12, -8] },
  hemi: { sky: "#bfe6ff", ground: "#6b7a4a", intensity: 1.15 },
  fire: 1.1,
  clouds: 0.34,
  water: { shallow: "#1eab99", deep: "#08365c", sparkle: 1 },
  motes: 0.5,
  fireflies: 0,
  bloom: { strength: 0.38, threshold: 0.78 },
  grade: { saturation: 1.14, lift: 0 },
  aurora: 0,
  fogPulse: 0,
};
const nuit: MoodConfig = {
  ...base,
  exposure: 0.72,
  sun: { color: "#000000", intensity: 0.62, position: [-15, 21, 10] },
  fire: 13,
};

const FADE = 2.2;

describe("createMoodMixer", () => {
  it("interpole les scalaires à mi-fondu", () => {
    const mix = createMoodMixer({ day: base, night: nuit }, "day", FADE);
    mix.goTo("night");
    mix.update(FADE / 2);
    expect(mix.value.exposure).toBeCloseTo((1 + 0.72) / 2, 3);
    expect(mix.value.fire).toBeCloseTo((1.1 + 13) / 2, 3);
  });

  it("interpole aussi les COULEURS, et non un entier hexadécimal", () => {
    // Toutes les couleurs sont des chaînes justement pour que le mélange se fasse dans l'espace
    // couleur. Interpoler 0xffffff vers 0x000000 sur un entier passerait par du vert.
    const mix = createMoodMixer({ day: base, night: nuit }, "day", FADE);
    mix.goTo("night");
    mix.update(FADE / 2);
    const c = mix.value.sun.color;
    expect(c.r).toBeCloseTo(0.5, 1);
    expect(c.g).toBeCloseTo(0.5, 1);
    expect(c.b).toBeCloseTo(0.5, 1);
  });

  it("signale le changement tant qu'il bouge, et se tait une fois arrivé", () => {
    // main.js fait `if (mood.update(dt)) pushMood()` : repousser l'ambiance dans toute la scène à
    // chaque frame alors qu'elle ne bouge plus, c'est du travail pour rien à 60 Hz.
    const mix = createMoodMixer({ day: base, night: nuit }, "day", FADE);
    mix.goTo("night");
    expect(mix.update(0.5)).toBe(true);
    expect(mix.update(FADE)).toBe(true);
    expect(mix.update(0.016)).toBe(false);
    expect(mix.value.exposure).toBeCloseTo(0.72);
    expect(mix.name).toBe("night");
  });

  it("repart de la valeur COURANTE quand on change d'avis en plein fondu", () => {
    // Sinon un aller-retour rapide ferait sauter l'image d'un bout à l'autre du fondu.
    const mix = createMoodMixer({ day: base, night: nuit }, "day", FADE);
    mix.goTo("night");
    mix.update(FADE / 2);
    const milieu = mix.value.exposure;
    mix.goTo("day");
    mix.update(0.001);
    expect(mix.value.exposure).toBeCloseTo(milieu, 2);
  });

  it("interpole les nouveaux canaux comme les anciens", () => {
    // `aurora` et `fogPulse` ne sont pas des cas particuliers : ils traversent le même fondu que
    // `stars` ou `exposure`. Si l'un des deux ne se mélange pas, c'est qu'il a été câblé à côté.
    const mix = createMoodMixer(
      { day: base, night: { ...nuit, aurora: 1, fogPulse: 0.6 } },
      "day",
      FADE,
    );
    mix.goTo("night");
    mix.update(FADE / 2);
    expect(mix.value.aurora).toBeCloseTo(0.5, 2);
    expect(mix.value.fogPulse).toBeCloseTo(0.3, 2);
  });
});

describe("createMoodBlend", () => {
  it("accepts a continuous external weight without accumulating transition state", () => {
    const blend = createMoodBlend(base, nuit);
    blend.set(0.25);
    expect(blend.value.exposure).toBeCloseTo(0.93);
    expect(blend.value.fire).toBeCloseTo(4.075);
    blend.set(1);
    expect(blend.value.exposure).toBeCloseTo(0.72);
    blend.set(0);
    expect(blend.value.exposure).toBeCloseTo(1);
  });
});
