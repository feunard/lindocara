import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createHd2dContext } from "../src/context.js";
import {
  createWaterfall,
  createWaterfallSheet,
  type WaterfallSheetOptions,
} from "../src/terrain/waterfall.js";

const texture = (): THREE.Texture => new THREE.Texture();

const sheet = (over: Partial<WaterfallSheetOptions> = {}) =>
  createWaterfallSheet(createHd2dContext(), {
    texture: texture(),
    x: -24.2,
    z: 10,
    width: 1.8,
    topY: 2.7,
    bottomY: 1.8,
    facing: "east",
    ...over,
  });

describe("createWaterfallSheet", () => {
  it("spans exactly the requested drop, vertically", () => {
    const s = sheet();
    s.mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(s.mesh);
    expect(box.min.y).toBeCloseTo(1.8, 5);
    expect(box.max.y).toBeCloseTo(2.7, 5);
  });

  it("faces east: its plane is normal to X, so it is thin along X and wide along Z", () => {
    const s = sheet();
    s.mesh.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(s.mesh).getSize(new THREE.Vector3());
    expect(size.z).toBeGreaterThan(size.x);
  });

  it("flares at the base: the bottom edge is wider than the lip", () => {
    const s = sheet({ flare: 0.4, lipSquash: 0 });
    const pos = s.mesh.geometry.getAttribute("position");
    let lipHalf = 0;
    let baseHalf = 0;
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      const half = Math.abs(pos.getX(k));
      if (y > 0.99) lipHalf = Math.max(lipHalf, half);
      if (y < 0.01) baseHalf = Math.max(baseHalf, half);
    }
    expect(baseHalf).toBeGreaterThan(lipHalf);
  });

  // Regression: the first version defaulted to FrontSide, and the sheet was backface-culled into
  // total invisibility in the lab while every geometric assertion above still passed — a bounding
  // box cannot see a culled face. A single quad's facing depends on winding AND yaw, so the only
  // robust answer is to render both sides; the terrace above a fall is walkable anyway, which
  // makes the back a view a player really gets.
  it("renders both sides, so no yaw can cull it into invisibility", () => {
    const material = sheet().mesh.material;
    expect(Array.isArray(material)).toBe(false);
    if (!Array.isArray(material)) expect(material.side).toBe(THREE.DoubleSide);
  });

  // Regression: placed exactly on the wall plane, the sheet was coplanar with the rock and
  // z-fought it. `renderOrder` decides draw order, not depth comparison, so it cannot fix this.
  it("stands clear of the cliff face it hangs on, in the facing direction", () => {
    expect(sheet({ facing: "east" }).mesh.position.x).toBeGreaterThan(-24.2);
    expect(sheet({ facing: "west" }).mesh.position.x).toBeLessThan(-24.2);
    expect(sheet({ facing: "south" }).mesh.position.z).toBeGreaterThan(10);
    expect(sheet({ facing: "north" }).mesh.position.z).toBeLessThan(10);
  });

  it("scrolls its texture downward over time, and only downward", () => {
    const s = sheet();
    const uniform = (s.mesh.material as THREE.ShaderMaterial).uniforms.uScroll;
    const before = uniform?.value as number;
    s.update(0.5);
    expect((uniform?.value as number) > before).toBe(true);
  });

  it("releases its own geometry and material on dispose", () => {
    const s = sheet();
    let disposed = 0;
    s.mesh.geometry.addEventListener("dispose", () => {
      disposed++;
    });
    // `Mesh.material` is typed as one material OR an array of them; this sheet only ever builds
    // one, and narrowing says so rather than asserting it away.
    const material = s.mesh.material;
    expect(Array.isArray(material)).toBe(false);
    if (!Array.isArray(material)) {
      material.addEventListener("dispose", () => {
        disposed++;
      });
    }
    s.dispose();
    expect(disposed).toBe(2);
  });
});

describe("createWaterfall", () => {
  const fall = (kind: "water" | "lava" = "water") =>
    createWaterfall(createHd2dContext(), {
      texture: texture(),
      kind,
      x: -23,
      z: 10,
      width: 1.4,
      topY: 1.8,
      bottomY: 0.9,
      facing: "east",
      poolOffset: 0.5,
    });

  // Two children, not three: the POOL is not built here. It is real water — `createWater` with a
  // `center` and a `level` — because a pool given its own flat shader reads as a painted disc.
  it("groups a sheet and a plunge ring, and builds no pool of its own", () => {
    expect(fall().group.children).toHaveLength(2);
  });

  it("does not generate an impact ring around a lavafall", () => {
    const lavafall = fall("lava");
    expect(lavafall.group.children).toHaveLength(1);
    expect(
      lavafall.group.children.some(
        (child) => child instanceof THREE.Mesh && child.geometry instanceof THREE.RingGeometry,
      ),
    ).toBe(false);
    expect(() => lavafall.update(1 / 60)).not.toThrow();
    lavafall.dispose();
  });

  it("reports the impact point at the foot of the sheet, where the water lands", () => {
    const f = fall();
    expect(f.impact.x).toBeCloseTo(-23, 5);
    expect(f.impact.y).toBeCloseTo(0.9, 5);
    expect(f.impact.z).toBeCloseTo(10, 5);
  });

  it("puts the impact ring out from the cliff by the pool offset, on the water it strikes", () => {
    const ring = fall().group.children[1];
    expect(ring).toBeDefined();
    expect(ring?.position.x).toBeCloseTo(-22.5, 5);
    expect(ring?.position.z).toBeCloseTo(10, 5);
  });

  it("disposes every part", () => {
    const f = fall();
    let disposed = 0;
    f.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.addEventListener("dispose", () => {
          disposed++;
        });
      }
    });
    f.dispose();
    expect(disposed).toBe(2);
  });
});
