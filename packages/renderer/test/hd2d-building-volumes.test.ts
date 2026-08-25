import {
  FACTION_BUILDING_FACTIONS,
  factionBuildingModelForArchetype,
} from "@lindocara/engine/faction-buildings.js";
import type {
  FactionBuildingArchetype,
  FactionBuildingFaction,
} from "@lindocara/engine/faction-buildings.js";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  BRIDGE_DECK_LENGTH,
  BRIDGE_DECK_WIDTH,
  BRIDGE_VISUAL_LIFT,
  buildingVolumeDimensions,
  makeBridgeVolume,
  makeBuildingVolume,
} from "../src/hd2d/building-volumes.js";
import { FACTION_BUILDING_DESIGN_NAMES } from "../src/hd2d/faction-building-volumes.js";

const FACTION_BUILDING_FUNCTIONAL_LANDMARKS = {
  goblin: {
    "housing-a": "goblin-roundhouse-heart",
    "housing-b": "fungus-stump-core",
    "command-a": "boss-tusk-gate",
    "command-b": "scrap-keep-hoist",
    "training-a": "stab-yard-armoury",
    "training-b": "sling-firing-gallery",
    "community-a": "feast-great-chimney",
    "community-b": "shaman-twisted-tree",
    "daily-life-a": "tinker-workshop-bay",
    "daily-life-b": "scavenger-loading-ramp",
  },
  "orc-troll": {
    "housing-a": "orc-longhouse-keel",
    "housing-b": "troll-hut-root-crown",
    "command-a": "warchief-horn-throne",
    "command-b": "skull-fort-jaw-gate",
    "training-a": "war-pit-sunken-ring",
    "training-b": "boulder-range-throwing-deck",
    "community-a": "clan-hearth-great-fire",
    "community-b": "smoke-lodge-drying-rack",
    "daily-life-a": "war-forge-furnace",
    "daily-life-b": "beast-pen-gatehouse",
  },
  beastfolk: {
    "housing-a": "hide-lodge-raised-floor",
    "housing-b": "elevated-nest-basket-floor",
    "command-a": "council-totems-alpha",
    "command-b": "moonfang-den-crescent-foundation",
    "training-a": "hunters-run-lookout-blind",
    "training-b": "claw-arena-sparring-beast",
    "community-a": "pack-commons-pack-fire",
    "community-b": "healers-canopy-living-trunk",
    "daily-life-a": "tanners-walk-drainage-floor",
    "daily-life-b": "bone-granary-woven-pod",
  },
  "wild-tribe": {
    "housing-a": "reed-house-curved-dock",
    "housing-b": "turtle-shell-hut-dome",
    "command-a": "ancestor-ziggurat-stepped-temple",
    "command-b": "sunwatch-spire-great-sun-disc",
    "training-a": "spear-dance-court-dance-ring",
    "training-b": "trial-cenote-sunken-rim",
    "community-a": "rain-lodge-umbrella-roof",
    "community-b": "spirit-cave-living-rock-shell",
    "daily-life-a": "drying-wharf-deck-slat",
    "daily-life-b": "weavers-workshop-round-floor",
  },
} satisfies Record<FactionBuildingFaction, Record<FactionBuildingArchetype, string>>;

function texture(): THREE.Texture {
  return new THREE.Texture();
}

function building(
  archetype: Parameters<typeof makeBuildingVolume>[0]["archetype"],
  dimensions?: Parameters<typeof makeBuildingVolume>[0]["dimensions"],
  faction?: Parameters<typeof makeBuildingVolume>[0]["faction"],
) {
  return makeBuildingVolume({
    archetype,
    ...(dimensions ? { dimensions } : {}),
    ...(faction ? { faction } : {}),
    state: "standing",
    front: texture(),
    wall: texture(),
    roof: texture(),
    stone: texture(),
    blueStone: texture(),
    wood: texture(),
    roofColor: 0x4da9c7,
  });
}

function uvSpan(mesh: THREE.Mesh, groupIndex: number): { u: number; v: number } {
  const group = mesh.geometry.groups[groupIndex];
  const index = mesh.geometry.index;
  const uv = mesh.geometry.getAttribute("uv");
  if (!group || !index || !(uv instanceof THREE.BufferAttribute)) {
    throw new Error("grouped UV geometry missing");
  }
  const vertices = new Set<number>();
  for (let offset = group.start; offset < group.start + group.count; offset += 1) {
    vertices.add(index.getX(offset));
  }
  const us = [...vertices].map((vertex) => uv.getX(vertex));
  const vs = [...vertices].map((vertex) => uv.getY(vertex));
  return { u: Math.max(...us) - Math.min(...us), v: Math.max(...vs) - Math.min(...vs) };
}

