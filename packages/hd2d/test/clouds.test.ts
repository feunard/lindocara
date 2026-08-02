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
    // Revue finale (point E4) : `dispose()` fabriquait auparavant un SECOND neutre à chaque appel,
    // orphelinant celui du contexte (jamais disposé, jamais réutilisé) — il restaure désormais
    // EXACTEMENT le neutre capturé à la construction, `before` lui-même, jamais un nouveau.
    expect(after).toBe(before);
    // Le projet vitest `hd2d` tourne en `node`, sans DOM : `createCloudCover` n'a donc rien construit
    // via canvas ici (`document` est indéfini), et c'est justement ce qui prouve que le reset de
    // `dispose()` ne dépend pas de la plate-forme — on peut vérifier sans DOM qu'il s'agit bien du
    // texel noir neutre.
    expect(after).toBeInstanceOf(THREE.DataTexture);
    expect((after as THREE.DataTexture).image.data).toEqual(new Uint8Array([0, 0, 0, 255]));
  });

  it("dans un vrai navigateur, dispose() restaure le neutre du contexte plutôt que d'en fabriquer un nouveau", () => {
    // `document` réel (jsdom-like minimal stub) pour forcer le chemin `built` : sans lui, le test
    // ci-dessus ne prouve rien de ce cas, `createCloudCover` n'y construisant jamais de vraie carte.
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        fillRect: () => {},
        createRadialGradient: () => ({ addColorStop: () => {} }),
        beginPath: () => {},
        arc: () => {},
        fill: () => {},
        set fillStyle(_v: unknown) {},
        set globalCompositeOperation(_v: unknown) {},
      }),
    } as unknown as HTMLCanvasElement;
    const originalCreateElement = globalThis.document?.createElement;
    (globalThis as { document?: Pick<Document, "createElement"> }).document = {
      createElement: () => fakeCanvas,
    };
    try {
      const ctx = createHd2dContext();
      const before = ctx.cloudUniforms.uCloudMap.value;
      const clouds = createCloudCover(ctx);
      // La vraie carte a bien pris la place du neutre : sans ça ce test ne distinguerait pas le
      // chemin `built` de celui, déjà couvert, où `document` est indéfini.
      expect(ctx.cloudUniforms.uCloudMap.value).not.toBe(before);

      clouds.dispose();

      expect(ctx.cloudUniforms.uCloudMap.value).toBe(before);
    } finally {
      if (originalCreateElement) globalThis.document.createElement = originalCreateElement;
      else (globalThis as { document?: unknown }).document = undefined;
    }
  });
});
