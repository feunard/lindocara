/**
 * The map's own scenery — `MapData.elements` and the active page of `MapData.events` — as static
 * HD-2D visuals. Most props are billboards; buildings and bridges are fixed native geometry.
 *
 * Its own file rather than a second export in `billboards.ts`, because the two answer different
 * questions. `billboards.ts` keeps a registry ALIVE across frames: it diffs the actor list every
 * tick, creates, moves, turns and drops. Scenery has no frame: it is placed once when the map lands
 * and given back when the map goes. Folding it into the actor registry would have meant either
 * inventing a fourth `ActorKind` and re-syncing hundreds of immobile trees sixty times a second, or
 * teaching that registry a second lifecycle — which is exactly the "general sprite framework" its
 * own header refuses to become. What the two DO share is reused rather than copied: the
 * `BillboardScene` shape, `makeBillboard`, and the camera pitch a sprite's stretch is computed from.
 * Native architecture is intentionally absent from the billboard registry: authored orientation
 * rotates it once in world space, while orbiting the camera merely reveals another physical face.
 *
 * TWO rules bind this file, and neither is negotiable:
 *
 * - **Appearance only.** Nothing here derives a collider. The authoring compiler has already baked
 *   terrain, prop footprints and walkable bridge platforms into the stored heightfield; both the
 *   client and room read that same document. This file only aligns visuals to those surfaces.
 * - **An unknown asset id is skipped, never thrown.** A map authored against a catalogue this build
 *   does not have must lose one bush, not the whole world.
 *
 * `@lindocara/hd2d` stays domain-free: which sheet an asset id names, how many frames it holds and
 * where its feet sit are the ADAPTER's knowledge and live in `game-renderer.ts`, exactly as the
 * actor sheets and the terrain atlases do. This file only ever sees the resolved `StaticSpriteArt`.
 */

import type { BridgeDimensions } from "@lindocara/engine/bridges.js";
import type { BuildingDimensions } from "@lindocara/engine/buildings.js";
import type { ElementOrientation } from "@lindocara/engine/element-orientation.js";
import type {
  HeightfieldElement,
  HeightfieldEvent,
  MapData,
} from "@lindocara/engine/hd2d/map-data.js";
import type { Billboard, CardVolume, Sprite, TextureUvRect } from "@lindocara/hd2d/billboard.js";
import {
  makeBillboard,
  makeCardVolume,
  makeFlatSprite,
  makeGlow,
} from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import * as THREE from "three";
import type { BillboardScene } from "./billboards.js";
import {
  type BuildingVolumeArt,
  buildingVolumeHeight,
  makeBridgeVolume,
  makeBuildingVolume,
  type NativeStaticVisual,
} from "./building-volumes.js";
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
  /** Number of populated animation cells when the rectangular sheet grid contains padding. */
  animationFrameCount?: number;
  /** Gentle procedural movement for a single-frame canopy. Kept deliberately tiny: it is wind,
   * not a substitute for swapping unrelated tree silhouettes. */
  sway?: { amplitudeRadians: number; durationMs: number };
  /** Sky art is a horizontal world-space plane, never a camera-facing billboard. */
  renderLayer?: "object" | "canopy" | "sky";
  renderMode?: "billboard" | "flat" | "cloud-volume" | "fixed-volume";
  flatSize?: number;
  lit?: boolean;
  fireLight?: {
    color: number;
    lift: number;
    distance: number;
    decay: number;
    glow: boolean;
  };
  /** A fixed world-space building assembled from real lit faces and roof geometry. */
  buildingVolume?: Omit<BuildingVolumeArt, "front">;
  /** Native raised deck and rails, replacing the old flat bridge crop. */
  bridgeOrientation?: "horizontal" | "vertical";
}

/** Resolves a catalogue asset id to the art it draws with, or `null` when this build has no such
 *  asset — the caller skips it with a warning. */
export type StaticArtResolver = (assetId: string) => StaticSpriteArt | null;

export interface StaticContentEvent extends HeightfieldEvent {
  orientation?: ElementOrientation;
  building?: BuildingDimensions;
  health?: { value: number; max: number; visible: boolean };
}

