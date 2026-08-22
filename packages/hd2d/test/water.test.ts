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

describe("shallowness as a bowl", () => {
  const field = fieldFrom(["0000", "0000", "0000", "0000"]);
  const base = {
    texture: new THREE.Texture(),
    level: 3.6,
    size: 3,
    segment: 0.5,
    depthRange: 7,
    roughness: 0.46,
  };

  // A CONSTANT shallowness makes `mix(deep, shallow, k)` one flat colour across the whole surface,
  // which renders as a blue rectangle however good the material is. Small bodies of water need a
  // gradient of their own, and the function form is how they say so.
  it("varies across the surface when given a function", () => {
    const w = createWater(CTX, field, {
      ...base,
      shallow: (x, z) => Math.min(1, Math.hypot(x, z) / 1.5),
    });
    const attr = w.mesh.geometry.getAttribute("aShallow");
    const values = new Set<number>();
    for (let k = 0; k < attr.count; k++) values.add(Math.round(attr.getX(k) * 100));
    expect(values.size).toBeGreaterThan(3);
  });

  it("is deepest at the centre and shallowest at the rim", () => {
    const w = createWater(CTX, field, {
      ...base,
      shallow: (x, z) => Math.min(1, Math.hypot(x, z) / 1.5),
    });
    const pos = w.mesh.geometry.getAttribute("position");
    const attr = w.mesh.geometry.getAttribute("aShallow");
    let centre = 1;
    let rim = 0;
    for (let k = 0; k < attr.count; k++) {
      const r = Math.hypot(pos.getX(k), pos.getZ(k));
      if (r < 0.1) centre = Math.min(centre, attr.getX(k));
      if (r > 1.4) rim = Math.max(rim, attr.getX(k));
    }
    expect(centre).toBeLessThan(rim);
  });
});

describe("water reused across a rebuilt scene", () => {
  const opts = {
    texture: new THREE.Texture(),
    level: 0,
    size: 12,
    segment: 1,
    depthRange: 4,
    roughness: 0.46,
  };

  // Why this method exists at all: the plane is the expensive half (385x385 vertices, 17-23 ms on
  // the editor's 256-cell canvas) and NOTHING about the terrain moves one of its vertices — only
  // `aShallow` follows the coast, and that is ~1 ms. The editor rebuilt the whole sea per painted
  // cell for want of that distinction.
  it("re-shades the coast without rebuilding the plane", () => {
    const water = createWater(CTX, fieldFrom(["0..", "...", "..."]), opts);
    const geometry = water.mesh.geometry;
    const position = geometry.getAttribute("position");
    const before = shallowAt(water.mesh, 2.5, 2.5);
    // `needsUpdate` is write-only in three (its setter bumps `version`), so the version IS the
    // observable "three has been told to re-upload this".
    const versionOf = (): number => {
      const attribute = geometry.getAttribute("aShallow");
      if (!(attribute instanceof THREE.BufferAttribute)) throw new Error("aShallow interleaved");
      return attribute.version;
    };
    const version = versionOf();

    water.setField(fieldFrom(["...", "...", "..0"]));

    // Same geometry object, same vertices: nothing was reallocated.
    expect(water.mesh.geometry).toBe(geometry);
    expect(water.mesh.geometry.getAttribute("position")).toBe(position);
    // But the shallows moved with the land, and the GPU copy is marked stale.
    expect(shallowAt(water.mesh, 2.5, 2.5)).toBeGreaterThan(before);
    expect(versionOf()).toBeGreaterThan(version);
    water.dispose();
  });

  it("leaves an authored shallowness alone, because the field never drove it", () => {
    // The constant and function forms answer the shallowness themselves; re-reading a field they
    // never consulted would silently replace an authored pool's tint with a coastline gradient.
    const water = createWater(CTX, fieldFrom(["0..", "...", "..."]), { ...opts, shallow: 0.42 });
    water.setField(fieldFrom(["...", "...", "..0"]));
    const attr = water.mesh.geometry.getAttribute("aShallow");
    for (let k = 0; k < attr.count; k += 1) expect(attr.getX(k)).toBeCloseTo(0.42, 5);
    water.dispose();
  });
});
