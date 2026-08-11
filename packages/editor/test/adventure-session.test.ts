import { setLocale, t } from "@lindocara/client/i18n.js";
import { createSandboxSession } from "@lindocara/editor/ui/editor/adventure-session.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("createSandboxSession", () => {
  beforeEach(() => setLocale("en"));

  it("opens a complete editable session without writing anything", () => {
    const mock = vi.fn(() => Promise.resolve(new Response(null, { status: 500 })));
    vi.stubGlobal("fetch", mock);

    const session = createSandboxSession();

    // The whole point: entering the editor no longer creates an untitled adventure row.
    expect(mock).not.toHaveBeenCalled();
    expect(session.adventureId).toBeNull();
    expect(session.savedDraft).toBeNull();
    // Unnamed, so the first save prompts for the real name (`FirstSaveDialog`).
    expect(session.titleUntouched).toBe(true);
    expect(session.draft.title).toBe(t("adventure.default_title"));

    // A real map to paint on, and a draft that already tracks it as its one member.
    const map = session.sandboxMap;
    expect(map).toBeDefined();
    if (!map) return;
    expect(map.revision).toBe(0);
    expect(map.heightfield).toBeNull();
    expect(map.cols).toBeGreaterThan(0);
    expect(map.layers.length).toBeGreaterThan(0);
    expect(session.draft.members.map((member) => member.mapId)).toEqual([map.id]);
  });

  it("mints an independent sandbox each time", () => {
    const first = createSandboxSession();
    const second = createSandboxSession();
    expect(second.draftId).not.toBe(first.draftId);
    expect(second.sandboxMap?.id).not.toBe(first.sandboxMap?.id);
  });

  it("names the sandbox with the active locale's default title", () => {
    setLocale("fr");
    expect(createSandboxSession().draft.title).toBe(t("adventure.default_title"));
  });
});
