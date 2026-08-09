/**
 * The game's renderer — the only one, since S3 retired the PixiJS path (2026-08-04).
 *
 * It draws the world's GROUND — terrain, sea, foam, sky and light, from the welcome's heightfield —
 * its actors, scenery, runtime event appearances, secondary entities and combat/interaction
 * presentation. `visual-layer.ts` owns transient geometry and screen projection while this adapter
 * keeps game-domain choices out of `@lindocara/hd2d`.
 *
 * Actors cycle their idle sheets; reported `vy` drives stretch/squash and a gliding player carries
 * a dedicated canopy billboard.
 */

import type { AuthoredQuestMarker } from "@lindocara/engine/adventure-state.js";
import type { PrimaryColor } from "@lindocara/engine/character.js";
import type { MonsterSpecies, PlayerClass } from "@lindocara/engine/game.js";
import type { GroundVector } from "@lindocara/engine/ground.js";
import type { HeroEvent } from "@lindocara/engine/hd2d/hero-state.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import type { MapElement } from "@lindocara/engine/map-data.js";
import type { MerchantDefinition } from "@lindocara/engine/merchant.js";
import type {
  CombatActionSnapshot,
  CombatAnimation,
  GuardSnapshot,
  MonsterSpecialImpact,
  PeasantBombImpactVisual,
  PeasantCampVisual,
  PlayerSnapshot,
  PriestLumenPortalVisual,
  PriestLumenTrailVisual,
  PriestPolarityOrbVisual,
  RogueShadowDanceSequence,
  WorldEventSnapshot,
} from "@lindocara/engine/protocol.js";
import { isSheepAssetId, SHEEP_RENDER_HEIGHT } from "@lindocara/engine/sheep.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import {
  EDITOR_ASSETS,
  editorAsset,
  guardPrimaryColorForAsset,
  LINDOCARA_CAMPFIRE_ASSET_ID,
  LINDOCARA_CHEST_CLOSED_ASSET_ID,
  LINDOCARA_CHEST_OPEN_ASSET_ID,
  NPC_MODEL_ASSETS,
} from "@lindocara/engine/tiny-swords-catalog.js";
import type { Facing } from "@lindocara/hd2d/billboard.js";
import { fetchAll } from "@lindocara/hd2d/loader.js";
import type { TextureRegistry, TextureSpec } from "@lindocara/hd2d/textures.js";
import { createTextureRegistry } from "@lindocara/hd2d/textures.js";
import { type ActorMotion, ActorMotionTracker } from "../actor-motion.js";
import {
  allCombatSheets,
  combatArt,
  type MonsterImpactSound,
  monsterSpecialImpactArt,
} from "../combat-art.js";
import { TINY_SWORDS_ENEMIES } from "../enemy-art.js";
import { sameRenderedMap } from "../map-render-cache.js";
import type { RenderContext, RendererLike } from "../renderer-api.js";
import type { SceneSample } from "../scene-sample.js";
import { ServerClock } from "../server-clock.js";
import { type SkillVisualDefinition, skillVisual } from "../skill-visuals.js";
import {
  allUnitSheets,
  isPeasantSkillId,
  peasantCarrySheet,
  peasantCasterSheet,
  type UnitSheet,
  unitSheet,
} from "../tiny-swords-art.js";
import { tinySwordsSourceUrl } from "../tiny-swords-assets.js";
import { WorldEventMotionTracker } from "../world-event-motion.js";
import type { ActorView, BillboardRegistry, BillboardScene } from "./billboards.js";
import { createBillboardRegistry } from "./billboards.js";
import type { Hd2dScene } from "./scene.js";
import { createHd2dScene, HD2D_TEXTURE_URLS } from "./scene.js";
import type { StaticContent, StaticSpriteArt } from "./static-content.js";
import { authoredMaterialAt, placeStaticContent } from "./static-content.js";
import {
  HD2D_SHEEP_EXPLOSION_TEXTURE_URL,
  HD2D_SPLASH_TEXTURE_URL,
  type Hd2dEditorOverlay,
  Hd2dVisualLayer,
} from "./visual-layer.js";

// --- actor art direction --------------------------------------------------------------------------

/**
 * Which sheet each kind of actor draws with — the ADAPTER's knowledge, exactly like the terrain
 * atlases in `scene.ts`. `billboards.ts` never sees a class, a species or a faction colour.
 *
 * Idle/run/attack are selected from presentation facts already in the frame: position deltas and
 * the server-owned action timeline.
 */
export function playerActorSheet(player: PlayerSnapshot, motion: ActorMotion): UnitSheet {
  if (player.class === "peasant") {
    if (motion === "attack" && player.action?.skillId && isPeasantSkillId(player.action.skillId)) {
      return peasantCasterSheet(player.appearance.primaryColor, player.action.skillId);
    }
    if (motion !== "attack" && player.peasantCarry) {
      return peasantCarrySheet(player.appearance.primaryColor, player.peasantCarry.kind, motion);
    }
  }
  if (motion === "attack" && player.action?.skillId) {
    const base = unitSheet(player.class, player.appearance, motion);
    const caster = combatArt(
      player.class,
      player.action.skillId,
      player.appearance.primaryColor,
    ).caster;
    return {
      ...base,
      source: caster.source,
      frames: caster.frames,
      frameWidth: caster.frameWidth,
      frameHeight: caster.frameHeight,
    };
  }
  return unitSheet(player.class, player.appearance, motion);
}

/** The SPECIES, never `graphicAssetId`: an authored catalogue appearance is one more sheet per
 *  authored monster, and preloading a set that only the running adventure knows is a later piece.
 *  The species is the authoritative combat model, so it is never a wrong answer, only a plainer
 *  one — the deleted PixiJS path drew the authored art on top of the same species model. */
export interface BillboardActorSheet {
  source: string;
  frames: number;
  frameWidth?: number;
  frameHeight?: number;
  footOffset?: number;
  axis?: "x" | "y";
}

const NPC_MODEL_ASSET_IDS = new Set(NPC_MODEL_ASSETS.map((asset) => asset.id));

export function authoredActorSheet(
  graphicAssetId: string | null | undefined,
  motion: ActorMotion,
): BillboardActorSheet | null {
  if (!graphicAssetId || !NPC_MODEL_ASSET_IDS.has(graphicAssetId)) return null;
  const asset = editorAsset(graphicAssetId);
  if (!asset) return null;
  const selected =
    motion === "run" && asset.motions?.run
      ? asset.motions.run
      : motion === "attack" && asset.motions?.attack
        ? asset.motions.attack
        : asset;
  if (!selected.frame) return null;
  return {
    source: tinySwordsSourceUrl(selected.sourcePath),
    frames: selected.frame.count,
    frameWidth: selected.frame.width,
    frameHeight: selected.frame.height,
    footOffset: selected.footOffset,
    axis: selected.frame.axis,
  };
}

export function monsterActorSheet(
  species: MonsterSpecies,
  motion: ActorMotion,
  graphicAssetId?: string | null,
): BillboardActorSheet {
  return authoredActorSheet(graphicAssetId, motion) ?? TINY_SWORDS_ENEMIES[species][motion];
}

function actorSheetView(sheet: BillboardActorSheet) {
  return {
    textureKey: sheet.source,
    frames: sheet.frames,
    ...(sheet.frameWidth === undefined ? {} : { frameWidth: sheet.frameWidth }),
    ...(sheet.frameHeight === undefined ? {} : { frameHeight: sheet.frameHeight }),
    frameAxis: sheet.axis ?? ("x" as const),
    ...(sheet.footOffset === undefined || sheet.frameHeight === undefined
      ? {}
      : { foot: sheet.footOffset / sheet.frameHeight }),
  };
}

