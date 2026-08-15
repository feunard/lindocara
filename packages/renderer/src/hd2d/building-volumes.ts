import type { BuildingArchetype } from "@lindocara/engine/buildings.js";
import * as THREE from "three";

export type BuildingVolumeState = "standing" | "construction" | "destroyed";

export interface BuildingVolumeArt {
  archetype: BuildingArchetype;
  state: BuildingVolumeState;
  front: THREE.Texture;
  wall: THREE.Texture;
  roof: THREE.Texture;
  roofColor: number;
}

export interface NativeStaticVisual {
  mesh: THREE.Group;
  placeAt(x: number, y: number, z: number): void;
  setFrame(frame: number): void;
  update(now: number): void;
  dispose(): void;
}

interface Dimensions {
  width: number;
  depth: number;
  wallHeight: number;
  roofHeight: number;
}

function dimensions(archetype: BuildingArchetype): Dimensions {
  switch (archetype) {
    case "tower":
    case "windmill":
      return { width: 2.2, depth: 2.1, wallHeight: 3.05, roofHeight: 1.05 };
    case "archery":
      return { width: 3.45, depth: 2.5, wallHeight: 1.75, roofHeight: 0.9 };
    case "barracks":
      return { width: 3.75, depth: 2.65, wallHeight: 1.95, roofHeight: 0.9 };
    case "monastery":
      return { width: 3.9, depth: 2.8, wallHeight: 2.1, roofHeight: 1 };
    case "castle":
      return { width: 4.4, depth: 3.15, wallHeight: 2.35, roofHeight: 0.8 };
    case "house":
      return { width: 3.1, depth: 2.25, wallHeight: 1.65, roofHeight: 0.9 };
  }
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

/**
 * A generated facade backed by real walls and a real roof. The facade preserves the authored
 * silhouette while the side/roof geometry keeps the building solid under camera yaw and shadows.
 */
export function makeBuildingVolume(art: BuildingVolumeArt): NativeStaticVisual {
  const group = new THREE.Group();
  const size = dimensions(art.archetype);
  const destroyed = art.state === "destroyed";
  const construction = art.state === "construction";
  const collapse = destroyed ? 0.38 : 1;

  const wallMaterial = new THREE.MeshLambertMaterial({
    map: art.wall,
    color: destroyed ? 0x514b48 : 0xffffff,
  });
  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(size.width, size.wallHeight * collapse, size.depth),
    wallMaterial,
  );
  walls.position.y = (size.wallHeight * collapse) / 2;
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  const roofMaterial = new THREE.MeshLambertMaterial({
    map: art.roof,
    color: destroyed ? 0x4f4542 : art.roofColor,
    side: THREE.DoubleSide,
  });
  const radius = Math.hypot(size.width, size.depth) / 2;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(radius, size.roofHeight, 4), roofMaterial);
  roof.scale.set(size.width / (radius * Math.SQRT2), 1, size.depth / (radius * Math.SQRT2));
  roof.rotation.y = Math.PI / 4;
  roof.position.y = size.wallHeight * collapse + size.roofHeight / 2;
  if (destroyed) {
    roof.rotation.z = -0.32;
    roof.position.x = size.width * 0.18;
  }
  roof.visible = !construction;
  roof.castShadow = true;
  roof.receiveShadow = true;
  group.add(roof);

  const facadeHeight = size.wallHeight + size.roofHeight;
  const image = art.front.image as { width?: unknown; height?: unknown };
  const imageWidth = typeof image.width === "number" ? image.width : 1;
  const imageHeight = typeof image.height === "number" && image.height > 0 ? image.height : 1;
  const facadeMaterial = new THREE.MeshLambertMaterial({
    map: art.front,
    transparent: true,
    alphaTest: 0.12,
    color: destroyed ? 0x81736d : 0xffffff,
    side: THREE.DoubleSide,
  });
  const facade = new THREE.Mesh(
    new THREE.PlaneGeometry(facadeHeight * (imageWidth / imageHeight), facadeHeight),
    facadeMaterial,
  );
  facade.position.set(
    0,
    destroyed ? facadeHeight * 0.28 : facadeHeight / 2,
    size.depth / 2 + 0.025,
  );
  if (destroyed) facade.rotation.z = 0.14;
  facade.visible = !construction;
  facade.castShadow = true;
  group.add(facade);

  // Construction variants remain useful authoring states: a readable timber frame, not a flat
  // technical sprite. They become a finished volume as soon as the standing asset is selected.
  if (construction) {
    const beamMaterial = new THREE.MeshLambertMaterial({ color: 0x6d4328 });
    for (const x of [-size.width / 2, 0, size.width / 2]) {
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, size.wallHeight + 0.35, 0.12),
        beamMaterial,
      );
      beam.position.set(x, (size.wallHeight + 0.35) / 2, size.depth / 2 + 0.08);
      beam.castShadow = true;
      group.add(beam);
    }
  }

  let rotor: THREE.Group | null = null;
  if (art.archetype === "windmill" && !destroyed) {
    rotor = new THREE.Group();
    const bladeMaterial = new THREE.MeshLambertMaterial({ color: 0xc69a62 });
    for (let index = 0; index < 4; index += 1) {
      const arm = new THREE.Group();
      arm.rotation.z = index * (Math.PI / 2);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.65, 0.09), bladeMaterial);
      blade.position.y = 0.85;
      blade.castShadow = true;
      arm.add(blade);
      rotor.add(arm);
    }
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.28, 12),
      new THREE.MeshLambertMaterial({ color: 0x53361f }),
    );
    hub.rotation.x = Math.PI / 2;
    rotor.add(hub);
    rotor.position.set(0, size.wallHeight * 0.76, size.depth / 2 + 0.22);
    group.add(rotor);
  }

  return {
    mesh: group,
    placeAt(x, y, z) {
      group.position.set(x, y, z);
    },
    setFrame() {},
    update(now) {
      if (rotor) rotor.rotation.z = now * 0.00032;
    },
    dispose() {
      group.removeFromParent();
      disposeObject(group);
    },
  };
}

export function makeBridgeVolume(
  deckTexture: THREE.Texture,
  orientation: "horizontal" | "vertical",
): NativeStaticVisual {
  const group = new THREE.Group();
  const horizontal = orientation === "horizontal";
  const length = 3.15;
  const width = 0.9;
  const deckMaterial = new THREE.MeshLambertMaterial({ map: deckTexture, color: 0xd7b07a });
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(horizontal ? length : width, 0.18, horizontal ? width : length),
    deckMaterial,
  );
  deck.position.y = 0.12;
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  const railMaterial = new THREE.MeshLambertMaterial({ color: 0x684329 });
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(horizontal ? length : 0.11, 0.12, horizontal ? 0.11 : length),
      railMaterial,
    );
    rail.position.set(
      horizontal ? 0 : side * width * 0.48,
      0.5,
      horizontal ? side * width * 0.48 : 0,
    );
    rail.castShadow = true;
    group.add(rail);
    for (const along of [-1.35, 0, 1.35]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.72, 0.11), railMaterial);
      post.position.set(
        horizontal ? along : side * width * 0.48,
        0.3,
        horizontal ? side * width * 0.48 : along,
      );
      post.castShadow = true;
      group.add(post);
    }
  }

  return {
    mesh: group,
    placeAt(x, y, z) {
      group.position.set(x, y + 0.03, z);
    },
    setFrame() {},
    update() {},
    dispose() {
      group.removeFromParent();
      disposeObject(group);
    },
  };
}
