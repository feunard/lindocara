import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Hd2dContext } from "../src/context.js";
import { createWater } from "../src/terrain/water.js";
import { fieldFrom } from "./helpers/field.js";

/** `createWater` never touches the context (its parameter is `_ctx`), so a bare cast is enough to
 *  build a mesh in a test without a GL surface. */
const CTX = {} as Hd2dContext;

/** The shallow value the mesh stores at the vertex nearest `(x, z)`. */
function shallowAt(mesh: THREE.Mesh, x: number, z: number): number {
  const position = mesh.geometry.attributes.position;
  const shallow = mesh.geometry.attributes.aShallow;
  if (!position || !shallow) throw new Error("water mesh is missing its attributes");
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let k = 0; k < position.count; k += 1) {
    const distance = Math.hypot(position.getX(k) - x, position.getZ(k) - z);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = shallow.getX(k);
  }
  return best;
}

describe("createWater", () => {
  it("fades the shallow band by distance from the coast, on every side of the land", () => {
    // A single land cell filling its whole field: the coast touches the field's bounding box on all
    // four sides, so every water vertex lies OUTSIDE the grid. `landDistance` only walks the grid,
    // and vertices beyond it used to read POSITIVE_INFINITY and come out fully deep — which cut the
    // shallow band dead wherever land reached the box, while a map with spare water rows inside the
    // box kept its band there. That is the lopsided coast: full on the padded side, absent on the
    // side the land runs up to.
    const water = createWater(CTX, fieldFrom(["0"]), {
      texture: new THREE.Texture(),
      level: 0,
      size: 12,
      segment: 1,
      depthRange: 4,
      roughness: 0.46,
    });

    const right = shallowAt(water.mesh, 1, 0);
    const left = shallowAt(water.mesh, -1, 0);
    const below = shallowAt(water.mesh, 0, 1);
    const above = shallowAt(water.mesh, 0, -1);

    // One cell out from a one-cell island is shallow water, not open sea.
    expect(right).toBeGreaterThan(0);
    // And it is the SAME water whichever side you swim off. This is the assertion the bug failed.
    expect(left).toBeCloseTo(right, 5);
    expect(below).toBeCloseTo(right, 5);
    expect(above).toBeCloseTo(right, 5);

    // Still a gradient: further out is deeper, and past `depthRange` it is open sea.
    expect(shallowAt(water.mesh, 3, 0)).toBeLessThan(right);
    expect(shallowAt(water.mesh, 5, 0)).toBe(0);

    water.dispose();
  });
});

describe("water somewhere other than the sea", () => {
  const field = fieldFrom(["0000", "0000", "0000", "0000"]);
  const opts = {
    texture: new THREE.Texture(),
    level: 3.6,
    size: 2,
    segment: 0.5,
    depthRange: 7,
    roughness: 0.46,
  };

  // What "water at elevation" means: the same surface the ocean is made of, placed somewhere else
  // and higher up — a pool at the foot of a waterfall, a spring on a summit. Before `center`, every
  // body of water in the world was pinned to the origin, so anything else had to be faked with its
  // own flat shader, which reads as painted-on blue however it is tinted.
  it("sits at the centre and level it is given", () => {
    const w = createWater(CTX, field, { ...opts, center: [-26.5, 13.4] });
    expect(w.mesh.position.x).toBeCloseTo(-26.5, 5);
    expect(w.mesh.position.y).toBeCloseTo(3.6, 5);
    expect(w.mesh.position.z).toBeCloseTo(13.4, 5);
  });

  it("still defaults to the world origin, where the sea belongs", () => {
    const w = createWater(CTX, field, opts);
    expect(w.mesh.position.x).toBe(0);
    expect(w.mesh.position.z).toBe(0);
  });

  // A pool is all bank, so it states its shallowness outright rather than deriving it from a
  // distance-to-land gradient that means nothing at this scale — and that would read 0 everywhere
  // for a pool sitting ON land, making it uniformly shore-coloured by accident rather than intent.
  it("takes a constant shallowness when given one, instead of the field gradient", () => {
    const w = createWater(CTX, field, { ...opts, shallow: 1 });
    const attr = w.mesh.geometry.getAttribute("aShallow");
    expect(attr.count).toBeGreaterThan(0);
    for (let k = 0; k < attr.count; k++) expect(attr.getX(k)).toBe(1);
  });
});
