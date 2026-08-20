import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Billboard } from "../src/billboard.js";
import {
  billboardHeight,
  createAnimator,
  facingToFlip,
  makeBillboard,
  makeCardVolume,
} from "../src/billboard.js";
import { createHd2dContext } from "../src/context.js";

const PITCH = (38 * Math.PI) / 180;

describe("billboardHeight", () => {
  it("ne compense rien à stretch 0", () => {
    expect(billboardHeight({ height: 2.6, pitch: PITCH, stretch: 0 })).toBeCloseTo(2.6);
  });

  it("annule complètement l'écrasement à stretch 1", () => {
    // Une caméra qui plonge de 38° écrase un plan vertical d'un facteur cos(38°).
    expect(billboardHeight({ height: 2.6, pitch: PITCH, stretch: 1 })).toBeCloseTo(
      2.6 / Math.cos(PITCH),
    );
  });

  it("interpole entre les deux au réglage par défaut", () => {
    expect(billboardHeight({ height: 2.6, pitch: PITCH, stretch: 0.85 })).toBeCloseTo(
      2.6 * (1 + (1 / Math.cos(PITCH) - 1) * 0.85),
    );
  });

  it("ne compense rien sans plongée", () => {
    expect(billboardHeight({ height: 2.6, pitch: 0, stretch: 1 })).toBeCloseTo(2.6);
  });
});

describe("facingToFlip", () => {
  it("miroite sur l'axe est-ouest", () => {
    expect(facingToFlip("east", false)).toBe(false);
    expect(facingToFlip("west", false)).toBe(true);
  });

  it("laisse le profil courant intact au nord et au sud", () => {
    // Les unités Tiny Swords n'ont que le profil : aucune frame de face, aucune de dos. Se
    // retourner n'a donc rien à jouer, et remettre le sprite d'aplomb serait un saut visible.
    expect(facingToFlip("north", true)).toBe(true);
    expect(facingToFlip("south", false)).toBe(false);
  });
});

// Revue finale (point G1) : `makeLitMaterial` écrasait la clé que `graftCloudShadow` venait de
// poser avec une constante — deux sprites éclairés construits avec des greffes DIFFÉRENTES
// (`BillboardOptions.graftCloudShadow`, un point d'injection documenté) partageaient donc la même
// clé, et three réutilisait le programme du premier pour le second : sa greffe s'évaporait.
describe("makeBillboard — customProgramCacheKey", () => {
  it("compose la clé de la greffe de nuages au lieu de l'écraser", () => {
    const ctx = createHd2dContext();
    const texture = new THREE.Texture();

    const a = makeBillboard(ctx, {
      texture,
      height: 1,
      graftCloudShadow: (material) => {
        material.customProgramCacheKey = () => "greffe-a";
      },
    });
    const b = makeBillboard(ctx, {
      texture,
      height: 1,
      graftCloudShadow: (material) => {
        material.customProgramCacheKey = () => "greffe-b";
      },
    });

    const matA = a.mesh.material as THREE.Material;
    const matB = b.mesh.material as THREE.Material;
    expect(matA.customProgramCacheKey()).toContain("greffe-a");
    expect(matB.customProgramCacheKey()).toContain("greffe-b");
    expect(matA.customProgramCacheKey()).not.toBe(matB.customProgramCacheKey());

    a.dispose();
    b.dispose();
  });
});

describe("makeBillboard — plongée dynamique", () => {
  it("recompense sa géométrie sans décoller ses pieds du sol", () => {
    const ctx = createHd2dContext({ pitch: PITCH });
    const billboard = makeBillboard(ctx, {
      texture: new THREE.Texture(),
      height: 2,
      foot: 0.25,
      stretch: 1,
      graftCloudShadow: () => undefined,
    });
    billboard.placeAt(1, 5, 2);
    const initialFoot = billboard.footOffset;

    const steeperPitch = Math.PI / 3;
    ctx.setPitch(steeperPitch);
    billboard.mesh.geometry.computeBoundingBox();
    const bounds = billboard.mesh.geometry.boundingBox;

    expect(bounds?.max.y).toBeCloseTo(2 / Math.cos(steeperPitch));
    expect(billboard.footOffset).toBeGreaterThan(initialFoot);
    expect(billboard.mesh.position.y + billboard.footOffset).toBeCloseTo(5);
    expect(ctx.litBillboards()[0]?.mid).toBeCloseTo(1 / Math.cos(steeperPitch));
    billboard.dispose();
  });
});

// Revue finale (point G2) : `play()` ne comparait que `row`/`frames`, jamais `fps` — deux clips de
// même ligne et même longueur mais de vitesses différentes ne changeaient donc jamais de cadence,
// le second `play()` étant pris pour une redemande du même clip.
describe("createAnimator — fps change", () => {
  it("prend en compte un fps différent même à row/frames identiques", () => {
    const frames: number[] = [];
    const fakeSprite: Billboard = {
      mesh: {} as THREE.Mesh,
      setFrame: (i) => frames.push(i),
      setFlip: () => {},
      setFacing: () => {},
      placeAt: () => {},
      footOffset: 0,
      dispose: () => {},
    };

    const animator = createAnimator(fakeSprite, { row: 0, frames: 4, fps: 4 }, 4);
    animator.setPhase(0); // élimine la phase de départ aléatoire pour un test déterministe
    animator.play({ row: 0, frames: 4, fps: 12 }); // même row/frames, fps différent
    frames.length = 0;
    animator.update(0.25);

    // À l'ancien fps (4, bogué : `play()` ignoré) : t = 0.25*4 = 1 -> frame 1.
    // Au nouveau fps (12, corrigé) : t = 0.25*12 = 3 -> frame 3.
    expect(frames).toEqual([3]);
  });
});

describe("makeCardVolume", () => {
  it("construit un nuage en trois cartes fixes sans l’inscrire au yaw caméra", () => {
    const ctx = createHd2dContext();
    const volume = makeCardVolume(ctx, {
      texture: new THREE.Texture(),
      height: 2,
      aspect: 2,
      mode: "cloud",
      graftCloudShadow: () => undefined,
    });

    expect(volume.mesh.geometry.getAttribute("position").count).toBe(12);
    expect(ctx.billboards()).toHaveLength(0);
    ctx.setYaw(Math.PI / 2);
    expect(volume.mesh.rotation.y).toBe(0);
    volume.dispose();
  });
});
