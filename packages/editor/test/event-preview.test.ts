import {
  authoredEventPreviewSnapshots,
  authoredMonsterPreviewSnapshots,
  authoredSeaGuardianPreviewSnapshots,
} from "@lindocara/editor/game/event-preview.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { defaultEventPage, type EventKind, type MapEvent } from "@lindocara/engine/map-events.js";
import { describe, expect, it } from "vitest";

function event(kind: EventKind): MapEvent {
  return {
    id: `${kind}-event`,
    col: 1,
    row: 2,
    name: kind,
    ordinal: 1,
    kind,
    species: kind === "monster" ? "spear_goblin" : null,
    patrolRadius: kind === "monster" || kind === "guard" || kind === "npc" ? 64 : null,
    pages: [defaultEventPage()],
  };
}

function heightfield(): MapData {
  return {
    version: 1,
    size: 16,
    levelHeight: 0.45,
    waterLevel: -0.05,
    levels: Array<number>(16 * 16).fill(2),
    materials: Array<"herbe">(16 * 16).fill("herbe"),
    colliders: [],
    spawns: [],
    elements: [],
    events: [],
  };
}

describe("authored event preview projection", () => {
  it("keeps generic event kinds visible in the map authoring stage", () => {
    const kinds: EventKind[] = [
      "normal",
      "npc",
      "entry",
      "exit",
      "monster",
      "sea-guardian",
      "guard",
      "harvestable",
    ];
    const events = kinds.map(event);

    expect(authoredEventPreviewSnapshots(events, "map-editor").map((item) => item.id)).toEqual(
      events
        .filter((item) => item.kind !== "sea-guardian" && item.kind !== "monster")
        .map((item) => item.id),
    );
  });

  it("keeps the authoring marker visible when gameplay hides the gold ring", () => {
    const hiddenInGame = { ...event("entry"), showMarker: false };

    expect(authoredEventPreviewSnapshots([hiddenInGame], "map-editor")).toMatchObject([
      { id: hiddenInGame.id, showMarker: true },
    ]);
    expect(authoredEventPreviewSnapshots([hiddenInGame], "playable-preview")).toMatchObject([
      { id: hiddenInGame.id, showMarker: false },
    ]);
  });

  it("preserves authored pickup height and visual levitation in the preview", () => {
    const pickup = event("normal");
    pickup.pages = [
      {
        ...defaultEventPage(),
        graphicAssetId: "resource.lindocara-pickup.speed-boost",
        graphicElevation: 2.25,
        optFloat: true,
      },
    ];

    expect(authoredEventPreviewSnapshots([pickup], "map-editor")).toMatchObject([
      { id: pickup.id, elevationOffset: 2.25, floating: true },
    ]);
  });

  it("uses the gameplay monster actor in the editor instead of a separate event sprite", () => {
    const pursuer = {
      ...event("monster"),
      species: "war_pig" as const,
      name: "Poursuivant",
    };

    expect(authoredMonsterPreviewSnapshots([pursuer], heightfield())).toEqual([
      expect.objectContaining({
        id: "preview-monster-monster-event",
        species: "war_pig",
        graphicAssetId: null,
        x: -6.5,
        y: 0.9,
        z: -5.5,
      }),
    ]);
  });

  it("projects every special monster through the dedicated sea-guardian actor path", () => {
    const first = event("sea-guardian");
    const second = { ...first, id: "second-guardian", col: 3, ordinal: 2 };
    expect(authoredSeaGuardianPreviewSnapshots([first, second], 16, -0.05)).toEqual([
      expect.objectContaining({
        id: "sea-guardian_sea-guardian-event",
        x: -6.5,
        y: -0.05,
        z: -5.5,
        state: "patrol",
      }),
      expect.objectContaining({
        id: "sea-guardian_second-guardian",
        x: -4.5,
        y: -0.05,
        z: -5.5,
        state: "patrol",
      }),
    ]);
  });

  it("avoids duplicate monster and guard sprites in the playable preview", () => {
    const events = [event("normal"), event("monster"), event("guard"), event("exit")];

    expect(
      authoredEventPreviewSnapshots(events, "playable-preview").map((item) => item.id),
    ).toEqual(["normal-event", "exit-event"]);
  });
});
