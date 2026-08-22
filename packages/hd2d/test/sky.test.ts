import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createHd2dContext } from "../src/context.js";
import { createMoodMixer, type MoodConfig } from "../src/mood.js";
import { createSky } from "../src/sky.js";

// Même ambiance que `mood.test.ts` : aucune raison d'inventer une seconde forme de `MoodConfig` ici,
// et réutiliser `createMoodMixer` pour la résoudre (couleurs -> `THREE.Color`) évite de fabriquer à
// la main un `ResolvedMood` complet rien que pour satisfaire le type.
const jour: MoodConfig = {
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

/** Une caméra minimale : `Sky.update` ne lit que `camera.position`, et `THREE.PerspectiveCamera` se
 *  construit sans DOM (voir `clouds.test.ts`, même précédent). */
function fabriqueCamera(): THREE.Camera {
  const camera = new THREE.PerspectiveCamera(22, 1, 0.5, 220);
  camera.position.set(3, 4, 5);
  return camera;
}

function uniformesDe(sky: ReturnType<typeof createSky>) {
  return (sky.mesh.material as THREE.ShaderMaterial).uniforms as {
    uAurora: { value: number };
  };
}

describe("createSky — canal aurora", () => {
  it("à aurora = 0, l'horizon reste EXACTEMENT celui de l'ambiance — pas un lerp qui converge vers 0", () => {
    // La garantie de non-régression de la Task 9 tient tout entière sur ce chemin (`if (aurora >
    // 0.001)` dans `sky.ts`) : avant ce test, seules des captures d'écran, non rejouables, en
    // témoignaient.
    const ctx = createHd2dContext();
    const sky = createSky(ctx);
    const mix = createMoodMixer({ jour }, "jour", 1);

    sky.apply(mix.value, new THREE.Vector3(0, 1, 0));
    sky.update(0.016, fabriqueCamera(), 0);

    expect(uniformesDe(sky).uAurora.value).toBe(0);
    const attendu = new THREE.Color(jour.sky.horizon);
    // Bit pour bit, composante par composante — pas `toBeCloseTo` : à aurora = 0 il ne doit y avoir
    // NI lerp NI arrondi, juste la couleur d'ambiance recopiée telle quelle.
    expect(sky.horizon.r).toBe(attendu.r);
    expect(sky.horizon.g).toBe(attendu.g);
    expect(sky.horizon.b).toBe(attendu.b);

    sky.dispose();
  });

  it("à aurora > 0, l'horizon CHANGE — sinon ce test ne prouverait rien du chemin > 0", () => {
    const ctx = createHd2dContext();
    const sky = createSky(ctx);
    const mix = createMoodMixer({ jour }, "jour", 1);

    sky.apply(mix.value, new THREE.Vector3(0, 1, 0));
    sky.update(0.016, fabriqueCamera(), 0.8);

    expect(uniformesDe(sky).uAurora.value).toBe(0.8);
    const ambiance = new THREE.Color(jour.sky.horizon);
    // Au moins UNE composante doit s'être écartée de la couleur d'ambiance pure : la teinte
    // d'aurore (`AURORA_TINT`, `sky.ts`) n'est pas grise-neutre par rapport à l'horizon de jour.
    const identique =
      sky.horizon.r === ambiance.r && sky.horizon.g === ambiance.g && sky.horizon.b === ambiance.b;
    expect(identique).toBe(false);

    sky.dispose();
  });
});
