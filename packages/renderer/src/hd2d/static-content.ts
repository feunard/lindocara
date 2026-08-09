/**
 * The map's own scenery — `MapData.elements` and the active page of `MapData.events` — as static
 * HD-2D billboards.
 *
 * Its own file rather than a second export in `billboards.ts`, because the two answer different
 * questions. `billboards.ts` keeps a registry ALIVE across frames: it diffs the actor list every
 * tick, creates, moves, turns and drops. Scenery has no frame: it is placed once when the map lands
 * and given back when the map goes. Folding it into the actor registry would have meant either
 * inventing a fourth `ActorKind` and re-syncing hundreds of immobile trees sixty times a second, or
 * teaching that registry a second lifecycle — which is exactly the "general sprite framework" its
 * own header refuses to become. What the two DO share is reused rather than copied: the
 * `BillboardScene` shape, `makeBillboard`, and the camera pitch a sprite's stretch is computed from.
 *
 * TWO rules bind this file, and neither is negotiable:
 *
 * - **Appearance only.** Nothing here derives a collider. Collision on this path is baked by the
 *   server from the terrain alone (`zoneTerrainFromHeightfield`, `engine/terrain-access.ts`), and
 *   the client bakes its prediction terrain from the same string; an authored element carries
 *   none — a tree you can walk through is the correct behaviour of this increment, an invisible
 *   wall around one is not.
 * - **An unknown asset id is skipped, never thrown.** A map authored against a catalogue this build
 *   does not have must lose one bush, not the whole world.
 *
 * `@lindocara/hd2d` stays domain-free: which sheet an asset id names, how many frames it holds and
 * where its feet sit are the ADAPTER's knowledge and live in `game-renderer.ts`, exactly as the
 * actor sheets and the terrain atlases do. This file only ever sees the resolved `StaticSpriteArt`.
 */

import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import type { Billboard, Sprite, TextureUvRect } from "@lindocara/hd2d/billboard.js";
import { makeBillboard, makeFlatSprite, makeGlow } from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import * as THREE from "three";
import type { BillboardScene } from "./billboards.js";
import { HD2D_CAMERA } from "./scene.js";

/**
 * One catalogue appearance, reduced to what a billboard is built from.
 *
 * Deliberately richer than the plan's bare `THREE.Texture`. A decoration is not an actor sheet: a
 * building is 128x192 and a rock 64x64, a bush is eight frames wide, and each asset carries its own
 * measured ground line. Guessing that from the image's own bytes — the `sheetOf` rule
 * `billboards.ts` applies to the actor roster, where every frame is square and every unit shares one
 * baseline — would draw a house as a 3x3 square and stand a tree in the ground. The catalogue
 * already holds all four numbers; the adapter reads them there and hands them over.
 */
export interface StaticSpriteArt {
  texture: THREE.Texture;
  /** Extra authored layers sharing this anchor (the lab campfire's flat base plus vertical flame). */
  companions?: readonly StaticSpriteArt[];
  /** Exact lab replacement selected when the anchor cell belongs to a cold biome. */
  coldVariant?: StaticSpriteArt;
  /** Frames across the sheet. The FIRST frame is what a static placement draws (a sheet is not an
   *  animation — see `docs/hd2d-rendering.md`: a tree's sheet also holds its felling and its
   *  stump). */
  cols?: number;
  /** Frames down the sheet. */
  rows?: number;
  /** World height of ONE frame, in tiles. The pack's own scale, as for actors: a frame is worth its
   *  native pixels at 64 to the tile, so a tree and a hero stay in proportion. */
  height: number;
  /** Frame width / frame height. */
  aspect?: number;
  /** Where the art's feet sit in its frame, as a fraction of frame height from the bottom. */
  foot?: number;
  uvRect?: TextureUvRect;
  /** Full-loop duration for a catalogue entry explicitly classified as `animated`. Technical
   * multi-state sheets omit it and remain pinned to frame zero. */
  animationDurationMs?: number;
  /** Sky art is a horizontal world-space plane, never a camera-facing billboard. */
  renderLayer?: "object" | "canopy" | "sky";
  renderMode?: "billboard" | "flat";
  flatSize?: number;
  lit?: boolean;
  fireLight?: {
    color: number;
    lift: number;
    distance: number;
    decay: number;
    glow: boolean;
  };
}

/** Resolves a catalogue asset id to the art it draws with, or `null` when this build has no such
 *  asset — the caller skips it with a warning. */
export type StaticArtResolver = (assetId: string) => StaticSpriteArt | null;

export interface StaticContent {
  setFireMood(intensity: number): void;
  update(now: number): void;
  dispose(): void;
}

export function staticAnimationFrame(
  now: number,
  durationMs: number,
  frames: number,
  phaseMs = 0,
): number {
  if (frames <= 1 || durationMs <= 0) return 0;
  const elapsed = (((now + phaseMs) % durationMs) + durationMs) % durationMs;
  return Math.min(frames - 1, Math.floor((elapsed / durationMs) * frames));
}

