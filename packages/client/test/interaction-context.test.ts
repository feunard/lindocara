import {
  hasNearbyInteraction,
  nearestInteractiveEvent,
} from "@lindocara/client/game/interaction-context.js";
import type {
  PeasantCampVisual,
  PlayerSnapshot,
  WorldBuildingSnapshot,
  WorldEventSnapshot,
} from "@lindocara/engine/protocol.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
import { describe, expect, it } from "vitest";

const self: PlayerSnapshot = {
  id: "hero",
  nick: "Hero",
  x: 0,
  y: 0,
  z: 0,
  airborne: false,
  swimming: false,
  gliding: false,
  hp: 100,
  maxHp: 100,
  level: 1,
  appearance: { body: "wayfarer", primaryColor: "moss" },
  class: "warrior",
  equipment: { mainHand: "weathered_sword", offHand: "oak_shield" },
  life: "alive",
  facing: { x: 1, z: 0 },
  action: null,
};

const event: WorldEventSnapshot = {
  id: "event",
  col: 5,
  row: 5,
  graphicAssetId: null,
  onTop: false,
  moveSpeed: 0,
  moveFrequency: 0,
  moveAnimation: false,
  directionFixed: true,
};

function context(overrides: Partial<Parameters<typeof hasNearbyInteraction>[0]> = {}) {
  return {
    self,
    worldSize: 10,
    events: [],
    corpses: [],
    camps: [],
    buildings: [],
    interiorNearby: false,
    interactionOpen: false,
    now: 1_000,
    ...overrides,
  };
}

describe("contextual controller interaction", () => {
  it("recognizes only server-marked authored events in range", () => {
    expect(hasNearbyInteraction(context({ events: [{ ...event, interactive: true }] }))).toBe(true);
    expect(hasNearbyInteraction(context({ events: [event] }))).toBe(false);
    expect(
      hasNearbyInteraction(context({ events: [{ ...event, col: 9, row: 9, interactive: true }] })),
    ).toBe(false);
  });

  it("never presents a harvest node as an interaction, even from a stale marked snapshot", () => {
    const harvest = {
      state: "intact" as const,
      generation: 0,
      hits: 0,
      hitsRequired: 2,
      lastHitAt: null,
      depletedAt: null,
      respawnAt: null,
      exhaustionBehavior: "hide" as const,
      exhaustedAssetId: null,
      fadeDurationMs: 250,
      collider: [0, 0, 32, 32] as const,
    };
    const resource = { ...event, interactive: true as const, harvest };

    expect(nearestInteractiveEvent(self, [resource], 10)).toBeUndefined();
    expect(nearestInteractiveEvent({ ...self, class: "peasant" }, [resource], 10)).toBeUndefined();
    expect(hasNearbyInteraction(context({ events: [resource] }))).toBe(false);
  });

  it("covers prompts, nearby bodies and live camp chests", () => {
    expect(hasNearbyInteraction(context({ promptKey: "prompt.speak" }))).toBe(true);
    expect(hasNearbyInteraction(context({ promptKey: "prompt.approach" }))).toBe(false);
    expect(hasNearbyInteraction(context({ interactionOpen: true }))).toBe(true);
    expect(
      hasNearbyInteraction(
        context({
          corpses: [
            {
              id: "body",
              nick: "Fallen",
              class: "warrior",
              appearance: { body: "wayfarer", primaryColor: "azure" },
              x: 0.5,
              y: 0,
              z: 0.5,
            },
          ],
        }),
      ),
    ).toBe(true);
    const camp: PeasantCampVisual = {
      t: "peasant.camp",
      id: "camp",
      actorId: "builder",
      x: 0.5,
      z: 0.5,
      radius: 2,
      startedAt: 0,
      expiresAt: 2_000,
    };
    expect(hasNearbyInteraction(context({ camps: [camp] }))).toBe(true);
    expect(hasNearbyInteraction(context({ camps: [{ ...camp, expiresAt: 999 }] }))).toBe(false);
  });

  it("picks the nearest interactive event, and only an interactive one in range", () => {
    const near = { ...event, id: "near", col: 5, row: 5, interactive: true as const };
    const far = { ...event, id: "far", col: 6, row: 5, interactive: true as const };
    const hero = { ...self, x: 0.4, z: 0.4 };

    // Nearest rather than first: array order must not decide which event the prompt names.
    expect(nearestInteractiveEvent(hero, [far, near], 10)?.id).toBe("near");
    expect(nearestInteractiveEvent(hero, [near, far], 10)?.id).toBe("near");

    // A page the server did not mark interactive is decoration, whatever it looks like.
    expect(nearestInteractiveEvent(hero, [event], 10)).toBeUndefined();
    // Out of reach, a spirit, and a world that has not been sized yet.
    expect(nearestInteractiveEvent(hero, [{ ...near, col: 9, row: 9 }], 10)).toBeUndefined();
    expect(nearestInteractiveEvent({ ...hero, life: "ghost" }, [near], 10)).toBeUndefined();
    expect(nearestInteractiveEvent(hero, [near], 0)).toBeUndefined();
    expect(nearestInteractiveEvent(undefined, [near], 10)).toBeUndefined();
  });

  it("ignores interactive events on another vertical storey", () => {
    const surfaceEvent = { ...event, interactive: true as const, y: 0 };
    const basementEvent = {
      ...event,
      id: "basement",
      interactive: true as const,
      y: -2.4,
      undergroundDepth: 1,
    };

    expect(nearestInteractiveEvent({ ...self, y: -2.4 }, [surfaceEvent], 10)).toBeUndefined();
    expect(nearestInteractiveEvent(self, [basementEvent], 10)).toBeUndefined();
    expect(nearestInteractiveEvent({ ...self, y: -2.4 }, [basementEvent], 10)?.id).toBe("basement");
  });

  it("recognizes an intact building only at its visible doorway", () => {
    const building: WorldBuildingSnapshot = {
      id: "building",
      x: 0,
      z: 0,
      graphicAssetId: "building.buildings-blue-buildings.house1" as EditorAssetId,
      destroyedAssetId:
        "building.factions-knights-buildings-house.house-destroyed" as EditorAssetId,
      hp: 100,
      maxHp: 100,
      destructible: true,
      destroyed: false,
      interactive: true,
      dimensions: { width: 5, depth: 3.125 },
      collider: { x: -1.375, z: -2.125, w: 2.75, h: 2.125 },
    };
    expect(
      hasNearbyInteraction(context({ self: { ...self, x: 1, z: 0.4 }, buildings: [building] })),
    ).toBe(true);
    expect(
      hasNearbyInteraction(context({ self: { ...self, x: -1.625, z: -1 }, buildings: [building] })),
    ).toBe(false);
    expect(
      hasNearbyInteraction(context({ self: { ...self, x: -0.4, z: 0.4 }, buildings: [building] })),
    ).toBe(false);
    expect(
      hasNearbyInteraction(
        context({
          self: { ...self, x: 0.55, z: 0.4 },
          buildings: [{ ...building, hp: 0, destroyed: true, interactive: false }],
        }),
      ),
    ).toBe(false);
  });
});
