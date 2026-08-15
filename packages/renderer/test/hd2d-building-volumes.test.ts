import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  BRIDGE_DECK_LENGTH,
  BRIDGE_DECK_WIDTH,
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
  it.each(["house", "tower", "archery", "barracks"] as const)(
    "fits the generated %s elevation to the real facade instead of a larger box",
    (archetype) => {
      const visual = building(archetype);
      const facade = visual.mesh.getObjectByName("generated-front-elevation");
      if (!(facade instanceof THREE.Mesh) || !(facade.geometry instanceof THREE.PlaneGeometry)) {
        throw new Error("generated front elevation missing");
      }
      const size = buildingVolumeDimensions(archetype);
      expect(facade.geometry.parameters.width).toBeCloseTo(size.width);
      expect(facade.geometry.parameters.height).toBeCloseTo(size.wallHeight + size.roofHeight);
      expect(visual.mesh.getObjectsByProperty("name", "window").length).toBeGreaterThan(0);
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

  it.each(["horizontal", "vertical"] as const)(
    "aligns the %s bridge deck and rails to its authored three-cell footprint",
    (orientation) => {
      const visual = makeBridgeVolume(texture(), orientation);
      visual.placeAt(2, 0.9, 3);
      expect(visual.mesh.position.z).toBe(orientation === "horizontal" ? 2.5 : 1.5);
      const deck = visual.mesh.getObjectByName("walkable-deck");
      if (!(deck instanceof THREE.Mesh) || !(deck.geometry instanceof THREE.BoxGeometry)) {
        throw new Error("bridge deck missing");
      }
      expect(deck.position.y + deck.geometry.parameters.height / 2).toBeCloseTo(0);
      expect(deck.geometry.parameters.width).toBeCloseTo(
        orientation === "horizontal" ? BRIDGE_DECK_LENGTH : BRIDGE_DECK_WIDTH,
      );
      expect(deck.geometry.parameters.depth).toBeCloseTo(
        orientation === "horizontal" ? BRIDGE_DECK_WIDTH : BRIDGE_DECK_LENGTH,
      );
      expect(visual.mesh.getObjectsByProperty("name", "bridge-rail")).toHaveLength(4);
      expect(visual.mesh.getObjectsByProperty("name", "bridge-post")).toHaveLength(6);
      visual.dispose();
    },
  );
});