/**
 * The wire's last-accepted movement vector, as one of the four names a billboard understands.
 *
 * The dominant axis wins. A ZERO vector answers `"north"` rather than falling through to `"east"`:
 * north and south are `facingToFlip`'s no-ops, so "no direction" leaves the sprite turned the way
 * it already was — where `"east"` would snap a westward hero around the instant the server ever
 * sent a zeroed facing.
 */
/** `z` is the screen-down ground axis, so a negative `z` faces north exactly as a negative pixel
 *  `y` used to. */
function facingOf(vector: GroundVector): Facing {
  if (vector.x === 0 && vector.z === 0) return "north";
  if (Math.abs(vector.x) >= Math.abs(vector.z)) return vector.x < 0 ? "west" : "east";
  return vector.z < 0 ? "north" : "south";
}

/**
 * One player snapshot, as the actor the registry draws.
 *
 * Exported, and a function rather than an object literal inlined in `#collectActors`, for one
 * reason: this is the seam the wire's locomotion state crosses into the renderer's. A flag dropped
 * here is a flag `billboards.ts` can do nothing with, and every placement test in the package would
 * still pass — so the seam is pinned by `hd2d-remote-state.test.ts` instead of trusted.
 *
 * All three flags and the elevation ride across untouched. `billboards.ts` decides what to do with
 * them; this only refuses to lose them.
 */
/** The locomotion flags of anything the ROOM steps. A monster and a guard walk on the ground and
 *  nowhere else — they never jump, swim or glide — so they are grounded by construction rather than
 *  by a flag nobody sets. Spelled once so the day a flying monster exists, there is one place that
 *  has to stop being a constant. */
const GROUNDED = { airborne: false, swimming: false, gliding: false } as const;

export const HD2D_GLIDER_TEXTURE_URL = "/assets/lindocara/hd2d/glider.png";

export function playerActorView(
  player: PlayerSnapshot,
  animationTimeMs = 0,
  motion: ActorMotion = "idle",
  animationDurationMs?: number,
): ActorView {
  const sheet = playerActorSheet(player, motion);
  return {
    id: player.id,
    kind: "player",
    x: player.x,
    y: player.y,
    z: player.z,
    airborne: player.airborne,
    swimming: player.swimming,
    gliding: player.gliding,
    vy: player.vy ?? 0,
    canopyTextureKey: HD2D_GLIDER_TEXTURE_URL,
    facing: facingOf(player.facing),
    ...actorSheetView(sheet),
    animationTimeMs,
    ...(animationDurationMs === undefined ? {} : { animationDurationMs }),
    animationLoop: motion !== "attack",
    ...(player.life === "ghost" ? { pose: "ghost" as const } : {}),
  };
}

/** A guard is a Tiny Swords unit like any other — the same warrior sheet the deleted PixiJS path
 *  gave it, in the faction colour its authored asset id implies. */
export function guardSheet(
  guard: Pick<GuardSnapshot, "graphicAssetId">,
  motion: ActorMotion,
): BillboardActorSheet {
  return (
    authoredActorSheet(guard.graphicAssetId, motion) ??
    unitSheet(
      "warrior",
      { body: "wayfarer", primaryColor: guardPrimaryColorForAsset(guard.graphicAssetId) },
      motion,
    )
  );
}

/**
 * Every sheet the three functions above can name, deduplicated — the registry's `get` throws on a
 * texture nobody preloaded, and a hero walking into a species that was never downloaded must not be
 * the thing that finds out.
 *
 * `atlas` stays false, as it does for every sprite sheet in the lab's own catalogue: a sprite is
 * sampled frame by frame but it is also seen at every distance, so it keeps its mipmaps (the
 * tilesets and the foam are the atlases, and `scene.ts` marks them).
 */
export const HD2D_ACTOR_TEXTURE_URLS: readonly TextureSpec[] = [
  ...new Set([
    ...allUnitSheets().map((sheet) => sheet.source),
    ...allCombatSheets().map((sheet) => sheet.source),
    ...NPC_MODEL_ASSETS.flatMap((asset) => [
      tinySwordsSourceUrl(asset.sourcePath),
      ...(asset.motions?.run ? [tinySwordsSourceUrl(asset.motions.run.sourcePath)] : []),
      ...(asset.motions?.attack ? [tinySwordsSourceUrl(asset.motions.attack.sourcePath)] : []),
    ]),
    ...Object.values(TINY_SWORDS_ENEMIES).flatMap((art) => [
      art.idle.source,
      art.run.source,
      art.attack.source,
    ]),
    HD2D_GLIDER_TEXTURE_URL,
    HD2D_SPLASH_TEXTURE_URL,
    HD2D_SHEEP_EXPLOSION_TEXTURE_URL,
  ]),
].map((url) => ({ url, ...(url === HD2D_SPLASH_TEXTURE_URL ? { atlas: true } : {}) }));

// --- scenery art direction ------------------------------------------------------------------------

/**
 * One catalogue asset, resolved: the file it draws from and the geometry a billboard is built with.
 * `StaticSpriteArt` minus its texture, because the sheet has to be NAMED before it can be
 * downloaded and TEXTURED only afterwards — see `staticAssetSpec`.
 */
export interface StaticAssetSpec
  extends Omit<StaticSpriteArt, "texture" | "companions" | "coldVariant"> {
  url: string;
  companions?: readonly StaticAssetSpec[];
  coldVariant?: StaticAssetSpec;
}

const LAB_CAMPFIRE_BASE_URL = "/assets/lindocara/hd2d/campfire-base.png";
const LAB_CAMPFIRE_FLAME_URL = "/assets/lindocara/hd2d/campfire-flame.png";
const LAB_CHEST_CLOSED_URL = "/assets/lindocara/hd2d/chest-closed.png";
const LAB_CHEST_OPEN_URL = "/assets/lindocara/hd2d/chest-open.png";
const LAB_SNOW_TREE_URL = "/assets/lindocara/hd2d/snow-tree.png";
const NATIVE_TREE_ASSET_IDS = new Set([
  "resource.terrain-resources-wood-trees.tree1",
  "resource.terrain-resources-wood-trees.tree2",
  "resource.terrain-resources-wood-trees.tree3",
]);

function snowTreeSpec(): StaticAssetSpec {
  return {
    url: LAB_SNOW_TREE_URL,
    height: 2.9,
    aspect: 94 / 142,
    foot: 0.03,
  };
}

/**
 * A catalogue asset id, read as everything the HD-2D path needs to draw it — or `null` when this
 * build cannot draw it at all. The ADAPTER's knowledge, exactly like `playerTextureKey` above and
 * the terrain atlases in `scene.ts`.
 *
 * ONE function, deliberately, and exported so it can be pinned by a test: the url and the geometry
 * were briefly two functions with the REFUSALS in only one of them, which made "never ask for the
 * geometry of an asset the other one rejected" an invariant living in neither — a second call site
 * (an editor preview, which the spec anticipates) would have quietly framed a whole shared sheet as
 * one sprite. The refusals and the arithmetic now sit together, and every caller gets both.
 *
 * Two honest refusals. `placeStaticContent` turns each into one skipped sprite and a console
 * warning, never a thrown error:
 *
 * - an id no catalogue entry answers to — a map authored against a newer pack;
 * - a file the Vite glob never bundled (`tinySwordsSourceUrl` throws on those, by design).
 *
 * `definition.width`/`height` are the FRAME's size, not the sheet's, so a frame count along its own
 * axis is what gives the grid. The scale rule is the pack's own and the same one `billboards.ts`
 * gives actors: a frame is worth its native pixels at 64 to the tile, so an authored tree and the
 * hero beside it stay in proportion. `footOffset` is `frameHeight - alphaBboxBottom` — the visible
 * ground line measured up from the bottom of the frame — which is precisely what `foot` wants, and
 * the same number the deleted PixiJS path used to stand the very same sprite on the very same cell.
 */
