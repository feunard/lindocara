import type { AuthoredQuestMarker } from "@lindocara/engine/adventure-state.js";
import type { GroundVector } from "@lindocara/engine/ground.js";
import type { ColliderRect } from "@lindocara/engine/hd2d/collider-index.js";
import type { HeroEvent } from "@lindocara/engine/hd2d/hero-state.js";
import type { TerrainRamp } from "@lindocara/engine/hd2d/terrain-query.js";
import type { MerchantDefinition } from "@lindocara/engine/merchant.js";
import { PEASANT_RATION_ARC_HEIGHT } from "@lindocara/engine/peasant-support.js";
import type {
  LootSnapshot,
  PeasantCampVisual,
  PeasantRationVisual,
  PlayerSnapshot,
  ProjectileSnapshot,
  WorldEventSnapshot,
} from "@lindocara/engine/protocol.js";
import type { Billboard, Sprite } from "@lindocara/hd2d/billboard.js";
import { makeBillboard, makeFlatSprite, makeRipple } from "@lindocara/hd2d/billboard.js";
import { meshStairs } from "@lindocara/hd2d/terrain/stairs.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";

import { CHARACTER_ATLAS_SIZE, CHARACTER_ATLAS_URL, LOOT_ATLAS_FRAMES } from "../character-art.js";
import {
  type CombatProjectileArt,
  type CombatSheetArt,
  PEASANT_CAMP_ART,
  PEASANT_RATION_ART,
  projectileArt,
} from "../combat-art.js";
import { MAX_ACTIVE_WORLD_EFFECTS } from "../feedback.js";
import type { LocalMovementVisualState } from "../renderer-api.js";
import type { SceneSample } from "../scene-sample.js";
import {
  makeBridgeVolume,
  makeBuildingVolume,
  type NativeStaticVisual,
} from "./building-volumes.js";
import { makeRunnerPropVolume } from "./runner-prop-volumes.js";
import { HD2D_CAMERA, type Hd2dScene, terrainAtlases, terrainAtlasKey } from "./scene.js";
import {
  isColdBiomeMaterial,
  type StaticSpriteArt,
  staticAnimationFrame,
} from "./static-content.js";
import { makeStructureVolume } from "./structure-volumes.js";

export const HD2D_SPLASH_TEXTURE_URL = "/assets/lindocara/hd2d/splash.png";
export const HD2D_SHEEP_EXPLOSION_TEXTURE_URL = "/assets/lindocara/hd2d/sheep-explosion.png";
/** Authored effect sheets are upright cards whose geometry already pivots at its bottom edge.
 * Any positive foot fraction would subtract part of their height and bury that edge in terrain. */
export const AUTHORED_EFFECT_FOOT = 0;
export const AUTHORED_EFFECT_GROUND_CLEARANCE = 0.055;
export const AUTHORED_EFFECT_DEPTH_BIAS = 0.035;

/** Moves a co-located transparent impact a few centimetres away from the camera. The target's
 * depth-writing billboard then remains in front instead of being painted over by the effect. */
export function depthBiasedEffectPosition(
  x: number,
  z: number,
  cameraX: number,
  cameraZ: number,
): GroundVector {
  const dx = x - cameraX;
  const dz = z - cameraZ;
  const length = Math.hypot(dx, dz);
  if (length <= 0.000_1) return { x, z };
  return {
    x: x + (dx / length) * AUTHORED_EFFECT_DEPTH_BIAS,
    z: z + (dz / length) * AUTHORED_EFFECT_DEPTH_BIAS,
  };
}

interface TimedVisual {
  object: THREE.Object3D;
  startedAt: number;
  endsAt: number;
  update(progress: number): void;
  dispose?: () => void;
}

interface LabelVisual {
  element: HTMLDivElement;
  point: THREE.Vector3;
  endsAt: number;
}

interface CampEntry {
  object: THREE.Object3D;
  billboard: Billboard | null;
  endsAt: number;
  startedAt: number;
  expiresAt: number;
}

interface RationEntry {
  object: THREE.Group;
  billboard: Billboard | null;
  ration: PeasantRationVisual;
  launchedAt: number;
  landsAt: number;
  fadeAt: number;
  endsAt: number;
}

interface PowerBuffEntry {
  object: THREE.Group;
  phase: number;
}

interface HealingAuraEntry {
  object: THREE.Group;
  phase: number;
}

interface LootEntry {
  object: THREE.Group;
  billboard: Billboard | null;
  kind: LootSnapshot["kind"];
  phase: number;
}

interface ProjectileEntry {
  object: THREE.Group;
  billboard: Billboard | null;
  trail: THREE.Object3D | null;
  kind: ProjectileSnapshot["kind"];
  color: ProjectileSnapshot["color"];
  art: CombatProjectileArt;
  createdAt: number;
}

export interface Hd2dEditorOverlay {
  cols: number;
  rows: number;
  showGrid: boolean;
  showCollisions: boolean;
  dim: boolean;
  colliders: readonly ColliderRect[];
  hover?: GroundVector | null;
  selection?: GroundVector | null;
  /** Direct-manipulation gizmo for a selected native building. The front anchor stays fixed while
   * the two side handles resize width and the rear handle resizes depth. */
  buildingResize?: {
    anchor: GroundVector;
    outline: readonly GroundVector[];
    widthHandles: readonly [GroundVector, GroundVector];
    depthHandle: GroundVector;
    hoverAxis?: "width" | "depth" | null;
    activeAxis?: "width" | "depth" | null;
    valid: boolean;
  } | null;
  /** Direct-manipulation gizmo for a selected native bridge. */
  bridgeResize?: {
    anchor: GroundVector;
    outline: readonly GroundVector[];
    handles: readonly {
      side: "length-start" | "length-end" | "width-start" | "width-end";
      axis: "length" | "width";
      point: GroundVector;
    }[];
    hoverSide?: "length-start" | "length-end" | "width-start" | "width-end" | null;
    activeSide?: "length-start" | "length-end" | "width-start" | "width-end" | null;
    valid: boolean;
  } | null;
  /** Direct-manipulation rotation arm for selected native 3D scenery. */
  elementRotation?: {
    anchor: GroundVector;
    handle: GroundVector;
    angle: number;
    hovered: boolean;
    active: boolean;
    valid: boolean;
  } | null;
  /** Side of the hover/selection outline, in cells. Field and event modes mark a whole cell (1);
   *  element mode places at quarter cells and marks one of those. Defaults to 1. */
  cursorCells?: number;
  stairsPreview?: { ramp: TerrainRamp; valid: boolean; levelHeight: number } | null;
  assetPreview?: {
    point: GroundVector;
    footprint: readonly GroundVector[];
    valid: boolean;
    /** Compiled bridge-bank elevation; absent scenery follows terrain under its anchor. */
    elevation?: number;
    skyAltitude?: number;
  } | null;
  /** World-coordinate outline of the rect a save would store — origin corner + size in cells.
   *  Drawn as a bright boundary so the author always sees what will be saved. */
  saveRect?: { x: number; z: number; cols: number; rows: number } | null;
  /** The map's one hero start cell, as a world-space cell centre. Drawn persistently rather than
   *  as a selection: it is a fact about the map, like `saveRect`, and an author who cannot see it
   *  buries it under scenery and then meets `keepsSpawnClear`'s refusal with no visible cause. */
  spawn?: GroundVector | null;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (
      !(child instanceof THREE.Mesh) &&
      !(child instanceof THREE.Line) &&
      !(child instanceof THREE.Sprite)
    )
      return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
  object.removeFromParent();
}

function transparentMaterial(
  color: THREE.ColorRepresentation,
  opacity = 0.9,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    opacity,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

function materialOpacity(object: THREE.Object3D, opacity: number): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      material.transparent = true;
      material.opacity = opacity;
    }
  });
}

function colorFromText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return new THREE.Color().setHSL(((hash >>> 0) % 360) / 360, 0.62, 0.58).getHex();
}

function phaseFor(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return ((hash >>> 0) / 0xffff_ffff) * Math.PI * 2;
}

/** Rotation of a camera-facing projectile sheet after projecting its ground direction into the
 * billboard plane. A world-east arrow stays horizontal at yaw zero; rotating the camera rotates the
 * screen-space arrow without changing the authoritative direction. */
export function projectileBillboardAngle(
  direction: GroundVector,
  cameraYaw: number,
  cameraPitch = HD2D_CAMERA.pitch,
): number {
  const horizontal = direction.x * Math.cos(cameraYaw) - direction.z * Math.sin(cameraYaw);
  const vertical =
    -(direction.x * Math.sin(cameraYaw) + direction.z * Math.cos(cameraYaw)) *
    Math.sin(cameraPitch);
  return Math.atan2(vertical, horizontal);
}

export function projectileFrameIndex(
  frames: number,
  durationMs: number,
  elapsedMs: number,
): number {
  const count = Math.max(1, Math.trunc(frames));
  return Math.floor((Math.max(0, elapsedMs) / Math.max(1, durationMs)) * count) % count;
}

/** The cursor outline's border thickness, as a fraction of the cell it marks — so the band stays in
 *  proportion when the cursor shrinks to a quarter cell in element mode. */
const EDITOR_CURSOR_BAND = 0.08;

/**
 * The square outline the editor draws under the pointer and around the selection, sized so its side
 * is exactly `sideCells` — one grid cell in field/event mode, a quarter in element mode.
 *
 * `RingGeometry` is POLAR: with four segments its corners sit at the radius, so a square built from
 * it has side `radius * sqrt(2)`, not `radius`. The old cursor passed the cell's half-width (0.5) as
 * the radius and therefore drew a square 0.707 cells across — noticeably inside the grid line it was
 * meant to trace. Converting side -> radius here is the whole fix, and baking the 45° turn into the
 * geometry (rather than the mesh) is what lets a test measure the bounding box and see the side.
 */
export function editorCursorGeometry(sideCells: number): THREE.RingGeometry {
  const toRadius = Math.SQRT2 / 2;
  const outer = sideCells * toRadius;
  const inner = Math.max(0, sideCells * (1 - 2 * EDITOR_CURSOR_BAND)) * toRadius;
  const geometry = new THREE.RingGeometry(inner, outer, 4);
  geometry.rotateZ(Math.PI / 4);
  return geometry;
}

/** Server projectile `y` is collision elevation (normally the shooter's ground), not the centre of
 * its rendered card. The card rotates in its own plane, so its lowest corner changes with the shot
 * direction; the trail can become vertical too. Return enough presentation-only lift to keep the
 * complete visual above terrain while leaving the authoritative sweep untouched. */
export function projectileVisualLift(
  frameWidth: number,
  frameHeight: number,
  scale = 1,
  angle = 0,
  trailLengthPixels = 0,
): number {
  const renderedHeight = Math.max(0.42, (frameHeight / 192) * 2.6 * scale);
  const renderedWidth = renderedHeight * (frameWidth / Math.max(1, frameHeight));
  const horizontalReach = Math.max(renderedWidth / 2, trailLengthPixels / 64);
  const downwardReach =
    Math.abs(Math.cos(angle)) * (renderedHeight / 2) + Math.abs(Math.sin(angle)) * horizontalReach;
  return downwardReach + 0.12;
}

