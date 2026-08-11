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

export interface WaterfallBasinOptions {
  texture: THREE.Texture;
  /** World centre of the disc. */
  x: number;
  z: number;
  /** Radius of the disc, world units. */
  radius: number;
  /** World height of its surface — the terrace it sits on. */
  y: number;
}

export interface WaterfallBasin {
  mesh: THREE.Mesh;
  update(dt: number): void;
  dispose(): void;
}

/**
 * A catch basin: a small horizontal disc of water on the terrace a fall lands on.
 *
 * DECORATIVE, and not by omission. `TerrainQuery` reads one global `waterLevel` for the whole
 * world, so water at altitude cannot exist as far as collision is concerned — the hero wades
 * through this, and teaching the engine about per-cell water height would change a contract shared
 * with the game's authoritative server for the sake of a visual feature.
 *
 * It reuses the sea's texture and a two-tone gradient like `createWater`'s, but with no
 * depth-range grading: a basin has no open sea to fade toward. What it must not lose is the
 * FAMILY resemblance — a basin that reads as a different substance from the ocean it drains into
 * breaks the island in two.
 */
export function createWaterfallBasin(
  _ctx: Hd2dContext,
  opts: WaterfallBasinOptions,
): WaterfallBasin {
  const geometry = new THREE.CircleGeometry(opts.radius, 24);
  geometry.rotateX(-Math.PI / 2);

  const map = opts.texture.clone();
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uTime: { value: 0 },
      // Pitched at the sea's own depth for the same reason the sheet's core is: unlit material
      // under bloom, so swatch-bright colours blow out to white. The two tones stay CLOSE together
      // — a wide shallow/deep spread on a disc this small reads as a bruise painted on the rock
      // rather than as a puddle, which is what the first pass looked like on screen.
      uShallow: { value: new THREE.Color("#3ea3a8") },
      uDeep: { value: new THREE.Color("#227e91") },
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
      uniform float uTime;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      varying vec2 vUv;
      void main() {
        float r = distance(vUv, vec2(0.5)) * 2.0;
        vec2 uv = vUv * 4.0 + vec2(uTime * 0.06, uTime * 0.04);
        float grain = texture2D(uMap, uv).r;
        // Slightly deeper in the middle, and a bright ring right at the rim where the water meets
        // the rock — that rim is what actually says "pool" rather than "blue paint".
        float bowl = smoothstep(0.9, 0.1, r);
        // Broad and gentle. A crisp bright rim reads as a UI button rather than as water meeting
        // rock, which is exactly how the first pass looked on screen.
        float rim = smoothstep(0.45, 1.0, r);
        vec3 col = mix(uShallow, uDeep, bowl) * (0.72 + 0.4 * grain);
        gl_FragColor = vec4(mix(col, vec3(0.78, 0.9, 0.94), rim * 0.34), 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(opts.x, opts.y, opts.z);
  // Just clear of the terrace top, for the same reason the sheet stands clear of its wall.
  mesh.position.y += FACE_CLEARANCE / 2;
  mesh.renderOrder = 1;

  return {
    mesh,
    update(dt) {
      const time = material.uniforms.uTime;
      if (time) time.value = ((time.value as number) + dt) % 3600;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      map.dispose();
    },
  };
}

export interface WaterfallOptions extends WaterfallSheetOptions {
  /** Radius of the catch basin under the sheet. */
  basinRadius: number;
  /**
   * How far out from the wall the basin's CENTRE sits, in world units. Defaults to half a cell.
   *
   * This is not the same as the radius, and conflating the two is a mistake worth naming: pushing
   * the basin out by its own radius puts its near edge on the wall and its far edge `2·radius`
   * away, which overhangs a terrace only one cell deep and leaves the disc floating over the drop
   * below. Offsetting by half a cell instead centres the basin on the terrace cell, where a disc
   * of radius up to ~0.45 fits with room to spare.
   */
  basinOffset?: number;
}

export interface Waterfall {
  group: THREE.Group;
  /** The world point where the sheet meets the basin. Mist, spray, the rainbow and the roar's
   *  distance are all anchored to this rather than each recomputing it from the placement. */
  impact: THREE.Vector3;
  update(dt: number): void;
  dispose(): void;
}

/** One complete drop: a falling sheet, the basin it lands in, and the ring where the two meet. */
export function createWaterfall(ctx: Hd2dContext, opts: WaterfallOptions): Waterfall {
  const sheet = createWaterfallSheet(ctx, opts);

  // The basin is pushed OUT from the wall onto the terrace the sheet lands on — by `basinOffset`,
  // half a cell by default, NOT by its own radius. See that field's docstring for why the
  // difference matters.
  const [nx, nz] = FACE_NORMAL[opts.facing];
  const offset = opts.basinOffset ?? 0.5;
  const basinX = opts.x + nx * offset;
  const basinZ = opts.z + nz * offset;
  const basin = createWaterfallBasin(ctx, {
    texture: opts.texture,
    x: basinX,
    z: basinZ,
    radius: opts.basinRadius,
    y: opts.bottomY,
  });

  // The plunge ring: a flat annulus that grows and fades on a loop, the way `makeRipple` animates
  // the hero's swim wake. Built here rather than reusing `makeRipple` because that one is sized
  // and paced for a single stroke, and a plunge pool ripples continuously.
  const ringGeometry = new THREE.RingGeometry(0.35, 0.5, 24);
  ringGeometry.rotateX(-Math.PI / 2);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xdff4fb,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.position.set(basinX, opts.bottomY + FACE_CLEARANCE, basinZ);
  ring.renderOrder = 2;

  const group = new THREE.Group();
  group.add(sheet.mesh, basin.mesh, ring);

  let phase = 0;
  return {
    group,
    impact: new THREE.Vector3(opts.x, opts.bottomY, opts.z),
    update(dt) {
      sheet.update(dt);
      basin.update(dt);
      phase = (phase + dt * 0.9) % 1;
      ring.scale.setScalar(0.4 + phase * 1.6);
      ringMaterial.opacity = 0.5 * (1 - phase);
    },
    dispose() {
      sheet.dispose();
      basin.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
    },
  };
}