function placementPhase(assetId: string, x: number, z: number, durationMs: number): number {
  let hash = 2_166_136_261;
  const key = `${assetId}:${x.toFixed(3)}:${z.toFixed(3)}`;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % Math.max(1, durationMs);
}

export function authoredSkyAltitude(map: MapData): number {
  const highestLevel = map.levels.reduce<number>(
    (highest, level) => (level === null ? highest : Math.max(highest, level)),
    0,
  );
  return Math.max(map.waterLevel, highestLevel * map.levelHeight) + map.levelHeight * 2.25;
}

export function authoredCloudWind(nowMs: number, phaseMs: number): { x: number; z: number } {
  const phase = (nowMs + phaseMs) * 0.00022;
  return {
    x: Math.sin(phase) * 0.42,
    z: Math.sin(phase * 0.61 + 1.7) * 0.18,
  };
}

export function isColdBiomeMaterial(material: unknown): boolean {
  return material === "neige" || material === "glace" || material === "glace-fine";
}

export function authoredMaterialAt(map: MapData, x: number, z: number): unknown {
  const col = Math.floor(x + map.size / 2);
  const row = Math.floor(z + map.size / 2);
  if (col < 0 || row < 0 || col >= map.size || row >= map.size) return null;
  return map.materials[row * map.size + col];
}

/**
 * Places every element and every graphic-bearing event of `map` into `scene`, once.
 *
 * `ctx` must be the very context that built `scene`, for the reason `createBillboardRegistry`
 * carries: `makeBillboard` grafts THAT context's cloud-shadow uniforms onto each sprite and
 * registers the mesh in its yaw registry.
 *
 * Coordinates ride across untouched. `HeightfieldElement`/`HeightfieldEvent` are already in TILE
 * units, grid-centred — the scene's own space — so there is no TILE→PIXEL bridge call in this file,
 * unlike `billboards.ts`'s `sync`, whose actors arrive in the snapshot's pixels.
 */