function volumeFingerprint(root: THREE.Object3D): string {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const extent = bounds.getSize(new THREE.Vector3());
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });

  const geometryCounts = new Map<string, number>();
  for (const mesh of meshes) {
    const kind = mesh.geometry.type;
    geometryCounts.set(kind, (geometryCounts.get(kind) ?? 0) + 1);
  }

  const resolution = 18;
  const projection = (horizontal: "x" | "z", vertical: "y" | "z"): string => {
    const occupied = Array.from({ length: resolution * resolution }, () => false);
    const axisMin = (axis: "x" | "y" | "z"): number => bounds.min[axis];
    const axisExtent = (axis: "x" | "y" | "z"): number => Math.max(extent[axis], 0.001);
    for (const mesh of meshes) {
      const box = new THREE.Box3().setFromObject(mesh);
      const minX = Math.max(
        0,
        Math.floor(
          ((box.min[horizontal] - axisMin(horizontal)) / axisExtent(horizontal)) * resolution,
        ),
      );
      const maxX = Math.min(
        resolution - 1,
        Math.ceil(
          ((box.max[horizontal] - axisMin(horizontal)) / axisExtent(horizontal)) * resolution,
        ),
      );
      const minY = Math.max(
        0,
        Math.floor(((box.min[vertical] - axisMin(vertical)) / axisExtent(vertical)) * resolution),
      );
      const maxY = Math.min(
        resolution - 1,
        Math.ceil(((box.max[vertical] - axisMin(vertical)) / axisExtent(vertical)) * resolution),
      );
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) occupied[y * resolution + x] = true;
      }
    }
    return occupied.map((value) => (value ? "1" : "0")).join("");
  };

  return [
    projection("x", "y"),
    projection("z", "y"),
    projection("x", "z"),
    [...geometryCounts.entries()].sort(([left], [right]) => left.localeCompare(right)).join(","),
  ].join(":");
}