export interface StaticContent {
  setFireMood(intensity: number): void;
  /** Incrementally updates authored scenery while preserving every unchanged visual. */
  syncElements(elements: readonly HeightfieldElement[], resolve: StaticArtResolver): void;
  /** Incrementally updates authored-event sprites without rebuilding every resource on the map. */
  syncEvents(events: readonly StaticContentEvent[]): void;
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
  return material === "neige" || material === "glace";
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
    contentKey: string | null;
    sprite: Billboard | CardVolume | Sprite | NativeStaticVisual;
    frames: number;
    durationMs: number;
    phaseMs: number;
    lastFrame: number;
    swayAmplitude: number;
    swayDurationMs: number;
    anchorX: number;
    anchorY: number;
    anchorZ: number;
    depthKey: string;
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
    contentKey: string | null;
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
  const eventVisuals = new Map<string, string>();
  const elementVisuals = new Map<string, string>();
  const healthBars: {
    contentKey: string;
    group: THREE.Group;
    fill: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  }[] = [];
  let fireMood = 1.1;

  function placeArt(
    assetId: string,
    sprite: StaticSpriteArt,
    x: number,
    z: number,
    contentKey: string | null,
    orientation: ElementOrientation = 0,
    bridge?: BridgeDimensions,
    building?: BuildingDimensions,
  ): void {
    const sky = sprite.renderLayer === "sky";
    const flat = sky || sprite.renderMode === "flat";
    const native = sprite.buildingVolume
      ? makeBuildingVolume({
          front: sprite.texture,
          ...sprite.buildingVolume,
          orientation,
          ...(building ? { dimensions: building } : {}),
        })
      : sprite.bridgeOrientation
        ? makeBridgeVolume(sprite.texture, sprite.bridgeOrientation, bridge)
        : null;
    const volume =
      native === null &&
      (sprite.renderMode === "cloud-volume" || sprite.renderMode === "fixed-volume")
        ? makeCardVolume(ctx, {
            texture: sprite.texture,
            cols: sprite.cols ?? 1,
            rows: sprite.rows ?? 1,
            height: sprite.height,
            aspect: sprite.aspect ?? 1,
            foot: sprite.foot ?? 0,
            mode: sprite.renderMode === "cloud-volume" ? "cloud" : "vertical",
            ...(sky ? { graftCloudShadow: () => undefined } : {}),
          })
        : null;
    const billboard =
      native ??
      volume ??
      (flat
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
          }));
    const bridgeSampleZ = bridge
      ? z
      : sprite.bridgeOrientation === "horizontal"
        ? z - 0.5
        : sprite.bridgeOrientation === "vertical"
          ? z - 1.5
          : z;
    // A bridge receives the exact platform top authored into the heightfield. Other offshore art
    // still falls back to the sea rather than inventing a gameplay surface from its appearance.
    const anchorY = sky
      ? authoredSkyAltitude(map)
      : sprite.bridgeOrientation
        ? (scene.query.surfaceAt?.(x, bridgeSampleZ, Number.POSITIVE_INFINITY) ??
          scene.query.heightAt(x, bridgeSampleZ) ??
          scene.waterLevel)
        : (scene.query.heightAt(x, z) ?? scene.waterLevel);
    if (native) {
      native.placeAt(x, anchorY, z);
    } else if (flat || sprite.renderMode === "cloud-volume") {
      billboard.mesh.position.set(x, anchorY + (sky ? 0 : 0.03), z);
    } else (billboard as Billboard | CardVolume).placeAt(x, anchorY, z);
    const depthKey = z.toFixed(6);
    const depthLayer = depthLayers.get(depthKey) ?? 0;
    depthLayers.set(depthKey, depthLayer + 1);
    if (!native && !sky && depthLayer > 0) {
      const mesh = billboard.mesh as THREE.Mesh;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        material.polygonOffset = true;
        material.polygonOffsetFactor = -depthLayer;
        material.polygonOffsetUnits = -depthLayer;
        material.needsUpdate = true;
      }
    }
    scene.root.add(billboard.mesh);
    placed.push({
      contentKey,
      sprite: billboard,
      frames: sprite.animationFrameCount ?? (sprite.cols ?? 1) * (sprite.rows ?? 1),
      durationMs: sprite.animationDurationMs ?? 0,
      phaseMs: placementPhase(
        assetId,
        x,
        z,
        sprite.animationDurationMs ?? sprite.sway?.durationMs ?? 1,
      ),
      lastFrame: 0,
      swayAmplitude: Math.max(0, sprite.sway?.amplitudeRadians ?? 0),
      swayDurationMs: Math.max(0, sprite.sway?.durationMs ?? 0),
      anchorX: x,
      anchorY,
      anchorZ: z,
      depthKey,
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
        contentKey,
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
    for (const companion of sprite.companions ?? []) {
      placeArt(assetId, companion, x, z, contentKey, orientation);
    }
  }

  function placeHealthBar(
    contentKey: string,
    x: number,
    y: number,
    z: number,
    health: NonNullable<StaticContentEvent["health"]>,
  ): void {
    const ratio = THREE.MathUtils.clamp(health.max > 0 ? health.value / health.max : 0, 0, 1);
    const group = new THREE.Group();
    const background = new THREE.Mesh(
      new THREE.PlaneGeometry(1.65, 0.15),
      new THREE.MeshBasicMaterial({ color: 0x211d24, depthTest: false }),
    );
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(1.55, 0.09),
      new THREE.MeshBasicMaterial({
        color: ratio > 0.5 ? 0x73c76b : ratio > 0.25 ? 0xe0b657 : 0xd45d55,
        depthTest: false,
      }),
    );
    fill.position.z = 0.01;
    fill.scale.x = Math.max(0.0001, ratio);
    fill.position.x = -(1 - ratio) * (1.55 / 2);
    group.add(background, fill);
    group.position.set(x, y, z);
    group.visible = health.visible && ratio > 0;
    group.renderOrder = 70;
    scene.root.add(group);
    healthBars.push({ contentKey, group, fill });
  }

  function place(
    assetId: string,
    x: number,
    z: number,
    contentKey: string | null,
    health?: StaticContentEvent["health"],
    orientation: ElementOrientation = 0,
    bridge?: BridgeDimensions,
    building?: BuildingDimensions,
  ): void {
    const resolved = resolve(assetId);
    if (!resolved) {
      skipped.set(assetId, (skipped.get(assetId) ?? 0) + 1);
      return;
    }
    const sprite =
      isColdBiomeMaterial(authoredMaterialAt(map, x, z)) && resolved.coldVariant
        ? resolved.coldVariant
        : resolved;
    placeArt(assetId, sprite, x, z, contentKey, orientation, bridge, building);
    if (contentKey && health) {
      const anchorY = scene.query.heightAt(x, z) ?? scene.waterLevel;
      placeHealthBar(
        contentKey,
        x,
        anchorY +
          (sprite.buildingVolume
            ? buildingVolumeHeight(sprite.buildingVolume.archetype, sprite.buildingVolume.state) +
              0.4
            : sprite.height + 0.4),
        z,
        health,
      );
    }
  }

  const elementKey = (index: number): string => `element:${index}`;
  const elementVisual = (element: HeightfieldElement): string =>
    `${element.assetId}:${element.x}:${element.z}:${element.orientation ?? 0}:${element.bridge?.length ?? ""}:${element.bridge?.width ?? ""}:${element.building?.width ?? ""}:${element.building?.depth ?? ""}`;

  for (const [index, element] of map.elements.entries()) {
    const key = elementKey(index);
    elementVisuals.set(key, elementVisual(element));
    place(
      element.assetId,
      element.x,
      element.z,
      key,
      undefined,
      element.orientation ?? 0,
      element.bridge,
      element.building,
    );
  }
  for (const event of map.events) {
    // No graphic is an authored choice, not a missing asset: a bare trigger cell draws nothing and
    // says nothing. Warning here would fill the console on any map that uses invisible triggers.
    const staticEvent = event as StaticContentEvent;
    const health = staticEvent.health;
    const orientation = staticEvent.orientation ?? 0;
    const visual = `${event.graphicAssetId ?? ""}:${event.x}:${event.z}:${orientation}:${staticEvent.building?.width ?? ""}:${staticEvent.building?.depth ?? ""}:${health?.value ?? ""}:${health?.max ?? ""}`;
    eventVisuals.set(event.id, visual);
    if (event.graphicAssetId === null) continue;
    place(
      event.graphicAssetId,
      event.x,
      event.z,
      `event:${event.id}`,
      health,
      orientation,
      undefined,
      staticEvent.building,
    );
  }
  function flushSkipped(): void {
    for (const [assetId, count] of skipped) {
      console.warn(`[hd2d] no art for asset id "${assetId}": skipped ${count} placement(s)`);
    }
    skipped.clear();
  }

  function disposePlacement(index: number): void {
    const placement = placed[index];
    if (!placement) return;
    scene.root.remove(placement.sprite.mesh);
    placement.sprite.dispose();
    const depthCount = depthLayers.get(placement.depthKey) ?? 1;
    if (depthCount <= 1) depthLayers.delete(placement.depthKey);
    else depthLayers.set(placement.depthKey, depthCount - 1);
    placed.splice(index, 1);
  }

  function disposeFireSource(index: number): void {
    const source = fireSources[index];
    if (!source) return;
    source.light.removeFromParent();
    for (const glow of [source.glow, source.halo]) {
      if (!glow) continue;
      glow.removeFromParent();
      glow.geometry.dispose();
      const materials = Array.isArray(glow.material) ? glow.material : [glow.material];
      for (const material of materials) material.dispose();
    }
    fireSources.splice(index, 1);
  }

  function dropContentKey(contentKey: string): void {
    for (let index = placed.length - 1; index >= 0; index -= 1) {
      if (placed[index]?.contentKey === contentKey) disposePlacement(index);
    }
    for (let index = fireSources.length - 1; index >= 0; index -= 1) {
      if (fireSources[index]?.contentKey === contentKey) disposeFireSource(index);
    }
    for (let index = healthBars.length - 1; index >= 0; index -= 1) {
      const bar = healthBars[index];
      if (!bar || bar.contentKey !== contentKey) continue;
      bar.group.removeFromParent();
      bar.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      });
      healthBars.splice(index, 1);
    }
    for (let index = 0; index < fireSources.length; index += 1) {
      const source = fireSources[index];
      if (source) source.shadow = index === 0;
    }
  }
  flushSkipped();

  return {
    setFireMood(intensity) {
      fireMood = Math.max(0, intensity);
    },
    syncElements(elements, nextResolve) {
      resolve = nextResolve;
      const desiredKeys = new Set(elements.map((_element, index) => elementKey(index)));
      for (const key of elementVisuals.keys()) {
        if (desiredKeys.has(key)) continue;
        dropContentKey(key);
        elementVisuals.delete(key);
      }
      for (const [index, element] of elements.entries()) {
        const key = elementKey(index);
        const visual = elementVisual(element);
        if (elementVisuals.get(key) === visual) continue;
        dropContentKey(key);
        elementVisuals.set(key, visual);
        place(
          element.assetId,
          element.x,
          element.z,
          key,
          undefined,
          element.orientation ?? 0,
          element.bridge,
          element.building,
        );
      }
      flushSkipped();
    },
    syncEvents(events) {
      const desiredIds = new Set(events.map((event) => event.id));
      for (const id of eventVisuals.keys()) {
        if (desiredIds.has(id)) continue;
        dropContentKey(`event:${id}`);
        eventVisuals.delete(id);
      }
      for (const event of events) {
        const visual = `${event.graphicAssetId ?? ""}:${event.x}:${event.z}:${event.orientation ?? 0}:${event.building?.width ?? ""}:${event.building?.depth ?? ""}:${event.health?.value ?? ""}:${event.health?.max ?? ""}`;
        if (eventVisuals.get(event.id) === visual) continue;
        dropContentKey(`event:${event.id}`);
        eventVisuals.set(event.id, visual);
        if (event.graphicAssetId !== null) {
          place(
            event.graphicAssetId,
            event.x,
            event.z,
            `event:${event.id}`,
            event.health,
            event.orientation ?? 0,
            undefined,
            event.building,
          );
        }
      }
      flushSkipped();
    },
    update(now) {
      for (const placement of placed) {
        const frame = staticAnimationFrame(
          now,
          placement.durationMs,
          placement.frames,
          placement.phaseMs,
        );
        if (frame !== placement.lastFrame) {
          placement.sprite.setFrame(frame);
          placement.lastFrame = frame;
        }
        if (placement.swayDurationMs > 0 && placement.swayAmplitude > 0) {
          const phase = ((now + placement.phaseMs) / placement.swayDurationMs) * Math.PI * 2;
          placement.sprite.mesh.rotation.z = Math.sin(phase) * placement.swayAmplitude;
        }
        if (placement.wind) {
          const wind = authoredCloudWind(now, placement.phaseMs);
          placement.sprite.mesh.position.set(
            placement.anchorX + wind.x,
            placement.anchorY,
            placement.anchorZ + wind.z,
          );
        }
        if ("update" in placement.sprite) placement.sprite.update(now);
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
      for (const bar of healthBars) bar.group.rotation.y = ctx.yaw();
    },
    dispose() {
      for (let index = placed.length - 1; index >= 0; index -= 1) disposePlacement(index);
      for (let index = fireSources.length - 1; index >= 0; index -= 1) disposeFireSource(index);
      eventVisuals.clear();
      for (const bar of healthBars.splice(0)) {
        bar.group.removeFromParent();
        bar.group.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material.dispose();
        });
      }
    },
  };
}