export function staticAssetSpec(assetId: string): StaticAssetSpec | null {
  if (assetId === LINDOCARA_CAMPFIRE_ASSET_ID) {
    return {
      url: LAB_CAMPFIRE_BASE_URL,
      height: 66 / TILE_SIZE,
      aspect: 57 / 66,
      foot: 0,
      renderMode: "flat",
      flatSize: 1.25,
      fireLight: { color: 0xff8c2e, lift: 0.62, distance: 34, decay: 2, glow: true },
      companions: [
        {
          url: LAB_CAMPFIRE_FLAME_URL,
          cols: 7,
          rows: 1,
          height: 1.5,
          aspect: 1,
          foot: 0.12,
          animationDurationMs: (7 / 12) * 1_000,
          lit: false,
        },
      ],
    };
  }
  if (assetId === LINDOCARA_CHEST_CLOSED_ASSET_ID || assetId === LINDOCARA_CHEST_OPEN_ASSET_ID) {
    return {
      url: assetId === LINDOCARA_CHEST_OPEN_ASSET_ID ? LAB_CHEST_OPEN_URL : LAB_CHEST_CLOSED_URL,
      height: 1.15,
      aspect: 1,
      foot: 0.02,
    };
  }
  const definition = editorAsset(assetId);
  if (!definition) return null;
  const frame = definition.frame;
  const crop = definition.editor.sourceRect;
  const sourceExtent = crop
    ? EDITOR_ASSETS.filter((asset) => asset.sourcePath === definition.sourcePath).reduce(
        (extent, asset) => {
          const rect = "sourceRect" in asset.editor ? asset.editor.sourceRect : undefined;
          return {
            width: Math.max(extent.width, rect ? rect.x + rect.width : asset.width),
            height: Math.max(extent.height, rect ? rect.y + rect.height : asset.height),
          };
        },
        { width: definition.width, height: definition.height },
      )
    : { width: definition.width, height: definition.height };
  const framePx = {
    width: crop?.width ?? frame?.width ?? definition.width,
    height: crop?.height ?? frame?.height ?? definition.height,
  };
  if (framePx.width <= 0 || framePx.height <= 0) return null;
  const count = Math.max(1, frame?.count ?? 1);
  const nativeTreeStrip = /\/Trees\/Tree[1-3]\.png$/.test(
    definition.sourcePath.replaceAll("\\", "/"),
  );
  const alongX = (frame?.axis ?? "x") === "x";
  let url: string;
  try {
    url = tinySwordsSourceUrl(definition.sourcePath);
  } catch {
    // The Vite glob is the only boundary to the raw pack and it throws on a path it never bundled.
    // A catalogue entry pointing at a file this build does not ship is one lost prop, not a crash.
    return null;
  }
  const spec: StaticAssetSpec = {
    url,
    cols: crop ? 1 : alongX ? count : 1,
    rows: crop ? 1 : alongX ? 1 : count,
    height: framePx.height / TILE_SIZE,
    aspect: framePx.width / framePx.height,
    foot: definition.footOffset / framePx.height + (1 - definition.anchor.y),
    renderLayer:
      definition.editor.renderLayer === "ground" ? "object" : definition.editor.renderLayer,
    ...(definition.nature === "animated" && !crop && count > 1
      ? { animationDurationMs: nativeTreeStrip ? 960 : (frame?.durationMs ?? count * 145) }
      : {}),
    ...(crop
      ? {
          uvRect: {
            offsetX: crop.x / sourceExtent.width,
            offsetY: 1 - (crop.y + crop.height) / sourceExtent.height,
            repeatX: crop.width / sourceExtent.width,
            repeatY: crop.height / sourceExtent.height,
          },
        }
      : {}),
  };
  const warmLight = definition.tags.some(
    (tag) => tag === "torch" || tag === "fire" || tag === "campfire",
  );
  const litSpec = warmLight
    ? {
        ...spec,
        fireLight: { color: 0xff9a45, lift: 0.55, distance: 18, decay: 2, glow: false },
      }
    : spec;
  return NATIVE_TREE_ASSET_IDS.has(assetId) ? { ...litSpec, coldVariant: snowTreeSpec() } : litSpec;
}

function staticSpecUrls(spec: StaticAssetSpec): string[] {
  return [
    spec.url,
    ...(spec.companions ?? []).flatMap(staticSpecUrls),
    ...(spec.coldVariant ? staticSpecUrls(spec.coldVariant) : []),
  ];
}

function materializeStaticSpec(spec: StaticAssetSpec, textures: TextureRegistry): StaticSpriteArt {
  const { url, companions, coldVariant, ...geometry } = spec;
  return {
    texture: textures.get(url),
    ...geometry,
    ...(companions
      ? { companions: companions.map((companion) => materializeStaticSpec(companion, textures)) }
      : {}),
    ...(coldVariant ? { coldVariant: materializeStaticSpec(coldVariant, textures) } : {}),
  };
}

/** Every catalogue id a map's scenery names, deduplicated and in placement order. */
function staticAssetIds(map: MapData): string[] {
  const ids = new Set<string>();
  for (const element of map.elements) ids.add(element.assetId);
  return [...ids];
}

function worldEventAsset(event: WorldEventSnapshot): string | null {
  const harvest = event.harvest;
  if (!harvest || harvest.state === "intact") return event.graphicAssetId;
  if (harvest.exhaustionBehavior === "replace") return harvest.exhaustedAssetId;
  return null;
}

const CLASS_EFFECT_COLORS: Record<PlayerClass, number> = {
  warrior: 0xffb45d,
  ranger: 0x7edb84,
  priest: 0xf6e28b,
  rogue: 0xb995ff,
  peasant: 0xe1ba75,
};

const PRIMARY_EFFECT_COLORS: Record<PrimaryColor, number> = {
  azure: 0x74b8ff,
  ember: 0xff7b68,
  moss: 0x7ee29a,
  violet: 0xb995ff,
};

function colorFromSkill(skillId: string): number {
  const palette = [0x74b8ff, 0xffb45d, 0x7ee29a, 0xb995ff, 0xff7b68, 0xffdd70] as const;
  let hash = 0;
  for (let index = 0; index < skillId.length; index += 1) hash += skillId.charCodeAt(index);
  return palette[hash % palette.length] ?? 0xffffff;
}

function rotatedDirection(direction: GroundVector, radians: number): GroundVector {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: direction.x * cosine - direction.z * sine,
    z: direction.x * sine + direction.z * cosine,
  };
}

function castTarget(origin: GroundVector, direction: GroundVector, reach: number): GroundVector {
  return { x: origin.x + direction.x * reach, z: origin.z + direction.z * reach };
}