/** A projectile card is centred explicitly below, so `placeAt` must not subtract the ordinary
 * actor foot offset a second time. Keeping this at `0.5` buried one half-height in flat terrain;
 * only a cliff edge exposed the complete sheet. */
export const PROJECTILE_BILLBOARD_FOOT = 0;

/** `makeBillboard` deliberately pivots ordinary sprites at their feet. A projectile needs the
 * pre-HD-2D centre anchor instead: rotating a foot-pivoted arrow 180° puts its whole quad below the
 * map, and the 90° cases leave half the card on either side of the terrain line. */
export function centerProjectileGeometry(geometry: THREE.BufferGeometry): void {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) return;
  geometry.translate(-(bounds.min.x + bounds.max.x) / 2, -(bounds.min.y + bounds.max.y) / 2, 0);
}

/**
 * The skid decal's dwell, the threshold under it, and how long it takes to fade.
 *
 * `derapage` (`engine/hd2d/locomotion.ts`) is the disagreement between where a hero is moving and
 * where the input asks it to, and its own docblock names the maximum case out loud: input released
 * while still moving. That is the tail of EVERY stop, on every material -- on grass it lasts the
 * two or three frames friction needs to bleed the speed off, on ice it lasts a second. As the HELD
 * SOUND it was written for, that difference IS the design and a couple of loud frames are
 * inaudible. As a decal on the ground it was a pale bar blinking under the hero every time a key
 * was released, which is what walking down/up/down/up reported.
 *
 * A dwell restores the distinction without naming a material, exactly as `derapage` refuses to name
 * one: grass is finished before the dwell elapses, ice is not. The fade is the other half of the
 * report -- a decal that vanishes between two frames reads as a rendering fault whatever painted it.
 */
export const SKID_DWELL_MS = 220;
export const SKID_MIN_INTENSITY = 0.35;
export const SKID_FADE_MS = 180;

/**
 * The dust ring that marks an interactable event.
 *
 * Motes ORBIT a circle rather than sitting on one: the marker has to be noticed from across a
 * street without ever becoming the brightest thing on screen, and a slow turn does that where a
 * static shape does not. One turn every `SPIN_MS`, which is slow enough to read as drifting dust
 * and not as a loading spinner.
 *
 * The first cut was motes ALONE, and on a green field it disappeared (feedback #22): fourteen
 * additive specks of 0.13 shrink to a pixel or two at the game's camera height, additive light over
 * mid-green lifts the grass towards white rather than towards gold, and points with nothing between
 * them never close into a circle the eye can complete. The fix is in three parts and each one
 * matters: a soft halo UNDER the motes to carry the shape, bigger and fewer-but-brighter motes, and
 * a gold saturated enough to survive being added to grass.
 */
const EVENT_MARKER_MOTES = 16;
const EVENT_MARKER_RADIUS = 0.34;
const EVENT_MARKER_SPIN_MS = 5200;
/** Warm gold, deliberately under 1.0 in blue so additive blending stays golden over grass. */
const EVENT_MARKER_GOLD = { r: 1, g: 0.78, b: 0.34 } as const;
/** Edge of one mote's sprite, in texels. Small: it is a point of light, not a texture. */
const MOTE_TEXTURE_SIZE = 16;
/** World size of one mote at the camera's own distance, before `sizeAttenuation` shrinks it. */
const MOTE_SIZE = 0.19;
/**
 * The halo the motes orbit over: one flat quad, one tile across, carrying a soft annulus.
 *
 * TINTED rather than additive, and that is the whole point of it. Additive light is what made the
 * motes vanish over grass, so the shape underneath has to work the other way: it lays warm colour
 * ON the ground the way a lamp's pool does, which reads at any brightness of terrain. The motes
 * stay additive on top, so the marker is a warm mark with sparkle rather than a painted ring.
 */
const HALO_TEXTURE_SIZE = 64;
const EVENT_MARKER_HALO_TILES = 1;
const EVENT_MARKER_HALO_GOLD = 0xf6b833;
const EVENT_MARKER_HALO_OPACITY = 0.34;

