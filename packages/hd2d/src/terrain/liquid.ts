import * as THREE from "three";

import type { Hd2dContext } from "../context.js";
import type { HeightField } from "./field.js";
import { createWaterfall, type Waterfall } from "./waterfall.js";

export type LiquidKind = "water" | "lava";

export interface LiquidFallPlacement {
  kind: LiquidKind;
  x: number;
  z: number;
  width: number;
  topY: number;
  bottomY: number;
  facing: "east" | "west" | "north" | "south";
}

export interface LiquidTerrainOptions {
  levelHeight: number;
  waterLevel: number;
  waterTexture: THREE.Texture;
  lavaTexture: THREE.Texture;
}

export interface LiquidTerrain {
  group: THREE.Group;
  /** Surfaces horizontales utilisables par le rayon de sélection de l'éditeur. */
  surfaces: readonly THREE.Mesh[];
  update(dt: number): void;
  dispose(): void;
}

interface UnitFall extends LiquidFallPlacement {
  /** Coordonnée de départ sur l'axe qui longe le rebord, avant regroupement. */
  along: number;
  /** Coordonnée fixe du rebord. */
  fixed: number;
}

const DIRECTIONS = [
  { di: 1, dj: 0, facing: "east" as const },
  { di: -1, dj: 0, facing: "west" as const },
  { di: 0, dj: -1, facing: "north" as const },
  { di: 0, dj: 1, facing: "south" as const },
] as const;

const SURFACE_CLEARANCE = 0.012;
const FALL_EPSILON = 0.04;

function liquidLevel(field: HeightField, i: number, j: number): number | null {
  return field.liquidLevelAt?.(i, j) ?? null;
}

function cellSurfaceY(
  field: HeightField,
  i: number,
  j: number,
  levelHeight: number,
  waterLevel: number,
): number {
  const liquid = liquidLevel(field, i, j);
  if (liquid !== null) return liquid * levelHeight;
  const ground = field.levelAt(i, j);
  return ground === null ? waterLevel : ground * levelHeight;
}

/**
 * Déduit les nappes qui tombent d'un liquide élevé vers la surface voisine. Les segments
 * colinéaires identiques sont réunis : un bord de lac long de vingt cases reste une seule chute.
 */
export function liquidFallPlacements(
  field: HeightField,
  levelHeight: number,
  waterLevel: number,
): LiquidFallPlacement[] {
  const halfX = field.cols / 2;
  const halfZ = field.rows / 2;
  const units: UnitFall[] = [];
  for (let j = 0; j < field.rows; j++) {
    for (let i = 0; i < field.cols; i++) {
      const kind = field.liquidAt?.(i, j) ?? null;
      const tier = liquidLevel(field, i, j);
      if (!kind || tier === null) continue;
      const topY = tier * levelHeight;
      for (const direction of DIRECTIONS) {
        const ni = i + direction.di;
        const nj = j + direction.dj;
        const bottomY = cellSurfaceY(field, ni, nj, levelHeight, waterLevel);
        if (topY - bottomY <= FALL_EPSILON) continue;
        const alongX = direction.facing === "north" || direction.facing === "south";
        const fixed = alongX
          ? j + (direction.facing === "south" ? 1 : 0) - halfZ
          : i + (direction.facing === "east" ? 1 : 0) - halfX;
        const along = alongX ? i - halfX : j - halfZ;
        units.push({
          kind,
          x: alongX ? i + 0.5 - halfX : fixed,
          z: alongX ? fixed : j + 0.5 - halfZ,
          width: 1,
          topY,
          bottomY,
          facing: direction.facing,
          along,
          fixed,
        });
      }
    }
  }

  units.sort((a, b) => {
    const ka = `${a.kind}:${a.facing}:${a.topY}:${a.bottomY}:${a.fixed}`;
    const kb = `${b.kind}:${b.facing}:${b.topY}:${b.bottomY}:${b.fixed}`;
    return ka.localeCompare(kb) || a.along - b.along;
  });

  const merged: LiquidFallPlacement[] = [];
  for (const unit of units) {
    const previous = merged.at(-1);
    const alongX = unit.facing === "north" || unit.facing === "south";
    const previousEnd = previous
      ? (alongX ? previous.x : previous.z) + previous.width / 2
      : Number.NaN;
    if (
      previous &&
      previous.kind === unit.kind &&
      previous.facing === unit.facing &&
      previous.topY === unit.topY &&
      previous.bottomY === unit.bottomY &&
      Math.abs((alongX ? previous.z : previous.x) - unit.fixed) < 1e-9 &&
      Math.abs(previousEnd - unit.along) < 1e-9
    ) {
      previous.width += 1;
      if (alongX) previous.x += 0.5;
      else previous.z += 0.5;
      continue;
    }
    merged.push({
      kind: unit.kind,
      x: unit.x,
      z: unit.z,
      width: 1,
      topY: unit.topY,
      bottomY: unit.bottomY,
      facing: unit.facing,
    });
  }
  return merged;
}

interface SurfaceGeometry {
  geometry: THREE.BufferGeometry;
}

