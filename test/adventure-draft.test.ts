import { describe, expect, it } from "vitest";
import {
  type AdventureDraft,
  addMember,
  bindExit,
  type DraftMemberInfo,
  draftComplete,
  draftFromAdventure,
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

  it("completes only when start, every binding and one end are set", () => {
    const draft = fullDraft();
    expect(draftComplete(draft)).toBe(true);
    expect(draftComplete({ ...draft, start: null })).toBe(false);
    expect(draftComplete({ ...draft, title: "  " })).toBe(false);
    const unbound = bindExit(draft, "map-a", "east", null) as AdventureDraft;
    expect(draftComplete(unbound)).toBe(false);
    const endless = bindExit(draft, "map-b", "boss", {
      mapId: "map-a",
      entryId: "door",
    }) as AdventureDraft;
    expect(draftComplete(endless)).toBe(false); // no end left
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
    expect(toAdventureInput(emptyDraft())).toBeNull();
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
