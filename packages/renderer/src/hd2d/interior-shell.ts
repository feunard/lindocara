import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import {
  INTERIOR_SHELL_SILL_HEIGHT,
  INTERIOR_SHELL_THICKNESS,
  INTERIOR_SHELL_WALL_HEIGHT,
  interiorShellLevels,
  interiorShellRuns,
  type InteriorShellRun,
  type InteriorShellSide,
} from "@lindocara/engine/interior-shell.js";
import type { InteriorShellStyle } from "@lindocara/engine/map-environment.js";
import type { TextureRegistry, TextureSpec } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";

const HD2D_ROOT = "/assets/lindocara/hd2d";
const TIMBER_TEXTURE = `${HD2D_ROOT}/buildings/wall-timber.png`;
const CASTLE_TEXTURE = `${HD2D_ROOT}/buildings/cream-stone.png`;

/** Extra sources not already loaded by the terrain scene. */
export const INTERIOR_SHELL_TEXTURES: readonly TextureSpec[] = [
  { url: TIMBER_TEXTURE },
  { url: CASTLE_TEXTURE },
];

const STYLE_SURFACE: Record<
  InteriorShellStyle,
  { url: string; atlas: boolean; cap: number; shadow: number }
> = {
  timber: { url: TIMBER_TEXTURE, atlas: false, cap: 0x70472f, shadow: 0x160f0d },
  castle: { url: CASTLE_TEXTURE, atlas: false, cap: 0x858486, shadow: 0x15151a },
  cave: {
    url: `${HD2D_ROOT}/tileset-grotte.png`,
    atlas: true,
    cap: 0x4e5657,
    shadow: 0x0c1012,
  },
  mountain: {
    url: `${HD2D_ROOT}/tileset-montagne.png`,
    atlas: true,
    cap: 0x68706e,
    shadow: 0x111415,
  },
  volcano: {
    url: `${HD2D_ROOT}/tileset-volcan.png`,
    atlas: true,
    cap: 0x493a39,
    shadow: 0x100607,
  },
  ice: {
    url: `${HD2D_ROOT}/tileset-glace.png`,
    atlas: true,
    cap: 0x9cc7d0,
    shadow: 0x09131b,
  },
  snow: {
    url: `${HD2D_ROOT}/tileset-neige.png`,
    atlas: true,
    cap: 0xc8d0cd,
    shadow: 0x12171b,
  },
};

export interface InteriorShellVisual {
  group: THREE.Group;
  setCameraYaw(yaw: number): void;
  dispose(): void;
}

interface SideMeshes {
  full: THREE.Group;
  cutaway: THREE.Group;
}

function wallTexture(style: InteriorShellStyle, textures: TextureRegistry): THREE.Texture {
  const surface = STYLE_SURFACE[style];
  const texture = textures.get(surface.url).clone();
  // The generated biome sheets are 9x6 atlases. Sample one coherent stone/ice face instead of
  // projecting the entire atlas onto each wall segment. The clone owns only its transform; the
  // registry keeps ownership of the decoded image and GPU source.
  if (surface.atlas) {
    texture.repeat.set(1 / 9, 1 / 6);
    texture.offset.set(6 / 9, 1 / 6);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
  }
  texture.needsUpdate = true;
  return texture;
}

function sideForYaw(yaw: number): InteriorShellSide {
  const x = Math.sin(yaw);
  const z = Math.cos(yaw);
  if (Math.abs(x) > Math.abs(z)) return x >= 0 ? "east" : "west";
  return z >= 0 ? "south" : "north";
}

