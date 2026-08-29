import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import type { InteriorShellStyle } from "@lindocara/engine/map-environment.js";
import {
  undergroundCells,
  undergroundFloorHeight,
  UNDERGROUND_SLAB_THICKNESS,
} from "@lindocara/engine/underground.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";

const HD2D_ROOT = "/assets/lindocara/hd2d";
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

/** Instanced, level-addressable underground rooms built from the exact authored excavation mask. */
export function createUnderground(map: MapData, textures: TextureRegistry): UndergroundVisual {
  const root = new THREE.Group();
  root.name = "underground";
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const ownedTextures: THREE.Texture[] = [];
  const levels = new Map<number, { group: THREE.Group; walls: Map<string, THREE.InstancedMesh> }>();
  const box = new THREE.BoxGeometry(1, 1, 1);
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
    const voidMaterial = new THREE.MeshLambertMaterial({ color: 0x060708, flatShading: true });
    materials.push(floorMaterial, wallMaterial, voidMaterial);
    const floorCount = level.cells.reduce((total, run) => total + run.length, 0);
    const floor = new THREE.InstancedMesh(box, floorMaterial, floorCount);
    floor.name = `underground-floor-${level.depth}`;
    floor.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    let floorIndex = 0;
    for (const run of level.cells) {
      for (let col = run.col; col < run.col + run.length; col += 1) {
        matrix.compose(
          new THREE.Vector3(
            col + 0.5 - map.size / 2,
            floorY - UNDERGROUND_SLAB_THICKNESS / 2,
            run.row + 0.5 - map.size / 2,
          ),
          new THREE.Quaternion(),
          new THREE.Vector3(1, UNDERGROUND_SLAB_THICKNESS, 1),
        );
        floor.setMatrixAt(floorIndex, matrix);
        floorIndex += 1;
      }
    }
    floor.instanceMatrix.needsUpdate = true;
    floor.computeBoundingSphere();
    group.add(floor);

    const wallCells = new Map<string, Array<{ col: number; row: number }>>(
      ["north", "east", "south", "west"].map((side) => [side, []]),
    );
    for (let row = 0; row < map.size; row += 1) {
      for (let col = 0; col < map.size; col += 1) {
        if (cells[row * map.size + col] === 0) continue;
        if (row === 0 || cells[(row - 1) * map.size + col] === 0)
          wallCells.get("north")?.push({ col, row });
        if (row === map.size - 1 || cells[(row + 1) * map.size + col] === 0)
          wallCells.get("south")?.push({ col, row });
        if (col === 0 || cells[row * map.size + col - 1] === 0)
          wallCells.get("west")?.push({ col, row });
        if (col === map.size - 1 || cells[row * map.size + col + 1] === 0)
          wallCells.get("east")?.push({ col, row });
      }
    }
    const walls = new Map<string, THREE.InstancedMesh>();
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
          new THREE.Vector3(x, floorY + 1.2, z),
          new THREE.Quaternion(),
          new THREE.Vector3(horizontal ? 1 : 0.16, 2.4, horizontal ? 0.16 : 1),
        );
        wall.setMatrixAt(index, matrix);
      });
      wall.instanceMatrix.needsUpdate = true;
      wall.computeBoundingSphere();
      group.add(wall);
      walls.set(side, wall);
    }
    const darkness = new THREE.Mesh(new THREE.PlaneGeometry(map.size, map.size), voidMaterial);
    darkness.rotation.x = Math.PI / 2;
    darkness.position.y = floorY - 0.2;
    darkness.renderOrder = -2;
    group.add(darkness);
    root.add(group);
    levels.set(level.depth, { group, walls });
  }

  let activeDepth: number | null = null;
  let cameraYaw = 0;
  const refresh = (): void => {
    root.visible = activeDepth !== null;
    const x = Math.sin(cameraYaw);
    const z = Math.cos(cameraYaw);
    const near =
      Math.abs(x) > Math.abs(z) ? (x >= 0 ? "east" : "west") : z >= 0 ? "south" : "north";
    for (const [depth, level] of levels) {
      level.group.visible = depth === activeDepth;
      for (const [side, wall] of level.walls) wall.visible = side !== near;
    }
  };
  refresh();
  return {
    group: root,
    setDepth(depth) {
      activeDepth = depth;
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