function surfaceGeometry(
  field: HeightField,
  kind: LiquidKind,
  levelHeight: number,
): SurfaceGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const halfX = field.cols / 2;
  const halfZ = field.rows / 2;

  for (let j = 0; j < field.rows; j++) {
    let i = 0;
    while (i < field.cols) {
      const tier = liquidLevel(field, i, j);
      if (field.liquidAt?.(i, j) !== kind || tier === null) {
        i++;
        continue;
      }
      const start = i;
      while (
        i + 1 < field.cols &&
        field.liquidAt?.(i + 1, j) === kind &&
        liquidLevel(field, i + 1, j) === tier
      ) {
        i++;
      }
      const end = i + 1;
      const x0 = start - halfX;
      const x1 = end - halfX;
      const z0 = j - halfZ;
      const z1 = j + 1 - halfZ;
      const y = tier * levelHeight + SURFACE_CLEARANCE;
      const base = positions.length / 3;
      positions.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
      // Les UV sont mondiales : deux bandes adjacentes partagent le même courant sans couture.
      uvs.push(x0 / 3, z0 / 3, x1 / 3, z0 / 3, x1 / 3, z1 / 3, x0 / 3, z1 / 3);
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      i++;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry };
}

function cloneSurfaceTexture(source: THREE.Texture): THREE.Texture {
  const texture = source.clone();
  texture.wrapS = THREE.MirroredRepeatWrapping;
  texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.repeat.set(1, 1);
  texture.needsUpdate = true;
  return texture;
}

interface LiquidSurface {
  mesh: THREE.Mesh;
  overlay: THREE.Mesh | null;
  map: THREE.Texture;
  overlayMap: THREE.Texture | null;
  material: THREE.MeshStandardMaterial;
  overlayMaterial: THREE.MeshBasicMaterial | null;
  update(dt: number): void;
  dispose(): void;
}

function createSurface(
  geometry: THREE.BufferGeometry,
  kind: LiquidKind,
  source: THREE.Texture,
): LiquidSurface {
  const map = cloneSurfaceTexture(source);
  const lava = kind === "lava";
  const material = new THREE.MeshStandardMaterial({
    map,
    color: lava ? 0xffb12b : 0x72c9e8,
    emissive: lava ? 0xff4b0b : 0x092e3a,
    emissiveMap: lava ? map : null,
    emissiveIntensity: lava ? 0.78 : 0.08,
    roughness: lava ? 0.72 : 0.38,
    metalness: lava ? 0 : 0.05,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = !lava;
  mesh.renderOrder = 1;
  mesh.userData.liquidSurface = kind;

  const overlayMap = lava ? cloneSurfaceTexture(source) : null;
  const overlayMaterial = overlayMap
    ? new THREE.MeshBasicMaterial({
        map: overlayMap,
        color: 0xffdb67,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
    : null;
  const overlay = overlayMaterial ? new THREE.Mesh(geometry, overlayMaterial) : null;
  if (overlay) {
    overlay.position.y = SURFACE_CLEARANCE;
    overlay.renderOrder = 2;
  }

  let elapsed = 0;
  return {
    mesh,
    overlay,
    map,
    overlayMap,
    material,
    overlayMaterial,
    update(dt) {
      elapsed += dt;
      const speed = lava ? 0.012 : 0.035;
      map.offset.set(elapsed * speed, Math.sin(elapsed * (lava ? 0.13 : 0.35)) * speed * 2);
      if (overlayMap && overlayMaterial) {
        overlayMap.offset.set(-elapsed * 0.019, elapsed * 0.009);
        overlayMaterial.opacity = 0.16 + (Math.sin(elapsed * 0.7) + 1) * 0.04;
        material.emissiveIntensity = 0.72 + (Math.sin(elapsed * 0.45) + 1) * 0.09;
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      map.dispose();
      overlayMaterial?.dispose();
      overlayMap?.dispose();
    },
  };
}

/** Construit toutes les surfaces liquides élevées, leurs chutes et leurs courants animés. */
export function createLiquidTerrain(
  ctx: Hd2dContext,
  field: HeightField,
  opts: LiquidTerrainOptions,
): LiquidTerrain {
  const group = new THREE.Group();
  const surfaces: LiquidSurface[] = [];
  const picked: THREE.Mesh[] = [];

  for (const kind of ["water", "lava"] as const) {
    const built = surfaceGeometry(field, kind, opts.levelHeight);
    if (built.geometry.getAttribute("position").count === 0) {
      built.geometry.dispose();
      continue;
    }
    const surface = createSurface(
      built.geometry,
      kind,
      kind === "water" ? opts.waterTexture : opts.lavaTexture,
    );
    surfaces.push(surface);
    picked.push(surface.mesh);
    group.add(surface.mesh);
    if (surface.overlay) group.add(surface.overlay);
  }

  const falls: Waterfall[] = liquidFallPlacements(field, opts.levelHeight, opts.waterLevel).map(
    (placement) =>
      createWaterfall(ctx, {
        ...placement,
        texture: placement.kind === "water" ? opts.waterTexture : opts.lavaTexture,
        speed: placement.kind === "water" ? 1.6 : 0.58,
      }),
  );
  for (const fall of falls) group.add(fall.group);

  return {
    group,
    surfaces: picked,
    update(dt) {
      for (const surface of surfaces) surface.update(dt);
      for (const fall of falls) fall.update(dt);
    },
    dispose() {
      for (const surface of surfaces) surface.dispose();
      for (const fall of falls) fall.dispose();
      group.clear();
    },
  };
}
