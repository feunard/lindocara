/**
 * The running game's actors — players, monsters and guards — as HD-2D billboards.
 *
 * ONE responsibility, deliberately narrow: keep one billboard alive per actor the frame loop still
 * shows, place it on the ground under its position, turn it the way the snapshot faces it, and give
 * it back the moment it leaves. It is not a sprite framework: it holds no animation clip and no
 * effect, because this piece draws actors and nothing else. What sheet an actor draws with is the
 * ADAPTER's knowledge and lives in `game-renderer.ts`; `@lindocara/hd2d` below stays domain-free
 * and never learns what a monster is.
 *
 * The billboard's shape — `height`, `aspect`, `foot`, `pitch` — is `apps/lab/src/world/hero.ts`'s,
 * and the reasons are in `docs/hd2d-rendering.md`: a sprite is a strictly VERTICAL plane pivoted on
 * its feet and stretched to cancel the camera's plunge (tilting it towards the camera lays it
 * backwards and sinks its head into whatever is behind it).
 */

import type { TerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import { BODY_RADIUS, HERO_FOOTPRINT_OFFSET } from "@lindocara/engine/terrain-access.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import type { Billboard, Facing } from "@lindocara/hd2d/billboard.js";
import { billboardHeight, makeBillboard } from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";

import { HD2D_CAMERA } from "./scene.js";

export type ActorKind = "player" | "sea_guardian" | "monster" | "guard" | "corpse" | "event";

/** One actor of one frame, as the renderer hands it over. Every coordinate is the snapshot's own —
 *  TILE units, grid centre as origin — so `sync` converts nothing. */
export interface ActorView {
  id: string;
  kind: ActorKind;
  /** GROUND axis, in tile units with the grid centre as origin — the snapshot's own coordinate,
   *  with no conversion left between the wire and the scene. */
  x: number;
  /** ELEVATION, as the actor's own authority reported it. Airborne actors use it directly;
   * grounded players use it to select a finite platform (roof, bridge or prop top) before the
   * terrain fallback. */
  y: number;
  /** Authored vertical plane for event actors. Its presence makes `y` the exact supporting floor. */
  undergroundDepth?: number;
  /** The other GROUND axis. */
  z: number;
  /**
   * The three locomotion flags, straight off the snapshot.
   *
   * They exist because the position stream alone cannot tell a jump from a swim from a glide, and
   * the difference is exactly what decides where the sprite belongs. Since S3 moved movement to the
   * client, a remote hero's elevation is a fact its own client computed and the room relayed — so
   * ground-snapping every actor would make every OTHER player's jump invisible, and would draw a
   * swimmer standing on the bed beneath them. Nothing about that fails; it just looks wrong forever.
   *
   * Players set all three. The room may also mark a relentless runner airborne during its
   * authoritative leap; guards and ordinary monsters cross with all three false.
   */
  airborne: boolean;
  swimming: boolean;
  /** Presentation depth below the water plane; defaults to the ordinary hero swim depth. */
  waterDepth?: number;
  gliding: boolean;
  /** Vertical velocity, used only for stretch/squash. */
  vy: number;
  /** Optional canopy texture. Only player views provide one. */
  canopyTextureKey?: string;
  /** Which way the actor is turned. The Tiny Swords units are drawn in profile only, so `north`
   *  and `south` deliberately leave the current profile alone (`facingToFlip`). */
  facing: Facing;
  /** A url in the `TextureRegistry` the registry was built with. */
  textureKey: string;
  /** Authored sheets can run vertically and need not use square frames. */
  frames?: number;
  frameWidth?: number;
  frameHeight?: number;
  frameAxis?: "x" | "y";
  /** Per-sheet ground line. Defaults to the roster convention for the actor kind. */
  foot?: number;
  /** Explicit world height for an authored actor whose measured lab size differs from the shared
   * Tiny Swords actor scale. */
  renderHeight?: number;
  pose?: "standing" | "fallen" | "ghost";
  animationTimeMs?: number;
  /** Plays every frame over this duration. Without it, the per-frame cadence below is used. */
  animationDurationMs?: number;
  /** How long ONE frame is held on a looping strip, in ms — `ACTOR_FRAME_MS` for the motion being
   *  drawn. Omitted, every strip falls back to one shared cadence, which is right for an idle and
   *  far too slow for a run. */
  frameDurationMs?: number;
  /** Attack strips play once and hold their final frame; idle/run strips loop. */
  animationLoop?: boolean;
  /** Optional authoritative/presentation-selected frame. Multi-contact actions use this to pin the
   * authored contact frame to every server-owned impact instead of stretching one strip across the
   * whole action. */
  frame?: number;
  /** Presentation-only modulation for stealth silhouettes and Ranger afterimages. */
  tint?: number;
  opacity?: number;
  /** Server-authored health rendered as world chrome. The registry only clamps and draws it; it
   * never predicts damage or mutates the values. */
  healthBar?: {
    value: number;
    max: number;
    visible: boolean;
  };
}

/**
 * What a registry needs of the scene it draws into. A structural type rather than `Hd2dScene`:
 * everything here is plain data or a pure query, which is what lets the suite exercise placement in
 * jsdom without a canvas or a GL context.
 */
export interface BillboardScene {
  /** Where billboards are parented. */
  root: THREE.Object3D;
  /** The ground under a point. The scene's own, so an actor and the terrain it stands on can never
   *  disagree. */
  query: TerrainQuery;
  /** Grid side in cells — the `size` half of the bridge above. */
  size: number;
  /** Where an actor stands when there is no ground under it at all (it is swimming, or the server
   *  has put it off the map). */
  waterLevel: number;
}

export interface BillboardRegistry {
  /** The frame's complete actor list. Anything absent from it is removed. */
  sync(actors: readonly ActorView[]): void;
  /** Live billboard meshes for a narrow picking set, in caller order. */
  objectsFor(actorIds: readonly string[]): readonly THREE.Object3D[];
  dispose(): void;
}

/**
 * Where an actor's feet sit inside its frame, as a fraction of the frame's height from the bottom.
 *
 * Two numbers because the Tiny Swords pack has two rosters with two conventions. Every UNIT (the
 * player classes, and a guard, which is a warrior) is drawn on the same baseline — 56px up a 192px
 * frame, the very `footOffset` the deleted PixiJS path used. The ENEMY pack measures its ground line per
 * species (`ENEMY_RENDER_METRICS`), and those measurements cluster at ~0.30 of the frame; the
 * registry deliberately does not know a species, so it takes the cluster. A troll (0.23) therefore
 * stands ~0.3 tiles deep and a pig rider (0.35) ~0.3 tiles high until an actor carries its own
 * measurement across the wire.
 */
export const ACTOR_FOOT: Record<ActorKind, number> = {
  player: 56 / 192,
  sea_guardian: 0.5,
  guard: 56 / 192,
  monster: 0.3,
  corpse: 56 / 192,
  event: 56 / 192,
};

/** Every actor sheet this game ships is a single ROW of square frames — 1536x192 for eight warrior
 *  idle poses, 1152x192 for six running ones, and so on up to a troll's 384px frames. Falling back
 *  to a unit's 192 keeps a texture whose bytes have not landed from sizing a sprite at zero. */
const DEFAULT_FRAME_PX = 192;

/** Cadence for a looping strip whose caller named no motion — the lab's idle, which is the safest
 *  thing to be wrong about: a sprite that idles slightly slow reads as calm, and one that RUNS
 *  slow reads as broken. Callers that know the motion pass `ACTOR_FRAME_MS` for it instead. */
const DEFAULT_FRAME_MS = 1_000 / 7;
const SEA_GUARDIAN_PLATFORM_OCCLUSION_RADIUS = 0.55;

/** The lab's measured actor scale: a 192px Tiny Swords unit is 2.6 world tiles high, not the
 * pixel-era 3 tiles produced by dividing by TILE_SIZE. Larger sheets retain the same ratio. */
export const LAB_UNIT_HEIGHT = 2.6;
export const LAB_ACTOR_SCALE = LAB_UNIT_HEIGHT / (DEFAULT_FRAME_PX / TILE_SIZE);

export function actorHeightAtLabScale(frameHeight: number): number {
  return (frameHeight / TILE_SIZE) * LAB_ACTOR_SCALE;
}

function sheetOf(texture: THREE.Texture): { cols: number; framePx: number } {
  const image = texture.image as { width?: number; height?: number } | null | undefined;
  const framePx =
    typeof image?.height === "number" && image.height > 0 ? image.height : DEFAULT_FRAME_PX;
  const width = typeof image?.width === "number" && image.width > 0 ? image.width : framePx;
  return { cols: Math.max(1, Math.round(width / framePx)), framePx };
}

/**
 * Where an actor's feet belong this frame.
 *
 * Three cases, and the order between the first two is load-bearing:
 *
 * - **Swimming wins first.** A swimmer's body is held at the surface by the rule itself
 *   (`hero-step.ts` pins `y` to the water level on entry), so the water line is the answer whatever
 *   elevation rides beside the flag — and the ground under a swimmer is the BED, which is where the
 *   sprite would sink to if the terrain were consulted. Reading the flag rather than the reported
 *   `y` also means a stale or hostile elevation cannot float a swimmer above their own sea.
 * - **Airborne or gliding: the reported elevation**, which is the whole point of relaying it. The
 *   two are checked independently even though the rule clears the canopy on landing: they are three
 *   separate booleans on the wire, and a glider drawn on the grass is never the right reading.
 * - **Otherwise the supporting surface under the actor.** A grounded player may stand on a finite
 *   collider top, which `heightAt` deliberately excludes. Its reported elevation selects that top
 *   only when the scene agrees; normal terrain remains the fallback and the only path used by
 *   monsters and guards. `waterLevel` remains the off-map fallback.
 */
function elevationOf(actor: ActorView, scene: BillboardScene): number {
  if (actor.swimming)
    return (
      scene.query.waterLevelAtElevation?.(actor.x, actor.z, actor.y) ??
      scene.query.waterLevelAt(actor.x, actor.z)
    );
  if (actor.airborne || actor.gliding) return actor.y;
  const terrain = scene.query.heightAt(actor.x, actor.z) ?? scene.waterLevel;
  // Monsters, guards and corpses already carry their authoritative server elevation. Authored event
  // actors do too on a selected vertical storey; surface events intentionally keep terrain snapping
  // so a page graphic without an explicit y still follows an ordinary raised surface.
  if (actor.kind !== "player")
    return actor.kind === "event" && actor.undergroundDepth === undefined ? terrain : actor.y;

  const footprintZ = actor.z - HERO_FOOTPRINT_OFFSET;
  const ceiling = actor.y + 0.08;
  const platform = scene.query.platformSurfaceAround?.(actor.x, footprintZ, BODY_RADIUS, ceiling);
  if (platform !== null && platform !== undefined && Math.abs(platform - actor.y) <= 0.1) {
    return platform;
  }
  const centreSurface = scene.query.surfaceAt?.(actor.x, footprintZ, ceiling);
  return centreSurface !== null &&
    centreSurface !== undefined &&
    centreSurface > terrain + 0.01 &&
    Math.abs(centreSurface - actor.y) <= 0.1
    ? centreSurface
    : terrain;
}

function standsOnFinitePlatform(
  actor: ActorView,
  scene: BillboardScene,
  elevation: number,
): boolean {
  if (actor.kind !== "player" || actor.airborne || actor.gliding || actor.swimming) return false;
  const terrain = scene.query.heightAt(actor.x, actor.z) ?? scene.waterLevel;
  return elevation > terrain + 0.01;
}

/** A shark passing below a bridge is behind an opaque gameplay surface even where plank gaps or
 * transparent-water sorting would otherwise reveal its tall billboard. */
function seaGuardianUnderPlatform(actor: ActorView, scene: BillboardScene): boolean {
  if (actor.kind !== "sea_guardian" || !actor.swimming) return false;
  const platform = scene.query.platformSurfaceAround?.(
    actor.x,
    actor.z,
    SEA_GUARDIAN_PLATFORM_OCCLUSION_RADIUS,
    Number.POSITIVE_INFINITY,
  );
  return platform !== null && platform !== undefined && platform > scene.waterLevel + 0.01;
}

interface Entry {
  billboard: Billboard;
  canopy: Billboard | null;
  healthBar: HealthBarVisual | null;
  /** Kept so a texture change — a class swap, a recoloured guard — rebuilds rather than silently
   *  keeping the old sheet forever. */
  textureKey: string;
  canopyTextureKey: string | undefined;
  frames: number;
  frameHeight: number;
}

interface HealthBarVisual {
  group: THREE.Group;
  fill: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  dispose(): void;
}

export const ENEMY_HEALTH_BAR_WIDTH = 0.82;
export const ENEMY_HEALTH_BAR_HEIGHT = 0.12;
export const ENEMY_HEALTH_BAR_GAP = 0.16;

export function healthBarFillRatio(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return THREE.MathUtils.clamp(value / max, 0, 1);
}

export function healthBarFillColor(ratio: number): number {
  return ratio > 0.55 ? 0x65d17d : ratio > 0.25 ? 0xf0b85a : 0xe85454;
}

export const GLIDER_HEIGHT = 2.45;
export const GLIDER_ASPECT = 0.938;
export const GLIDER_LIFT = 1.05;
/** Same presentation depth as the lab witness: the water plane masks the swimmer's lower body. */
export const SWIM_DEPTH = 0.5;

function makeHealthBar(): HealthBarVisual {
  const group = new THREE.Group();
  group.name = "enemy-health-bar";
  const backgroundGeometry = new THREE.PlaneGeometry(
    ENEMY_HEALTH_BAR_WIDTH + 0.08,
    ENEMY_HEALTH_BAR_HEIGHT + 0.06,
  );
  const fillGeometry = new THREE.PlaneGeometry(ENEMY_HEALTH_BAR_WIDTH, ENEMY_HEALTH_BAR_HEIGHT);
  const backgroundMaterial = new THREE.MeshBasicMaterial({
    color: 0x251f26,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: 0x65d17d,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const background = new THREE.Mesh(backgroundGeometry, backgroundMaterial);
  const fill = new THREE.Mesh(fillGeometry, fillMaterial);
  background.renderOrder = 40;
  fill.position.z = 0.004;
  fill.renderOrder = 41;
  group.add(background, fill);
  return {
    group,
    fill,
    dispose() {
      group.removeFromParent();
      backgroundGeometry.dispose();
      fillGeometry.dispose();
      backgroundMaterial.dispose();
      fillMaterial.dispose();
    },
  };
}

function healthBarElevation(
  actor: ActorView,
  scene: BillboardScene,
  ctx: Hd2dContext,
  frameHeight: number,
): number {
  const height = actor.renderHeight ?? actorHeightAtLabScale(frameHeight);
  const drawnHeight = billboardHeight({
    height,
    pitch: ctx.pitch() ?? HD2D_CAMERA.pitch,
    stretch: ctx.config.spriteStretch,
  });
  const foot = actor.foot ?? ACTOR_FOOT[actor.kind];
  return elevationOf(actor, scene) + drawnHeight * (1 - foot) + ENEMY_HEALTH_BAR_GAP;
}

/**
 * `ctx` is passed explicitly, and must be the very context that built `scene`: `makeBillboard`
 * grafts THAT context's cloud-shadow uniforms onto each sprite's material and registers the mesh in
 * its yaw registry. A context of our own would give actors that neither darken under a cloud nor
 * turn with the camera — the same reasoning `terrainGroupFor` carries in `scene.ts`.
 */
export function createBillboardRegistry(
  ctx: Hd2dContext,
  scene: BillboardScene,
  textures: TextureRegistry,
): BillboardRegistry {
  const entries = new Map<string, Entry>();

  function create(actor: ActorView): Entry {
    const texture = textures.get(actor.textureKey);
    const inferred = sheetOf(texture);
    const frames = Math.max(1, actor.frames ?? inferred.cols);
    const frameWidth = actor.frameWidth ?? inferred.framePx;
    const frameHeight = actor.frameHeight ?? inferred.framePx;
    const vertical = actor.frameAxis === "y";
    const cols = vertical ? 1 : frames;
    const rows = vertical ? frames : 1;
    const billboard = makeBillboard(ctx, {
      texture,
      cols,
      rows,
      // The lab's measured scale keeps a 192px hero at 2.6 tiles while preserving the native
      // proportions between a 192px goblin and a 384px troll. A deliberately measured authored
      // actor may override it (the lab's 128px sheep is 1.5 tiles).
      height: actor.renderHeight ?? actorHeightAtLabScale(frameHeight),
      aspect: frameWidth / frameHeight,
      foot: actor.foot ?? ACTOR_FOOT[actor.kind],
      pitch: HD2D_CAMERA.pitch,
    });
    billboard.mesh.userData.actorId = actor.id;
    scene.root.add(billboard.mesh);
    const healthBar = actor.healthBar ? makeHealthBar() : null;
    if (healthBar) scene.root.add(healthBar.group);
    return {
      billboard,
      canopy: null,
      healthBar,
      textureKey: actor.textureKey,
      canopyTextureKey: actor.canopyTextureKey,
      frames,
      frameHeight,
    };
  }

  function createCanopy(textureKey: string): Billboard {
    const canopy = makeBillboard(ctx, {
      texture: textures.get(textureKey),
      height: GLIDER_HEIGHT,
      aspect: GLIDER_ASPECT,
      foot: 0,
      pitch: HD2D_CAMERA.pitch,
    });
    scene.root.add(canopy.mesh);
    return canopy;
  }

  function drop(entry: Entry): void {
    scene.root.remove(entry.billboard.mesh);
    entry.billboard.dispose();
    if (entry.canopy) {
      scene.root.remove(entry.canopy.mesh);
      entry.canopy.dispose();
    }
    entry.healthBar?.dispose();
  }

  return {
    objectsFor(actorIds) {
      return actorIds.flatMap((id) => {
        const object = entries.get(id)?.billboard.mesh;
        return object ? [object] : [];
      });
    },
    sync(actors) {
      const present = new Set<string>();
      for (const actor of actors) {
        present.add(actor.id);
        let entry = entries.get(actor.id);
        if (
          entry &&
          (entry.textureKey !== actor.textureKey ||
            entry.canopyTextureKey !== actor.canopyTextureKey)
        ) {
          drop(entry);
          entry = undefined;
        }
        if (!entry) {
          entry = create(actor);
          entries.set(actor.id, entry);
        }
        const stretch = THREE.MathUtils.clamp(actor.vy * 0.018, -0.1, 0.13);
        const fallen = actor.pose === "fallen";
        entry.billboard.mesh.scale.set(1 - stretch * 0.6, fallen ? 0.24 : 1 + stretch, 1);
        entry.billboard.mesh.rotation.z = fallen ? Math.PI / 2 : 0;
        const elapsed = Math.max(0, actor.animationTimeMs ?? 0);
        const duration = actor.animationDurationMs;
        const animatedFrame =
          actor.frame ??
          (duration && duration > 0
            ? actor.animationLoop === false
              ? Math.min(entry.frames - 1, Math.floor((elapsed / duration) * entry.frames))
              : Math.floor((elapsed / duration) * entry.frames) % entry.frames
            : Math.floor(elapsed / (actor.frameDurationMs ?? DEFAULT_FRAME_MS)) % entry.frames);
        entry.billboard.setFrame(
          fallen ? 0 : Math.max(0, Math.min(entry.frames - 1, animatedFrame)),
        );
        const material = entry.billboard.mesh.material;
        const materials = Array.isArray(material) ? material : [material];
        const opacity = actor.opacity ?? (actor.pose === "ghost" ? 0.48 : 1);
        const elevation = elevationOf(actor, scene);
        const elevatedPlatform = standsOnFinitePlatform(actor, scene, elevation);
        entry.billboard.mesh.visible = !seaGuardianUnderPlatform(actor, scene);
        // Native roofs are opaque volumes in front of a camera-facing hero plane. On their top,
        // ordinary depth clipping can swallow the entire actor. Draw it after the volume while
        // preserving the ordinary foot pivot: lifting by `footOffset` puts the painted feet above
        // both roof surfaces and bridge decks, which reads as levitation.
        for (const current of materials) {
          if (current instanceof THREE.MeshLambertMaterial) {
            current.color.setHex(actor.tint ?? 0xffffff);
          }
          current.transparent = opacity < 1;
          current.opacity = opacity;
          current.depthTest = !elevatedPlatform;
        }
        entry.billboard.mesh.renderOrder = elevatedPlatform ? 6 : 0;
        if (actor.healthBar && !entry.healthBar) {
          entry.healthBar = makeHealthBar();
          scene.root.add(entry.healthBar.group);
        } else if (!actor.healthBar && entry.healthBar) {
          entry.healthBar.dispose();
          entry.healthBar = null;
        }
        if (actor.healthBar && entry.healthBar) {
          const ratio = healthBarFillRatio(actor.healthBar.value, actor.healthBar.max);
          entry.healthBar.group.visible = actor.healthBar.visible && ratio > 0;
          entry.healthBar.group.position.set(
            actor.x,
            healthBarElevation(actor, scene, ctx, entry.frameHeight),
            actor.z,
          );
          entry.healthBar.group.rotation.y = ctx.yaw();
          entry.healthBar.fill.scale.x = Math.max(0.000_1, ratio);
          entry.healthBar.fill.position.x = -(1 - ratio) * (ENEMY_HEALTH_BAR_WIDTH / 2);
          entry.healthBar.fill.material.color.setHex(healthBarFillColor(ratio));
        }
        entry.billboard.placeAt(
          actor.x,
          elevation - (actor.swimming ? (actor.waterDepth ?? SWIM_DEPTH) : 0),
          actor.z,
        );
        entry.billboard.setFacing(actor.facing);
        if (actor.gliding && actor.canopyTextureKey) {
          entry.canopy ??= createCanopy(actor.canopyTextureKey);
          entry.canopy.mesh.visible = true;
          entry.canopy.setFacing(actor.facing);
          entry.canopy.placeAt(actor.x, elevationOf(actor, scene) + GLIDER_LIFT, actor.z);
        } else if (entry.canopy) {
          entry.canopy.mesh.visible = false;
        }
      }
      for (const [id, entry] of entries) {
        if (present.has(id)) continue;
        drop(entry);
        entries.delete(id);
      }
    },
    dispose() {
      for (const entry of entries.values()) drop(entry);
      entries.clear();
    },
  };
}