/** Dynamic presentation parented to the same scene graph as terrain and billboards. */
export class Hd2dVisualLayer {
  readonly #scene: Hd2dScene;
  readonly #canvas: HTMLCanvasElement;
  readonly #size: number;
  readonly #waterLevel: number;
  readonly #textures: TextureRegistry | null;
  readonly #materialAt: (x: number, z: number) => unknown;
  readonly #root = new THREE.Group();
  readonly #editorRoot = new THREE.Group();
  readonly #editorPreviewRoot = new THREE.Group();
  readonly #effects: TimedVisual[] = [];
  readonly #loot = new Map<string, LootEntry>();
  readonly #projectiles = new Map<string, ProjectileEntry>();
  readonly #eventMarkers = new Map<string, THREE.Object3D>();
  /** One geometry, one material and one texture for EVERY event marker on the map, built on first
   *  use and owned by this layer. A marker is then a `THREE.Points` sharing all three, so a map
   *  carrying fifty interactables costs fifty transforms rather than fifty buffers. They are not
   *  module-level: the game and the editor preview each open their own context. */
  #moteGeometry: THREE.BufferGeometry | null = null;
  #moteMaterial: THREE.PointsMaterial | null = null;
  #moteTexture: THREE.DataTexture | null = null;
  #haloGeometry: THREE.PlaneGeometry | null = null;
  #haloMaterial: THREE.MeshBasicMaterial | null = null;
  #haloTexture: THREE.DataTexture | null = null;
  readonly #camps = new Map<string, CampEntry>();
  readonly #rations = new Map<string, RationEntry>();
  readonly #powerBuffs = new Map<string, PowerBuffEntry>();
  readonly #healingAuras = new Map<string, HealingAuraEntry>();
  readonly #questMarkers = new Map<string, THREE.Object3D>();
  readonly #hiddenQuestSites = new Map<string, number>();
  readonly #labels: LabelVisual[] = [];
  readonly #raycaster = new THREE.Raycaster();
  readonly #swimDisc: THREE.Mesh;
  readonly #breathBar = new THREE.Group();
  readonly #breathFill: THREE.Mesh;
  readonly #skid: THREE.Mesh;
  /** When the current continuous slide began, `null` when the hero is not sliding. The decal is a
   *  function of these three and of nothing the frame it is drawn in. */
  #skidSince: number | null = null;
  #skidEndedAt: number | null = null;
  #skidFadeFrom = 0;
  #skidAlpha = 0;
  #skidIntensity = 0;
  #events: readonly WorldEventSnapshot[] = [];
  #questState: readonly AuthoredQuestMarker[] = [];
  #questVisualKey = "";
  #merchant: THREE.Object3D | null = null;
  #aim: THREE.Object3D | null = null;
  #nextRippleAt = 0;
  #editorOverlay: Hd2dEditorOverlay | null = null;
  /** The editor grid, cached: a 256×256 canvas is ~263k vertices, each with a `#groundY` terrain
   *  lookup, and `setEditorOverlay` runs on every hover — rebuilding it there stalls the pointer. */
  #gridLines: THREE.LineSegments | null = null;
  #gridKey = "";
  /** Built once and repositioned, never rebuilt: `setEditorOverlay` runs on every hover. Unlike
   *  `#gridLines` this needs no cache key — its geometry does not depend on the map at all, only
   *  its position does. */
  #spawnMarker: THREE.Group | null = null;
  /** The marker's ghost knight, attached only once its texture resolves — see
   *  `setSpawnKnightArt()`. `null` while the load is still in flight or before it starts. */
  #spawnKnight: Billboard | null = null;
  #spawnKnightArt: StaticSpriteArt | null = null;
  readonly #editorPreviews: {
    sprite: Billboard | Sprite | NativeStaticVisual;
    art: StaticSpriteArt;
    cold: boolean;
  }[] = [];

  constructor(
    scene: Hd2dScene,
    canvas: HTMLCanvasElement,
    size: number,
    waterLevel = 0,
    textures: TextureRegistry | null = null,
    materialAt: (x: number, z: number) => unknown = () => null,
  ) {
    this.#scene = scene;
    this.#canvas = canvas;
    this.#size = size;
    // The grid hugs the terrain via `#groundY`, so a fresh terrain (this constructor runs once per
    // `configureMapTerrain` call — `game-renderer.ts` builds a whole new `Hd2dVisualLayer` rather than
    // reusing one) must never keep a stale cached grid alive across it.
    this.#gridKey = "";
    this.#waterLevel = waterLevel;
    this.#textures = textures;
    this.#materialAt = materialAt;
    this.#root.name = "game-presentation";
    this.#editorRoot.name = "editor-overlay";
    this.#editorPreviewRoot.name = "editor-asset-preview";
    this.#root.add(this.#editorRoot);
    this.#root.add(this.#editorPreviewRoot);
    scene.scene.add(this.#root);

    this.#swimDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 32),
      transparentMaterial(0x18384b, 0.38),
    );
    this.#swimDisc.rotation.x = -Math.PI / 2;
    this.#swimDisc.visible = false;
    this.#swimDisc.renderOrder = 2;
    this.#root.add(this.#swimDisc);

    const breathBackground = new THREE.Mesh(
      new THREE.PlaneGeometry(1.04, 0.16),
      new THREE.MeshBasicMaterial({
        color: 0x102938,
        transparent: true,
        opacity: 0.88,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    breathBackground.renderOrder = 20;
    this.#breathFill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.94, 0.09),
      new THREE.MeshBasicMaterial({
        color: 0x73ddf2,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.#breathFill.position.z = 0.006;
    this.#breathFill.renderOrder = 21;
    this.#breathBar.add(breathBackground, this.#breathFill);
    this.#breathBar.visible = false;
    this.#root.add(this.#breathBar);

    this.#skid = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.012, 0.055),
      transparentMaterial(0xc7efff, 0.62),
    );
    this.#skid.name = "hero-skid";
    this.#skid.visible = false;
    this.#root.add(this.#skid);
  }

  #groundY(x: number, z: number, lift = 0.04): number {
    return (this.#scene.query.heightAt(x, z) ?? 0) + lift;
  }

  #disposeEffect(effect: TimedVisual): void {
    if (effect.dispose) effect.dispose();
    else disposeObject(effect.object);
  }

  #trackEffect(effect: TimedVisual): void {
    this.#effects.push(effect);
    while (this.#effects.length > MAX_ACTIVE_WORLD_EFFECTS) {
      const oldest = this.#effects.shift();
      if (oldest) this.#disposeEffect(oldest);
    }
  }

  pulse(
    x: number,
    z: number,
    color: THREE.ColorRepresentation,
    radius = 1,
    durationMs = 480,
    startedAt = performance.now(),
  ): void {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 48), transparentMaterial(color));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, this.#groundY(x, z), z);
    this.#root.add(mesh);
    this.#trackEffect({
      object: mesh,
      startedAt,
      endsAt: startedAt + Math.max(1, durationMs),
      update(progress) {
        const scale = radius * (0.18 + progress * 0.82);
        mesh.scale.setScalar(scale);
        materialOpacity(mesh, 1 - progress);
      },
    });
  }

  beam(
    from: GroundVector,
    to: GroundVector,
    width: number,
    color: THREE.ColorRepresentation,
    durationMs = 420,
    startedAt = performance.now(),
  ): void {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length <= 0.001) {
      this.pulse(from.x, from.z, color, width * 2, durationMs, startedAt);
      return;
    }
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.035, Math.max(0.03, width)),
      transparentMaterial(color, 0.75),
    );
    const x = (from.x + to.x) / 2;
    const z = (from.z + to.z) / 2;
    mesh.position.set(x, this.#groundY(x, z, 0.07), z);
    mesh.rotation.y = -Math.atan2(dz, dx);
    this.#root.add(mesh);
    this.#trackEffect({
      object: mesh,
      startedAt,
      endsAt: startedAt + Math.max(1, durationMs),
      update(progress) {
        materialOpacity(mesh, 0.75 * (1 - progress));
      },
    });
  }

  orb(
    x: number,
    z: number,
    color: THREE.ColorRepresentation,
    radius: number,
    durationMs: number,
    startedAt = performance.now(),
  ): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.08, radius), 18, 12),
      transparentMaterial(color, 0.82),
    );
    mesh.position.set(x, this.#groundY(x, z, radius + 0.12), z);
    this.#root.add(mesh);
    this.#trackEffect({
      object: mesh,
      startedAt,
      endsAt: startedAt + Math.max(1, durationMs),
      update(progress) {
        const breathe = 1 + Math.sin(progress * Math.PI * 6) * 0.16;
        mesh.scale.setScalar(breathe);
        materialOpacity(mesh, Math.min(0.82, (1 - progress) * 1.5));
      },
    });
  }

  /** Animate one authored Tiny Swords effect sheet as a camera-facing world sprite. */
  playSheet(
    art: CombatSheetArt,
    x: number,
    z: number,
    durationMs = art.durationMs,
    startedAt = performance.now(),
    heightScale = 1,
  ): void {
    if (!this.#textures) {
      this.pulse(x, z, art.tint ?? 0xffffff, Math.max(0.45, art.scale ?? 1), durationMs, startedAt);
      return;
    }
    const height = Math.max(0.42, (art.frameHeight / 192) * 2.6 * (art.scale ?? 1)) * heightScale;
    const billboard = makeBillboard(this.#scene.ctx, {
      texture: this.#textures.get(art.source),
      cols: art.frames,
      rows: 1,
      height,
      aspect: art.frameWidth / art.frameHeight,
      foot: AUTHORED_EFFECT_FOOT,
      lit: false,
      pitch: HD2D_CAMERA.pitch,
    });
    const material = billboard.mesh.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.color.setHex(art.tint ?? 0xffffff);
      material.transparent = true;
      material.depthWrite = false;
    }
    const placement = depthBiasedEffectPosition(
      x,
      z,
      this.#scene.camera.position.x,
      this.#scene.camera.position.z,
    );
    billboard.placeAt(
      placement.x,
      this.#groundY(x, z, AUTHORED_EFFECT_GROUND_CLEARANCE),
      placement.z,
    );
    billboard.mesh.visible = startedAt <= performance.now();
    this.#root.add(billboard.mesh);
    const authoredDuration = Math.max(1, durationMs);
    this.#trackEffect({
      object: billboard.mesh,
      startedAt,
      endsAt: startedAt + authoredDuration,
      update(progress) {
        billboard.setFrame(Math.min(art.frames - 1, Math.floor(progress * art.frames)));
        if (material instanceof THREE.MeshBasicMaterial) {
          material.opacity = Math.min(1, (1 - progress) * 4);
        }
      },
      dispose() {
        billboard.mesh.removeFromParent();
        billboard.dispose();
      },
    });
  }

  /**
   * One expanding surface ring, from the shared primitive rather than a rebuilt one.
   *
   * `makeRipple()` is a plane carrying the soft radial ring texture, and it is what the lab has
   * always drawn. This used to build a `RingGeometry(0.28, 0.38, 40)` instead — a hard-edged
   * untextured annulus with the identical timing curve, so it MOVED correctly and read as a
   * wireframe hoop on the water. It was also fogged, unlike the primitive (`fog: false`), so
   * distant ripples washed out into the haze.
   */
  #ripple(x: number, z: number, strength = 1, now = performance.now()): void {
    const mesh = makeRipple();
    mesh.position.set(x, this.#waterLevel + 0.025, z);
    this.#root.add(mesh);
    this.#trackEffect({
      object: mesh,
      startedAt: now,
      endsAt: now + 2_400,
      update(progress) {
        mesh.scale.setScalar(strength * (0.5 + Math.sqrt(progress) * 2.6));
        materialOpacity(mesh, (1 - progress) * 0.55);
      },
    });
  }

  #splash(x: number, y: number, z: number, now = performance.now()): void {
    if (!this.#textures) {
      this.pulse(x, z, 0xd8f7ff, 0.9, 450, now);
      return;
    }
    const map = this.#textures.get(HD2D_SPLASH_TEXTURE_URL).clone();
    map.repeat.set(1 / 9, 1);
    map.offset.set(0, 0);
    map.needsUpdate = true;
    const material = new THREE.SpriteMaterial({
      map,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.center.set(0.5, 0.32);
    sprite.scale.set(1.7, 1.7, 1);
    sprite.position.set(x, y, z);
    sprite.renderOrder = 4;
    this.#root.add(sprite);
    const duration = (9 / 20) * 1_000;
    this.#trackEffect({
      object: sprite,
      startedAt: now,
      endsAt: now + duration,
      update(progress) {
        map.offset.x = Math.min(8, Math.floor(progress * 9)) / 9;
      },
      dispose() {
        sprite.removeFromParent();
        sprite.geometry.dispose();
        material.dispose();
        map.dispose();
      },
    });
  }

  /** Exact lab critter blast: the authored nine-frame, unlit sheet at 12 fps and 2.6 tiles high. */
  playSheepExplosion(x: number, z: number, now = performance.now()): void {
    if (!this.#textures) {
      this.pulse(x, z, 0xff9f45, 1.2, 750, now);
      return;
    }
    const billboard = makeBillboard(this.#scene.ctx, {
      texture: this.#textures.get(HD2D_SHEEP_EXPLOSION_TEXTURE_URL),
      cols: 9,
      rows: 1,
      height: 2.6,
      aspect: 1,
      foot: 0.3,
      lit: false,
    });
    billboard.placeAt(x, this.#groundY(x, z, 0), z);
    this.#root.add(billboard.mesh);
    const duration = (9 / 12) * 1_000;
    this.#trackEffect({
      object: billboard.mesh,
      startedAt: now,
      endsAt: now + duration,
      update(progress) {
        billboard.setFrame(Math.min(8, Math.floor(progress * 9)));
      },
      dispose() {
        billboard.mesh.removeFromParent();
        billboard.dispose();
      },
    });
  }

  #footprint(event: Extract<HeroEvent, { t: "trace" }>, hero: PlayerSnapshot, now: number): void {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.012, 0.4),
      transparentMaterial(0x536d78, 0.7),
    );
    mesh.position.set(event.x, this.#groundY(event.x, event.z, 0.025), event.z);
    mesh.rotation.y = -Math.atan2(hero.facing.z, hero.facing.x);
    this.#root.add(mesh);
    this.#trackEffect({
      object: mesh,
      startedAt: now,
      endsAt: now + 4_500,
      update(progress) {
        materialOpacity(mesh, 0.7 * (1 - progress));
      },
    });
  }

  #breath(hero: PlayerSnapshot, now: number): void {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 7),
      transparentMaterial(0xeaf8ff, 0.88),
    );
    puff.position.set(hero.x + hero.facing.x * 0.22, hero.y + 1.8, hero.z + hero.facing.z * 0.22);
    const startY = puff.position.y;
    this.#root.add(puff);
    this.#trackEffect({
      object: puff,
      startedAt: now,
      endsAt: now + 900,
      update(progress) {
        puff.position.y = startY + progress * 0.5;
        puff.scale.setScalar(1 + progress * 1.4);
        materialOpacity(puff, 0.88 * (1 - progress));
      },
    });
  }

  playHeroMovement(events: readonly HeroEvent[], hero: PlayerSnapshot | null): void {
    const now = performance.now();
    let skid = 0;
    for (const event of events) {
      if (event.t === "glisse") skid = Math.max(skid, event.intensite);
      else if (event.t === "trace" && hero) this.#footprint(event, hero, now);
      else if (event.t === "haleine" && hero) this.#breath(hero, now);
      // `brasse` is a SOUND, not a ripple. Ripples run on their own cadence in `syncLocalHero`
      // (550 ms, the lab's `ONDE_TOUTES_LES`); emitting one here as well put two overlapping
      // series on the water — the stroke's own ~850 ms beat on top of the timer's — which reads
      // as churn rather than as a swimmer.
      else if (event.t === "entree-eau" || event.t === "sortie-eau" || event.t === "noyade")
        this.#splash(event.x, event.y, event.z, now);
      else if (event.t === "reception" && hero)
        this.pulse(hero.x, hero.z, 0xd8c49c, Math.min(1.2, 0.45 + event.force * 0.04), 360, now);
    }
    // Sliding is RECORDED here and drawn in `update()`: the decal has to keep fading after the
    // hero stops sending events, and it must not reappear at full strength the frame a slide ends.
    const sliding = hero !== null && skid >= SKID_MIN_INTENSITY;
    if (sliding && hero) {
      this.#skidSince ??= now;
      this.#skidEndedAt = null;
      this.#skidIntensity = skid;
      // Placed only while sliding: a mark on the ground stays where it was scraped, it does not
      // follow the hero through the fade.
      this.#skid.position.set(
        hero.x - hero.facing.x * 0.38,
        this.#groundY(hero.x, hero.z, 0.035),
        hero.z - hero.facing.z * 0.38,
      );
      this.#skid.rotation.y = -Math.atan2(hero.facing.z, hero.facing.x);
      this.#skid.scale.x = 0.45 + skid * 0.9;
    } else if (this.#skidSince !== null) {
      this.#skidSince = null;
      this.#skidEndedAt = now;
      this.#skidFadeFrom = this.#skidAlpha;
    }
    this.#advanceSkid(now);
  }

  /**
   * The decal's whole visibility rule, in one place and driven by the clock rather than by whether
   * a frame happened to carry a `glisse` event.
   *
   * A slide that ends before the dwell elapses fades from the alpha it actually had, which is zero:
   * that is what stops the old flash from simply moving to the moment the key is released.
   */
  #advanceSkid(now: number): void {
    if (this.#skidSince !== null) {
      const dwelled = now - this.#skidSince - SKID_DWELL_MS;
      const target = 0.25 + this.#skidIntensity * 0.5;
      this.#skidAlpha = target * THREE.MathUtils.clamp(dwelled / SKID_FADE_MS, 0, 1);
    } else if (this.#skidEndedAt !== null) {
      const remaining = THREE.MathUtils.clamp(1 - (now - this.#skidEndedAt) / SKID_FADE_MS, 0, 1);
      this.#skidAlpha = this.#skidFadeFrom * remaining;
      if (remaining <= 0) this.#skidEndedAt = null;
    } else {
      this.#skidAlpha = 0;
    }
    this.#skid.visible = this.#skidAlpha > 0.01;
    if (this.#skid.visible) materialOpacity(this.#skid, this.#skidAlpha);
  }

  syncLocalHero(
    hero: PlayerSnapshot | null,
    movement: LocalMovementVisualState | null,
    now: number,
  ): void {
    this.#swimDisc.visible = hero?.swimming ?? false;
    if (hero?.swimming) {
      this.#swimDisc.position.set(hero.x, this.#waterLevel + 0.03, hero.z);
      if (now >= this.#nextRippleAt) {
        this.#ripple(hero.x, hero.z, 1, now);
        this.#nextRippleAt = now + 550;
      }
    } else this.#nextRippleAt = now;

    const maxBreath = movement?.maxBreath ?? 0;
    const showBreath = hero !== null && movement?.swimming === true && maxBreath > 0;
    this.#breathBar.visible = showBreath;
    if (showBreath && hero && movement) {
      const ratio = THREE.MathUtils.clamp(movement.breath / maxBreath, 0, 1);
      this.#breathBar.position.set(hero.x, Math.max(hero.y, this.#waterLevel) + 1.82, hero.z);
      this.#breathBar.rotation.y = this.#scene.ctx.yaw();
      this.#breathFill.scale.x = Math.max(0.001, ratio);
      this.#breathFill.position.x = -(1 - ratio) * 0.47;
      const material = this.#breathFill.material as THREE.MeshBasicMaterial;
      material.color.setHex(ratio <= 0.25 ? 0xf06b5d : ratio <= 0.5 ? 0xf2bd56 : 0x73ddf2);
    }
  }

  /** Keeps a restrained gold aura attached to every hero whose authoritative power buff is live. */
  syncPowerBuffs(
    buffs: readonly { id: string; x: number; z: number; endsAt: number }[],
    now: number,
  ): void {
    const present = new Set<string>();
    for (const buff of buffs) {
      if (buff.endsAt <= now) continue;
      present.add(buff.id);
      let entry = this.#powerBuffs.get(buff.id);
      if (!entry) {
        const object = new THREE.Group();
        const inner = new THREE.Mesh(
          new THREE.RingGeometry(0.34, 0.41, 40),
          transparentMaterial(0xffd66b, 0.26),
        );
        const outer = new THREE.Mesh(
          new THREE.RingGeometry(0.53, 0.57, 40),
          transparentMaterial(0xffedaa, 0.13),
        );
        inner.rotation.x = -Math.PI / 2;
        outer.rotation.x = -Math.PI / 2;
        object.add(inner, outer);
        this.#root.add(object);
        entry = { object, phase: phaseFor(buff.id) };
        this.#powerBuffs.set(buff.id, entry);
      }
      entry.object.position.set(buff.x, this.#groundY(buff.x, buff.z, 0.045), buff.z);
      const pulse = 1 + Math.sin(now / 320 + entry.phase) * 0.08;
      entry.object.scale.setScalar(pulse);
      materialOpacity(entry.object, Math.min(0.28, Math.max(0.08, (buff.endsAt - now) / 700)));
    }
    for (const [id, entry] of this.#powerBuffs) {
      if (present.has(id)) continue;
      disposeObject(entry.object);
      this.#powerBuffs.delete(id);
    }
  }

  /** Soft green body glow attached only while the server confirms camp-zone membership. */
  syncHealingAuras(
    auras: readonly { id: string; x: number; z: number; endsAt: number }[],
    now: number,
  ): void {
    const present = new Set<string>();
    for (const aura of auras) {
      if (aura.endsAt <= now) continue;
      present.add(aura.id);
      let entry = this.#healingAuras.get(aura.id);
      if (!entry) {
        const object = new THREE.Group();
        const glow = new THREE.Mesh(
          new THREE.SphereGeometry(0.42, 16, 10),
          new THREE.MeshBasicMaterial({
            color: 0x8fffb0,
            transparent: true,
            opacity: 0.14,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
        );
        glow.scale.y = 1.55;
        object.add(glow);
        this.#root.add(object);
        entry = { object, phase: phaseFor(`heal:${aura.id}`) };
        this.#healingAuras.set(aura.id, entry);
      }
      entry.object.position.set(aura.x, this.#groundY(aura.x, aura.z, 0.62), aura.z);
      entry.object.scale.setScalar(1 + Math.sin(now / 460 + entry.phase) * 0.045);
      materialOpacity(entry.object, Math.min(0.2, Math.max(0.06, (aura.endsAt - now) / 500)));
    }
    for (const [id, entry] of this.#healingAuras) {
      if (present.has(id)) continue;
      disposeObject(entry.object);
      this.#healingAuras.delete(id);
    }
  }

  setMerchant(merchant: MerchantDefinition | null): void {
    if (this.#merchant) disposeObject(this.#merchant);
    this.#merchant = null;
    if (!merchant) return;
    const marker = new THREE.Mesh(
      new THREE.TorusGeometry(0.46, 0.09, 10, 32),
      transparentMaterial(0xf5c451),
    );
    marker.rotation.x = Math.PI / 2;
    marker.position.set(merchant.x, this.#groundY(merchant.x, merchant.y, 0.72), merchant.y);
    this.#root.add(marker);
    this.#merchant = marker;
  }

  showCamp(camp: PeasantCampVisual, endsAt: number): boolean {
    const current = this.#camps.get(camp.id);
    if (current && current.startedAt === camp.startedAt && current.expiresAt === camp.expiresAt) {
      current.endsAt = endsAt;
      return false;
    }
    this.removeCamp(camp.id);
    const group = new THREE.Group();
    let billboard: Billboard | null = null;
    if (this.#textures) {
      billboard = makeBillboard(this.#scene.ctx, {
        texture: this.#textures.get(PEASANT_CAMP_ART.source),
        height: (PEASANT_CAMP_ART.frameHeight / 192) * 2.6 * (PEASANT_CAMP_ART.scale ?? 1),
        aspect: PEASANT_CAMP_ART.frameWidth / PEASANT_CAMP_ART.frameHeight,
        foot: PEASANT_CAMP_ART.anchor.y,
        pitch: HD2D_CAMERA.pitch,
      });
      billboard.placeAt(0, 0, 0);
      group.add(billboard.mesh);
    }
    group.position.set(camp.x, this.#groundY(camp.x, camp.z, 0.02), camp.z);
    this.#root.add(group);
    this.#camps.set(camp.id, {
      object: group,
      billboard,
      endsAt,
      startedAt: camp.startedAt,
      expiresAt: camp.expiresAt,
    });
    return true;
  }

  showRation(
    ration: PeasantRationVisual,
    launchedAt: number,
    landsAt: number,
    fadeAt: number,
    endsAt: number,
  ): boolean {
    const current = this.#rations.get(ration.id);
    if (current) {
      current.fadeAt = fadeAt;
      current.endsAt = endsAt;
      return false;
    }
    const object = new THREE.Group();
    let billboard: Billboard | null = null;
    if (this.#textures) {
      billboard = makeBillboard(this.#scene.ctx, {
        texture: this.#textures.get(PEASANT_RATION_ART.source),
        height: (PEASANT_RATION_ART.frameHeight / 192) * 2.6 * (PEASANT_RATION_ART.scale ?? 1),
        aspect: PEASANT_RATION_ART.frameWidth / PEASANT_RATION_ART.frameHeight,
        foot: 0.28,
        // UI-like food needs to remain readable under every map mood; lighting previously made
        // this tiny sprite nearly black at night even though the authoritative ration existed.
        lit: false,
        pitch: HD2D_CAMERA.pitch,
      });
      billboard.placeAt(0, 0, 0);
      object.add(billboard.mesh);
    }
    object.position.set(ration.originX, ration.originY + 0.08, ration.originZ);
    this.#root.add(object);
    this.#rations.set(ration.id, {
      object,
      billboard,
      ration,
      launchedAt,
      landsAt,
      fadeAt,
      endsAt,
    });
    return true;
  }

  removeRation(id: string): void {
    const entry = this.#rations.get(id);
    if (!entry) return;
    if (entry.billboard) {
      entry.object.remove(entry.billboard.mesh);
      entry.billboard.dispose();
    }
    disposeObject(entry.object);
    this.#rations.delete(id);
  }

  #updateRations(now: number): void {
    for (const [id, entry] of this.#rations) {
      if (now >= entry.endsAt) {
        this.removeRation(id);
        continue;
      }
      const flightDuration = Math.max(1, entry.landsAt - entry.launchedAt);
      const progress = THREE.MathUtils.clamp((now - entry.launchedAt) / flightDuration, 0, 1);
      const x = THREE.MathUtils.lerp(entry.ration.originX, entry.ration.x, progress);
      const baseY = THREE.MathUtils.lerp(entry.ration.originY, entry.ration.y, progress);
      const z = THREE.MathUtils.lerp(entry.ration.originZ, entry.ration.z, progress);
      const landed = now >= entry.landsAt;
      const y = landed
        ? entry.ration.y + 0.08 + Math.sin(now / 280 + phaseFor(id)) * 0.035
        : baseY + 0.08 + Math.sin(progress * Math.PI) * PEASANT_RATION_ARC_HEIGHT;
      entry.object.position.set(x, y, z);
      const opacity =
        now <= entry.fadeAt
          ? 1
          : THREE.MathUtils.clamp(
              (entry.endsAt - now) / Math.max(1, entry.endsAt - entry.fadeAt),
              0,
              1,
            );
      materialOpacity(entry.object, opacity);
      if (entry.billboard) entry.billboard.mesh.rotation.z = landed ? 0 : progress * Math.PI * 4;
    }
  }

  removeCamp(id: string): void {
    const camp = this.#camps.get(id);
    if (!camp) return;
    if (camp.billboard) {
      camp.object.remove(camp.billboard.mesh);
      camp.billboard.dispose();
    }
    disposeObject(camp.object);
    this.#camps.delete(id);
  }

  setAim(origin: GroundVector, direction: GroundVector, range: number): void {
    this.hideAim();
    const to = { x: origin.x + direction.x * range, z: origin.z + direction.z * range };
    const dx = to.x - origin.x;
    const dz = to.z - origin.z;
    const length = Math.max(0.01, Math.hypot(dx, dz));
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.025, 0.08),
      transparentMaterial(0xffd45c, 0.8),
    );
    const x = (origin.x + to.x) / 2;
    const z = (origin.z + to.z) / 2;
    mesh.position.set(x, this.#groundY(x, z, 0.08), z);
    mesh.rotation.y = -Math.atan2(dz, dx);
    this.#root.add(mesh);
    this.#aim = mesh;
  }

  hideAim(): void {
    if (!this.#aim) return;
    disposeObject(this.#aim);
    this.#aim = null;
  }

  setQuestMarkers(markers: readonly AuthoredQuestMarker[]): void {
    this.#questState = markers;
    this.#questVisualKey = "";
    this.#rebuildQuestMarkers();
  }

  hideQuestSite(id: string, durationMs: number): void {
    this.#hiddenQuestSites.set(id, performance.now() + Math.max(0, durationMs));
    this.#questVisualKey = "";
    const marker = this.#questMarkers.get(id);
    if (!marker) return;
    disposeObject(marker);
    this.#questMarkers.delete(id);
  }

  #rebuildQuestMarkers(): void {
    for (const marker of this.#questMarkers.values()) disposeObject(marker);
    this.#questMarkers.clear();
    const eventById = new Map(this.#events.map((event) => [event.id, event]));
    const colors = { available: 0xf2d14f, active: 0x62aaf7, ready: 0x5de28a } as const;
    for (const marker of this.#questState) {
      if ((this.#hiddenQuestSites.get(marker.eventId) ?? 0) > performance.now()) continue;
      const event = eventById.get(marker.eventId);
      if (!event) continue;
      const x = event.col + 0.5 - this.#size / 2;
      const z = event.row + 0.5 - this.#size / 2;
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.22),
        transparentMaterial(colors[marker.kind]),
      );
      mesh.position.set(x, this.#groundY(x, z, 1.55), z);
      this.#root.add(mesh);
      this.#questMarkers.set(marker.eventId, mesh);
    }
  }

  sync(sample: SceneSample, now: number): void {
    this.#events = sample.events;
    this.#syncLoot(sample, now);
    this.#syncProjectiles(sample, now);
    this.#syncEventMarkers(sample.events);
    this.#updateRations(now);
    const eventById = new Map(sample.events.map((event) => [event.id, event]));
    const questVisualKey = this.#questState
      .map((marker) => {
        const event = eventById.get(marker.eventId);
        return `${marker.eventId}:${marker.kind}:${event?.col ?? ""}:${event?.row ?? ""}`;
      })
      .join("|");
    if (questVisualKey !== this.#questVisualKey) {
      this.#questVisualKey = questVisualKey;
      this.#rebuildQuestMarkers();
    }
    this.update(now);
  }

  #syncLoot(sample: SceneSample, now: number): void {
    const present = new Set<string>();
    for (const loot of sample.loot) {
      present.add(loot.id);
      let entry = this.#loot.get(loot.id);
      if (entry && entry.kind !== loot.kind) {
        this.#dropLoot(entry);
        this.#loot.delete(loot.id);
        entry = undefined;
      }
      if (!entry) {
        entry = this.#createLoot(loot);
        this.#loot.set(loot.id, entry);
      }
      const bob = Math.sin(now / 360 + entry.phase) * 0.08;
      entry.object.position.set(loot.x, loot.y + 0.48 + bob, loot.z);
      const glow = entry.object.userData.glow;
      if (glow instanceof THREE.Object3D) {
        const pulse = 0.92 + Math.sin(now / 280 + entry.phase) * 0.12;
        glow.scale.setScalar(pulse);
      }
    }
    for (const [id, entry] of this.#loot) {
      if (present.has(id)) continue;
      this.#dropLoot(entry);
      this.#loot.delete(id);
    }
  }

  #createLoot(loot: LootSnapshot): LootEntry {
    const object = new THREE.Group();
    const color = colorFromText(loot.kind);
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.34, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -0.4;
    object.add(glow);
    object.userData.glow = glow;

    let billboard: Billboard | null = null;
    if (this.#textures) {
      const frame = LOOT_ATLAS_FRAMES[loot.kind];
      billboard = makeBillboard(this.#scene.ctx, {
        texture: this.#textures.get(CHARACTER_ATLAS_URL),
        height: 0.72,
        aspect: frame.width / frame.height,
        foot: 0.5,
        lit: false,
        pitch: HD2D_CAMERA.pitch,
        uvRect: {
          offsetX: frame.x / CHARACTER_ATLAS_SIZE.width,
          offsetY: 1 - (frame.y + frame.height) / CHARACTER_ATLAS_SIZE.height,
          repeatX: frame.width / CHARACTER_ATLAS_SIZE.width,
          repeatY: frame.height / CHARACTER_ATLAS_SIZE.height,
        },
      });
      billboard.placeAt(0, 0, 0);
      object.add(billboard.mesh);
    }
    this.#root.add(object);
    return { object, billboard, kind: loot.kind, phase: phaseFor(loot.id) };
  }

  #dropLoot(entry: LootEntry): void {
    if (entry.billboard) {
      entry.object.remove(entry.billboard.mesh);
      entry.billboard.dispose();
    }
    disposeObject(entry.object);
  }

  #syncProjectiles(sample: SceneSample, now: number): void {
    const present = new Set<string>();
    for (const projectile of sample.projectiles) {
      present.add(projectile.id);
      let entry = this.#projectiles.get(projectile.id);
      if (entry && (entry.kind !== projectile.kind || entry.color !== projectile.color)) {
        this.#dropProjectile(entry);
        this.#projectiles.delete(projectile.id);
        entry = undefined;
      }
      if (!entry) {
        entry = this.#createProjectile(projectile, now);
        this.#projectiles.set(projectile.id, entry);
      }
      const angle =
        projectileBillboardAngle(
          projectile.direction,
          this.#scene.ctx.yaw(),
          this.#scene.ctx.pitch() ?? HD2D_CAMERA.pitch,
        ) + entry.art.rotationOffset;
      const terrainY = this.#scene.query.heightAt(projectile.x, projectile.z);
      entry.object.position.set(
        projectile.x,
        Math.max(projectile.y, terrainY ?? projectile.y) +
          projectileVisualLift(
            entry.art.frameWidth,
            entry.art.frameHeight,
            entry.art.scale ?? 1,
            angle,
            entry.art.trail?.length ?? 0,
          ),
        projectile.z,
      );
      if (entry.billboard) {
        entry.billboard.setFrame(
          projectileFrameIndex(entry.art.frames, entry.art.durationMs, now - entry.createdAt),
        );
        entry.billboard.mesh.rotation.z = angle;
      }
    }
    for (const [id, entry] of this.#projectiles) {
      if (present.has(id)) continue;
      this.#dropProjectile(entry);
      this.#projectiles.delete(id);
    }
  }

  #createProjectile(projectile: ProjectileSnapshot, now: number): ProjectileEntry {
    const art = projectileArt(projectile.kind, projectile.color);
    const object = new THREE.Group();
    let billboard: Billboard | null = null;
    let trail: THREE.Object3D | null = null;
    if (this.#textures) {
      const height = Math.max(0.42, (art.frameHeight / 192) * 2.6 * (art.scale ?? 1));
      billboard = makeBillboard(this.#scene.ctx, {
        texture: this.#textures.get(art.source),
        cols: art.frames,
        rows: 1,
        height,
        aspect: art.frameWidth / art.frameHeight,
        foot: PROJECTILE_BILLBOARD_FOOT,
        lit: false,
        pitch: HD2D_CAMERA.pitch,
      });
      centerProjectileGeometry(billboard.mesh.geometry);
      const material = billboard.mesh.material;
      if (material instanceof THREE.MeshBasicMaterial) {
        material.color.setHex(art.tint ?? 0xffffff);
        material.transparent = true;
        material.depthWrite = false;
      }
      billboard.placeAt(0, 0, 0);
      object.add(billboard.mesh);
      if (art.trail) {
        trail = this.#projectileTrail(art.trail);
        billboard.mesh.add(trail);
      }
    }
    this.#root.add(object);
    return {
      object,
      billboard,
      trail,
      kind: projectile.kind,
      color: projectile.color,
      art,
      createdAt: now,
    };
  }

  #projectileTrail(trail: NonNullable<CombatProjectileArt["trail"]>): THREE.Group {
    const group = new THREE.Group();
    const length = Math.max(0.08, trail.length / 64);
    const width = Math.max(0.025, trail.width / 64);
    for (const [scale, opacity] of [
      [2.4, 0.16],
      [1, 0.82],
    ] as const) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(length, width * scale),
        new THREE.MeshBasicMaterial({
          color: trail.color,
          transparent: true,
          opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      mesh.position.x = -length / 2;
      mesh.position.z = 0.002 * scale;
      group.add(mesh);
    }
    return group;
  }

  #dropProjectile(entry: ProjectileEntry): void {
    if (entry.trail) {
      entry.billboard?.mesh.remove(entry.trail);
      disposeObject(entry.trail);
    }
    if (entry.billboard) {
      entry.object.remove(entry.billboard.mesh);
      entry.billboard.dispose();
    }
    disposeObject(entry.object);
  }

  /**
   * One mote, as pixel data rather than a drawn canvas: a 2D context is not guaranteed outside a
   * browser, and this layer is constructed in jsdom by the renderer suite. A radial falloff raised
   * to the fourth power gives a small hot centre with a soft edge, which is what reads as a speck
   * of light instead of a disc.
   */
  #dustTexture(): THREE.DataTexture {
    if (this.#moteTexture) return this.#moteTexture;
    const size = MOTE_TEXTURE_SIZE;
    const data = new Uint8Array(size * size * 4);
    const centre = (size - 1) / 2;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = (x - centre) / centre;
        const dy = (y - centre) / centre;
        const falloff = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
        const alpha = falloff * falloff * falloff * falloff;
        const index = (y * size + x) * 4;
        data[index] = 255;
        data[index + 1] = 255;
        data[index + 2] = 255;
        data[index + 3] = Math.round(alpha * 255);
      }
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.needsUpdate = true;
    this.#moteTexture = texture;
    return texture;
  }

  /**
   * The halo's annulus, as pixel data for the same reason `#dustTexture` is: no 2D context is
   * guaranteed here. A gaussian ring peaking where the motes orbit, over a faint fill that lifts
   * the middle just enough to read as one mark rather than as a hoop, and hard zero past the
   * inscribed circle so the quad's corners never show.
   */
  #haloAnnulusTexture(): THREE.DataTexture {
    if (this.#haloTexture) return this.#haloTexture;
    const size = HALO_TEXTURE_SIZE;
    const data = new Uint8Array(size * size * 4);
    const centre = (size - 1) / 2;
    // The motes orbit at `EVENT_MARKER_RADIUS` tiles and the quad is `EVENT_MARKER_HALO_TILES`
    // across, so the ring belongs at that fraction of the quad's half-extent.
    const peak = EVENT_MARKER_RADIUS / (EVENT_MARKER_HALO_TILES / 2);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = (x - centre) / centre;
        const dy = (y - centre) / centre;
        const radius = Math.sqrt(dx * dx + dy * dy);
        // Width and fill were picked against a render of this exact profile over grass, squashed
        // to the camera's own 38 degrees: wider than this and the halo reads as a yellow blob,
        // narrower and it stops carrying the shape the motes are too sparse to draw.
        const ring = Math.exp(-(((radius - peak) / 0.26) ** 2));
        const fill = Math.max(0, 1 - radius / peak) * 0.14;
        const alpha = radius > 1 ? 0 : Math.min(1, ring + fill);
        const index = (y * size + x) * 4;
        data[index] = 255;
        data[index + 1] = 255;
        data[index + 2] = 255;
        data[index + 3] = Math.round(alpha * 255);
      }
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.needsUpdate = true;
    this.#haloTexture = texture;
    return texture;
  }

  /** The halo quad, laid flat once IN THE GEOMETRY so every marker can share the same buffers:
   *  a per-mesh `rotation.x` would be undone by the spin the group carries. */
  #eventMarkerHalo(): THREE.Mesh {
    if (!this.#haloGeometry) {
      const geometry = new THREE.PlaneGeometry(EVENT_MARKER_HALO_TILES, EVENT_MARKER_HALO_TILES);
      geometry.rotateX(-Math.PI / 2);
      this.#haloGeometry = geometry;
    }
    this.#haloMaterial ??= new THREE.MeshBasicMaterial({
      map: this.#haloAnnulusTexture(),
      color: EVENT_MARKER_HALO_GOLD,
      transparent: true,
      opacity: EVENT_MARKER_HALO_OPACITY,
      depthWrite: false,
      toneMapped: false,
    });
    return new THREE.Mesh(this.#haloGeometry, this.#haloMaterial);
  }

  /**
   * The dust ring itself. Every mote's position, height and brightness is BAKED into the shared
   * geometry from its index, so the ring is varied without being random: the same marker draws the
   * same dust in every session, and animating it costs one rotation per frame rather than a buffer
   * rewrite. `sizeAttenuation` keeps a mote a speck at distance instead of a growing blob.
   */
  #eventMarkerDust(): THREE.Points {
    if (!this.#moteGeometry) {
      const positions = new Float32Array(EVENT_MARKER_MOTES * 3);
      const colors = new Float32Array(EVENT_MARKER_MOTES * 3);
      for (let mote = 0; mote < EVENT_MARKER_MOTES; mote += 1) {
        const angle = (mote / EVENT_MARKER_MOTES) * Math.PI * 2;
        // An irrational step per mote: neighbouring motes never share a wobble, and the ring never
        // resolves into a visible pattern the way `mote % 3` would.
        const wobble = Math.sin(mote * 2.399963);
        const radius = EVENT_MARKER_RADIUS + wobble * 0.035;
        const warmth = 0.7 + Math.abs(wobble) * 0.3;
        positions[mote * 3] = Math.cos(angle) * radius;
        positions[mote * 3 + 1] = 0.03 + Math.abs(wobble) * 0.1;
        positions[mote * 3 + 2] = Math.sin(angle) * radius;
        colors[mote * 3] = EVENT_MARKER_GOLD.r * warmth;
        colors[mote * 3 + 1] = EVENT_MARKER_GOLD.g * warmth;
        colors[mote * 3 + 2] = EVENT_MARKER_GOLD.b * warmth;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      this.#moteGeometry = geometry;
    }
    if (!this.#moteMaterial) {
      this.#moteMaterial = new THREE.PointsMaterial({
        size: MOTE_SIZE,
        map: this.#dustTexture(),
        transparent: true,
        depthWrite: false,
        // Additive is what makes dust read as LIGHT on ground it is lying over. It is also why the
        // gold is mixed under 1.0 in blue: at full white the sum washes out to a grey smear.
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        sizeAttenuation: true,
        toneMapped: false,
        opacity: 1,
      });
    }
    return new THREE.Points(this.#moteGeometry, this.#moteMaterial);
  }

  #syncEventMarkers(events: readonly WorldEventSnapshot[]): void {
    const present = new Set<string>();
    for (const event of events) {
      const needsMarker =
        event.showMarker !== false &&
        !event.harvest &&
        (event.presentation !== "native" || event.graphicAssetId === null);
      if (!needsMarker) continue;
      present.add(event.id);
      let object = this.#eventMarkers.get(event.id);
      if (!object) {
        // Halo first so the motes draw over it, both on shared buffers: a marker costs one group
        // and two transforms, never a buffer of its own.
        object = new THREE.Group();
        object.name = "event-marker";
        object.add(this.#eventMarkerHalo(), this.#eventMarkerDust());
        this.#root.add(object);
        this.#eventMarkers.set(event.id, object);
      }
      const x = event.col + 0.5 - this.#size / 2;
      const z = event.row + 0.5 - this.#size / 2;
      object.position.set(x, this.#groundY(x, z, 0.06), z);
    }
    for (const [id, object] of this.#eventMarkers) {
      if (present.has(id)) continue;
      // Detach only. The geometry, material and texture are SHARED by every marker and freed once
      // in `dispose()`; `disposeObject` here would free them out from under the survivors.
      object.removeFromParent();
      this.#eventMarkers.delete(id);
    }
  }

  showWorldEvent(
    text: string,
    tone: "info" | "good" | "bad",
    x: number,
    z: number,
    now = performance.now(),
  ): void {
    if (typeof document === "undefined") return;
    const element = document.createElement("div");
    element.textContent = text;
    element.dataset.tone = tone;
    Object.assign(element.style, {
      position: "fixed",
      zIndex: "40",
      pointerEvents: "none",
      transform: "translate(-50%, -100%)",
      color: tone === "bad" ? "#ff8b77" : tone === "good" ? "#8ff0ad" : "#f8e6b4",
      fontFamily: '"Alegreya Sans SC", sans-serif',
      fontWeight: "800",
      fontSize: "15px",
      textShadow: "0 2px 3px #142019, 0 0 8px #142019",
      whiteSpace: "nowrap",
    });
    document.body.append(element);
    this.#labels.push({
      element,
      point: new THREE.Vector3(x, this.#groundY(x, z, 1.4), z),
      endsAt: now + 1500,
    });
  }

  screenToWorld(clientX: number, clientY: number): GroundVector | null {
    const rect = this.#canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.#scene.camera.updateMatrixWorld();
    this.#raycaster.setFromCamera(ndc, this.#scene.camera);
    const point = this.#scene.pickGround(this.#raycaster);
    if (!point) return null;
    const half = this.#size / 2;
    if (point.x < -half || point.x > half || point.z < -half || point.z > half) {
      return null;
    }
    return point;
  }

  /** Builds the editor grid's `LineSegments` for the given overlay dimensions. Split out of
   *  `setEditorOverlay` so it can be cached rather than rebuilt on every hover — see `#gridLines`. */
  #buildEditorGrid(overlay: Hd2dEditorOverlay, half: number, lift: number): THREE.LineSegments {
    const positions: number[] = [];
    const point = (x: number, z: number): void => {
      positions.push(x, this.#groundY(x, z, lift), z);
    };
    for (let col = 0; col <= overlay.cols; col += 1) {
      const x = col - half;
      for (let row = 0; row < overlay.rows; row += 1) {
        point(x, row - half);
        point(x, row + 1 - half);
      }
    }
    for (let row = 0; row <= overlay.rows; row += 1) {
      const z = row - half;
      for (let col = 0; col < overlay.cols; col += 1) {
        point(col - half, z);
        point(col + 1 - half, z);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: overlay.dim ? 0x9fc4c0 : 0xdce8cb,
      transparent: true,
      opacity: overlay.dim ? 0.5 : 0.3,
      depthWrite: false,
      toneMapped: false,
    });
    return new THREE.LineSegments(geometry, material);
  }

  /** The hero start marker: the ghost knight, and nothing else. The knight is the same catalogue
   *  warrior sheet the palette itself draws with (`EDITOR_SPAWN_KNIGHT_ASSET_ID` in
   *  `game-renderer.ts`), held translucent so it reads as a mark on the map rather than a placed
   *  unit: the stage already refuses to select or delete this group (`map-editor-stage.ts`,
   *  `kind: "spawn"`), and the art must agree with that.
   *
   *  A pulsing green ring used to sit under it, and it was removed on the author's report that the
   *  knight alone already says "the hero starts here" (feedback #23). The ring was also what showed
   *  FIRST while the knight's texture was still in flight, so removing it moved that job upstream:
   *  `Hd2dRenderer.setEditorOverlay` now starts the one-shot load on the first editor overlay of
   *  any kind rather than on the first one carrying a spawn, so the art is already cached by the
   *  time an author places or selects the start. */
  #buildSpawnMarker(): THREE.Group {
    const group = new THREE.Group();
    group.name = "editor-spawn";
    this.#attachSpawnKnight(group);
    return group;
  }

  /** (Re)builds the knight billboard from the currently cached art, or clears it when there is
   *  none. Called both once the async load resolves (`setSpawnKnightArt`) and from
   *  `#buildSpawnMarker()` in case the art already arrived before the marker was first drawn —
   *  loading and drawing race each other and either may finish first. */
  #attachSpawnKnight(group: THREE.Group): void {
    this.#clearSpawnKnight();
    const art = this.#spawnKnightArt;
    if (!art) return;
    const billboard = makeBillboard(this.#scene.ctx, {
      texture: art.texture,
      cols: art.cols ?? 1,
      rows: art.rows ?? 1,
      height: art.height,
      aspect: art.aspect ?? 1,
      foot: art.foot ?? 0,
      lit: false,
      pitch: HD2D_CAMERA.pitch,
    });
    billboard.mesh.name = "editor-spawn-knight";
    billboard.placeAt(0, 0, 0);
    materialOpacity(billboard.mesh, 0.5);
    group.add(billboard.mesh);
    this.#spawnKnight = billboard;
  }

  /** `disposeObject`'s generic traversal frees a `Billboard`'s mesh geometry/material, but not its
   *  registration in the scene context's yaw registry — only `Billboard.dispose()` does that (see
   *  `hd2d/billboard.ts`'s `finishBillboard`), so the knight needs this explicit teardown wherever
   *  it is dropped or replaced, not just a generic sweep. */
  #clearSpawnKnight(): void {
    if (!this.#spawnKnight) return;
    this.#spawnKnight.mesh.removeFromParent();
    this.#spawnKnight.dispose();
    this.#spawnKnight = null;
  }

  /** Attaches the marker's knight once its texture has resolved. `Hd2dRenderer` owns the async
   *  load, through the same catalogue machinery every static asset uses (`staticAssetSpec` ->
   *  `staticSpecUrls` -> `fetchAll` -> `createTextureRegistry` -> `materializeStaticSpec`) — this
   *  layer only ever receives the resolved `StaticSpriteArt`, exactly like `setEditorPreviewArt`.
   *  Safe to call before the marker group exists: the art is cached and applied the next time
   *  `#buildSpawnMarker()` runs. */
  setSpawnKnightArt(art: StaticSpriteArt | null): void {
    this.#spawnKnightArt = art;
    if (this.#spawnMarker) this.#attachSpawnKnight(this.#spawnMarker);
  }

  setEditorOverlay(overlay: Hd2dEditorOverlay | null): void {
    this.#editorOverlay = overlay;
    // Detached BEFORE the clear loop so `disposeObject` does not tear down the cached grid along
    // with everything else the overlay redraws every time.
    if (this.#gridLines) this.#gridLines.removeFromParent();
    if (this.#spawnMarker) this.#spawnMarker.removeFromParent();
    for (const child of [...this.#editorRoot.children]) disposeObject(child);
    this.#editorRoot.clear();
    if (!overlay) {
      this.#positionEditorPreview();
      return;
    }

    const half = this.#size / 2;
    const lift = overlay.dim ? 0.085 : 0.06;
    if (overlay.showGrid) {
      // The grid is by far the heaviest overlay child — a 256×256 canvas is ~263k vertices, each
      // with a `#groundY` terrain lookup — and this runs on every hover. Rebuild only when its
      // inputs actually change; `#gridKey` also resets whenever the constructor learns of a fresh
      // terrain, so a cached grid can never survive onto a map it does not hug.
      const key = `${overlay.cols}:${overlay.rows}:${overlay.dim}:${this.#size}`;
      if (!this.#gridLines || this.#gridKey !== key) {
        if (this.#gridLines) disposeObject(this.#gridLines);
        this.#gridLines = this.#buildEditorGrid(overlay, half, lift);
        this.#gridKey = key;
      }
      this.#editorRoot.add(this.#gridLines);
    }

    if (overlay.showCollisions) {
      for (const collider of overlay.colliders) {
        const x = collider.x + collider.w / 2;
        const z = collider.z + collider.h / 2;
        const platformTop = collider.top;
        const platform = platformTop !== undefined;
        const material = transparentMaterial(
          platform ? 0x36e0a0 : 0xd84b3e,
          platform ? 0.52 : 0.38,
        );
        if (platform) material.depthTest = false;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(collider.w, collider.h), material);
        mesh.name = platform ? "editor-walkable-platform" : "editor-solid-collision";
        mesh.renderOrder = platform ? 31 : 30;
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.z = -(collider.rotation ?? 0);
        mesh.position.set(
          x,
          platformTop !== undefined ? platformTop + 0.1 : this.#groundY(x, z, 0.1),
          z,
        );
        this.#editorRoot.add(mesh);
      }
    }

    if (overlay.saveRect) {
      const rect = overlay.saveRect;
      const positions: number[] = [];
      const point = (x: number, z: number): void => {
        positions.push(x, this.#groundY(x, z, lift + 0.04), z);
      };
      // One segment per cell, like the grid, so the outline follows the terrain instead of
      // clipping through cliffs.
      for (let col = 0; col < rect.cols; col += 1) {
        point(rect.x + col, rect.z);
        point(rect.x + col + 1, rect.z);
        point(rect.x + col, rect.z + rect.rows);
        point(rect.x + col + 1, rect.z + rect.rows);
      }
      for (let row = 0; row < rect.rows; row += 1) {
        point(rect.x, rect.z + row);
        point(rect.x, rect.z + row + 1);
        point(rect.x + rect.cols, rect.z + row);
        point(rect.x + rect.cols, rect.z + row + 1);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const material = new THREE.LineBasicMaterial({
        color: 0x57d6ff,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        toneMapped: false,
      });
      this.#editorRoot.add(new THREE.LineSegments(geometry, material));
    }

    if (overlay.spawn) {
      this.#spawnMarker ??= this.#buildSpawnMarker();
      const { x, z } = overlay.spawn;
      this.#spawnMarker.position.set(x, this.#groundY(x, z, lift + 0.02), z);
      this.#editorRoot.add(this.#spawnMarker);
    }

    // One cell unless the caller says otherwise — element mode marks a quarter cell, which is the
    // unit it actually places on.
    const cursorCells = overlay.cursorCells ?? 1;
    const addCursor = (point: GroundVector, color: number, lift: number): void => {
      const ring = new THREE.Mesh(
        editorCursorGeometry(cursorCells),
        transparentMaterial(color, 0.92),
      );
      ring.rotation.set(-Math.PI / 2, 0, 0);
      ring.position.set(point.x, this.#groundY(point.x, point.z, lift), point.z);
      this.#editorRoot.add(ring);
    };
    // Both trace the same cell now, so the selection is separated by colour and by drawing just
    // above the hover rather than by being oversized.
    if (overlay.hover) addCursor(overlay.hover, 0xffd66b, 0.13);
    if (overlay.selection) addCursor(overlay.selection, 0x57d6ff, 0.135);
    if (overlay.elementRotation) {
      const rotation = overlay.elementRotation;
      const group = new THREE.Group();
      group.name = "editor-element-rotation";
      const lineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(
          rotation.anchor.x,
          this.#groundY(rotation.anchor.x, rotation.anchor.z, 0.23),
          rotation.anchor.z,
        ),
        new THREE.Vector3(
          rotation.handle.x,
          this.#groundY(rotation.handle.x, rotation.handle.z, 0.23),
          rotation.handle.z,
        ),
      ]);
      const color = rotation.valid ? 0xd46cff : 0xef5350;
      const line = new THREE.Line(
        lineGeometry,
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.95,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      line.name = "editor-element-rotation-arm";
      line.renderOrder = 44;
      group.add(line);
      const highlighted = rotation.hovered || rotation.active;
      const handle = new THREE.Mesh(
        new THREE.RingGeometry(highlighted ? 0.12 : 0.1, highlighted ? 0.28 : 0.23, 28),
        transparentMaterial(color, highlighted ? 1 : 0.92),
      );
      handle.name = "editor-element-rotation-handle";
      handle.rotation.x = -Math.PI / 2;
      handle.position.set(
        rotation.handle.x,
        this.#groundY(rotation.handle.x, rotation.handle.z, 0.235),
        rotation.handle.z,
      );
      handle.renderOrder = 45;
      (handle.material as THREE.MeshBasicMaterial).depthTest = false;
      group.add(handle);
      this.#editorRoot.add(group);
    }
    if (overlay.buildingResize) {
      const resize = overlay.buildingResize;
      const group = new THREE.Group();
      group.name = "editor-building-resize";
      const positions: number[] = [];
      for (let index = 0; index < resize.outline.length; index += 1) {
        const from = resize.outline[index];
        const to = resize.outline[(index + 1) % resize.outline.length];
        if (!from || !to) continue;
        positions.push(
          from.x,
          this.#groundY(from.x, from.z, 0.19),
          from.z,
          to.x,
          this.#groundY(to.x, to.z, 0.19),
          to.z,
        );
      }
      const outlineGeometry = new THREE.BufferGeometry();
      outlineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const outlineMaterial = new THREE.LineBasicMaterial({
        color: resize.valid ? 0x7de7ff : 0xef5350,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      const outline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
      outline.name = "editor-building-resize-outline";
      outline.renderOrder = 42;
      group.add(outline);

      const addHandle = (point: GroundVector, axis: "width" | "depth", index?: number): void => {
        const highlighted = resize.activeAxis === axis || resize.hoverAxis === axis;
        const color = resize.valid ? (axis === "width" ? 0xffb84d : 0x57d6ff) : 0xef5350;
        const handle = new THREE.Mesh(
          new THREE.CircleGeometry(highlighted ? 0.27 : 0.22, 24),
          transparentMaterial(color, highlighted ? 1 : 0.9),
        );
        handle.name = `editor-building-resize-${axis}${index === undefined ? "" : `-${index}`}`;
        handle.rotation.x = -Math.PI / 2;
        handle.position.set(point.x, this.#groundY(point.x, point.z, 0.205), point.z);
        handle.renderOrder = 43;
        const material = handle.material as THREE.MeshBasicMaterial;
        material.depthTest = false;
        group.add(handle);
      };
      for (const [index, point] of resize.widthHandles.entries()) {
        addHandle(point, "width", index);
      }
      addHandle(resize.depthHandle, "depth");

      const anchor = new THREE.Mesh(
        new THREE.RingGeometry(0.08, 0.14, 4),
        transparentMaterial(resize.valid ? 0xffffff : 0xef5350, 0.95),
      );
      anchor.name = "editor-building-resize-anchor";
      anchor.rotation.x = -Math.PI / 2;
      anchor.rotation.z = Math.PI / 4;
      anchor.position.set(
        resize.anchor.x,
        this.#groundY(resize.anchor.x, resize.anchor.z, 0.205),
        resize.anchor.z,
      );
      anchor.renderOrder = 43;
      (anchor.material as THREE.MeshBasicMaterial).depthTest = false;
      group.add(anchor);
      this.#editorRoot.add(group);
    }
    if (overlay.bridgeResize) {
      const resize = overlay.bridgeResize;
      const group = new THREE.Group();
      group.name = "editor-bridge-resize";
      const positions: number[] = [];
      for (let index = 0; index < resize.outline.length; index += 1) {
        const from = resize.outline[index];
        const to = resize.outline[(index + 1) % resize.outline.length];
        if (!from || !to) continue;
        positions.push(
          from.x,
          this.#groundY(from.x, from.z, 0.19),
          from.z,
          to.x,
          this.#groundY(to.x, to.z, 0.19),
          to.z,
        );
      }
      const outlineGeometry = new THREE.BufferGeometry();
      outlineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const outlineMaterial = new THREE.LineBasicMaterial({
        color: resize.valid ? 0x7de7ff : 0xef5350,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      const outline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
      outline.name = "editor-bridge-resize-outline";
      outline.renderOrder = 42;
      group.add(outline);

      const addHandle = (handle: (typeof resize.handles)[number]): void => {
        const { point, axis, side } = handle;
        const highlighted = resize.activeSide === side || resize.hoverSide === side;
        const color = resize.valid ? (axis === "length" ? 0xffb84d : 0x57d6ff) : 0xef5350;
        const mesh = new THREE.Mesh(
          new THREE.CircleGeometry(highlighted ? 0.27 : 0.22, 24),
          transparentMaterial(color, highlighted ? 1 : 0.9),
        );
        mesh.name = `editor-bridge-resize-${side}`;
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(point.x, this.#groundY(point.x, point.z, 0.205), point.z);
        mesh.renderOrder = 43;
        (mesh.material as THREE.MeshBasicMaterial).depthTest = false;
        group.add(mesh);
      };
      for (const handle of resize.handles) addHandle(handle);

      const anchor = new THREE.Mesh(
        new THREE.RingGeometry(0.08, 0.14, 4),
        transparentMaterial(resize.valid ? 0xffffff : 0xef5350, 0.95),
      );
      anchor.name = "editor-bridge-resize-anchor";
      anchor.rotation.x = -Math.PI / 2;
      anchor.rotation.z = Math.PI / 4;
      anchor.position.set(
        resize.anchor.x,
        this.#groundY(resize.anchor.x, resize.anchor.z, 0.205),
        resize.anchor.z,
      );
      anchor.renderOrder = 43;
      (anchor.material as THREE.MeshBasicMaterial).depthTest = false;
      group.add(anchor);
      this.#editorRoot.add(group);
    }
    if (overlay.assetPreview) {
      for (const point of overlay.assetPreview.footprint) {
        const cell = new THREE.Mesh(
          new THREE.PlaneGeometry(0.96, 0.96),
          transparentMaterial(overlay.assetPreview.valid ? 0xffd66b : 0xe34d42, 0.22),
        );
        cell.rotation.x = -Math.PI / 2;
        cell.position.set(point.x, this.#groundY(point.x, point.z, 0.105), point.z);
        this.#editorRoot.add(cell);
      }
    }
    if (overlay.stairsPreview) {
      const atlases = this.#textures ? terrainAtlases(this.#textures) : null;
      const fallback = atlases?.lvl0;
      if (atlases && fallback) {
        const preview = meshStairs([overlay.stairsPreview.ramp], {
          levelHeight: overlay.stairsPreview.levelHeight,
          // The preview is tinted a flat highlight colour anyway, but it still asks for the right
          // bank's atlas: the ghost's geometry must be the geometry the real ramp will have.
          atlasFor: (level) => atlases[terrainAtlasKey("herbe", level)] ?? fallback,
          color: overlay.stairsPreview.valid ? 0xffd66b : 0xe34d42,
          opacity: 0.58,
          lift: 0.03,
        });
        this.#editorRoot.add(preview.group);
      }
    }
    this.#positionEditorPreview();
  }

  setEditorPreviewArt(art: StaticSpriteArt | null): void {
    for (const preview of this.#editorPreviews) {
      preview.sprite.mesh.removeFromParent();
      preview.sprite.dispose();
    }
    this.#editorPreviews.length = 0;
    this.#editorPreviewRoot.clear();
    if (!art) return;
    const layers: StaticSpriteArt[] = [];
    const coldLayers: StaticSpriteArt[] = [];
    const collect = (layer: StaticSpriteArt, target: StaticSpriteArt[]): void => {
      target.push(layer);
      for (const companion of layer.companions ?? []) collect(companion, target);
    };
    collect(art, layers);
    if (art.coldVariant) collect(art.coldVariant, coldLayers);
    for (const [layer, cold] of [
      ...layers.map((entry) => [entry, false] as const),
      ...coldLayers.map((entry) => [entry, true] as const),
    ]) {
      const sky = layer.renderLayer === "sky";
      const flat = sky || layer.renderMode === "flat";
      const preview: Billboard | Sprite | NativeStaticVisual = layer.structureVolume
        ? makeStructureVolume(layer.structureVolume)
        : layer.runnerProp
          ? makeRunnerPropVolume(layer.runnerProp)
          : layer.buildingVolume
            ? makeBuildingVolume({ front: layer.texture, ...layer.buildingVolume })
            : layer.bridgeOrientation
              ? makeBridgeVolume(layer.texture, layer.bridgeOrientation)
              : flat
                ? makeFlatSprite(this.#scene.ctx, {
                    texture: layer.texture,
                    cols: layer.cols ?? 1,
                    rows: layer.rows ?? 1,
                    size: layer.flatSize ?? layer.height * (layer.aspect ?? 1),
                    aspect: 1 / (layer.aspect ?? 1),
                    alphaTest: 0.5,
                    graftCloudShadow: () => undefined,
                  })
                : makeBillboard(this.#scene.ctx, {
                    texture: layer.texture,
                    cols: layer.cols ?? 1,
                    rows: layer.rows ?? 1,
                    height: layer.height,
                    aspect: layer.aspect ?? 1,
                    foot: layer.foot ?? 0,
                    ...(layer.uvRect ? { uvRect: layer.uvRect } : {}),
                    ...(layer.lit === undefined ? {} : { lit: layer.lit }),
                    pitch: HD2D_CAMERA.pitch,
                  });
      materialOpacity(preview.mesh, 0.62);
      preview.mesh.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material.depthWrite = false;
      });
      preview.mesh.renderOrder = 8;
      this.#editorPreviews.push({ sprite: preview, art: layer, cold });
      this.#editorPreviewRoot.add(preview.mesh);
    }
    this.#positionEditorPreview();
  }

  #positionEditorPreview(): void {
    const placement = this.#editorOverlay?.assetPreview;
    if (!placement) {
      for (const preview of this.#editorPreviews) preview.sprite.mesh.visible = false;
      return;
    }
    const coldMaterial = isColdBiomeMaterial(
      this.#materialAt(placement.point.x, placement.point.z),
    );
    const hasColdVariant = this.#editorPreviews.some((preview) => preview.cold);
    for (const preview of this.#editorPreviews) {
      preview.sprite.mesh.visible = !hasColdVariant || preview.cold === coldMaterial;
      if (preview.art.renderLayer === "sky") {
        preview.sprite.mesh.position.set(
          placement.point.x,
          placement.skyAltitude ?? this.#waterLevel + 2,
          placement.point.z,
        );
      } else if (preview.art.renderMode === "flat") {
        preview.sprite.mesh.position.set(
          placement.point.x,
          this.#groundY(placement.point.x, placement.point.z, 0.055),
          placement.point.z,
        );
      } else if (
        preview.art.structureVolume ||
        preview.art.runnerProp ||
        preview.art.buildingVolume ||
        preview.art.bridgeOrientation
      ) {
        (preview.sprite as NativeStaticVisual).placeAt(
          placement.point.x,
          preview.art.bridgeOrientation && placement.elevation !== undefined
            ? placement.elevation
            : this.#groundY(placement.point.x, placement.point.z, 0.025),
          placement.point.z,
        );
      } else {
        (preview.sprite as Billboard).placeAt(
          placement.point.x,
          this.#groundY(placement.point.x, placement.point.z, 0.025),
          placement.point.z,
        );
      }
    }
  }

  update(now: number): void {
    for (const preview of this.#editorPreviews) {
      const frames = (preview.art.cols ?? 1) * (preview.art.rows ?? 1);
      preview.sprite.setFrame(
        staticAnimationFrame(now, preview.art.animationDurationMs ?? 0, frames),
      );
      if (preview.art.structureVolume || preview.art.runnerProp || preview.art.buildingVolume) {
        (preview.sprite as NativeStaticVisual).update(now);
      }
    }
    this.#advanceSkid(now);
    // The dust turns. A transform per marker on shared, baked geometry: no buffer is rewritten and
    // nothing is allocated, which is what lets a map full of interactables animate for free.
    if (this.#eventMarkers.size > 0) {
      const spin = ((now % EVENT_MARKER_SPIN_MS) / EVENT_MARKER_SPIN_MS) * Math.PI * 2;
      for (const marker of this.#eventMarkers.values()) marker.rotation.y = spin;
    }
    if (this.#spawnKnight && this.#spawnKnightArt) {
      const frames = (this.#spawnKnightArt.cols ?? 1) * (this.#spawnKnightArt.rows ?? 1);
      this.#spawnKnight.setFrame(
        staticAnimationFrame(now, this.#spawnKnightArt.animationDurationMs ?? 0, frames),
      );
    }
    for (let index = this.#effects.length - 1; index >= 0; index -= 1) {
      const effect = this.#effects[index];
      if (!effect) continue;
      effect.object.visible = now >= effect.startedAt;
      if (now < effect.startedAt) continue;
      if (now >= effect.endsAt) {
        this.#disposeEffect(effect);
        this.#effects.splice(index, 1);
        continue;
      }
      effect.update(
        THREE.MathUtils.clamp((now - effect.startedAt) / (effect.endsAt - effect.startedAt), 0, 1),
      );
    }
    for (const [id, camp] of this.#camps) {
      if (now < camp.endsAt) continue;
      this.removeCamp(id);
    }
    for (const [id, until] of this.#hiddenQuestSites) {
      if (now < until) continue;
      this.#hiddenQuestSites.delete(id);
      this.#questVisualKey = "";
    }
    for (let index = this.#labels.length - 1; index >= 0; index -= 1) {
      const label = this.#labels[index];
      if (!label) continue;
      if (now >= label.endsAt) {
        label.element.remove();
        this.#labels.splice(index, 1);
        continue;
      }
      const projected = label.point.clone().project(this.#scene.camera);
      const rect = this.#canvas.getBoundingClientRect();
      label.element.style.left = `${rect.left + (projected.x * 0.5 + 0.5) * rect.width}px`;
      label.element.style.top = `${rect.top + (-projected.y * 0.5 + 0.5) * rect.height}px`;
      label.element.style.opacity = String(Math.min(1, (label.endsAt - now) / 350));
    }
  }

  diagnostics(): Record<string, number> {
    return {
      actorsSecondary: this.#loot.size + this.#projectiles.size,
      camps: this.#camps.size,
      rations: this.#rations.size,
      powerBuffs: this.#powerBuffs.size,
      healingAuras: this.#healingAuras.size,
      effects: this.#effects.length,
      movementSurfaces:
        Number(this.#swimDisc.visible) +
        Number(this.#breathBar.visible) +
        Number(this.#skid.visible),
      eventMarkers: this.#eventMarkers.size,
      labels: this.#labels.length,
      questMarkers: this.#questMarkers.size,
    };
  }

  dispose(): void {
    this.setEditorPreviewArt(null);
    for (const label of this.#labels) label.element.remove();
    this.#labels.length = 0;
    for (const effect of this.#effects) this.#disposeEffect(effect);
    for (const entry of this.#loot.values()) this.#dropLoot(entry);
    for (const entry of this.#projectiles.values()) this.#dropProjectile(entry);
    for (const id of [...this.#camps.keys()]) this.removeCamp(id);
    for (const id of [...this.#rations.keys()]) this.removeRation(id);
    for (const entry of this.#powerBuffs.values()) disposeObject(entry.object);
    for (const entry of this.#healingAuras.values()) disposeObject(entry.object);
    disposeObject(this.#root);
    // `disposeObject(this.#root)` only walks ATTACHED descendants via `Object3D.traverse`. The
    // cached grid is deliberately detached (not disposed) whenever the grid toggle is off or the
    // overlay is cleared — see `setEditorOverlay` — so it must be freed here explicitly, or its
    // BufferGeometry/LineBasicMaterial leak their GPU buffers every time a session is torn down (or
    // its terrain is reconfigured, which discards this whole layer) while the grid happened to be
    // toggled off. `disposeObject`'s geometry/material `.dispose()` calls are idempotent, so this is
    // safe even on the (still attached, already-disposed-once) common case too.
    if (this.#gridLines) {
      disposeObject(this.#gridLines);
      this.#gridLines = null;
    }
    // The knight billboard first, and explicitly: it is a `Billboard`, not a bare mesh, and its
    // `dispose()` also unregisters it from the scene context's yaw registry — the generic
    // `disposeObject` traversal below only frees geometry/material, so skipping this would leave
    // the context turning a destroyed mesh on every camera rotation. See `#clearSpawnKnight`.
    this.#clearSpawnKnight();
    if (this.#spawnMarker) {
      disposeObject(this.#spawnMarker);
      this.#spawnMarker = null;
    }
    this.#spawnKnightArt = null;
    this.#effects.length = 0;
    this.#loot.clear();
    this.#projectiles.clear();
    this.#eventMarkers.clear();
    // The shared marker resources, freed exactly once: no marker owns them, so nothing else ever
    // will. Six now rather than three, since the halo brought a geometry, a material and a texture
    // of its own.
    this.#moteGeometry?.dispose();
    this.#moteGeometry = null;
    this.#moteMaterial?.dispose();
    this.#moteMaterial = null;
    this.#moteTexture?.dispose();
    this.#moteTexture = null;
    this.#haloGeometry?.dispose();
    this.#haloGeometry = null;
    this.#haloMaterial?.dispose();
    this.#haloMaterial = null;
    this.#haloTexture?.dispose();
    this.#haloTexture = null;
    this.#camps.clear();
    this.#rations.clear();
    this.#powerBuffs.clear();
    this.#healingAuras.clear();
    this.#questMarkers.clear();
    this.#hiddenQuestSites.clear();
    this.#merchant = null;
    this.#aim = null;
  }
}
