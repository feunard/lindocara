import { describe, expect, it } from "vitest";
import {
  type AdventureDraft,
  addMember,
  bindExit,
  type DraftMemberInfo,
  draftFromAdventure,
  draftSaveable,
  draftValidationIssues,
  emptyDraft,
  moveMember,
  refreshMember,
  removeMember,
  setStart,
  toAdventureInput,
} from "../src/client/adventure-draft.js";

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
  draft = setStart(draft, "map-a", "door") as AdventureDraft;
  draft = bindExit(draft, "map-a", "east", { mapId: "map-b", entryId: "west" }) as AdventureDraft;
  draft = bindExit(draft, "map-b", "boss", "end") as AdventureDraft;
  return draft;
}

describe("adventure draft", () => {
  it("adding a member creates one unbound binding row per exit", () => {
    const draft = addMember(emptyDraft(), A);
    expect(draft?.bindings).toEqual([{ mapId: "map-a", exitId: "east", dest: null }]);
    expect(addMember(draft as AdventureDraft, A)).toBeNull(); // duplicate refused
  });

  it("is saveable on title and player count alone — graph completeness never blocks Save", () => {
    const draft = fullDraft();
    expect(draftSaveable(draft)).toBe(true);
    // A missing start, an unbound exit and no reachable ending are all still SAVEABLE (D25): only an
    // invalid title/player count blocks persistence.
    expect(draftSaveable({ ...draft, start: null })).toBe(true);
    const unbound = bindExit(draft, "map-a", "east", null) as AdventureDraft;
    expect(draftSaveable(unbound)).toBe(true);
    expect(draftSaveable({ ...draft, title: "  " })).toBe(false);
    expect(draftSaveable({ ...draft, maxPlayers: 5 })).toBe(false);
  });

  it("produces the exact AdventureInput wire shape", () => {
    expect(toAdventureInput(fullDraft())).toEqual({
      title: "Donjon",
      maxPlayers: 2,
      graph: {
        start: { mapId: "map-a", entryId: "door" },
        links: [
          { mapId: "map-a", exitId: "east", dest: { mapId: "map-b", entryId: "west" } },
          { mapId: "map-b", exitId: "boss", dest: "end" },
        ],
      },
      registry: { switches: [], variables: [] },
    });
    // An empty draft has no title, so it is not saveable and yields no input.
    expect(toAdventureInput(emptyDraft())).toBeNull();
  });

  it("saves a partially-wired draft: a null start and unbound exits, omitted from the graph", () => {
    // A titled draft with a member map but no start and its exit unbound still produces a wire input —
    // start null, no links — so the settings dialog can persist it.
    let draft = emptyDraft();
    draft = { ...draft, title: "Work in progress", maxPlayers: 3 };
    draft = addMember(draft, A) as AdventureDraft;
    expect(toAdventureInput(draft)).toEqual({
      title: "Work in progress",
      maxPlayers: 3,
      graph: { start: null, links: [] },
      registry: { switches: [], variables: [] },
    });
  });

  it("removing a member clears its bindings, dangling destinations and the start", () => {
    const removed = removeMember(fullDraft(), "map-b");
    expect(removed.members.map((m) => m.mapId)).toEqual(["map-a"]);
    expect(removed.bindings).toEqual([{ mapId: "map-a", exitId: "east", dest: null }]);
    const noStart = removeMember(fullDraft(), "map-a");
    expect(noStart.start).toBeNull();
  });

  it("refuses starts and destinations that name unknown maps or entries", () => {
    const draft = fullDraft();
    expect(setStart(draft, "map-c", "door")).toBeNull();
    expect(setStart(draft, "map-a", "ghost")).toBeNull();
    expect(bindExit(draft, "map-a", "east", { mapId: "map-b", entryId: "ghost" })).toBeNull();
    expect(bindExit(draft, "map-a", "ghost", "end")).toBeNull();
  });

  it("rebuilds a draft from a stored adventure", () => {
    const stored = toAdventureInput(fullDraft());
    if (!stored) throw new Error("expected a complete draft");
    const infos = new Map([
      ["map-a", A],
      ["map-b", B],
    ]);
    const rebuilt = draftFromAdventure({ ...stored, mapIds: ["map-a", "map-b"] }, infos);
    expect(rebuilt).toEqual(fullDraft());
  });

  it("refreshes edited markers while preserving only still-valid links", () => {
    const updatedB: DraftMemberInfo = {
      ...B,
      revision: 2,
      entryIds: ["cellar"],
      entryLabels: { cellar: "Cellar" },
    };
    const refreshed = refreshMember(fullDraft(), updatedB);
    expect(refreshed.draft.members[1]).toEqual(updatedB);
    expect(refreshed.draft.bindings[0]?.dest).toBeNull();
    expect(refreshed.draft.bindings[1]?.dest).toBe("end");
    expect(refreshed.invalidated).toEqual(["map-a:east"]);
  });

  it("keeps display ordering independent from graph destinations", () => {
    const draft = fullDraft();
    const moved = moveMember(draft, "map-b", -1);
    expect(moved.members.map((member) => member.mapId)).toEqual(["map-b", "map-a"]);
    expect(moved.bindings).toEqual(draft.bindings);
  });

  it("reports unreachable maps and an ending that exists only on an island", () => {
    const island = bindExit(fullDraft(), "map-a", "east", "end") as AdventureDraft;
    expect(draftValidationIssues(island)).toContainEqual({
      code: "unreachable_map",
      mapId: "map-b",
    });
    const endOnIsland = bindExit(island, "map-a", "east", {
      mapId: "map-a",
      entryId: "door",
    }) as AdventureDraft;
    expect(draftValidationIssues(endOnIsland)).toContainEqual({ code: "unreachable_end" });
  });
});