export function placeStaticContent(
  ctx: Hd2dContext,
  scene: BillboardScene,
  map: MapData,
  resolve: StaticArtResolver,
): StaticContent {
  const placed: {
    sprite: Billboard | Sprite;
    frames: number;
    durationMs: number;
    phaseMs: number;
    anchorX: number;
    anchorY: number;
    anchorZ: number;
    wind: boolean;
  }[] = [];
  /** Unresolved ids, counted rather than reported one by one. A map dressed entirely out of assets
   *  this build cannot draw — the sub-rect crops are a real such family — would otherwise emit one
   *  line per PLACEMENT, hundreds of them, and bury whatever else the console had to say. The same
   *  care the graphicless-event skip below takes, applied to the case that actually is a warning. */
  const skipped = new Map<string, number>();
  // Every vertical billboard with the same z shares the same plane after the context applies its
  // common yaw. Overlapping pixels on that plane otherwise write identical depth and alternate
  // between both textures. Only coplanar siblings receive a bias: different rows keep real depth.
  const depthLayers = new Map<string, number>();
  const fireSources: {
    light: THREE.PointLight;
    glow: THREE.Mesh | null;
    halo: THREE.Mesh | null;
    x: number;
    y: number;
    z: number;
    lift: number;
    phase: number;
    shadow: boolean;
  }[] = [];
  let fireMood = 1.1;

  function placeArt(assetId: string, sprite: StaticSpriteArt, x: number, z: number): void {
    const sky = sprite.renderLayer === "sky";
    const flat = sky || sprite.renderMode === "flat";
    const billboard = flat
      ? makeFlatSprite(ctx, {
          texture: sprite.texture,
          cols: sprite.cols ?? 1,
          rows: sprite.rows ?? 1,
          size: sprite.flatSize ?? sprite.height * (sprite.aspect ?? 1),
          aspect: 1 / (sprite.aspect ?? 1),
          alphaTest: 0.5,
          graftCloudShadow: () => undefined,
        })
      : makeBillboard(ctx, {
          texture: sprite.texture,
          cols: sprite.cols ?? 1,
          rows: sprite.rows ?? 1,
          height: sprite.height,
          aspect: sprite.aspect ?? 1,
          foot: sprite.foot ?? 0,
          ...(sprite.uvRect ? { uvRect: sprite.uvRect } : {}),
          ...(sprite.lit === undefined ? {} : { lit: sprite.lit }),
          pitch: HD2D_CAMERA.pitch,
        });
    // The ground under the piece, or the sea when there is none: an offshore rock is authored on
    // water on purpose, and dropping it would be worse than floating it at sea level.
    const anchorY = sky
      ? authoredSkyAltitude(map)
      : (scene.query.heightAt(x, z) ?? scene.waterLevel);
    if (flat) billboard.mesh.position.set(x, anchorY + (sky ? 0 : 0.03), z);
    else (billboard as Billboard).placeAt(x, anchorY, z);
    const depthKey = z.toFixed(6);
    const depthLayer = depthLayers.get(depthKey) ?? 0;
    depthLayers.set(depthKey, depthLayer + 1);
    if (!sky && depthLayer > 0) {
      const materials = Array.isArray(billboard.mesh.material)
        ? billboard.mesh.material
        : [billboard.mesh.material];
      for (const material of materials) {
        material.polygonOffset = true;
        material.polygonOffsetFactor = -depthLayer;
        material.polygonOffsetUnits = -depthLayer;
        material.needsUpdate = true;
      }
    }
    scene.root.add(billboard.mesh);
    placed.push({
      sprite: billboard,
      frames: (sprite.cols ?? 1) * (sprite.rows ?? 1),
      durationMs: sprite.animationDurationMs ?? 0,
      phaseMs: sprite.animationDurationMs
        ? placementPhase(assetId, x, z, sprite.animationDurationMs)
        : 0,
      anchorX: x,
      anchorY,
      anchorZ: z,
      wind: sky,
    });
    if (sprite.fireLight) {
      const source = sprite.fireLight;
      const light = new THREE.PointLight(source.color, 1, source.distance, source.decay);
      light.position.set(x, anchorY + source.lift, z);
      light.shadow.mapSize.set(256, 256);
      light.shadow.camera.far = Math.min(9, source.distance);
      light.shadow.bias = -0.005;
      scene.root.add(light);
      const glow = source.glow ? makeGlow(5.4, source.color, 0) : null;
      const halo = source.glow ? makeGlow(13, source.color, 1) : null;
      glow?.position.set(x, anchorY + 0.03, z);
      halo?.position.set(x, anchorY + 0.02, z);
      if (glow) scene.root.add(glow);
      if (halo) scene.root.add(halo);
      fireSources.push({
        light,
        glow,
        halo,
        x,
        y: anchorY,
        z,
        lift: source.lift,
        phase: placementPhase(assetId, x, z, 10_000) / 1_000,
        // One point shadow is already six scene renders. Keep the nearest authored group bounded.
        shadow: fireSources.length === 0,
      });
    }
    for (const companion of sprite.companions ?? []) placeArt(assetId, companion, x, z);
  }

  function place(assetId: string, x: number, z: number): void {
    const resolved = resolve(assetId);
    if (!resolved) {
      skipped.set(assetId, (skipped.get(assetId) ?? 0) + 1);
      return;
    }
    const sprite =
      isColdBiomeMaterial(authoredMaterialAt(map, x, z)) && resolved.coldVariant
        ? resolved.coldVariant
        : resolved;
    placeArt(assetId, sprite, x, z);
  }

  for (const element of map.elements) place(element.assetId, element.x, element.z);
  for (const event of map.events) {
    // No graphic is an authored choice, not a missing asset: a bare trigger cell draws nothing and
    // says nothing. Warning here would fill the console on any map that uses invisible triggers.
    if (event.graphicAssetId === null) continue;
    place(event.graphicAssetId, event.x, event.z);
  }
  for (const [assetId, count] of skipped) {
    console.warn(`[hd2d] no art for asset id "${assetId}": skipped ${count} placement(s)`);
  }

  return {
    setFireMood(intensity) {
      fireMood = Math.max(0, intensity);
    },
    update(now) {
      for (const placement of placed) {
        placement.sprite.setFrame(
          staticAnimationFrame(now, placement.durationMs, placement.frames, placement.phaseMs),
        );
        if (placement.wind) {
          const wind = authoredCloudWind(now, placement.phaseMs);
          placement.sprite.mesh.position.set(
            placement.anchorX + wind.x,
            placement.anchorY,
            placement.anchorZ + wind.z,
          );
        }
      }
      const seconds = now / 1_000;
      for (const source of fireSources) {
        const t = seconds + source.phase;
        const flicker = 0.82 + 0.12 * Math.sin(t * 11.3) + 0.08 * Math.sin(t * 27.1 + 1.7);
        source.light.intensity = fireMood * flicker;
        source.light.castShadow = source.shadow && fireMood > 2.2;
        source.light.position.set(
          source.x + Math.sin(t * 3.7) * 0.09,
          source.y + source.lift + Math.sin(t * 5.1 + 0.6) * 0.05,
          source.z + Math.cos(t * 4.3 + 1.9) * 0.09,
        );
        const opacity = THREE.MathUtils.clamp(fireMood / 13, 0.16, 1) * 0.5;
        if (source.glow) {
          (source.glow.material as THREE.MeshBasicMaterial).opacity = opacity;
          source.glow.scale.setScalar(0.94 + flicker * 0.12);
        }
        if (source.halo) {
          (source.halo.material as THREE.MeshBasicMaterial).opacity = opacity;
          source.halo.scale.setScalar(0.88 + flicker * 0.1 + Math.sin(t * 1.9) * 0.05);
          source.halo.rotation.y += 0.001;
        }
      }
    },
    dispose() {
      for (const placement of placed) {
        scene.root.remove(placement.sprite.mesh);
        placement.sprite.dispose();
      }
      placed.length = 0;
      for (const source of fireSources) {
        source.light.removeFromParent();
        for (const glow of [source.glow, source.halo]) {
          if (!glow) continue;
          glow.removeFromParent();
          glow.geometry.dispose();
          const materials = Array.isArray(glow.material) ? glow.material : [glow.material];
          for (const material of materials) material.dispose();
        }
      }
      fireSources.length = 0;
    },
  };
}
