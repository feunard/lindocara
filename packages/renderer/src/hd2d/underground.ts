import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import type { InteriorShellStyle } from "@lindocara/engine/map-environment.js";
import {
  undergroundCells,
  undergroundFloorHeight,
  undergroundShaftCell,
  undergroundStairFootprint,
  undergroundStairMouth,
  undergroundSurfaceOpenings,
  undergroundTerrainCells,
  undergroundVisibleDepthsAtElevation,
  UNDERGROUND_SLAB_THICKNESS,
} from "@lindocara/engine/underground.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";

const HD2D_ROOT = "/assets/lindocara/hd2d";
const TINY_TERRAIN_ROOT = "/assets/lindocara/tiny-swords/terrain";
const STYLE_TEXTURE: Record<InteriorShellStyle, { url: string; atlas: boolean; color: number }> = {
  timber: { url: `${HD2D_ROOT}/buildings/wall-timber.png`, atlas: false, color: 0x5b3a28 },
  castle: { url: `${HD2D_ROOT}/buildings/cream-stone.png`, atlas: false, color: 0x77777c },
  cave: { url: `${HD2D_ROOT}/tileset-grotte.png`, atlas: true, color: 0x465052 },
  mountain: { url: `${HD2D_ROOT}/tileset-montagne.png`, atlas: true, color: 0x626a68 },
  volcano: { url: `${HD2D_ROOT}/tileset-volcan.png`, atlas: true, color: 0x493535 },
  ice: { url: `${HD2D_ROOT}/tileset-glace.png`, atlas: true, color: 0x8bbbc8 },
  snow: { url: `${HD2D_ROOT}/tileset-neige.png`, atlas: true, color: 0xbfc7c5 },
};

export interface UndergroundVisual {
  group: THREE.Group;
  setDepth(depth: number | null): void;
  /** Gameplay descent: keeps adjacent storeys visible around the body's exact elevation. */
  setElevation(elevation: number | null): void;
  setCameraYaw(yaw: number): void;
  dispose(): void;
}

function textureFor(style: InteriorShellStyle, textures: TextureRegistry): THREE.Texture {
  const surface = STYLE_TEXTURE[style];
  const texture = textures.get(surface.url).clone();
  if (surface.atlas) {
    texture.repeat.set(1 / 9, 1 / 6);
    texture.offset.set(6 / 9, 1 / 6);
  }
  texture.needsUpdate = true;
  return texture;
}

function terrainTextureFor(material: string, textures: TextureRegistry): THREE.Texture | null {
  if (material === "water") return null;
  const url =
    material === "herbe"
      ? `${TINY_TERRAIN_ROOT}/Tilemap_color1.png`
      : material === "sable"
        ? `${TINY_TERRAIN_ROOT}/Tilemap_Flat.png`
        : `${HD2D_ROOT}/tileset-${material}.png`;
  const texture = textures.get(url).clone();
  const cols = material === "sable" ? 10 : 9;
  const rows = material === "sable" ? 4 : 6;
  texture.repeat.set(1 / cols, 1 / rows);
  texture.offset.set(6 / cols, 1 / rows);
  texture.needsUpdate = true;
  return texture;
}