function playSkillCast(
  visuals: Hd2dVisualLayer,
  origin: GroundVector,
  direction: GroundVector,
  profile: SkillVisualDefinition,
  durationMs: number,
  startedAt: number,
): void {
  const target = castTarget(origin, direction, profile.reach);
  switch (profile.cast) {
    case "slash": {
      const left = castTarget(origin, rotatedDirection(direction, -0.24), profile.reach);
      const right = castTarget(origin, rotatedDirection(direction, 0.24), profile.reach);
      visuals.beam(origin, left, profile.width, profile.color, durationMs, startedAt);
      visuals.beam(origin, right, profile.width, profile.accent, durationMs, startedAt);
      return;
    }
    case "guard":
      visuals.orb(origin.x, origin.z, profile.color, 0.48, durationMs, startedAt);
      visuals.pulse(
        origin.x,
        origin.z,
        profile.accent,
        profile.impactRadius,
        durationMs,
        startedAt,
      );
      return;
    case "charge":
      visuals.beam(origin, target, profile.width, profile.color, durationMs, startedAt);
      visuals.pulse(
        target.x,
        target.z,
        profile.accent,
        profile.impactRadius * 0.58,
        durationMs,
        startedAt,
      );
      return;
    case "wave":
      visuals.pulse(origin.x, origin.z, profile.color, profile.impactRadius, durationMs, startedAt);
      visuals.pulse(
        origin.x,
        origin.z,
        profile.accent,
        profile.impactRadius * 0.62,
        durationMs,
        startedAt,
      );
      return;
    case "spin": {
      const side = rotatedDirection(direction, Math.PI / 2);
      visuals.beam(
        castTarget(origin, direction, -profile.reach),
        castTarget(origin, direction, profile.reach),
        profile.width,
        profile.color,
        durationMs,
        startedAt,
      );
      visuals.beam(
        castTarget(origin, side, -profile.reach),
        castTarget(origin, side, profile.reach),
        profile.width,
        profile.accent,
        durationMs,
        startedAt,
      );
      visuals.pulse(origin.x, origin.z, profile.color, profile.impactRadius, durationMs, startedAt);
      return;
    }
    case "projectile":
      visuals.beam(origin, target, profile.width, profile.color, durationMs, startedAt);
      visuals.orb(
        target.x,
        target.z,
        profile.accent,
        Math.max(0.09, profile.width),
        durationMs,
        startedAt,
      );
      return;
    case "fan":
      for (const angle of [-0.28, 0, 0.28]) {
        visuals.beam(
          origin,
          castTarget(origin, rotatedDirection(direction, angle), profile.reach),
          profile.width,
          angle === 0 ? profile.accent : profile.color,
          durationMs,
          startedAt,
        );
      }
      return;
    case "heal":
      visuals.orb(origin.x, origin.z, profile.color, 0.3, durationMs, startedAt);
      visuals.pulse(
        origin.x,
        origin.z,
        profile.accent,
        profile.impactRadius,
        durationMs,
        startedAt,
      );
      return;
    case "blink":
      visuals.pulse(origin.x, origin.z, profile.color, profile.impactRadius, durationMs, startedAt);
      visuals.beam(origin, target, profile.width, profile.accent, durationMs, startedAt);
      return;
    case "stealth":
      visuals.orb(origin.x, origin.z, profile.color, 0.55, durationMs, startedAt);
      visuals.pulse(
        origin.x,
        origin.z,
        profile.accent,
        profile.impactRadius,
        durationMs,
        startedAt,
      );
      return;
    case "harvest":
      visuals.beam(origin, target, profile.width, profile.color, durationMs, startedAt);
      visuals.pulse(
        target.x,
        target.z,
        profile.accent,
        profile.impactRadius * 0.55,
        durationMs,
        startedAt,
      );
      return;
    case "construct":
      visuals.pulse(origin.x, origin.z, profile.color, profile.impactRadius, durationMs, startedAt);
      visuals.orb(origin.x, origin.z, profile.accent, 0.2, durationMs, startedAt);
      return;
    case "bomb":
      visuals.orb(target.x, target.z, profile.color, 0.24, durationMs, startedAt);
      visuals.beam(origin, target, profile.width, profile.accent, durationMs, startedAt);
  }
}

interface ActorPosition {
  x: number;
  z: number;
  playerClass?: PlayerClass;
  primaryColor?: PrimaryColor;
  species?: MonsterSpecies;
}

export class Hd2dRenderer implements RendererLike {
  #canvas: HTMLCanvasElement;
  #textures: TextureRegistry;
  /** Built on the first `configureMapTerrain` carrying a heightfield, not at construction: the map
   *  only exists once the welcome has landed. */
  #scene: Hd2dScene | null = null;
  /** Lives and dies with the scene: its billboards are parented to that scene's graph. */
  #actors: BillboardRegistry | null = null;
  /** The map's scenery, placed once per map. Lives and dies with the scene, like the actors. */
  #content: StaticContent | null = null;
  /** The scenery's own textures. A second registry rather than an addition to `#textures`: which
   *  catalogue sheets a map needs is only known once that map has landed, and the actor/terrain
   *  registry is fixed at construction so the first frame can be correct. */
  #contentTextures: TextureRegistry | null = null;
  #eventContent: StaticContent | null = null;
  #eventTextures: TextureRegistry | null = null;
  #eventToken = 0;
  #eventAssetKey = "";
  #eventVisualKey = "";
  #editorPreviewAssetId: string | null = null;
  #editorPreviewArt: StaticSpriteArt | null = null;
  #editorPreviewTextures: TextureRegistry | null = null;
  #editorPreviewToken = 0;
  #worldEvents: readonly WorldEventSnapshot[] = [];
  #map: MapData | null = null;
  #visuals: Hd2dVisualLayer | null = null;
  #merchant: MerchantDefinition | null = null;
  #questMarkers: readonly AuthoredQuestMarker[] = [];
  #actorPositions = new Map<string, ActorPosition>();
  #actorMotion = new ActorMotionTracker();
  #eventMotion = new WorldEventMotionTracker();
  #serverClock: ServerClock;
  /** Bumped by every map change and every teardown, so a download still in flight for the previous
   *  map cannot land its scenery in the new one's scene. */
  #contentToken = 0;
  /** Rebuilt every frame into the same array — `render` runs 60 times a second, and a fresh array
   *  per frame is garbage for nothing. */
  #actorViews: ActorView[] = [];
  #selfId: string | null = null;
  #manualFocus: GroundVector | null = null;
  #tiltShiftEnabled = true;
  #cameraZoom = 100;
  #cameraYaw = 0;
  #frameCallbacks: Array<(nowMs: number, deltaSeconds: number) => void> = [];
  #rafHandle: number | null = null;
  #lastFrameMs: number | null = null;
  #destroyed = false;
  #currentMapId: string | null = null;
  #currentMapRevision = -1;
  #onResize = (): void => this.#scene?.resize();

