import {
  authoredEventPreviewSnapshots,
  authoredSeaGuardianPreviewSnapshots,
} from "@lindocara/editor/game/event-preview.js";
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
      events.filter((item) => item.kind !== "sea-guardian").map((item) => item.id),
    );
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