/** Instanced, level-addressable underground rooms built from the exact authored excavation mask. */
export function createUnderground(map: MapData, textures: TextureRegistry): UndergroundVisual {
  const root = new THREE.Group();
  root.name = "underground";
  const surfaceAccess = new THREE.Group();
  surfaceAccess.name = "underground-surface-access";
  root.add(surfaceAccess);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const ownedTextures: THREE.Texture[] = [];
  const levels = new Map<
    number,
    {
      group: THREE.Group;
      walls: Map<string, THREE.InstancedMesh>;
      tintedMaterials: Array<{
        material: THREE.MeshLambertMaterial | THREE.MeshPhongMaterial;
        color: THREE.Color;
      }>;
    }
  >();
  const accessWalls: Array<{
    side: "west" | "east" | "north" | "south";
    mesh: THREE.InstancedMesh;
  }> = [];
  const box = new THREE.BoxGeometry(1, 1, 1);
  const matrix = new THREE.Matrix4();
  geometries.push(box);

  for (const level of map.underground?.levels ?? []) {
    const group = new THREE.Group();
    group.name = `underground-${level.depth}`;
    const cells = undergroundCells(level, map.size);
    const floorY = undergroundFloorHeight(level.depth);
    const surface = STYLE_TEXTURE[level.style];
    const texture = textureFor(level.style, textures);
    ownedTextures.push(texture);
    const floorMaterial = new THREE.MeshLambertMaterial({ map: texture, color: 0xffffff });
    const wallMaterial = new THREE.MeshLambertMaterial({
      map: texture,
      color: surface.color,
      side: THREE.DoubleSide,
    });
    const tintedMaterials: Array<{
      material: THREE.MeshLambertMaterial | THREE.MeshPhongMaterial;
      color: THREE.Color;
    }> = [
      { material: floorMaterial, color: floorMaterial.color.clone() },
      { material: wallMaterial, color: wallMaterial.color.clone() },
    ];
    materials.push(floorMaterial, wallMaterial);
    const floorCells = level.cells.flatMap((run) =>
      Array.from({ length: run.length }, (_unused, offset) => ({
        col: run.col + offset,
        row: run.row,
      })),
    );
    const floorOpening = (col: number, row: number): boolean =>
      (map.underground?.stairs ?? []).some((stair) => {
        if (stair.depth !== level.depth + 1) return false;
        const footprint = undergroundStairFootprint(stair);
        return (
          col >= stair.col &&
          col < stair.col + footprint.cols &&
          row >= stair.row &&
          row < stair.row + footprint.rows
        );
      }) || undergroundShaftCell(map.underground?.shafts, col, row, level.depth + 1);
    const terrainCells = undergroundTerrainCells(level, map.size);
    const visibleFloorCells = floorCells.filter(
      (cell) =>
        !floorOpening(cell.col, cell.row) && terrainCells[cell.row * map.size + cell.col] === null,
    );
    const floor = new THREE.InstancedMesh(box, floorMaterial, visibleFloorCells.length);
    floor.name = `underground-floor-${level.depth}`;
    floor.receiveShadow = true;
    visibleFloorCells.forEach((cell, index) => {
      matrix.compose(
        new THREE.Vector3(
          cell.col + 0.5 - map.size / 2,
          floorY - UNDERGROUND_SLAB_THICKNESS / 2,
          cell.row + 0.5 - map.size / 2,
        ),
        new THREE.Quaternion(),
        new THREE.Vector3(1, UNDERGROUND_SLAB_THICKNESS, 1),
      );
      floor.setMatrixAt(index, matrix);
    });
    floor.instanceMatrix.needsUpdate = true;
    floor.computeBoundingSphere();
    group.add(floor);
    const overrides = new Map<string, Array<{ col: number; row: number }>>();
    for (const cell of floorCells) {
      if (floorOpening(cell.col, cell.row)) continue;
      const material = terrainCells[cell.row * map.size + cell.col];
      if (material === null || material === undefined) continue;
      const entries = overrides.get(material) ?? [];
      entries.push(cell);
      overrides.set(material, entries);
    }
    for (const [material, entries] of overrides) {
      const overrideTexture = terrainTextureFor(material, textures);
      if (overrideTexture) ownedTextures.push(overrideTexture);
      const overrideMaterial =
        material === "water"
          ? new THREE.MeshPhongMaterial({ color: 0x2d7fbb, transparent: true, opacity: 0.78 })
          : new THREE.MeshLambertMaterial({
              map: overrideTexture,
              color: material === "lave" ? 0xff8a3d : 0xffffff,
              ...(material === "lave" ? { emissive: 0x5a1600, emissiveIntensity: 0.45 } : {}),
            });
      materials.push(overrideMaterial);
      tintedMaterials.push({ material: overrideMaterial, color: overrideMaterial.color.clone() });
      const overrideFloor = new THREE.InstancedMesh(box, overrideMaterial, entries.length);
      overrideFloor.name = `underground-terrain-${level.depth}-${material}`;
      entries.forEach((cell, index) => {
        matrix.compose(
          new THREE.Vector3(
            cell.col + 0.5 - map.size / 2,
            floorY + (material === "water" ? 0.025 : -UNDERGROUND_SLAB_THICKNESS / 2),
            cell.row + 0.5 - map.size / 2,
          ),
          new THREE.Quaternion(),
          new THREE.Vector3(1, material === "water" ? 0.035 : UNDERGROUND_SLAB_THICKNESS, 1),
        );
        overrideFloor.setMatrixAt(index, matrix);
      });
      overrideFloor.instanceMatrix.needsUpdate = true;
      overrideFloor.computeBoundingSphere();
      group.add(overrideFloor);
    }

    const wallCells = new Map<string, Array<{ col: number; row: number }>>(
      ["north", "east", "south", "west"].map((side) => [side, []]),
    );
    for (let row = 0; row < map.size; row += 1) {
      for (let col = 0; col < map.size; col += 1) {
        if (cells[row * map.size + col] === 0) continue;
        if (
          (row === 0 || cells[(row - 1) * map.size + col] === 0) &&
          !undergroundStairMouth(map.underground?.stairs ?? [], level.depth, col, row, 0, -1)
        )
          wallCells.get("north")?.push({ col, row });
        if (
          (row === map.size - 1 || cells[(row + 1) * map.size + col] === 0) &&
          !undergroundStairMouth(map.underground?.stairs ?? [], level.depth, col, row, 0, 1)
        )
          wallCells.get("south")?.push({ col, row });
        if (
          (col === 0 || cells[row * map.size + col - 1] === 0) &&
          !undergroundStairMouth(map.underground?.stairs ?? [], level.depth, col, row, -1, 0)
        )
          wallCells.get("west")?.push({ col, row });
        if (
          (col === map.size - 1 || cells[row * map.size + col + 1] === 0) &&
          !undergroundStairMouth(map.underground?.stairs ?? [], level.depth, col, row, 1, 0)
        )
          wallCells.get("east")?.push({ col, row });
      }
    }
    const walls = new Map<string, THREE.InstancedMesh>();
    const wallHeight = level.depth === 1 ? 2.4 - UNDERGROUND_SLAB_THICKNESS : 2.4;
    for (const [side, entries] of wallCells) {
      if (entries.length === 0) continue;
      const wall = new THREE.InstancedMesh(box, wallMaterial, entries.length);
      wall.name = `underground-wall-${level.depth}-${side}`;
      wall.castShadow = true;
      wall.receiveShadow = true;
      entries.forEach((entry, index) => {
        const horizontal = side === "north" || side === "south";
        const x =
          entry.col + 0.5 - map.size / 2 + (side === "east" ? 0.47 : side === "west" ? -0.47 : 0);
        const z =
          entry.row + 0.5 - map.size / 2 + (side === "south" ? 0.47 : side === "north" ? -0.47 : 0);
        matrix.compose(
          new THREE.Vector3(x, floorY + wallHeight / 2, z),
          new THREE.Quaternion(),
          new THREE.Vector3(horizontal ? 1 : 0.16, wallHeight, horizontal ? 0.16 : 1),
        );
        wall.setMatrixAt(index, matrix);
      });
      wall.instanceMatrix.needsUpdate = true;
      wall.computeBoundingSphere();
      group.add(wall);
      walls.set(side, wall);
    }
    root.add(group);
    levels.set(level.depth, { group, walls, tintedMaterials });
  }

  const openings = undergroundSurfaceOpenings(map.underground, map.size);
  const openingAt = (col: number, row: number): boolean =>
    col >= 0 &&
    row >= 0 &&
    col < map.size &&
    row < map.size &&
    openings[row * map.size + col] !== 0;
  const levelOneStyle = map.underground?.levels.find((level) => level.depth === 1)?.style ?? "cave";
  if (openings.some((cell) => cell !== 0)) {
    const texture = textureFor(levelOneStyle, textures);
    ownedTextures.push(texture);
    const rimMaterial = new THREE.MeshLambertMaterial({ map: texture, color: 0xffffff });
    const shaftMaterial = new THREE.MeshBasicMaterial({ color: 0x010203 });
    materials.push(rimMaterial, shaftMaterial);
    const rims: Array<{ x: number; y: number; z: number; w: number; d: number }> = [];
    const trenchWalls = new Map<
      string,
      {
        material: string;
        side: "west" | "east" | "north" | "south";
        entries: Array<{ x: number; top: number; bottom: number; z: number; w: number; d: number }>;
      }
    >();
    const shaftCells: Array<{ col: number; row: number; y: number }> = [];
    const addTrenchWall = (
      material: string,
      side: "west" | "east" | "north" | "south",
      entry: { x: number; top: number; bottom: number; z: number; w: number; d: number },
    ): void => {
      const key = `${material}:${side}`;
      const group = trenchWalls.get(key) ?? { material, side, entries: [] };
      group.entries.push(entry);
      trenchWalls.set(key, group);
    };
    for (let row = 0; row < map.size; row += 1) {
      for (let col = 0; col < map.size; col += 1) {
        if (!openingAt(col, row)) continue;
        const index = row * map.size + col;
        const y = (map.levels[index] ?? 0) * map.levelHeight;
        const x = col + 0.5 - map.size / 2;
        const z = row + 0.5 - map.size / 2;
        const shaft = undergroundShaftCell(map.underground?.shafts, col, row);
        if (shaft) shaftCells.push({ col, row, y });
        const stair = (map.underground?.stairs ?? []).find((candidate) => {
          if (candidate.depth !== 1) return false;
          const footprint = undergroundStairFootprint(candidate);
          return (
            col >= candidate.col &&
            col < candidate.col + footprint.cols &&
            row >= candidate.row &&
            row < candidate.row + footprint.rows
          );
        });
        const alongX = stair?.direction === "east" || stair?.direction === "west";
        const stairBottom = stair
          ? (() => {
              const along = alongX
                ? (col + 0.5 - stair.col) / stair.length
                : (row + 0.5 - stair.row) / stair.length;
              const progress =
                stair.direction === "east" || stair.direction === "south" ? along : 1 - along;
              return undergroundFloorHeight(1) + progress * -undergroundFloorHeight(1);
            })()
          : undergroundFloorHeight(1);
        const material = map.materials[index] ?? levelOneStyle;
        const edge = (
          side: "west" | "east" | "north" | "south",
          entry: { x: number; z: number; w: number; d: number },
        ): void => {
          rims.push({ ...entry, y });
          const lateral = stair
            ? alongX
              ? side === "north" || side === "south"
              : side === "west" || side === "east"
            : true;
          if (shaft || lateral)
            addTrenchWall(material, side, {
              ...entry,
              top: y,
              bottom: shaft ? undergroundFloorHeight(1) : stairBottom,
            });
        };
        if (!openingAt(col - 1, row)) edge("west", { x: x - 0.46, z, w: 0.12, d: 1 });
        if (!openingAt(col + 1, row)) edge("east", { x: x + 0.46, z, w: 0.12, d: 1 });
        if (!openingAt(col, row - 1)) edge("north", { x, z: z - 0.46, w: 1, d: 0.12 });
        if (!openingAt(col, row + 1)) edge("south", { x, z: z + 0.46, w: 1, d: 0.12 });
      }
    }
    const rim = new THREE.InstancedMesh(box, rimMaterial, rims.length);
    rim.name = "underground-access-rim";
    rims.forEach((entry, index) => {
      matrix.compose(
        new THREE.Vector3(entry.x, entry.y + 0.035, entry.z),
        new THREE.Quaternion(),
        new THREE.Vector3(entry.w, 0.07, entry.d),
      );
      rim.setMatrixAt(index, matrix);
    });
    rim.instanceMatrix.needsUpdate = true;
    surfaceAccess.add(rim);
    for (const { material, side, entries } of trenchWalls.values()) {
      const wallTexture = terrainTextureFor(material, textures) ?? texture.clone();
      if (wallTexture !== texture) ownedTextures.push(wallTexture);
      const wallMaterial = new THREE.MeshLambertMaterial({
        map: wallTexture,
        color: material === "herbe" ? 0x78634f : 0x929292,
        side: THREE.DoubleSide,
      });
      materials.push(wallMaterial);
      const wall = new THREE.InstancedMesh(box, wallMaterial, entries.length);
      wall.name = `underground-access-wall-${material}`;
      wall.castShadow = true;
      wall.receiveShadow = true;
      entries.forEach((entry, index) => {
        const height = Math.max(0.06, entry.top - entry.bottom);
        matrix.compose(
          new THREE.Vector3(entry.x, entry.top - height / 2, entry.z),
          new THREE.Quaternion(),
          new THREE.Vector3(entry.w, height, entry.d),
        );
        wall.setMatrixAt(index, matrix);
      });
      wall.instanceMatrix.needsUpdate = true;
      wall.computeBoundingSphere();
      surfaceAccess.add(wall);
      accessWalls.push({ side, mesh: wall });
    }
    const aperture = new THREE.InstancedMesh(box, shaftMaterial, shaftCells.length);
    aperture.name = "underground-shaft-aperture";
    shaftCells.forEach((entry, index) => {
      matrix.compose(
        new THREE.Vector3(
          entry.col + 0.5 - map.size / 2,
          entry.y - 0.035,
          entry.row + 0.5 - map.size / 2,
        ),
        new THREE.Quaternion(),
        new THREE.Vector3(0.92, 0.03, 0.92),
      );
      aperture.setMatrixAt(index, matrix);
    });
    aperture.instanceMatrix.needsUpdate = true;
    surfaceAccess.add(aperture);
  }

  let activeDepth: number | null = null;
  let visibleDepths = new Set<number>();
  let activeElevation: number | null = null;
  let cameraYaw = 0;
  const refresh = (): void => {
    root.visible = visibleDepths.size > 0 || surfaceAccess.children.length > 0;
    surfaceAccess.visible =
      activeElevation === null ? activeDepth === null : activeElevation > undergroundFloorHeight(1);
    const x = Math.sin(cameraYaw);
    const z = Math.cos(cameraYaw);
    const near =
      Math.abs(x) > Math.abs(z) ? (x >= 0 ? "east" : "west") : z >= 0 ? "south" : "north";
    for (const wall of accessWalls) wall.mesh.visible = wall.side !== near;
    const previewFirstStorey = surfaceAccess.visible && surfaceAccess.children.length > 0;
    for (const [depth, level] of levels) {
      // At surface level the terrain itself occludes this group everywhere except through a real
      // opening. Keeping the first storey rendered therefore reveals the actual landing through
      // stairs/shafts without exposing the rest of the basement through intact ground.
      const previewing = depth === 1 && previewFirstStorey && !visibleDepths.has(depth);
      level.group.visible = visibleDepths.has(depth) || previewing;
      for (const tinted of level.tintedMaterials) {
        tinted.material.color.copy(tinted.color);
        if (previewing) tinted.material.color.multiplyScalar(0.38);
      }
      for (const [side, wall] of level.walls) wall.visible = side !== near;
    }
  };
  refresh();
  return {
    group: root,
    setDepth(depth) {
      activeDepth = depth;
      activeElevation = null;
      visibleDepths = new Set(depth === null ? [] : [depth]);
      refresh();
    },
    setElevation(elevation) {
      activeElevation = elevation;
      const depths = elevation === null ? [null] : undergroundVisibleDepthsAtElevation(elevation);
      visibleDepths = new Set(depths.flatMap((depth) => (depth === null ? [] : [depth])));
      activeDepth = [...visibleDepths].at(-1) ?? null;
      refresh();
    },
    setCameraYaw(yaw) {
      cameraYaw = yaw;
      refresh();
    },
    dispose() {
      root.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of ownedTextures) texture.dispose();
      root.clear();
    },
  };
}