  private constructor(
    canvas: HTMLCanvasElement,
    textures: TextureRegistry,
    serverClock: ServerClock,
  ) {
    this.#canvas = canvas;
    this.#textures = textures;
    this.#serverClock = serverClock;
    addEventListener("resize", this.#onResize);
    this.#startLoop();
  }

  /**
   * Downloads and decodes every texture BEFORE returning, exactly as the lab does: a scene built on
   * textures still decoding clones empty ones, and three complains once per frame about it.
   *
   * The session clock projects authoritative effect deadlines onto the local frame timeline.
   */
  static async create(
    canvas: HTMLCanvasElement,
    serverClock: ServerClock = new ServerClock(),
  ): Promise<Hd2dRenderer> {
    const specs = [...HD2D_TEXTURE_URLS, ...HD2D_ACTOR_TEXTURE_URLS];
    const blobs = await fetchAll(
      specs.map((spec) => spec.url),
      () => {},
    );
    const textures = createTextureRegistry(specs);
    await textures.decode(blobs, () => {});
    return new Hd2dRenderer(canvas, textures, serverClock);
  }

  /**
   * The frame loop. The deleted PixiJS renderer borrowed a shared `Application`'s ticker; there is
   * no such ticker here, so this owns a `requestAnimationFrame` loop and hands the session the same
   * `(nowMs, deltaSeconds)` it has always received. The session's callback is what calls `render`,
   * so the scene advances from inside the callback, never beside it.
   */
  #startLoop(): void {
    const step = (now: number): void => {
      this.#rafHandle = requestAnimationFrame(step);
      const dt = this.#lastFrameMs === null ? 0 : (now - this.#lastFrameMs) / 1000;
      this.#lastFrameMs = now;
      for (const callback of this.#frameCallbacks) callback(now, dt);
    };
    this.#rafHandle = requestAnimationFrame(step);
  }

  onFrame(callback: (nowMs: number, deltaSeconds: number) => void): void {
    this.#frameCallbacks.push(callback);
  }

  /**
   * Builds the scene from the welcome's heightfield.
   *
   * `tiles`/`elements`/`appearance` are the tile path's, and go unread here — the appearance this
   * renderer draws comes from the heightfield, and a heightfield-backed room ships blank tile
   * layers precisely so its welcome still validates. A `null` heightfield leaves the scene unbuilt
   * and the screen empty, which is the honest state of a room this path cannot draw.
   */
  configureMapTerrain(
    zoneId: string,
    _elements: readonly MapElement[],
    revision: number,
    heightfield: MapData,
    _appearance?: { tilesetId: string; layers: readonly string[] },
  ): void {
    if (
      this.#currentMapId !== null &&
      sameRenderedMap(
        { mapId: zoneId, revision },
        { mapId: this.#currentMapId, revision: this.#currentMapRevision },
      )
    )
      return;
    this.#currentMapId = zoneId;
    this.#currentMapRevision = revision;
    this.#disposeScene();
    const scene = createHd2dScene(this.#canvas, heightfield, this.#textures);
    this.#scene = scene;
    scene.setZoom(this.#cameraZoom);
    scene.setYaw(this.#cameraYaw);
    scene.setTiltShiftEnabled(this.#tiltShiftEnabled);
    if (this.#manualFocus) scene.focusOn(this.#manualFocus.x, this.#manualFocus.z);
    this.#map = heightfield;
    this.#visuals = new Hd2dVisualLayer(
      scene,
      this.#canvas,
      heightfield.size,
      heightfield.waterLevel,
      this.#textures,
      (x, z) => authoredMaterialAt(heightfield, x, z),
    );
    this.#visuals.setEditorPreviewArt(this.#editorPreviewArt);
    this.#visuals.setMerchant(this.#merchant);
    this.#visuals.setQuestMarkers(this.#questMarkers);
    this.#actors = createBillboardRegistry(
      scene.ctx,
      this.#sceneFor(scene, heightfield),
      this.#textures,
    );
    // Fire and forget, but never silently: a failed scenery download costs the map its props and
    // must say so, while the ground and the actors carry on.
    void this.#loadStaticContent(scene, heightfield).catch((error: unknown) => {
      console.warn("[hd2d] map scenery could not be loaded", error);
    });
    this.#syncWorldEventContent(this.#worldEvents, true);
  }

  /** What `billboards.ts` and `static-content.ts` both need of the scene they draw into. */
  #sceneFor(scene: Hd2dScene, heightfield: MapData): BillboardScene {
    return {
      root: scene.scene,
      query: scene.query,
      size: heightfield.size,
      waterLevel: heightfield.waterLevel,
    };
  }

  /**
   * Downloads the map's own scenery sheets, then places them.
   *
   * Asynchronous where `configureMapTerrain` is not, and it has to be: the catalogue holds 480
   * assets and a map names a handful of them, so preloading the lot beside the terrain would trade
   * a two-second first frame for scenery that could simply arrive a moment later. The ground, the
   * sea and the actors are already on screen while this runs.
   *
   * `token` is the guard that makes that safe. Two maps in quick succession — a map transition, a
   * reconnect onto a different map — must not let the first one's download graft its trees onto the
   * second one's scene, so a load that is no longer the current one gives its textures straight
   * back.
   */
  async #loadStaticContent(scene: Hd2dScene, heightfield: MapData): Promise<void> {
    const token = ++this.#contentToken;
    const assetIds = staticAssetIds(heightfield);
    if (assetIds.length === 0) return;

    // Resolved ONCE, BEFORE the download, and reused as the placement's own resolver below: an id
    // this build cannot draw must not become a 404 that fails the whole batch, and — because the
    // spec carries the geometry as well as the url — there is no second lookup that could disagree
    // with this one about what is drawable. An unresolved id stays out of the map, `resolve`
    // answers `null` for it, and `placeStaticContent` skips it with a warning.
    const specByAsset = new Map<string, StaticAssetSpec>();
    for (const assetId of assetIds) {
      const spec = staticAssetSpec(assetId);
      if (spec) specByAsset.set(assetId, spec);
    }
    // `atlas` stays false, as it does for every sprite sheet: a prop is seen at every distance, so
    // it keeps its mipmaps. Same reasoning as `HD2D_ACTOR_TEXTURE_URLS`.
    const specs: TextureSpec[] = [
      ...new Set([...specByAsset.values()].flatMap(staticSpecUrls)),
    ].map((url) => ({ url }));

    let textures: TextureRegistry | null = null;
    if (specs.length > 0) {
      const blobs = await fetchAll(
        specs.map((spec) => spec.url),
        () => {},
      );
      const registry = createTextureRegistry(specs);
      await registry.decode(blobs, () => {});
      textures = registry;
    }

    if (this.#destroyed || token !== this.#contentToken || this.#scene !== scene) {
      textures?.dispose();
      return;
    }
    this.#contentTextures = textures;
    this.#content = placeStaticContent(
      scene.ctx,
      this.#sceneFor(scene, heightfield),
      { ...heightfield, events: [] },
      (assetId) => {
        const spec = specByAsset.get(assetId);
        if (!spec || !textures) return null;
        return materializeStaticSpec(spec, textures);
      },
    );
  }

