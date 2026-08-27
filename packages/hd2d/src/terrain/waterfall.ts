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
  /** Nature du liquide. L'eau reste la valeur par défaut pour les appels historiques du labo. */
  kind?: "water" | "lava";
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
  const lava = opts.kind === "lava";
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
      // Three tones, and all of them pitched DARK: this material is unlit and the pipeline puts
      // bloom over it, so a colour picked to look right as a swatch blows out to a flat white slab
      // on screen. `uDeep` is the fast core, `uCore` the flanks, `uFoam` the threads and the churn.
      uDeep: { value: new THREE.Color(lava ? "#4b0903" : "#15556e") },
      uCore: { value: new THREE.Color(lava ? "#c52b05" : "#2e86a8") },
      uFoam: { value: new THREE.Color(lava ? "#ffd34d" : "#d6f2fb") },
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
      uniform vec3 uDeep;
      uniform vec3 uFoam;
      uniform float uRepeat;
      varying vec2 vUv;

      float hash(float n) { return fract(sin(n) * 43758.5453123); }

      void main() {
        // --- vertical streaking, procedural ------------------------------------------------------
        // The falling sheet's whole legibility is the STREAKS. Relying on the sea texture's grain
        // for them (the first version did) produces a flat pale rectangle: water.png is a gentle
        // tiling surface meant to be seen edge-on under a sun, and its contrast vanishes stretched
        // over three world units of vertical fall. So the columns are generated here.
        // (No backticks in this comment on purpose: it lives inside a JS template literal, and one
        // stray backtick terminates the shader string with a parse error twenty lines away.)
        //
        // Streaks are LONG VERTICAL LINES, and that is the whole trick. Brightness is chosen per
        // COLUMN and held down the fall, modulated only slowly as it scrolls. Varying it quickly
        // along Y instead — the obvious way to write "moving water" — makes the two axes beat
        // against each other and the sheet renders as a chequerboard of dots, which is exactly
        // what the first attempt at this looked like.
        float wide = floor(vUv.x * 11.0);
        float fine = floor(vUv.x * 31.0);
        float hWide = hash(wide);
        float hFine = hash(fine + 17.0);
        float slowV = vUv.y * uRepeat - uScroll;
        float fastV = vUv.y * uRepeat * 1.6 - uScroll * 1.5;

        // Per-column base brightness, held; the sine only breathes it, at a wavelength longer than
        // the fall is tall, so a column never breaks into segments.
        float bodyStreak = (0.3 + 0.7 * hWide) * (0.8 + 0.2 * sin(slowV * 0.55 + hWide * 6.28));

        // Bright threads: only some columns have one, and it runs the column's whole height.
        float threadStreak = step(0.7, hFine) * (0.55 + 0.45 * sin(fastV * 0.7 + hFine * 6.28));

        // A little of the sea's own grain on top, so the fall shares its substance.
        float grain = texture2D(uMap, vec2(vUv.x, slowV * 0.35)).r;

        // Dark in the fast core, lighter toward the flanks: the shape of a real fall in section.
        float flank = smoothstep(0.0, 0.55, abs(vUv.x - 0.5) * 2.0);
        vec3 col = mix(uDeep, uCore, flank * 0.6 + bodyStreak * 0.5 + grain * 0.12);

        // The bright threads.
        col = mix(col, uFoam, clamp(threadStreak, 0.0, 1.0) * 0.45);

        // The lip: water going over an edge catches the light in one bright line.
        col = mix(col, uFoam, smoothstep(0.93, 1.0, vUv.y) * 0.7);

        // The churn where it lands — wider and stronger than the lip, and the reason the base does
        // not read as a sawn-off rectangle.
        float churn = smoothstep(0.22, 0.0, vUv.y);
        col = mix(col, uFoam, churn * (0.55 + 0.45 * threadStreak));

        // The fraying lateral edges.
        col = mix(col, uFoam, smoothstep(0.42, 0.5, abs(vUv.x - 0.5)) * 0.5);

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

  const speed = opts.speed ?? (lava ? 0.58 : 1.6);

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

export interface WaterfallOptions extends WaterfallSheetOptions {
  /**
   * How far out from the cliff the impact ring sits, in world units.
   *
   * The POOL itself is not built here. It is real water — `createWater` placed at this fall's
   * `bottomY` with its own `center` — because a pool given its own flat shader reads as a painted
   * disc however it is tinted: no swells, no sparkle, no mood colours, none of what makes the sea
   * in this scene look wet. This module owns only the falling sheet and the ring where it strikes.
   */
  poolOffset?: number;
}

export interface Waterfall {
  group: THREE.Group;
  /** The world point where the sheet meets the basin. Mist, spray, the rainbow and the roar's
   *  distance are all anchored to this rather than each recomputing it from the placement. */
  impact: THREE.Vector3;
  update(dt: number): void;
  dispose(): void;
}

/** A fall: its animated sheet, plus a water-only ripple where it strikes the basin below. */
export function createWaterfall(ctx: Hd2dContext, opts: WaterfallOptions): Waterfall {
  const sheet = createWaterfallSheet(ctx, opts);
  const lava = opts.kind === "lava";

  const [nx, nz] = FACE_NORMAL[opts.facing];
  const offset = opts.poolOffset ?? 0.5;
  const basinX = opts.x + nx * offset;
  const basinZ = opts.z + nz * offset;

  const group = new THREE.Group();
  group.add(sheet.mesh);

  // Water spreads a readable ripple at impact. Lava deliberately does not: an expanding geometric
  // annulus reads as a generated bubble, and used to keep popping around every lavafall even after
  // the lava surface's own bubble system had been removed.
  let ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null = null;
  if (!lava) {
    const geometry = new THREE.RingGeometry(0.5, 0.62, 24);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0xdff4fb,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    ring = new THREE.Mesh(geometry, material);
    ring.position.set(basinX, opts.bottomY + FACE_CLEARANCE, basinZ);
    ring.renderOrder = 2;
    group.add(ring);
  }

  let phase = 0;
  return {
    group,
    impact: new THREE.Vector3(opts.x, opts.bottomY, opts.z),
    update(dt) {
      sheet.update(dt);
      if (!ring) return;
      phase = (phase + dt * 0.9) % 1;
      ring.scale.setScalar(0.5 + phase * 1.5);
      ring.material.opacity = 0.32 * (1 - phase);
    },
    dispose() {
      sheet.dispose();
      ring?.geometry.dispose();
      ring?.material.dispose();
    },
  };
}
