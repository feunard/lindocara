import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createCloudCover } from "../src/clouds.js";
import { createHd2dContext } from "../src/context.js";

describe("createCloudCover", () => {
  it("fait dériver la couverture à la vitesse configurée", () => {
    const ctx = createHd2dContext({
      config: { cloudShadow: { scale: 0.011, drift: [0.002, 0.001], softness: 0.4 } },
    });
    const clouds = createCloudCover(ctx);
    clouds.update(2);
    expect(clouds.offset().x).toBeCloseTo(0.004);
    expect(clouds.offset().y).toBeCloseTo(0.002);
  });

  it("garde deux couvertures indépendantes", () => {
    const a = createCloudCover(createHd2dContext());
    const b = createCloudCover(createHd2dContext());
    a.update(5);
    expect(b.offset().x).toBe(0);
  });

  it("après dispose(), le contexte retombe sur une carte neutre plutôt que sur une texture libérée", () => {
    const ctx = createHd2dContext();
    const before = ctx.cloudUniforms.uCloudMap.value;
    const clouds = createCloudCover(ctx);

    clouds.dispose();

    const after = ctx.cloudUniforms.uCloudMap.value;
    // `applyCloudShadow` partage `uCloudMap` par référence avec tout matériau greffé
    // (`Object.assign(shader.uniforms, uniforms)`) : un matériau encore rendu après ce `dispose()`
    // ne doit jamais retomber sur `null`, ni rester accroché à la texture que `dispose()` vient de
    // libérer.
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    // Le projet vitest `hd2d` tourne en `node`, sans DOM : `createCloudCover` n'a donc rien construit
    // via canvas ici (`document` est indéfini), et c'est justement ce qui prouve que le reset de
    // `dispose()` ne dépend pas de la plate-forme — on peut vérifier sans DOM qu'il s'agit bien du
    // texel noir neutre.
    expect(after).toBeInstanceOf(THREE.DataTexture);
    expect((after as THREE.DataTexture).image.data).toEqual(new Uint8Array([0, 0, 0, 255]));
  });
});