  async #loadEditorPreviewAsset(assetId: string, token: number): Promise<void> {
    const spec = staticAssetSpec(assetId);
    if (!spec) return;
    const urls = [...new Set(staticSpecUrls(spec))];
    const textureSpecs: TextureSpec[] = urls.map((url) => ({ url }));
    const blobs = await fetchAll(urls, () => {});
    const textures = createTextureRegistry(textureSpecs);
    await textures.decode(blobs, () => {});
    if (this.#destroyed || token !== this.#editorPreviewToken) {
      textures.dispose();
      return;
    }
    this.#editorPreviewTextures = textures;
    this.#editorPreviewArt = materializeStaticSpec(spec, textures);
    this.#visuals?.setEditorPreviewArt(this.#editorPreviewArt);
  }

  #syncWorldEventContent(events: readonly WorldEventSnapshot[], force = false): void {
    this.#worldEvents = events;
    const visualKey = events
      .map((event) => {
        const assetId = worldEventAsset(event);
        return authoredActorSheet(assetId, "idle")
          ? `${event.id}:actor:${assetId ?? ""}`
          : `${event.id}:${event.col}:${event.row}:${assetId ?? ""}`;
      })
      .join("|");
    const assetIds = [
      ...new Set(
        events.flatMap((event) =>
          [event.graphicAssetId, event.harvest?.exhaustedAssetId ?? null].filter(
            (assetId): assetId is string => assetId !== null,
          ),
        ),
      ),
    ].sort();
    const assetKey = assetIds.join("|");
    if (!force && visualKey === this.#eventVisualKey && assetKey === this.#eventAssetKey) return;
    if (!this.#scene || !this.#map) return;
    if (assetKey === this.#eventAssetKey && this.#eventTextures) {
      this.#placeWorldEventContent(visualKey);
      return;
    }
    this.#eventAssetKey = assetKey;
    this.#eventVisualKey = "";
    const token = ++this.#eventToken;
    this.#eventContent?.dispose();
    this.#eventContent = null;
    this.#eventTextures?.dispose();
    this.#eventTextures = null;
    if (assetIds.length === 0) {
      this.#eventVisualKey = visualKey;
      return;
    }
    void this.#loadWorldEventTextures(assetIds, token, visualKey).catch((error: unknown) => {
      console.warn("[hd2d] world-event art could not be loaded", error);
    });
  }

  async #loadWorldEventTextures(
    assetIds: readonly string[],
    token: number,
    visualKey: string,
  ): Promise<void> {
    const specsByAsset = new Map<string, StaticAssetSpec>();
    for (const assetId of assetIds) {
      const spec = staticAssetSpec(assetId);
      if (spec) specsByAsset.set(assetId, spec);
    }
    const specs: TextureSpec[] = [
      ...new Set([...specsByAsset.values()].flatMap(staticSpecUrls)),
    ].map((url) => ({ url }));
    if (specs.length === 0) {
      if (token === this.#eventToken) this.#eventVisualKey = visualKey;
      return;
    }
    const blobs = await fetchAll(
      specs.map((spec) => spec.url),
      () => {},
    );
    const textures = createTextureRegistry(specs);
    await textures.decode(blobs, () => {});
    if (this.#destroyed || token !== this.#eventToken || !this.#scene || !this.#map) {
      textures.dispose();
      return;
    }
    this.#eventTextures = textures;
    this.#placeWorldEventContent(visualKey);
  }

  #placeWorldEventContent(visualKey: string): void {
    const scene = this.#scene;
    const map = this.#map;
    const textures = this.#eventTextures;
    if (!scene || !map || !textures) return;
    this.#eventContent?.dispose();
    const events = this.#worldEvents.flatMap((event) => {
      const assetId = worldEventAsset(event);
      return assetId === null || authoredActorSheet(assetId, "idle")
        ? []
        : [
            {
              id: event.id,
              x: event.col + 0.5 - map.size / 2,
              z: event.row + 0.5 - map.size / 2,
              graphicAssetId: assetId,
            },
          ];
    });
    this.#eventContent = placeStaticContent(
      scene.ctx,
      this.#sceneFor(scene, map),
      { ...map, elements: [], events },
      (assetId) => {
        const spec = staticAssetSpec(assetId);
        if (!spec) return null;
        return materializeStaticSpec(spec, textures);
      },
    );
    this.#eventVisualKey = visualKey;
  }

  render(sample: SceneSample, context: RenderContext): void {
    if (this.#destroyed) return;
    const scene = this.#scene;
    if (!scene) return;

    this.#actors?.sync(this.#collectActors(sample, context.now));
    this.#syncWorldEventContent(sample.events);
    const fireIntensity = scene.fireIntensity();
    this.#content?.setFireMood(fireIntensity);
    this.#eventContent?.setFireMood(fireIntensity);
    this.#content?.update(context.now);
    this.#eventContent?.update(context.now);
    this.#visuals?.syncLocalHero(context.self ?? null, context.movement ?? null, context.now);
    this.#visuals?.sync(sample, context.now);

    // The camera follows the local player, and only it: every other actor is drawn where the
    // interpolated view puts it. `focusOn` takes a GROUND point — `x` and `z` — and the snapshot is
    // already in the scene's own tile units, so nothing is converted here. `self.y` is the
    // ELEVATION; handing it over as the second ground axis parks the camera on the horizon.
    // A player the view has not sent yet leaves the camera wherever it last was, which is the map's
    // spawn on the very first frames.
    const self = sample.players.find((player) => player.id === this.#selfId);
    if (self) scene.focusOn(self.x, self.z);
    else if (this.#manualFocus) scene.focusOn(this.#manualFocus.x, this.#manualFocus.z);

    // `context.now` rather than a clock read of our own: it is the very `now` this frame's callback
    // was handed, so the scene's animations advance on the same timeline as everything else in it.
    scene.render(context.now);
  }

  /**
   * The frame's actors, in the one shape the registry understands. Positions ride across in the
   * snapshot's own TILE units, `x`/`z` on the ground and `y` the elevation — the same frame the
   * scene draws in, so there is no conversion anywhere in this package.
   *
   * A PLAYER also carries its three locomotion flags (`playerActorView`), because since S3 moved
   * movement to the client a hero's elevation is a fact its own client computed and the room
   * relayed. A monster or a guard is stepped by the room, on the ground and nowhere else, so all
   * three are false for them and the registry stands them on the terrain as it always did.
   *
   * Dead monsters and corpse snapshots become flattened billboards; ghosts keep their walking pose
   * with reduced opacity. A player whose life is `corpse` is omitted only because the dedicated
   * `sample.corpses` entry is the single body source.
   */
  #collectActors(sample: SceneSample, animationTimeMs: number): readonly ActorView[] {
    const views = this.#actorViews;
    const present = new Set<string>();
    views.length = 0;
    this.#actorPositions.clear();
    for (const player of sample.players) {
      if (player.life === "corpse") continue;
      present.add(player.id);
      const motion = this.#actorMotion.sample(
        player.id,
        player.x,
        player.z,
        player.action !== null,
        animationTimeMs,
      );
      const timing = player.action
        ? this.#actorAnimationTiming(player.action, animationTimeMs)
        : null;
      views.push(
        playerActorView(
          player,
          timing?.elapsed ?? animationTimeMs,
          motion.motion,
          timing?.duration,
        ),
      );
      this.#actorPositions.set(player.id, {
        x: player.x,
        z: player.z,
        playerClass: player.class,
        primaryColor: player.appearance.primaryColor,
      });
    }
    for (const monster of sample.monsters) {
      present.add(monster.id);
      const motion = this.#actorMotion.sample(
        monster.id,
        monster.x,
        monster.z,
        monster.action !== null,
        animationTimeMs,
      );
      const timing = monster.action
        ? this.#actorAnimationTiming(monster.action, animationTimeMs)
        : null;
      const sheet = monsterActorSheet(
        monster.species,
        monster.dead ? "idle" : motion.motion,
        monster.graphicAssetId,
      );
      views.push({
        id: monster.id,
        kind: monster.dead ? "corpse" : "monster",
        x: monster.x,
        y: monster.y,
        z: monster.z,
        ...GROUNDED,
        vy: 0,
        facing: facingOf(monster.facing),
        ...actorSheetView(sheet),
        animationTimeMs: timing?.elapsed ?? animationTimeMs,
        ...(timing ? { animationDurationMs: timing.duration } : {}),
        animationLoop: motion.motion !== "attack",
        ...(monster.dead ? { pose: "fallen" as const } : {}),
      });
      this.#actorPositions.set(monster.id, {
        x: monster.x,
        z: monster.z,
        species: monster.species,
      });
    }
    for (const guard of sample.guards) {
      present.add(guard.id);
      const motion = this.#actorMotion.sample(
        guard.id,
        guard.x,
        guard.z,
        guard.fighting,
        animationTimeMs,
      );
      const sheet = guardSheet(guard, motion.motion);
      views.push({
        id: guard.id,
        kind: "guard",
        x: guard.x,
        y: guard.y,
        z: guard.z,
        ...GROUNDED,
        vy: 0,
        // A guard carries no facing on the wire. `"north"` is `facingToFlip`'s no-op, so it keeps
        // whichever profile the guard already had rather than snapping it east every frame.
        facing: motion.direction ? facingOf(motion.direction) : "north",
        ...actorSheetView(sheet),
        animationTimeMs,
        animationLoop: true,
      });
    }
    for (const guard of sample.guards)
      this.#actorPositions.set(guard.id, { x: guard.x, z: guard.z });
    for (const corpse of sample.corpses) {
      const sheet = unitSheet(corpse.class, corpse.appearance, "idle");
      views.push({
        id: `corpse:${corpse.id}`,
        kind: "corpse",
        x: corpse.x,
        y: corpse.y,
        z: corpse.z,
        ...GROUNDED,
        vy: 0,
        facing: "north",
        ...actorSheetView(sheet),
        pose: "fallen",
      });
    }
    const eventIds = new Set<string>();
    const mapSize = this.#map?.size ?? 0;
    for (const event of sample.events) {
      const assetId = worldEventAsset(event);
      const idleSheet = authoredActorSheet(assetId, "idle");
      if (!idleSheet) continue;
      eventIds.add(event.id);
      const movement = this.#eventMotion.sample(event, animationTimeMs);
      const motion = event.moveAnimation && movement.moving ? "run" : "idle";
      const sheet = authoredActorSheet(assetId, motion) ?? idleSheet;
      views.push({
        id: `event:${event.id}`,
        kind: "event",
        x: movement.col + 0.5 - mapSize / 2,
        y: 0,
        z: movement.row + 0.5 - mapSize / 2,
        ...GROUNDED,
        vy: 0,
        facing:
          !event.directionFixed && movement.direction ? facingOf(movement.direction) : "north",
        ...actorSheetView(sheet),
        ...(isSheepAssetId(assetId) ? { renderHeight: SHEEP_RENDER_HEIGHT } : {}),
        animationTimeMs,
        animationLoop: true,
      });
    }
    this.#eventMotion.retain(eventIds);
    this.#actorMotion.retain(present);
    return views;
  }

  #actorAnimationTiming(
    action: CombatActionSnapshot,
    now: number,
  ): { elapsed: number; duration: number } {
    const timeline = this.#serverClock.combatTimeline(action, now);
    return {
      elapsed: Math.max(0, now - timeline.startedAt),
      duration: Math.max(1, timeline.recoveryEndsAt - timeline.startedAt),
    };
  }

  #disposeScene(): void {
    // Billboards first: they are parented to the scene's graph, and disposing that graph out from
    // under them would leave the context's yaw registry holding meshes nothing can reach. The
    // token bump is part of the same teardown — a scenery download still in flight belongs to a
    // scene that no longer exists.
    this.#contentToken += 1;
    this.#eventToken += 1;
    this.#content?.dispose();
    this.#content = null;
    this.#contentTextures?.dispose();
    this.#contentTextures = null;
    this.#eventContent?.dispose();
    this.#eventContent = null;
    this.#eventTextures?.dispose();
    this.#eventTextures = null;
    this.#eventAssetKey = "";
    this.#eventVisualKey = "";
    this.#visuals?.dispose();
    this.#visuals = null;
    this.#actors?.dispose();
    this.#actors = null;
    this.#actorMotion.reset();
    this.#eventMotion.reset();
    this.#scene?.dispose();
    this.#scene = null;
    this.#map = null;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    removeEventListener("resize", this.#onResize);
    if (this.#rafHandle !== null) cancelAnimationFrame(this.#rafHandle);
    this.#rafHandle = null;
    this.#frameCallbacks = [];
    this.#disposeScene();
    this.#editorPreviewToken += 1;
    this.#editorPreviewTextures?.dispose();
    this.#editorPreviewTextures = null;
    this.#editorPreviewArt = null;
    this.#textures.dispose();
  }

  /** Which of the frame's players the camera follows. Not a no-op any more: this is the one actor
   *  the view is built around. */
  setSelfId(id: string): void {
    this.#selfId = id;
  }

  #position(id: string): ActorPosition | null {
    return this.#actorPositions.get(id) ?? null;
  }

  #localDeadline(serverTimestamp: number, fallbackMs: number): number {
    return this.#serverClock.toLocal(serverTimestamp) ?? performance.now() + fallbackMs;
  }

  configureMerchant(merchant: MerchantDefinition | null): void {
    this.#merchant = merchant;
    this.#visuals?.setMerchant(merchant);
  }

  diagnostics(): Record<string, number> {
    return {
      mapLoaded: this.#scene ? 1 : 0,
      gameHour: this.#scene?.gameHour() ?? 0,
      trackedActors: this.#actorPositions.size,
      ...this.#visuals?.diagnostics(),
    };
  }

  hidePeasantBombAim(): void {
    this.#visuals?.hideAim();
  }

  hideQuestSite(id: string, durationMs: number): void {
    this.#visuals?.hideQuestSite(id, durationMs);
  }

  playCombatAnimation(animation: CombatAnimation): void {
    const position = this.#position(animation.actorId);
    if (!position) return;
    const now = performance.now();
    const timeline = this.#serverClock.combatTimeline(animation, now);
    const profile = animation.skillId ? skillVisual(animation.skillId) : null;
    const duration = Math.max(120, timeline.impactAt - timeline.startedAt);
    if (profile && animation.actorKind === "player" && this.#visuals) {
      playSkillCast(
        this.#visuals,
        { x: position.x, z: position.z },
        animation.direction,
        profile,
        duration,
        timeline.startedAt,
      );
      if (position.playerClass && position.primaryColor) {
        const art = combatArt(
          position.playerClass,
          animation.skillId ?? "attack",
          position.primaryColor,
        );
        for (const sheet of [art.zone, art.accent]) {
          if (sheet)
            this.#visuals.playSheet(sheet, position.x, position.z, duration, timeline.startedAt);
        }
      }
      return;
    }
    const color = position.playerClass
      ? CLASS_EFFECT_COLORS[position.playerClass]
      : animation.actorKind === "monster"
        ? 0xff745f
        : 0xffffff;
    this.#visuals?.beam(
      { x: position.x, z: position.z },
      {
        x: position.x + animation.direction.x * 0.72,
        z: position.z + animation.direction.z * 0.72,
      },
      0.12,
      color,
      duration,
      timeline.startedAt,
    );
  }

  playCombatImpact(
    playerId: string,
    skillId: string,
    x: number,
    z: number,
  ): PlayerClass | undefined {
    const position = this.#position(playerId);
    const playerClass = position?.playerClass;
    const profile = skillVisual(skillId);
    const color =
      profile?.color ?? (playerClass ? CLASS_EFFECT_COLORS[playerClass] : colorFromSkill(skillId));
    this.#visuals?.pulse(
      x,
      z,
      color,
      profile?.impactRadius ?? (skillId === "attack" ? 0.55 : 0.9),
      profile?.impactDurationMs,
    );
    if (profile) {
      this.#visuals?.orb(
        x,
        z,
        profile.accent,
        Math.max(0.1, profile.impactRadius * 0.16),
        profile.impactDurationMs,
      );
    }
    if (playerClass && position?.primaryColor) {
      const art = combatArt(playerClass, skillId, position.primaryColor);
      if (art.impact) this.#visuals?.playSheet(art.impact, x, z);
    }
    return playerClass;
  }

  playHealingImpact(
    color: PrimaryColor,
    skillId?: "mend" | "prayer" | "divine_nova",
    x?: number,
    z?: number,
  ): void {
    const self = this.#selfId ? this.#position(this.#selfId) : null;
    const atX = x ?? self?.x;
    const atZ = z ?? self?.z;
    if (atX === undefined || atZ === undefined) return;
    const profile = skillId ? skillVisual(skillId) : null;
    this.#visuals?.pulse(
      atX,
      atZ,
      profile?.color ?? PRIMARY_EFFECT_COLORS[color],
      profile?.impactRadius ?? 0.75,
      profile?.impactDurationMs ?? 680,
    );
    this.#visuals?.orb(
      atX,
      atZ,
      profile?.accent ?? PRIMARY_EFFECT_COLORS[color],
      Math.max(0.12, (profile?.impactRadius ?? 0.75) * 0.18),
      profile?.impactDurationMs ?? 680,
    );
    if (skillId) {
      const impact = combatArt("priest", skillId, color).impact;
      if (impact) this.#visuals?.playSheet(impact, atX, atZ);
    }
  }

  playInteraction(): void {
    const self = this.#selfId ? this.#position(this.#selfId) : null;
    if (self) this.#visuals?.pulse(self.x, self.z, 0xffe29a, 0.48, 300);
  }

  playHeroMovement(events: readonly HeroEvent[], hero: PlayerSnapshot | null): void {
    this.#visuals?.playHeroMovement(events, hero);
  }

  playLumenPortal(portal: PriestLumenPortalVisual): void {
    const now = performance.now();
    const endsAt = this.#localDeadline(portal.endsAt, 700);
    const duration = Math.max(120, endsAt - now);
    const color = this.#position(portal.actorId)?.primaryColor ?? "azure";
    const cloud = combatArt("priest", "blink", color).impact;
    if (!cloud) return;
    this.#visuals?.playSheet(cloud, portal.from.x, portal.from.z, duration, now, 1.05);
    this.#visuals?.playSheet(cloud, portal.to.x, portal.to.z, duration, now, 1.18);
  }

  playLumenTrail(trail: PriestLumenTrailVisual): void {
    const now = performance.now();
    const duration = Math.max(120, this.#localDeadline(trail.endsAt, 650) - now);
    const color = this.#position(trail.actorId)?.primaryColor ?? "azure";
    const cloud = combatArt("priest", "blink", color).impact;
    if (!cloud) return;
    for (let index = 1; index < trail.points.length; index += 1) {
      const from = trail.points[index - 1];
      const to = trail.points[index];
      if (!from || !to) continue;
      const distance = Math.hypot(to.x - from.x, to.z - from.z);
      const steps = Math.max(1, Math.ceil(distance / 0.65));
      for (let step = 0; step <= steps; step += 1) {
        const progress = step / steps;
        this.#visuals?.playSheet(
          cloud,
          from.x + (to.x - from.x) * progress,
          from.z + (to.z - from.z) * progress,
          duration,
          now,
          0.72 + ((index + step) % 3) * 0.08,
        );
      }
    }
  }

  playMonsterImpact(species: MonsterSpecies, x?: number, z?: number): void {
    const fallback = [...this.#actorPositions.values()].find((actor) => actor.species === species);
    const atX = x ?? fallback?.x;
    const atZ = z ?? fallback?.z;
    if (atX !== undefined && atZ !== undefined) this.#visuals?.pulse(atX, atZ, 0xff755f, 0.72);
  }

  playMonsterSpecialImpact(impact: MonsterSpecialImpact): MonsterImpactSound | undefined {
    const art = monsterSpecialImpactArt(impact.technique);
    const x = impact.x + (impact.direction.x * art.forwardOffset) / TILE_SIZE;
    const z = impact.z + (impact.direction.z * art.forwardOffset) / TILE_SIZE;
    this.#visuals?.pulse(x, z, 0xff6b54, art.visualRadius / TILE_SIZE, 620);
    return art.sound;
  }

  playPeasantBombImpact(impact: PeasantBombImpactVisual): void {
    this.#visuals?.pulse(impact.x, impact.z, 0xff9f45, impact.radius, 720);
  }

  playSheepExplosion(x: number, z: number): void {
    this.#visuals?.playSheepExplosion(x, z);
  }

  playPolarityOrb(orb: PriestPolarityOrbVisual): void {
    const now = performance.now();
    const duration = Math.max(120, this.#localDeadline(orb.endsAt, 900) - now);
    this.#visuals?.orb(
      orb.x,
      orb.z,
      0x8bcfff,
      Math.min(0.45, orb.maximumRadius * 0.22),
      duration,
      now,
    );
    this.#visuals?.pulse(orb.x, orb.z, 0x8bcfff, orb.maximumRadius, duration, now);
  }

  playRoguePoisonImpact(x: number, z: number, rupture: boolean): PlayerClass {
    this.#visuals?.pulse(x, z, rupture ? 0x8fff5f : 0x6bcf54, rupture ? 1.1 : 0.68, 560);
    return "rogue";
  }

  playShadowDance(sequence: RogueShadowDanceSequence): void {
    const base = this.#serverClock.toLocal(sequence.startedAt) ?? performance.now();
    for (const strike of sequence.strikes) {
      const startedAt = this.#serverClock.toLocal(strike.impactAt) ?? base;
      this.#visuals?.beam(strike.from, strike.targetPosition, 0.09, 0xb995ff, 280, startedAt);
      this.#visuals?.pulse(
        strike.targetPosition.x,
        strike.targetPosition.z,
        0xc8a8ff,
        0.62,
        360,
        startedAt,
      );
    }
  }

  playTeleportEffect(x?: number, z?: number): void {
    const self = this.#selfId ? this.#position(this.#selfId) : null;
    const atX = x ?? self?.x;
    const atZ = z ?? self?.z;
    if (atX !== undefined && atZ !== undefined) this.#visuals?.pulse(atX, atZ, 0xb995ff, 1.15, 620);
  }

  /**
   * Preloads authored event art before its first playable frame.
   *
   * **The invariant this owes, rescued from the deleted `world-event-art.ts`:** collect ONLY the
   * explicit visual ids the authoritative snapshot carries — `event.graphicAssetId` and
   * `event.harvest.exhaustedAssetId`, each validated by `isEditorAssetId`. In particular **never
   * inspect an asset's name or path to guess that a resource might need a stump, an empty rock or
   * any other harvested replacement.** Guessing from a filename makes the preload set drift the day
   * an asset is renamed, and a harvest that lands on an unpreloaded texture initiates its download
   * from the last authoritative hit — which is exactly the frame it must not.
   *
   * The point of preloading here at all is that timing: queue every replacement before the first
   * playable frame, so the swap is a texture already in memory.
   */
  preloadWorldEventAssets(events: readonly WorldEventSnapshot[]): void {
    this.#syncWorldEventContent(events, true);
  }

  removePeasantCamp(id: string): void {
    this.#visuals?.removeCamp(id);
  }

  /** Casts the pointer through the HD-2D camera onto the bounded world ground. */
  screenToWorld(clientX: number, clientY: number): GroundVector | null {
    return this.#visuals?.screenToWorld(clientX, clientY) ?? null;
  }

  /** Moves the editor/preview camera without impersonating a local player. */
  setCameraFocus(x: number, z: number): void {
    this.#manualFocus = { x, z };
    this.#scene?.focusOn(x, z);
  }

  /** Changes the editor/preview camera while preserving gameplay's 100% default. */
  setCameraZoom(percent: number): void {
    this.#cameraZoom = percent;
    this.#scene?.setZoom(percent);
  }

  rotateCamera(deltaRadians: number): void {
    if (!Number.isFinite(deltaRadians) || deltaRadians === 0) return;
    this.#cameraYaw = Math.atan2(
      Math.sin(this.#cameraYaw + deltaRadians),
      Math.cos(this.#cameraYaw + deltaRadians),
    );
    this.#scene?.setYaw(this.#cameraYaw);
  }

  /** Keeps gameplay's tilt-shift by default while allowing the authoring stage to stay crisp. */
  setTiltShiftEnabled(enabled: boolean): void {
    this.#tiltShiftEnabled = enabled;
    this.#scene?.setTiltShiftEnabled(enabled);
  }

  /** Draws creator-only grid/collision/selection guides in the real HD-2D scene. */
  setEditorOverlay(overlay: Hd2dEditorOverlay | null): void {
    this.#visuals?.setEditorOverlay(overlay);
  }

  /** Loads only the currently selected creator asset and keeps it alive across terrain redraws. */
  setEditorPreviewAsset(assetId: string | null): void {
    if (assetId === this.#editorPreviewAssetId) {
      this.#visuals?.setEditorPreviewArt(this.#editorPreviewArt);
      return;
    }
    this.#editorPreviewAssetId = assetId;
    const token = ++this.#editorPreviewToken;
    this.#visuals?.setEditorPreviewArt(null);
    this.#editorPreviewArt = null;
    this.#editorPreviewTextures?.dispose();
    this.#editorPreviewTextures = null;
    if (!assetId) return;
    void this.#loadEditorPreviewAsset(assetId, token).catch((error: unknown) => {
      if (token === this.#editorPreviewToken) {
        console.warn(`[hd2d] editor preview asset "${assetId}" could not be loaded`, error);
      }
    });
  }

  setAuthoredQuestMarkers(markers: readonly AuthoredQuestMarker[]): void {
    this.#questMarkers = markers;
    this.#visuals?.setQuestMarkers(markers);
  }

  showPeasantBombAim(origin: GroundVector, direction: GroundVector, range: number): void {
    this.#visuals?.setAim(origin, direction, range);
  }

  showPeasantCamp(camp: PeasantCampVisual): void {
    this.#visuals?.showCamp(camp, this.#localDeadline(camp.expiresAt, 30_000));
  }

  showWorldEvent(text: string, tone: "info" | "good" | "bad", x?: number, z?: number): void {
    const self = this.#selfId ? this.#position(this.#selfId) : null;
    this.#visuals?.showWorldEvent(text, tone, x ?? self?.x ?? 0, z ?? self?.z ?? 0);
  }
}
