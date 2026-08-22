import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config.js";
import { createHd2dContext } from "../src/context.js";

function fakeSprite(): { mesh: THREE.Mesh; material: THREE.MeshLambertMaterial } {
  const material = new THREE.MeshLambertMaterial();
  return { mesh: new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material), material };
}

describe("createHd2dContext", () => {
  it("garde deux contextes parfaitement indépendants", () => {
    const a = createHd2dContext();
    const b = createHd2dContext();
    const sa = fakeSprite();
    const sb = fakeSprite();
    a.registerBillboard(sa.mesh, { lit: true, material: sa.material, mid: 1 });
    b.registerBillboard(sb.mesh, { lit: true, material: sb.material, mid: 1 });

    a.setYaw(0.4);

    expect(sa.mesh.rotation.y).toBeCloseTo(0.4);
    expect(sb.mesh.rotation.y).toBe(0);
    expect(b.yaw()).toBe(0);
  });

  it("n'inscrit dans les éclairés que les billboards éclairés", () => {
    const ctx = createHd2dContext();
    const lit = fakeSprite();
    const flat = fakeSprite();
    ctx.registerBillboard(lit.mesh, { lit: true, material: lit.material, mid: 1.3 });
    ctx.registerBillboard(flat.mesh, { lit: false });

    expect(ctx.billboards()).toHaveLength(2);
    expect(ctx.litBillboards()).toHaveLength(1);
    expect(ctx.litBillboards()[0]?.mid).toBe(1.3);
  });

  it("adopte le yaw courant à l'inscription, pour qu'un sprite né en cours de rotation ne soit pas de travers", () => {
    const ctx = createHd2dContext();
    ctx.setYaw(-0.25);
    const late = fakeSprite();
    ctx.registerBillboard(late.mesh, { lit: true, material: late.material, mid: 1 });
    expect(late.mesh.rotation.y).toBeCloseTo(-0.25);
  });

  it("propage la plongée aux billboards inscrits et oublie ceux qui sont retirés", () => {
    const ctx = createHd2dContext({ pitch: 0.4 });
    const sprite = fakeSprite();
    const pitches: number[] = [];
    ctx.registerBillboard(sprite.mesh, {
      lit: true,
      material: sprite.material,
      mid: 1,
      onPitch: (pitch) => pitches.push(pitch),
    });

    ctx.setPitch(0.7);
    ctx.unregisterBillboard(sprite.mesh);
    ctx.setPitch(0.9);

    expect(pitches).toEqual([0.4, 0.7]);
    expect(ctx.pitch()).toBe(0.9);
  });

  it("laisse surcharger la configuration sans muter les valeurs par défaut", () => {
    const ctx = createHd2dContext({ config: { spriteStretch: 0.5 } });
    const autre = createHd2dContext();
    expect(ctx.config.spriteStretch).toBe(0.5);
    expect(autre.config.spriteStretch).toBe(0.85);
    // Les blocs non surchargés gardent leurs valeurs.
    expect(ctx.config.postfx.bloom.strength).toBe(0.42);
  });

  it("vide ses registres au dispose", () => {
    const ctx = createHd2dContext();
    const s = fakeSprite();
    ctx.registerBillboard(s.mesh, { lit: true, material: s.material, mid: 1 });
    ctx.dispose();
    expect(ctx.billboards()).toHaveLength(0);
    expect(ctx.litBillboards()).toHaveLength(0);
  });

  it("désinscrit un mesh des deux registres, sans toucher aux autres", () => {
    const ctx = createHd2dContext();
    const a = fakeSprite();
    const b = fakeSprite();
    ctx.registerBillboard(a.mesh, { lit: true, material: a.material, mid: 1 });
    ctx.registerBillboard(b.mesh, { lit: true, material: b.material, mid: 2 });

    ctx.unregisterBillboard(a.mesh);

    expect(ctx.billboards()).toEqual([b.mesh]);
    expect(ctx.litBillboards()).toHaveLength(1);
    expect(ctx.litBillboards()[0]?.mesh).toBe(b.mesh);
  });

  it("désinscrire un mesh jamais inscrit ne casse rien et ne retire rien", () => {
    const ctx = createHd2dContext();
    const registered = fakeSprite();
    const stranger = fakeSprite();
    ctx.registerBillboard(registered.mesh, { lit: true, material: registered.material, mid: 1 });

    expect(() => ctx.unregisterBillboard(stranger.mesh)).not.toThrow();
    expect(ctx.billboards()).toEqual([registered.mesh]);
    expect(ctx.litBillboards()).toHaveLength(1);
  });

  it("un mesh désinscrit n'est plus tourné par setYaw", () => {
    const ctx = createHd2dContext();
    const gone = fakeSprite();
    ctx.registerBillboard(gone.mesh, { lit: true, material: gone.material, mid: 1 });
    ctx.unregisterBillboard(gone.mesh);

    ctx.setYaw(1.1);

    // Un billboard disposé qui resterait tourné par une rotation de caméra ultérieure serait la
    // fuite mémoire/CPU exacte que le retrait doit empêcher : le mesh mort ne doit plus jamais
    // bouger, quel que soit le nombre de rotations qui suivent.
    expect(gone.mesh.rotation.y).toBe(0);
  });

  it("garde des uniformes de nuages distincts par contexte", () => {
    const a = createHd2dContext();
    const b = createHd2dContext();

    a.cloudUniforms.uCloudOffset.value.set(0.5, 0.7);
    a.cloudUniforms.uCloudStrength.value = 0.9;

    // Si les deux contextes partageaient le même objet uniforms (comme le faisait le PoC, en
    // variable de module), faire dériver les nuages de l'un ferait dériver ceux de l'autre — un
    // héros dans l'éditeur verrait passer les nuages du jeu en cours.
    expect(b.cloudUniforms.uCloudOffset.value.x).toBe(0);
    expect(b.cloudUniforms.uCloudOffset.value.y).toBe(0);
    expect(b.cloudUniforms.uCloudStrength.value).toBe(0.34);
    expect(a.cloudUniforms.uCloudMap).not.toBe(b.cloudUniforms.uCloudMap);
  });

  it("initialise la carte de nuages à un texel noir neutre, pas à null", () => {
    // Un sampler2D nul est indéfini en GLSL et peut faire virer la scène au noir. Le noir est le
    // neutre pour `smoothstep(0.5-s, 0.5+s, 0.0)` : il vaut 0, donc l'ombre ne multiplie rien tant
    // que `createCloudCover` n'a pas posé la vraie carte.
    const ctx = createHd2dContext();
    const texture = ctx.cloudUniforms.uCloudMap.value;
    expect(texture).not.toBeNull();
    expect(texture).toBeInstanceOf(THREE.DataTexture);
    expect((texture as THREE.DataTexture).image.data).toEqual(new Uint8Array([0, 0, 0, 255]));
  });

  it("ne partage aucun sous-objet de config entre contextes, même non surchargé", () => {
    const a = createHd2dContext();
    a.config.postfx.bloom.strength = 999;
    // `drift` est `readonly` au niveau du TYPE (interdit à un appelant ordinaire), mais reste un
    // vrai tableau à l'exécution — le cast ne sert qu'à simuler ici la mutation en place que fait
    // réellement le pipeline de la Task 4.
    (a.config.cloudShadow.drift as [number, number])[0] = 999;

    // Un contexte créé APRÈS la mutation doit toujours voir les valeurs par défaut : si les
    // sous-objets étaient partagés par référence, il verrait 999 ici.
    const b = createHd2dContext();
    expect(b.config.postfx.bloom.strength).toBe(0.42);
    expect(b.config.cloudShadow.drift[0]).toBe(0.0022);

    // DEFAULT_CONFIG lui-même ne doit jamais être corrompu par une mutation vécue via un contexte.
    expect(DEFAULT_CONFIG.postfx.bloom.strength).toBe(0.42);
    expect(DEFAULT_CONFIG.cloudShadow.drift[0]).toBe(0.0022);
  });
});
