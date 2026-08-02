import * as THREE from "three";
import { describe, expect, it } from "vitest";
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
    a.registerBillboard(sa.mesh, { lit: true, mid: 1 });
    b.registerBillboard(sb.mesh, { lit: true, mid: 1 });

    a.setYaw(0.4);

    expect(sa.mesh.rotation.y).toBeCloseTo(0.4);
    expect(sb.mesh.rotation.y).toBe(0);
    expect(b.yaw()).toBe(0);
  });

  it("n'inscrit dans les éclairés que les billboards éclairés", () => {
    const ctx = createHd2dContext();
    const lit = fakeSprite();
    const flat = fakeSprite();
    ctx.registerBillboard(lit.mesh, { lit: true, mid: 1.3 });
    ctx.registerBillboard(flat.mesh, { lit: false, mid: 0 });

    expect(ctx.billboards()).toHaveLength(2);
    expect(ctx.litBillboards()).toHaveLength(1);
    expect(ctx.litBillboards()[0]?.mid).toBe(1.3);
  });

  it("adopte le yaw courant à l'inscription, pour qu'un sprite né en cours de rotation ne soit pas de travers", () => {
    const ctx = createHd2dContext();
    ctx.setYaw(-0.25);
    const late = fakeSprite();
    ctx.registerBillboard(late.mesh, { lit: true, mid: 1 });
    expect(late.mesh.rotation.y).toBeCloseTo(-0.25);
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
    ctx.registerBillboard(fakeSprite().mesh, { lit: true, mid: 1 });
    ctx.dispose();
    expect(ctx.billboards()).toHaveLength(0);
    expect(ctx.litBillboards()).toHaveLength(0);
  });
});
