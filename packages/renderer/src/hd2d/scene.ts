/**
 * The game's HD-2D scene: ground, sea, foam, sky and light, built from the welcome's heightfield.
 *
 * This file is a near-transcription of `apps/lab/src/main.ts`'s composition root (its lines ~127-330
 * and ~481-520), and deliberately so — the lab reproduces a PoC whose ORDER is load-bearing, and
 * rediscovering that order by feel is exactly what `docs/hd2d-rendering.md` exists to spare the next
 * reader. Where the lab's comments still explain WHY, the reasoning is carried across here in
 * English (the lab and `@lindocara/engine/hd2d/` are a deliberately French-speaking zone; this
 * package is not).
 *
 * What is knowingly NOT transcribed, because this task draws bare ground:
 * - the props, NPCs, sheep, the chest, the house and its interior, and the collider index they
 *   populate — the game's own actors are `billboards.ts`, and its scenery is a later S3 piece;
 * - the day/night TOGGLE, the zone machinery, particles, cloud cover, the wind gusts and the whole
 *   audio layer — they are lab content, not the game's;
 * - camera orbit/zoom/shake and the look-ahead that follows a running hero. The camera DOES follow
 *   now (`focusOn`, with the lab's exponential damping), but it neither leads nor shakes, and it is
 *   parked over the map's spawn until something names a point to follow.
 *
 * `@lindocara/hd2d` stays domain-free: it takes numbers. Everything below the "art direction" line
 * — which tileset a material draws with, which URLs the game serves — is the ADAPTER's knowledge and
 * lives here, never in that package.
 */

