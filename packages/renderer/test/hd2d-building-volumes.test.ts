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
