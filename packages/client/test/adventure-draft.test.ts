import {
  type AdventureDraft,
  addMember,
  type DraftMemberInfo,
  draftFromAdventure,
  draftSaveable,
  emptyDraft,
  moveMember,
  refreshMember,
  removeMember,
  toAdventureInput,
} from "@lindocara/client/adventure-draft.js";
import { describe, expect, it } from "vitest";

// Since the graph teardown a draft models only the adventure shell + its member maps: no start, no
// exit bindings, no graph validation. These pin the surviving pure rules.
const VISUAL_INFO = {
  revision: 1,
  solid: ["...."],
  monsterCount: 0,
  entryLabels: {},
  exitLabels: {},
};
const A: DraftMemberInfo = {
  ...VISUAL_INFO,
  mapId: "map-a",
  name: "A",
  entryIds: ["door"],
  exitIds: ["east"],
};
const B: DraftMemberInfo = {
  ...VISUAL_INFO,
  mapId: "map-b",
  name: "B",
  entryIds: ["west"],
  exitIds: ["boss"],
};

function fullDraft(): AdventureDraft {
  let draft = emptyDraft();
  draft = { ...draft, title: "Donjon", maxPlayers: 2 };
  draft = addMember(draft, A) as AdventureDraft;
  draft = addMember(draft, B) as AdventureDraft;
  return draft;
}

describe("adventure draft", () => {
  it("adds member maps and refuses duplicates", () => {
    const draft = addMember(emptyDraft(), A);
    expect(draft?.members.map((m) => m.mapId)).toEqual(["map-a"]);
    expect(addMember(draft as AdventureDraft, A)).toBeNull(); // duplicate refused
  });

  it("is saveable on title and player count alone", () => {
    const draft = fullDraft();
    expect(draftSaveable(draft)).toBe(true);
    expect(draftSaveable({ ...draft, title: "  " })).toBe(false);
    expect(draftSaveable({ ...draft, maxPlayers: 5 })).toBe(false);
  });

  it("produces the graph-free AdventureInput wire shape", () => {
    // The editor never authors a graph, so the input carries only the shell + registry — the server
    // preserves the stored graph on this PUT.
    expect(toAdventureInput(fullDraft())).toEqual({
      title: "Donjon",
      maxPlayers: 2,
      registry: { switches: [], variables: [] },
    });
    // An empty draft has no title, so it is not saveable and yields no input.
    expect(toAdventureInput(emptyDraft())).toBeNull();
  });

  it("removing a member drops it from the member list", () => {
    const removed = removeMember(fullDraft(), "map-b");
    expect(removed.members.map((m) => m.mapId)).toEqual(["map-a"]);
  });

  it("rebuilds a draft's members from a stored adventure (graph ignored)", () => {
    const infos = new Map([
      ["map-a", A],
      ["map-b", B],
    ]);
    const rebuilt = draftFromAdventure(
      { title: "Donjon", maxPlayers: 2, mapIds: ["map-a", "map-b"] },
      infos,
    );
    expect(rebuilt).toEqual(fullDraft());
  });

  it("refreshes an edited map's facts in place", () => {
    const updatedB: DraftMemberInfo = {
      ...B,
      revision: 2,
      entryIds: ["cellar"],
      entryLabels: { cellar: "Cellar" },
    };
    const refreshed = refreshMember(fullDraft(), updatedB);
    expect(refreshed.members[1]).toEqual(updatedB);
    // A map not yet a member is added by refresh.
    const C: DraftMemberInfo = {
      ...VISUAL_INFO,
      mapId: "map-c",
      name: "C",
      entryIds: [],
      exitIds: [],
    };
    expect(refreshMember(fullDraft(), C).members.map((m) => m.mapId)).toEqual([
      "map-a",
      "map-b",
      "map-c",
    ]);
  });

  it("reorders member maps for display", () => {
    const moved = moveMember(fullDraft(), "map-b", -1);
    expect(moved.members.map((member) => member.mapId)).toEqual(["map-b", "map-a"]);
  });
});