describe("native HD-2D building volumes", () => {
  it.each([
    ["goblin", "goblin-roundhouse-heart"],
    ["orc-troll", "orc-longhouse-keel"],
    ["beastfolk", "hide-lodge-raised-floor"],
    ["wild-tribe", "reed-house-curved-dock"],
  ] as const)("builds an architectural language unique to the %s pack", (faction, signature) => {
    const model = factionBuildingModelForArchetype(faction, "housing-a");
    const visual = building(model.archetype, undefined, faction);
    expect(visual.mesh.getObjectByName(signature)).toBeDefined();
    expect(visual.mesh.getObjectByName("native-architecture")).toBeDefined();
    visual.dispose();
  });

  it("builds forty structurally unique faction models instead of recolouring shared halls", () => {
    const designNames = new Set<string>();
    const volumeFingerprints = new Map<string, string>();
    const underDetailed: string[] = [];
    for (const faction of FACTION_BUILDING_FACTIONS) {
      for (const purpose of [
        "housing",
        "command",
        "training",
        "community",
        "daily-life",
      ] as const) {
        for (const variant of ["a", "b"] as const) {
          const model = factionBuildingModelForArchetype(faction, `${purpose}-${variant}`);
          const visual = building(model.archetype, undefined, faction);
          const identity = `${faction}/${model.archetype}`;
          const designName = `design-${faction}-${FACTION_BUILDING_DESIGN_NAMES[faction][model.archetype]}`;
          expect(visual.mesh.getObjectByName(designName), identity).toBeDefined();
          expect(
            visual.mesh.getObjectByName(
              FACTION_BUILDING_FUNCTIONAL_LANDMARKS[faction][model.archetype],
            ),
            `${identity} has lost its defining functional landmark`,
          ).toBeDefined();
          expect(visual.mesh.getObjectByName("faction-hall"), identity).toBeUndefined();
          const meshCount = visual.mesh.getObjectsByProperty("type", "Mesh").length;
          if (meshCount < 19) underDetailed.push(`${identity}:${meshCount}`);
          const fingerprint = volumeFingerprint(visual.mesh);
          const previous = volumeFingerprints.get(fingerprint);
          expect(
            previous,
            `${identity} duplicates the structure of ${previous ?? "nothing"}`,
          ).toBeUndefined();
          volumeFingerprints.set(fingerprint, identity);
          designNames.add(designName);
          visual.dispose();
        }
      }
    }
    expect(designNames.size).toBe(40);
    expect(volumeFingerprints.size).toBe(40);
    expect(underDetailed).toEqual([]);
  });

  it.each(["goblin", "orc-troll", "beastfolk", "wild-tribe"] as const)(
    "builds every %s role as finished layered architecture instead of flat decoration",
    (faction) => {
      for (const archetype of [
        "housing-a",
        "housing-b",
        "command-a",
        "command-b",
        "training-a",
        "training-b",
        "community-a",
        "community-b",
        "daily-life-a",
        "daily-life-b",
      ] as const) {
        const model = factionBuildingModelForArchetype(faction, archetype);
        const visual = building(model.archetype, undefined, faction);
        const meshes = visual.mesh.getObjectsByProperty("type", "Mesh") as THREE.Mesh[];
        const materials = new Set(meshes.flatMap((mesh) => mesh.material).map((item) => item.uuid));
        const geometryKinds = new Set(meshes.map((mesh) => mesh.geometry.type));
        const outlines = visual.mesh.getObjectsByProperty("name", `${faction}-silhouette-line`);
        visual.mesh.updateMatrixWorld(true);
        const volumetricParts = meshes.filter((mesh) => {
          const extent = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
          return extent.x > 0.015 && extent.y > 0.015 && extent.z > 0.015;
        });

        expect(meshes.length, `${archetype} is under-detailed`).toBeGreaterThanOrEqual(55);
        expect(
          volumetricParts.length,
          `${archetype} relies on flat decoration`,
        ).toBeGreaterThanOrEqual(45);
        expect(materials.size, `${archetype} lacks surface variation`).toBeGreaterThanOrEqual(7);
        expect(geometryKinds.size, `${archetype} lacks shape variation`).toBeGreaterThanOrEqual(4);
        expect(outlines.length, `${archetype} outlines too many small parts`).toBeLessThan(
          meshes.length / 4,
        );
        visual.dispose();
      }
    },
  );

  it.each(["house", "tower", "windmill", "archery", "barracks", "monastery", "castle"] as const)(
    "builds %s as complete native architecture behind its authored front threshold",
    (archetype) => {
      const visual = building(archetype);
      const size = buildingVolumeDimensions(archetype);
      const architecture = visual.mesh.getObjectByName("native-architecture");
      expect(architecture?.position.z).toBeCloseTo(-size.depth / 2);
      expect(visual.mesh.getObjectByName("generated-front-elevation")).toBeUndefined();
      expect(visual.mesh.getObjectsByProperty("type", "Mesh").length).toBeGreaterThan(8);
      visual.dispose();
    },
  );

  it("repeats facade and roof modules across a resized house instead of magnifying one texture", () => {
    const visual = building("house", { width: 5, depth: 3.125 });
    const wall = visual.mesh.getObjectByName("plaster-house");
    const roof = visual.mesh.getObjectByName("blue-roof-slope");
    if (!(wall instanceof THREE.Mesh) || !(roof instanceof THREE.Mesh)) {
      throw new Error("resized house shell missing");
    }

    // Box groups 4/5 are the front/back faces; the 2-world-unit facade module now repeats 2.5x.
    expect(uvSpan(wall, 4)).toEqual({ u: 2.5, v: 1 });
    // Roof top/bottom faces repeat the one-tile shingles in both slope and depth directions.
    expect(uvSpan(roof, 2).u).toBeGreaterThan(2.5);
    expect(uvSpan(roof, 2).v).toBeGreaterThan(3);
    visual.dispose();
  });

  it("compensates texture repetition for internally scaled round buildings", () => {
    const visual = building("tower", { width: 5, depth: 3.125 });
    const wall = visual.mesh.getObjectByName("stone-watchtower");
    if (!(wall instanceof THREE.Mesh)) throw new Error("resized tower wall missing");

    expect(uvSpan(wall, 0).u).toBeGreaterThan(5);
    expect(uvSpan(wall, 0).v).toBeGreaterThan(1);
    visual.dispose();
  });

  it.each(["house", "tower", "windmill", "archery", "barracks", "monastery", "castle"] as const)(
    "regenerates resized %s architecture from the requested footprint",
    (archetype) => {
      const native = building(archetype);
      const visual = building(archetype, { width: 5, depth: 3.125 });
      const nativeArchitecture = native.mesh.getObjectByName("native-architecture");
      const architecture = visual.mesh.getObjectByName("native-architecture");
      if (!nativeArchitecture || !architecture) throw new Error("native architecture missing");
      const nativeBounds = new THREE.Box3().setFromObject(nativeArchitecture);
      const bounds = new THREE.Box3().setFromObject(architecture);
      expect(bounds.max.x - bounds.min.x).toBeGreaterThan(
        (nativeBounds.max.x - nativeBounds.min.x) * 1.35,
      );
      expect(bounds.max.z - bounds.min.z).toBeGreaterThan(
        (nativeBounds.max.z - nativeBounds.min.z) * 1.2,
      );
      expect(architecture.position.z).toBeCloseTo(-3.125 / 2);
      native.dispose();
      visual.dispose();
    },
  );

  it("keeps the stone tower open and crenellated at every camera angle instead of capping a cylinder with a cone", () => {
    const visual = building("tower");
    expect(visual.mesh.getObjectByName("tower-deck")).toBeDefined();
    expect(visual.mesh.getObjectsByProperty("name", "tower-battlement")).toHaveLength(12);
    expect(visual.mesh.getObjectByName("cone-roof")).toBeUndefined();
    expect(visual.mesh.getObjectsByProperty("name", "window")).toHaveLength(3);
    expect(visual.mesh.getObjectsByProperty("name", "stone-block").length).toBeGreaterThan(12);
    expect(visual.mesh.getObjectsByProperty("name", "ink-outline").length).toBeGreaterThan(20);
    visual.dispose();
  });

  it("gives the archery guild a full open range and leaves the barracks as one integrated hall", () => {
    const guild = building("archery");
    expect(guild.mesh.getObjectsByProperty("name", "archery-target")).toHaveLength(2);
    expect(guild.mesh.getObjectsByProperty("name", "range-post")).toHaveLength(2);
    guild.dispose();

    const barracks = building("barracks");
    expect(barracks.mesh.getObjectByName("fortified-hall")).toBeDefined();
    expect(barracks.mesh.getObjectsByProperty("name", "corner-tower")).toHaveLength(0);
    expect(barracks.mesh.getObjectsByProperty("name", "battlement").length).toBeGreaterThan(0);
    barracks.dispose();
  });

  it.each(["house", "tower", "windmill", "archery", "barracks", "monastery", "castle"] as const)(
    "gives the %s a recessed plank door instead of a flat blue portal",
    (archetype) => {
      const visual = building(archetype);
      const door = visual.mesh.getObjectByName("arched-door");
      const leaf = door?.getObjectByName("door-leaf");
      const recess = door?.getObjectByName("door-recess");
      const handle = door?.getObjectByName("door-handle");
      expect(door).toBeDefined();
      expect(leaf?.position.z).toBeLessThan(handle?.position.z ?? 0);
      expect(recess?.position.z).toBeLessThan(leaf?.position.z ?? 0);
      expect(door?.getObjectsByProperty("name", "door-plank-gap")).toHaveLength(4);
      expect(door?.getObjectsByProperty("name", "door-timber-brace")).toHaveLength(2);
      expect(door?.getObjectsByProperty("name", "door-hinge-strap")).toHaveLength(2);
      expect(visual.mesh.getObjectsByProperty("name", "door-arch-stone")).toHaveLength(5);
      expect(visual.mesh.getObjectByName("door-threshold")).toBeDefined();
      visual.dispose();
    },
  );

  it("builds the windmill as a tapered mill with four lattice sails, not a tower facade", () => {
    const visual = building("windmill");
    expect(visual.mesh.getObjectByName("mill-body")).toBeDefined();
    expect(visual.mesh.getObjectByName("stone-tower")).toBeUndefined();
    expect(visual.mesh.getObjectByName("generated-front-elevation")).toBeUndefined();
    const rotor = visual.mesh.getObjectByName("windmill-rotor");
    if (!rotor) throw new Error("windmill rotor missing");
    expect([0, 1, 2, 3].map((index) => rotor.getObjectByName(`sail-${index}`))).not.toContain(
      undefined,
    );
    const before = rotor.rotation.z;
    visual.update(4_000);
    expect(rotor.rotation.z).not.toBe(before);
    visual.dispose();
  });

  it.each([
    [0, 0],
    [1, -Math.PI / 2],
    [2, -Math.PI],
    [3, (-3 * Math.PI) / 2],
  ] as const)("fixes authored orientation %s on the world volume", (orientation, yaw) => {
    const visual = makeBuildingVolume({
      archetype: "house",
      state: "standing",
      front: texture(),
      wall: texture(),
      roof: texture(),
      stone: texture(),
      blueStone: texture(),
      wood: texture(),
      roofColor: 0x4da9c7,
      orientation,
    });
    expect(visual.mesh.rotation.y).toBeCloseTo(yaw);
    visual.dispose();
  });

  it("applies a native building's free authored angle without quarter-turn snapping", () => {
    const visual = makeBuildingVolume({
      archetype: "house",
      state: "standing",
      front: texture(),
      wall: texture(),
      roof: texture(),
      stone: texture(),
      blueStone: texture(),
      wood: texture(),
      roofColor: 0x4da9c7,
      rotation: 37,
    });
    expect(visual.mesh.rotation.y).toBeCloseTo((-37 * Math.PI) / 180);
    visual.dispose();
  });

  it.each(["horizontal", "vertical"] as const)(
    "aligns the %s bridge deck and rails to its authored three-cell footprint",
    (orientation) => {
      const visual = makeBridgeVolume(texture(), orientation);
      visual.placeAt(2, 0.9, 3);
      expect(visual.mesh.position.z).toBe(orientation === "horizontal" ? 2.5 : 1.5);
      const deck = visual.mesh.getObjectByName("walkable-deck");
      if (!(deck instanceof THREE.Group)) {
        throw new Error("bridge deck missing");
      }
      expect(deck.getObjectsByProperty("name", "bridge-plank")).toHaveLength(11);
      const bounds = new THREE.Box3().setFromObject(deck);
      expect(bounds.max.y).toBeGreaterThanOrEqual(BRIDGE_VISUAL_LIFT);
      expect(bounds.max.y).toBeLessThan(0.12);
      const visibleWidth = bounds.max.x - bounds.min.x;
      const visibleDepth = bounds.max.z - bounds.min.z;
      const along = orientation === "horizontal" ? visibleWidth : visibleDepth;
      const across = orientation === "horizontal" ? visibleDepth : visibleWidth;
      expect(along).toBeGreaterThan(BRIDGE_DECK_LENGTH - 0.08);
      expect(along).toBeLessThanOrEqual(BRIDGE_DECK_LENGTH + 0.08);
      expect(across).toBeGreaterThan(BRIDGE_DECK_WIDTH - 0.1);
      expect(across).toBeLessThanOrEqual(BRIDGE_DECK_WIDTH + 0.08);
      expect(visual.mesh.getObjectsByProperty("name", "bridge-rope")).toHaveLength(4);
      expect(visual.mesh.getObjectsByProperty("name", "bridge-post")).toHaveLength(6);
      visual.dispose();
    },
  );

  it("regenerates a resized bridge instead of repeating fixed 3x1 geometry", () => {
    const visual = makeBridgeVolume(texture(), "horizontal", { length: 7, width: 2 });
    visual.placeAt(2, 0.9, 3);
    expect(visual.mesh.position).toMatchObject({ x: 2, y: 0.9, z: 3 });
    const deck = visual.mesh.getObjectByName("walkable-deck");
    if (!(deck instanceof THREE.Group)) throw new Error("bridge deck missing");
    expect(deck.getObjectsByProperty("name", "bridge-plank").length).toBeGreaterThan(20);
    const bounds = new THREE.Box3().setFromObject(deck);
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(7, 1);
    expect(bounds.max.z - bounds.min.z).toBeGreaterThan(1.85);
    expect(visual.mesh.getObjectsByProperty("name", "bridge-post").length).toBeGreaterThan(6);
    visual.dispose();
  });

  it("applies absolute free angles to either bridge source orientation", () => {
    const horizontal = makeBridgeVolume(texture(), "horizontal", undefined, 37);
    const vertical = makeBridgeVolume(texture(), "vertical", undefined, 37);
    expect(horizontal.mesh.rotation.y).toBeCloseTo((-37 * Math.PI) / 180);
    expect(vertical.mesh.rotation.y).toBeCloseTo((53 * Math.PI) / 180);
    horizontal.dispose();
    vertical.dispose();
  });
});