function instancesFor(
  name: string,
  runs: readonly InteriorShellRun[],
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  height: number,
  yOffset: number,
  levelHeight: number,
  depthOffset = 0,
): THREE.InstancedMesh | null {
  const count = runs.reduce((sum, run) => sum + run.length, 0);
  if (count === 0) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3(1.02, height, INTERIOR_SHELL_THICKNESS);
  let index = 0;
  for (const run of runs) {
    const horizontal = run.side === "north" || run.side === "south";
    rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), horizontal ? 0 : Math.PI / 2);
    for (let cell = 0; cell < run.length; cell += 1) {
      const along = cell + 0.5 - run.length / 2;
      const normalX = run.side === "east" ? 1 : run.side === "west" ? -1 : 0;
      const normalZ = run.side === "south" ? 1 : run.side === "north" ? -1 : 0;
      position.set(
        run.x + (horizontal ? along : 0) + normalX * depthOffset,
        run.level * levelHeight + yOffset,
        run.z + (horizontal ? 0 : along) + normalZ * depthOffset,
      );
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
      index += 1;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * Build a cutaway envelope from the exact same boundary runs compiled as movement colliders.
 *
 * One draw call per visible component and side keeps the cost bounded by the four directions, not
 * by room area. Turning the camera swaps which direction is rendered as the low cutaway sill, so
 * authoring and gameplay can inspect the room from every angle without a wall hiding the action.
 */
export function createInteriorShell(map: MapData, textures: TextureRegistry): InteriorShellVisual {
  const root = new THREE.Group();
  root.name = "interior-shell";
  const shell = map.environment === "interior" ? map.interiorShell : undefined;
  if (!shell) {
    return { group: root, setCameraYaw() {}, dispose() {} };
  }

  const surface = STYLE_SURFACE[shell.style];
  const texture = wallTexture(shell.style, textures);
  const wallMaterial = new THREE.MeshLambertMaterial({ map: texture });
  const capMaterial = new THREE.MeshLambertMaterial({ color: surface.cap, flatShading: true });
  const voidMaterial = new THREE.MeshLambertMaterial({ color: surface.shadow, flatShading: true });
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const runs = interiorShellRuns(
    map.size,
    interiorShellLevels(map.size, map.levels, map.materials, shell.style, map.liquidLevels ?? []),
  );
  const sideMeshes = new Map<InteriorShellSide, SideMeshes>();

  for (const side of ["north", "east", "south", "west"] as const) {
    const sideRuns = runs.filter((run) => run.side === side);
    const full = new THREE.Group();
    full.name = `${side}-full`;
    const wall = instancesFor(
      `${side}-wall`,
      sideRuns,
      unitBox,
      wallMaterial,
      INTERIOR_SHELL_WALL_HEIGHT,
      INTERIOR_SHELL_WALL_HEIGHT / 2,
      map.levelHeight,
    );
    if (wall) full.add(wall);
    const cap = instancesFor(
      `${side}-cap`,
      sideRuns,
      unitBox,
      capMaterial,
      0.12,
      INTERIOR_SHELL_WALL_HEIGHT + 0.06,
      map.levelHeight,
    );
    if (cap) full.add(cap);

    const cutaway = new THREE.Group();
    cutaway.name = `${side}-cutaway`;
    const sill = instancesFor(
      `${side}-sill`,
      sideRuns,
      unitBox,
      wallMaterial,
      INTERIOR_SHELL_SILL_HEIGHT,
      INTERIOR_SHELL_SILL_HEIGHT / 2,
      map.levelHeight,
    );
    if (sill) cutaway.add(sill);
    const abyss = instancesFor(
      `${side}-black-margin`,
      sideRuns,
      unitBox,
      voidMaterial,
      0.72,
      -0.36,
      map.levelHeight,
      INTERIOR_SHELL_THICKNESS * 0.34,
    );
    if (abyss) cutaway.add(abyss);
    root.add(full, cutaway);
    sideMeshes.set(side, { full, cutaway });
  }

  const setCameraYaw = (yaw: number): void => {
    const near = sideForYaw(yaw);
    for (const [side, meshes] of sideMeshes) {
      meshes.full.visible = side !== near;
      meshes.cutaway.visible = side === near;
    }
  };
  setCameraYaw(0);

  return {
    group: root,
    setCameraYaw,
    dispose() {
      root.removeFromParent();
      unitBox.dispose();
      wallMaterial.dispose();
      capMaterial.dispose();
      voidMaterial.dispose();
      texture.dispose();
      root.clear();
    },
  };
}