import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { mapToQuerySource } from "@lindocara/engine/hd2d/map-data.js";
import type { TerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import { createTerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import { RIM_LAYER } from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import { createHd2dContext } from "@lindocara/hd2d/context.js";
import type { MoodConfig } from "@lindocara/hd2d/mood.js";
import { createMoodMixer } from "@lindocara/hd2d/mood.js";
import { createPipeline } from "@lindocara/hd2d/pipeline.js";
import { createSky } from "@lindocara/hd2d/sky.js";
import type { TerrainAtlas } from "@lindocara/hd2d/terrain/atlas.js";
import type { HeightField } from "@lindocara/hd2d/terrain/field.js";
import { createFoam, FOAM_SPREAD } from "@lindocara/hd2d/terrain/foam.js";
import { heightFieldFromGrid } from "@lindocara/hd2d/terrain/height-field-from-grid.js";
import { meshTerrain } from "@lindocara/hd2d/terrain/mesh.js";
import { createWater } from "@lindocara/hd2d/terrain/water.js";
import type { TextureRegistry, TextureSpec } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";

// --- art direction ------------------------------------------------------------------------------

const TERRAIN_ROOT = "/assets/lindocara/tiny-swords/terrain";

/**
 * The textures this scene needs, all of them already served by the game.
 *
 * The lab syncs its own `public/tex/` out of `packages/catalog/assets/` with a shell script; the
 * game does not need to, because `packages/client/public/` already ships the very same Pixel Frog
 * sheets under these names — `Tilemap_color1..5.png` is the Free Pack's 9x6 tileset in its five
 * hues (576x384, the lab's `tileset-lvl*`), `Tilemap_Flat.png` is Update 010's 10x4 sand sheet
 * (640x256, the lab's `tileset-sand`), and `Water.png`/`Foam.png` are byte-identical to the lab's.
 * So there is no new asset pipeline here, and there must not be one.
 *
 * `atlas: true` on every sheet sampled by sub-rectangle is not optional: with mipmaps, the lower
 * levels average neighbouring tiles and the borders bleed. Foam counts as an atlas too — it is a
 * strip of eight 192px frames, and mipmapping averaged the eight frames INTO EACH OTHER, which is
 * one of the pitfalls `docs/hd2d-rendering.md` records as having cost real time once already.
 */
export const HD2D_TEXTURE_URLS: readonly TextureSpec[] = [
  { url: `${TERRAIN_ROOT}/Tilemap_color1.png`, atlas: true },
  { url: `${TERRAIN_ROOT}/Tilemap_color2.png`, atlas: true },
  { url: `${TERRAIN_ROOT}/Tilemap_color3.png`, atlas: true },
  { url: `${TERRAIN_ROOT}/Tilemap_color4.png`, atlas: true },
  { url: `${TERRAIN_ROOT}/Tilemap_color5.png`, atlas: true },
  { url: `${TERRAIN_ROOT}/Tilemap_Flat.png`, atlas: true },
  { url: `${TERRAIN_ROOT}/Water.png` },
  { url: `${TERRAIN_ROOT}/Foam.png`, atlas: true },
];

const HD2D_GROUND_PALETTES = ["color1", "color2", "color3", "color4", "color5"] as const;
let groundPaletteOverride: (typeof HD2D_GROUND_PALETTES)[number] | null = null;

/** Development witness hook. Call before creating a renderer; production keeps altitude palettes. */
export function setHd2dGroundPalette(palette: string): boolean {
  if (!(HD2D_GROUND_PALETTES as readonly string[]).includes(palette)) return false;
  groundPaletteOverride = palette as (typeof HD2D_GROUND_PALETTES)[number];
  return true;
}

/**
 * Material + level -> atlas key. Art direction, which is why `heightFieldFromGrid` takes it as a
 * callback rather than knowing it (see `packages/hd2d/AGENTS.md`).
 *
 * Grass reads its tileset from its ALTITUDE — the pack ships the same sheet in five hues, so a
 * plateau is a different green rather than the same green with a tint slapped over it. Sand, snow
 * and ice read theirs from the material instead; they never appear at more than one level in
 * practice, and their identity is the material, not the height. `"glace-fine"` (thin ice, a RULE
 * material) shares ice's appearance, exactly as it does in the lab.
 */
export function terrainAtlasKey(material: string, level: number): string {
  if (material === "sable" || material === "neige") return material;
  if (material === "glace" || material === "glace-fine") return "glace";
  return `lvl${Math.min(2, Math.max(0, Math.round(level)))}`;
}

/**
 * One atlas per key `terrainAtlasKey` can return.
 *
 * `block` says which 4x4 group the sheet holds. Level 0 always borders the WATER directly (a level-0
 * cell never carries a cliff face towards the sea — see `wallDrop`), so it takes the water-edge
 * group, whose white shore line is already painted in. Levels 1 and 2 necessarily border a VOID
 * (they dominate a lower neighbour), so they take the bushy cliff-edge group, the one that joins the
 * stone wall on rows 4-5. Sand only ever exists at level 0, but Update 010's flat sheet reuses the
 * SAME column layout as the cliff-edge group for its own sand-against-grass trim.
 *
 * Snow and ice: the lab composes dedicated sheets for them (`apps/lab/scripts/compose-tileset.py`),
 * and the game does not ship those. Both cold materials therefore borrow `color5`, the coldest of
 * the pack's five hues, until the game has art of its own. They stay two separate entries — same
 * texture today, different 4x4 group — so giving snow its own sheet later is one line.
 */
export function terrainAtlases(textures: TextureRegistry): Record<string, TerrainAtlas> {
  const sheet = (name: string, block: TerrainAtlas["block"], cols: number, rows: number) => ({
    texture: textures.get(`${TERRAIN_ROOT}/${name}`),
    cols,
    rows,
    block,
    wallRow: 4,
    tilePx: 64,
  });
  const palette = groundPaletteOverride ? `Tilemap_${groundPaletteOverride}.png` : null;
  return {
    lvl0: sheet(palette ?? "Tilemap_color1.png", "water-edge", 9, 6),
    lvl1: sheet(palette ?? "Tilemap_color3.png", "cliff-edge", 9, 6),
    lvl2: sheet(palette ?? "Tilemap_color4.png", "cliff-edge", 9, 6),
    // Never a wall for sand (always at level 0): `wallRow` is never read here, kept at 4 out of
    // consistency with the others rather than out of necessity.
    sable: sheet("Tilemap_Flat.png", "cliff-edge", 10, 4),
    neige: sheet("Tilemap_color5.png", "water-edge", 9, 6),
    glace: sheet("Tilemap_color5.png", "cliff-edge", 9, 6),
  };
}

// --- the pure half ------------------------------------------------------------------------------

/**
 * The map's ground, meshed. The half of the composition root that needs neither a canvas nor a GL
 * context, which is what makes it testable in jsdom — `three` builds geometry and materials fine
 * without WebGL.
 *
 * Takes the `Hd2dContext` (unlike the plan's two-argument sketch) because `meshTerrain` grafts THIS
 * context's cloud-shadow uniforms onto every terrain material it builds. Creating a throwaway
 * context in here would silently detach the ground from the scene's own uniforms — precisely the
 * module-singleton failure `Hd2dContext` exists to prevent.
 */
export function terrainGroupFor(
  ctx: Hd2dContext,
  map: MapData,
  atlases: Record<string, TerrainAtlas>,
): { group: THREE.Group; dispose(): void } {
  return meshTerrain(ctx, heightFieldFor(map), { atlases, levelHeight: map.levelHeight });
}

/** The serialized grid, read as the field the mesher consumes. `null` levels stay water: they are
 *  the water plane's business, never a ground quad laid flat at the sea's height. */
export function heightFieldFor(map: MapData): HeightField {
  return heightFieldFromGrid({
    size: map.size,
    levels: map.levels,
    materials: map.materials,
    materialKey: terrainAtlasKey,
  });
}

// --- settings -----------------------------------------------------------------------------------
// Transcribed from `apps/lab/src/settings.ts`. Copied rather than imported: `apps/lab` sits outside
// the package dependency graph on purpose (root `AGENTS.md`), and no package source may reach into
// it. `levelHeight` and `waterLevel` are NOT copied — they travel with the map, which is the whole
// point of the heightfield.

/** Exported because a billboard's vertical stretch is computed FROM the pitch (`billboardHeight`):
 *  `billboards.ts` must read the very angle this camera uses, or every sprite is compensated for a
 *  plunge the scene does not have. */
export const HD2D_CAMERA = {
  /** A short FOV is what makes the near-orthographic, diorama look. */
  fov: 22,
  distance: 40,
  /** Degrees above the horizon. */
  pitch: 38 * (Math.PI / 180),
  /** How far above the ground the camera aims. */
  height: 1.2,
  /** 1 = fog neutral under zoom, 0 = fog frozen in absolute terms. Unused while the camera cannot
   *  zoom, but `frameCamera` still applies the coupling so the day zoom lands it is already right. */
  fogFar: 0.38,
  /** How fast the camera catches up with what it follows, as an exponential rate (see `render`). */
  follow: 6,
} as const;

const CAMERA = HD2D_CAMERA;

const WATER = { roughness: 0.46, segment: 2, depthRange: 7 } as const;

/**
 * Daylight, and only daylight. The lab crossfades a second `night` mood on a key press; the game
 * has no such control, so shipping the catalogue's other half would be dead weight. The mixer is
 * still used for the one mood because it is what turns `#rrggbb` strings into blendable
 * `THREE.Color`s, and hand-rolling that conversion here would be a second, divergent copy.
 */
const DAY: MoodConfig = {
  exposure: 1.0,
  sky: { top: "#3d8fd0", horizon: "#a8dced", glow: "#fff4d2", glowStrength: 0.5, stars: 0 },
  // No colour of its own: the fog takes the sky's horizon hue. Two neighbouring-but-distinct tints
  // drew a hard line exactly where the far sea meets the dome.
  fog: { near: 34, far: 86 },
  sun: { color: "#fff2d0", intensity: 2.6, position: [-18, 22, 12] },
  // Rim light, taken from the side OPPOSITE the sun. Sprite normals are bowed left and right, so a
  // grazing side light catches exactly one of their two edges — that is the outline.
  rim: { color: "#cfe6ff", intensity: 0.85, position: [17, 12, -8] },
  hemi: { sky: "#bfe6ff", ground: "#6b7a4a", intensity: 1.15 },
  fire: 1.1,
  clouds: 0.34,
  // Deliberately DARK and saturated. A pale sea goes white: it is a horizontal plane taking the sun
  // head-on, and ACES desaturates everything climbing towards the highlights.
  water: { shallow: "#1eab99", deep: "#08365c", sparkle: 1.0 },
  motes: 0.5,
  fireflies: 0,
  bloom: { strength: 0.38, threshold: 0.78 },
  grade: { saturation: 1.14, lift: 0.0 },
  aurora: 0,
  fogPulse: 0,
};

/** A frame longer than this is clamped: a backgrounded tab returns with a multi-second delta, and
 *  handing that to the water/foam/sky integrators makes them jump. */
const MAX_FRAME_SECONDS = 0.05;

// --- the scene ----------------------------------------------------------------------------------

export interface Hd2dScene {
  render(now: number): void;
  /**
   * Ask the camera to follow a point — the local player, in practice. `x`/`z` are the two GROUND
   * axes in tile units, exactly as `ActorView` carries them; there is no conversion left on either
   * side. Passing the snapshot's `y` as the second argument hands the camera an ELEVATION and parks
   * it on the horizon. Recorded here and consumed by the next `render`, which is the only place
   * that knows the frame's `dt` and can therefore damp towards it.
   */
  focusOn(x: number, z: number): void;
  /** Sets the diorama zoom as a percentage. 100 is the gameplay camera. */
  setZoom(percent: number): void;
  resize(): void;
  dispose(): void;
  ctx: Hd2dContext;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  query: TerrainQuery;
}

export function createHd2dScene(
  canvas: HTMLCanvasElement,
  map: MapData,
  textures: TextureRegistry,
): Hd2dScene {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.5, 5000);

  const ctx = createHd2dContext();

  // --- world ------------------------------------------------------------------------------------
  // `heightFieldFor` is a stateless adapter over the map's own arrays, so the one `terrainGroupFor`
  // builds for itself and this one are interchangeable — this exists because the sea and the foam
  // need a field too, not because the ground's differs from theirs.
  const field = heightFieldFor(map);
  const query = createTerrainQuery(mapToQuerySource(map));

  const terrain = terrainGroupFor(ctx, map, terrainAtlases(textures));
  scene.add(terrain.group);

  // A plane three times wider than the grid: enough that the sea loses itself in the fog before its
  // own edge does, at every zoom.
  const water = createWater(ctx, field, {
    texture: textures.get(`${TERRAIN_ROOT}/Water.png`),
    level: map.waterLevel,
    size: map.size * 3,
    segment: WATER.segment,
    depthRange: WATER.depthRange,
    roughness: WATER.roughness,
  });
  scene.add(water.mesh);

  const foam = createFoam(ctx, field, {
    texture: textures.get(`${TERRAIN_ROOT}/Foam.png`),
    frames: 8,
    fps: 7,
    spread: FOAM_SPREAD,
    waterLevel: map.waterLevel,
  });
  scene.add(foam.group);

  const sky = createSky(ctx);
  scene.add(sky.mesh);

  // --- lights -----------------------------------------------------------------------------------
  // Before the pipeline, as in the lab: `createPipeline` compiles the scene's materials, and a
  // material compiled without its lights is a material recompiled on the first frame.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // A fixed extent, not one proportional to the map: the shadow map follows the camera target, and
  // spreading it over the whole island would only waste its resolution.
  const SHADOW_EXTENT = 26;
  sun.shadow.camera.left = -SHADOW_EXTENT;
  sun.shadow.camera.right = SHADOW_EXTENT;
  sun.shadow.camera.top = SHADOW_EXTENT;
  sun.shadow.camera.bottom = -SHADOW_EXTENT;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  // Sprites receive shadows and their own quad is written into the shadow map (`shadowSide:
  // DoubleSide`, without which they would cast none): with no bias along the normal each one
  // self-shadows. Set here, before any sprite exists, because it is a property of the LIGHT and
  // Task 7 must find the light already correct rather than have to rediscover this.
  sun.shadow.normalBias = 0.09;
  scene.add(sun);
  scene.add(sun.target);

  // Rim light, taken from the side OPPOSITE the sun.
  const rim = new THREE.DirectionalLight(0xffffff, 0);
  // Confined to the sprite layer. Applied to the ground and the cliffs, this shadowless light stops
  // being an outline and becomes a veil that washes the scenery out — in three, a light only lights
  // an object whose layers it shares. Nothing is registered on `RIM_LAYER` until Task 7 draws the
  // first billboard, which is exactly why the confinement must already be here: a rim light that
  // "works" today because it has nothing to light would light EVERYTHING the moment it is moved.
  rim.layers.set(RIM_LAYER);
  scene.add(rim);
  scene.add(rim.target);

  // --- render -----------------------------------------------------------------------------------
  const pipeline = createPipeline(canvas, scene, camera, ctx);

  // --- mood -------------------------------------------------------------------------------------
  const mood = createMoodMixer({ day: DAY }, "day", 1);
  const fog = new THREE.Fog(0x000000, 1, 100);
  scene.fog = fog;

  const sunOffset = new THREE.Vector3();

  /** Where the camera looks. The map's spawn until `focusOn` names the local player — the one point
   *  on the map the server itself considers the way in, and the honest answer for the frames before
   *  the first snapshot has landed. */
  const target = ((): THREE.Vector3 => {
    const spawn = map.spawns.find((s) => s.name === "default") ?? map.spawns[0];
    const x = spawn?.x ?? 0;
    const z = spawn?.z ?? 0;
    return new THREE.Vector3(x, (query.heightAt(x, z) ?? map.waterLevel) + CAMERA.height, z);
  })();

  /** The point `focusOn` last named, and whether the camera has already been placed over it once.
   *  Reused every frame rather than reallocated: `render` runs 60 times a second. */
  let focus: { x: number; z: number } | null = null;
  let focusReached = false;
  let cameraDistance = CAMERA.distance;
  const wantedTarget = new THREE.Vector3();
  const cameraInset = Math.min(4, Math.max(0, map.size / 2 - 0.5));
  const cameraMin = -map.size / 2 + cameraInset;
  const cameraMax = map.size / 2 - cameraInset;

  function frameCamera(): void {
    // How far back the camera sits. A constant while nothing can zoom; the variable it becomes the
    // day a wheel is wired is what makes the two zoom couplings below mean anything.
    const distance = cameraDistance;
    const horizontal = Math.cos(CAMERA.pitch) * distance;
    camera.position.set(
      target.x,
      target.y + Math.sin(CAMERA.pitch) * distance,
      target.z + horizontal,
    );
    camera.lookAt(target);

    // The lights travel with the target rather than sitting at fixed world points: the shadow map's
    // 26-unit box has to stay centred on what is on screen.
    sunOffset.set(...mood.value.sun.position);
    sun.target.position.copy(target);
    sun.position.copy(target).add(sunOffset);
    sunOffset.set(...mood.value.rim.position);
    rim.target.position.copy(target);
    rim.position.copy(target).add(sunOffset);

    // Fog and the tilt-shift radius BOTH follow the camera's zoom, and neither of them the same way
    // (`CAMERA.fogFar`): pulling back must tighten the band so the map dissolves at its edges,
    // rather than showing the same picture smaller. This camera cannot zoom yet, so the factor is
    // exactly 1 and both are neutral — written out rather than folded away because a fog tuned in
    // absolutes drowns the whole map the day the camera does pull back, and this is where the day's
    // reader will look.
    const zoom = distance / CAMERA.distance;
    fog.near = mood.value.fog.near * zoom;
    fog.far = mood.value.fog.far * zoom ** CAMERA.fogFar;
    pipeline.setTiltShiftZoom(zoom);
  }

  /** Reused every frame by `updateFocus`: projecting into a fresh vector 60 times a second is an
   *  allocation for nothing. */
  const projected = new THREE.Vector3();

  /**
   * The sharp band tracks what the camera is aimed at, so what matters stays crisp wherever it goes.
   *
   * Called EVERY frame rather than once beside the framing: `setFocusY` damps towards its argument
   * by 8% a call, so a single call barely moves the band off the pipeline's configured default. A
   * camera that never moves converges within a second either way — but the day the camera follows a
   * hero (Task 7), a once-only call would silently be a band that never follows anything.
   */
  function updateFocus(): void {
    projected.copy(target).project(camera);
    pipeline.setFocusY(THREE.MathUtils.clamp(1 - (projected.y * 0.5 + 0.5), 0.25, 0.8));
  }

  function pushMood(): void {
    const m = mood.value;
    sun.color.copy(m.sun.color);
    sun.intensity = m.sun.intensity;
    hemi.color.copy(m.hemi.sky);
    hemi.groundColor.copy(m.hemi.ground);
    hemi.intensity = m.hemi.intensity;
    rim.color.copy(m.rim.color);
    rim.intensity = m.rim.intensity;
    pipeline.bloom.strength = m.bloom.strength;
    pipeline.bloom.threshold = m.bloom.threshold;
    pipeline.setGrade({
      saturation: m.grade.saturation,
      contrast: ctx.config.postfx.grade.contrast,
      lift: m.grade.lift,
      vignette: ctx.config.postfx.grade.vignette,
    });
    // Under-exposing reads as an ambience far more directly than dimming each light in turn — those
    // only tint it.
    pipeline.renderer.toneMappingExposure = m.exposure;
    water.colors.shallow.copy(m.water.shallow);
    water.colors.deep.copy(m.water.deep);
    water.setSparkle(m.water.sparkle);
    sky.apply(m, sun.position.clone().sub(sun.target.position));
    // `fog.color` is NOT copied here: the sky's horizon also moves outside a mood crossfade, and
    // `render` copies it every frame, just after `sky.update`.
  }

  // One empty framing before pushing the mood: `pushMood` needs the sun's direction, and it is the
  // camera that places it.
  frameCamera();
  pushMood();

  let last: number | null = null;

  return {
    ctx,
    scene,
    camera,
    query,
    // The camera follows a player, and a player's position now arrives in the scene's own tile
    // units — there is nothing to convert here any more.
    //
    focusOn(x: number, z: number): void {
      focus = {
        x: THREE.MathUtils.clamp(x, cameraMin, cameraMax),
        z: THREE.MathUtils.clamp(z, cameraMin, cameraMax),
      };
    },
    setZoom(percent: number): void {
      const safePercent = THREE.MathUtils.clamp(percent, 2, 250);
      cameraDistance = (CAMERA.distance * 100) / safePercent;
      frameCamera();
    },
    render(now: number): void {
      const dt = last === null ? 0 : Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
      last = now;
      if (focus) {
        wantedTarget.set(
          focus.x,
          (query.heightAt(focus.x, focus.z) ?? map.waterLevel) + CAMERA.height,
          focus.z,
        );
        // Exponential damping, transcribed from `apps/lab/src/main.ts`'s `updateCamera`: it is
        // framerate-independent, unlike a fixed lerp, which converges faster on a fast machine and
        // makes the same follow read as two different games. The FIRST focus snaps instead — the
        // camera starts parked over the map's spawn, and damping from there would be a one-second
        // fly-in every time a hero joins somewhere else.
        if (focusReached && target.distanceToSquared(wantedTarget) <= 25) {
          target.lerp(wantedTarget, 1 - Math.exp(-CAMERA.follow * dt));
        } else {
          target.copy(wantedTarget);
          focusReached = true;
        }
        frameCamera();
      }
      water.update(dt);
      foam.update(dt);
      sky.update(dt, camera, mood.value.aurora);
      // Copied EVERY frame, not only on a mood crossfade: `sky.horizon` also moves with effects
      // that follow their own timing.
      fog.color.copy(sky.horizon);
      // The mood settles once and then never moves again while only `day` exists — `update` returns
      // false and nothing is pushed. Kept anyway: it is one comparison per frame, and it is the
      // seam a second mood would arrive through.
      if (mood.update(dt)) pushMood();
      updateFocus();
      pipeline.render();
    },
    resize: pipeline.resize,
    /**
     * Gives back everything this scene took — with one exception it CANNOT give back: the canvas's
     * WebGL context. `createPipeline` built it and `pipeline.dispose()` restores the canvas's
     * `image-rendering`, but no API detaches a context from a canvas; `forceContextLoss()` was
     * measured and makes it strictly worse (see that function's own comment).
     *
     * The consequence, measured on `#stage` after this increment made HD-2D the only path: a SECOND
     * session in the same page load (leave `/game`, come back) builds a second `WebGLRenderer` on
     * the first one's context. It renders identically — terrain pixels compared byte for byte — but
     * three logs two `texImage3D: FLIP_Y or PREMULTIPLY_ALPHA isn't allowed` warnings while
     * uploading the grading LUT, because the new renderer's unpack state does not match what the
     * context was left in. Noise, not damage, and it is the same inherited-context rule; a fix
     * belongs in `@lindocara/hd2d`'s pipeline, not here.
     */
    dispose(): void {
      terrain.dispose();
      water.dispose();
      foam.dispose();
      sky.dispose();
      pipeline.dispose();
      ctx.dispose();
    },
  };
}
