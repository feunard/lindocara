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

function texture(): THREE.Texture {
  return new THREE.Texture();
}

function building(archetype: Parameters<typeof makeBuildingVolume>[0]["archetype"]) {
  return makeBuildingVolume({
    archetype,
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

describe("native HD-2D building volumes", () => {
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
});
