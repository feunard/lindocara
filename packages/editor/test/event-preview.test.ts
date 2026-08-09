import { authoredEventPreviewSnapshots } from "@lindocara/editor/game/event-preview.js";
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
  it("keeps every event kind visible in the map authoring stage", () => {
    const kinds: EventKind[] = [
      "normal",
      "npc",
      "entry",
      "exit",
      "monster",
      "guard",
      "harvestable",
      "spawn",
    ];
    const events = kinds.map(event);

    expect(authoredEventPreviewSnapshots(events, "map-editor").map((item) => item.id)).toEqual(
      events.map((item) => item.id),
    );
  });

  it("avoids duplicate monster and guard sprites in the playable preview", () => {
    const events = [event("normal"), event("monster"), event("guard"), event("exit")];

    expect(
      authoredEventPreviewSnapshots(events, "playable-preview").map((item) => item.id),
    ).toEqual(["normal-event", "exit-event"]);
  });
});
