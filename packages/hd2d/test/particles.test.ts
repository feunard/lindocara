import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createHd2dContext } from "../src/context.js";
import { createParticleField } from "../src/particles.js";

const moodLike = (motes: number, fireflies: number) =>
  ({ motes, fireflies }) as unknown as Parameters<
    ReturnType<typeof createParticleField>["apply"]
  >[0];

describe("createParticleField", () => {
  it("éteint les lucioles le jour et le pollen la nuit", () => {
    const ctx = createHd2dContext();
    const champ = createParticleField(ctx, { firePosition: new THREE.Vector3(), worldRadius: 22 });

    champ.apply(moodLike(0.5, 0));
    const jour = champ.group.children.map((c) => c.visible);
    champ.apply(moodLike(0, 1));
    const nuit = champ.group.children.map((c) => c.visible);

    // Le jour et la nuit ne montrent pas les mêmes nuages de points.
    expect(jour).not.toEqual(nuit);
  });

  it("avance sans jamais laisser filer un point hors du monde", () => {
    const ctx = createHd2dContext();
    const champ = createParticleField(ctx, { firePosition: new THREE.Vector3(), worldRadius: 10 });
    champ.apply(moodLike(0.5, 1));
    for (let k = 0; k < 600; k++) champ.update(1 / 60);

    for (const enfant of champ.group.children) {
      const pos = (enfant as THREE.Points).geometry?.getAttribute("position");
      if (!pos) continue;
      for (let n = 0; n < pos.count; n++) {
        expect(Math.hypot(pos.getX(n), pos.getZ(n))).toBeLessThanOrEqual(10 * 1.5);
      }
    }
  });

  it("libère ses géométries au dispose", () => {
    const ctx = createHd2dContext();
    const champ = createParticleField(ctx, { firePosition: new THREE.Vector3(), worldRadius: 10 });
    champ.dispose();
    expect(champ.group.children).toHaveLength(0);
  });
});
