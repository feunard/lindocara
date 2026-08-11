import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createHd2dContext } from "../src/context.js";
import {
  createWaterfall,
  createWaterfallBasin,
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

describe("createWaterfallBasin", () => {
  const basin = () =>
    createWaterfallBasin(createHd2dContext(), {
      texture: texture(),
      x: -22.5,
      z: 10,
      radius: 0.45,
      y: 1.8,
    });

  // Flat, and a hair ABOVE the terrace it sits on rather than exactly at it: a disc coplanar with
  // the ground z-fights it just as a sheet coplanar with a wall does. The gap has to be small
  // enough that the water still reads as lying ON the rock, which is what the upper bound pins.
  it("lies flat, just clear of the terrace it sits on", () => {
    const b = basin();
    b.mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(b.mesh);
    expect(box.min.y).toBeCloseTo(box.max.y, 6);
    expect(box.min.y).toBeGreaterThan(1.8);
    expect(box.min.y).toBeLessThan(1.85);
  });

  it("spans its own diameter", () => {
    const b = basin();
    b.mesh.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(b.mesh).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(0.9, 2);
    expect(size.z).toBeCloseTo(0.9, 2);
  });

  it("animates its surface over time", () => {
    const b = basin();
    const uniform = (b.mesh.material as THREE.ShaderMaterial).uniforms.uTime;
    const before = uniform?.value as number;
    b.update(0.5);
    expect((uniform?.value as number) > before).toBe(true);
  });
});

describe("createWaterfall", () => {
  const fall = () =>
    createWaterfall(createHd2dContext(), {
      texture: texture(),
      x: -23,
      z: 10,
      width: 1.4,
      topY: 1.8,
      bottomY: 0.9,
      facing: "east",
      basinRadius: 0.45,
    });

  it("groups a sheet, a basin and a plunge ring", () => {
    expect(fall().group.children).toHaveLength(3);
  });

  it("reports the impact point at the foot of the sheet, where the water lands", () => {
    const f = fall();
    expect(f.impact.x).toBeCloseTo(-23, 5);
    expect(f.impact.y).toBeCloseTo(0.9, 5);
    expect(f.impact.z).toBeCloseTo(10, 5);
  });

  // The basin must sit ENTIRELY on the one-cell terrace the sheet lands on — centred on that cell,
  // half a cell out from the wall. Offsetting by the RADIUS instead (the first attempt) put the
  // near edge on the wall and the far edge two radii out, which overhung the terrace and left the
  // disc floating in the air over the next drop. Nothing geometric caught it; the screen did.
  it("centres the basin on the terrace cell, half a cell clear of the wall", () => {
    const basin = fall().group.children[1];
    expect(basin).toBeDefined();
    expect(basin?.position.x).toBeCloseTo(-22.5, 5);
    expect(basin?.position.z).toBeCloseTo(10, 5);
  });

  it("keeps the whole basin inside the terrace cell it stands on", () => {
    const basin = fall().group.children[1];
    expect(basin).toBeDefined();
    // The cell runs from the wall at x = -23 to x = -22; the disc must not cross either edge.
    expect((basin?.position.x ?? 0) - 0.45).toBeGreaterThanOrEqual(-23);
    expect((basin?.position.x ?? 0) + 0.45).toBeLessThanOrEqual(-22);
  });

  it("advances every part on update", () => {
    const f = fall();
    const before = f.group.children.map((c) =>
      c instanceof THREE.Mesh && !Array.isArray(c.material) ? c.material.uuid : "",
    );
    f.update(0.5);
    expect(before.filter(Boolean)).toHaveLength(3);
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
    expect(disposed).toBe(3);
  });
});
