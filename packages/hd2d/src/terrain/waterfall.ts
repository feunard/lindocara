import * as THREE from "three";
import type { Hd2dContext } from "../context.js";

/**
 * A falling sheet of water: one vertical quad hugging a cliff face, scrolling its texture
 * downward.
 *
 * Authored, never derived. `foam.ts` can find a shoreline by asking the height field where land
 * meets water, but nothing in the field knows about water ABOVE ground — `waterLevel` is one
 * global scalar for the whole world (see `water.ts`, and `TerrainQuerySource.waterLevel` in
 * `@lindocara/engine`). A waterfall is therefore a placement its caller declares, not a feature
 * this module can detect.
 *
 * Opaque, like `createWater` and for the same reason: foam is painted with `alphaTest`, so it
 * draws BEFORE transparent materials. A translucent sheet would draw over the foam at the shore
 * and haze it. The break at the sheet's edges is done in the fragment shader by mixing toward a
 * foam colour, not by turning the material transparent.
 */
export interface WaterfallSheetOptions {
  /** Surface texture, scrolled downward. The lab passes the same `/tex/water.png` the sea uses:
   *  a fall and the sea it ends in must read as one substance. Cloned internally, so the caller's
   *  registry copy keeps its own wrap/repeat/offset — same discipline as `createWater`. */
  texture: THREE.Texture;
  /** World position of the sheet's centre, on the cliff face. */
  x: number;
  z: number;
  /** Width of the sheet at the lip, in world units. */
  width: number;
  /** World height of the lip and of the base. `topY > bottomY`. */
  topY: number;
  bottomY: number;
  /** Which way the cliff face looks. Decides the plane's orientation and its normal. */
  facing: "east" | "west" | "north" | "south";
  /** Texture rows scrolled per second. Higher reads as a faster fall. */
  speed?: number;
  /** Horizontal squash at the lip, 0..1 — water narrows as it accelerates off the edge. */
  lipSquash?: number;
  /** Fractional widening at the base, 0..1 — the sheet spreads as it hits. */
  flare?: number;
}

export interface WaterfallSheet {
  mesh: THREE.Mesh;
  update(dt: number): void;
  dispose(): void;
}

const YAW: Record<WaterfallSheetOptions["facing"], number> = {
  east: Math.PI / 2,
  west: -Math.PI / 2,
  north: Math.PI,
  south: 0,
};

/** Which way the cliff face looks, as a unit vector. Used to push the sheet a hair clear of the
 *  rock it hangs on — see `FACE_CLEARANCE`. */
const FACE_NORMAL: Record<WaterfallSheetOptions["facing"], readonly [number, number]> = {
  east: [1, 0],
  west: [-1, 0],
  north: [0, -1],
  south: [0, 1],
};

/**
 * How far the sheet stands proud of its cliff face, in world units.
 *
 * A sheet placed exactly ON the wall plane is coplanar with it, and coplanar surfaces z-fight:
 * the fall would flicker in and out of the rock as the camera moves. `renderOrder` does not help —
 * it decides draw ORDER, not depth comparison. Small enough to be invisible at any zoom the lab
 * allows, large enough to clear the depth buffer's precision at the far plane.
 */
const FACE_CLEARANCE = 0.04;

/** Rows of vertices down the sheet. Eight is enough for the lip squash and the base flare to read
 *  as curves rather than as two straight bevels, and the whole mesh is still 18 vertices. */
const ROWS = 8;

export function createWaterfallSheet(
  _ctx: Hd2dContext,
  opts: WaterfallSheetOptions,
): WaterfallSheet {
  const drop = opts.topY - opts.bottomY;
  const squash = opts.lipSquash ?? 0.15;
  const flare = opts.flare ?? 0.25;

  // Built by hand rather than with `PlaneGeometry` because the lip and the base have DIFFERENT
  // widths: the quad is a trapezoid, not a rectangle. Y runs 0..1 — a fraction of the drop, which
  // the mesh's own scale turns into world units below — so the same geometry maths holds at any
  // drop height, and the shader can read `vUv.y` as "how far down the fall am I".
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= ROWS; r++) {
    const v = r / ROWS;
    const half = (opts.width / 2) * (1 - squash * (1 - v) ** 2 + flare * (1 - v));
    positions.push(-half, v, 0, half, v, 0);
    uvs.push(0, v, 1, v);
  }
  for (let r = 0; r < ROWS; r++) {
    const a = r * 2;
    indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const map = opts.texture.clone();
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uScroll: { value: 0 },
      // Two tones, like the sea's shallow/deep pair, and pitched at the same DEPTH as the sea's:
      // this material is unlit and the pipeline puts bloom over it, so a colour picked to look
      // right as a swatch blows out to a flat white slab on screen. The first pass used #4fb8cd
      // and read as a lit panel bolted to the cliff rather than as water.
      uCore: { value: new THREE.Color("#1f8fa5") },
      uFoam: { value: new THREE.Color("#cfeef7") },
      // How many times the texture repeats down the fall. Derived from the drop so a tall sheet
      // does not stretch one tile over its whole height — the very smear `mesh.ts` accepts for a
      // cliff face and which would read as a frozen curtain here.
      uRepeat: { value: Math.max(2, Math.round(drop * 3)) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uScroll;
      uniform vec3 uCore;
      uniform vec3 uFoam;
      uniform float uRepeat;
      varying vec2 vUv;
      void main() {
        // Minus, so the texture travels DOWN as uScroll grows: falling water, never rising.
        vec2 uv = vec2(vUv.x, vUv.y * uRepeat - uScroll);
        float grain = texture2D(uMap, uv).r;
        // Foam in two THIN bands — the lateral edges where the sheet frays, and the base where it
        // strikes. Wide bands (the first pass used 0.28 and 0.3) leave almost no core visible, and
        // the whole sheet reads as one pale rectangle.
        float edges = smoothstep(0.38, 0.5, abs(vUv.x - 0.5));
        float base = smoothstep(0.16, 0.0, vUv.y);
        // Vertical streaking: the scrolled grain is what says "this is moving", so let it bite
        // harder in the core than the foam does.
        float streak = 0.55 + 0.55 * grain;
        vec3 col = mix(uCore * streak, uFoam, clamp(edges + base, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    // DoubleSide is not a detail. A single quad has one facing, and which one depends on the
    // winding order and the yaw — get it wrong and the sheet is backface-culled into complete
    // invisibility while still sitting in the scene graph, reporting a correct bounding box and
    // passing every geometric assertion. That is exactly what happened the first time this ran in
    // the lab. A fall is also legitimately seen from behind: the terrace above it is walkable.
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.set(1, drop, 1);
  const [nx, nz] = FACE_NORMAL[opts.facing];
  mesh.position.set(opts.x + nx * FACE_CLEARANCE, opts.bottomY, opts.z + nz * FACE_CLEARANCE);
  mesh.rotation.y = YAW[opts.facing];
  // Drawn after the opaque terrain, so the depth buffer is already populated when it lands.
  mesh.renderOrder = 1;

  const speed = opts.speed ?? 1.6;

  return {
    mesh,
    update(dt) {
      const scroll = material.uniforms.uScroll;
      if (scroll) scroll.value = ((scroll.value as number) + dt * speed) % 1024;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      map.dispose();
    },
  };
}
