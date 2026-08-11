import { setLocale, t } from "@lindocara/client/i18n.js";
import { adventureEditorSessionAtom } from "@lindocara/client/state/atoms.js";
import { AdventureEditorScreen } from "@lindocara/editor/ui/editor/AdventureEditorScreen.js";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Alepha } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { ReactRouter } from "alepha/react/router";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** `AdventureEditorScreen` reads `adventureEditorSessionAtom` and calls `useRouter()` directly (Task
 *  6) — both need a real Alepha instance with `AlephaReact` registered to mount at all. A bare
 *  `AlephaReact` (no full `AppRouter` page tree) is enough, but `ReactRouter` still has to be
 *  injected HERE, before `start()` locks the container: a component's first `useRouter()` call
 *  happens after that lock, and `alepha.react.router`'s module is only ever registered by touching
 *  one of its services first (mirrors `AppRouter`'s own eager `reactAuth = $inject(ReactAuth)`
 *  field — see its docblock).
 *
 *  This mounts by hand instead of using `renderWithAlepha`, and the ordering is load-bearing: it must
 *  match `ReactPageProvider.root` (`.vendor/alepha/src/react/router/providers/ReactPageProvider.ts`),
 *  which wraps `<StrictMode>` OUTSIDE `<AlephaContext.Provider>` — the real router root every `$page`
 *  (including `editor`) mounts under, with `strictMode` defaulting `true` and never overridden in this
 *  app. `renderWithAlepha`'s own `wrapper` option nests the opposite way (inside the Alepha provider),
 *  which does not reproduce React's real mount→cleanup→mount dance in this environment. Composing the
 *  tree in the ORDER THE APP ACTUALLY USES is what makes the entry path strict-mode-tested for real:
 *  the sandbox is minted in an effect, and a second invocation would discard the first one's map. */
async function mountScreen() {
  const alepha = Alepha.create().with(AlephaReact);
  alepha.inject(ReactRouter);
  await alepha.start();
  const result = render(
    <StrictMode>
      <AlephaContext.Provider value={alepha}>
        <AdventureEditorScreen />
      </AlephaContext.Provider>
    </StrictMode>,
  );
  return { ...result, alepha };
}

/** The sandbox map is mounted straight into the stage, so entry now reaches it — a bare `vi.fn()`
 *  would return `undefined` where the screen calls `.then()`. Only the calls the open path makes
 *  are needed. */
const stageMock = vi.hoisted(() => ({ openMapEditorStage: vi.fn() }));
vi.mock("@lindocara/editor/game/map-editor-stage.js", () => ({
  openMapEditorStage: stageMock.openMapEditorStage,
  defaultDimForMode: (mode: string) => mode !== "field",
}));
vi.mock("@lindocara/editor/game/map-preview.js", () => ({ startMapPreview: vi.fn() }));

function stageHandle() {
  return {
    setTool: vi.fn(),
    setActiveMode: vi.fn(),
    setDim: vi.fn(),
    setGrid: vi.fn(),
    setCollisions: vi.fn(),
    setZoom: vi.fn(),
    // Read during render (the inspector's live map), so it must answer with a map, not undefined.
    current: vi.fn(() => ({
      name: "Sandbox",
      layers: [],
      elements: [],
      spawn: { col: 0, row: 0 },
      markers: [],
      events: [],
    })),
    setName: vi.fn(),
    setAudio: vi.fn(),
    setHeroSettings: vi.fn(),
    setLighting: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    markSaved: vi.fn(),
    selected: vi.fn(() => null),
    clearSelection: vi.fn(),
    moveSelected: vi.fn(),
    setSelectedElementAsset: vi.fn(),
    deleteSelected: vi.fn(),
    beginEventDraft: vi.fn(),
    commitEventDraft: vi.fn(),
    deleteEvent: vi.fn(),
    highlightEvent: vi.fn(),
    selectEvent: vi.fn(),
    dispose: vi.fn(),
  };
}

describe("AdventureEditorScreen sandbox entry", () => {
  let alephaInstances: Array<{ stop(): Promise<void> }> = [];

  beforeEach(() => {
    setLocale("en");
    localStorage.clear();
    stageMock.openMapEditorStage.mockReset();
    stageMock.openMapEditorStage.mockResolvedValue(stageHandle());
  });

  afterEach(async () => {
    for (const alepha of alephaInstances) await alepha.stop();
    alephaInstances = [];
  });

  it("opens a local sandbox on entry, writing nothing and never rendering a picker", async () => {
    const mock = vi.fn(() => Promise.resolve(new Response("[]", { status: 200 })));
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);

    await waitFor(() => expect(alepha.store.get(adventureEditorSessionAtom)).not.toBeNull());
    const session = alepha.store.get(adventureEditorSessionAtom);
    // The whole point of the sandbox: entering the editor creates no adventure row. Untitled rows
    // used to accumulate one per visit, and nothing ever cleaned them up.
    expect(session?.adventureId).toBeNull();
    expect(session?.sandboxMap).toBeDefined();
    expect(session?.titleUntouched).toBe(true);
    expect(mock).not.toHaveBeenCalled();
    // Strict mode double-invokes the mount effect; a second sandbox would discard this one's map.
    await waitFor(() => expect(stageMock.openMapEditorStage).toHaveBeenCalled());
    expect(alepha.store.get(adventureEditorSessionAtom)?.sandboxMap?.id).toBe(
      session?.sandboxMap?.id,
    );
  });

  it("mounts the sandbox's own map in the stage, with no map request", async () => {
    const mock = vi.fn(() => Promise.resolve(new Response("[]", { status: 200 })));
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);

    await waitFor(() => expect(stageMock.openMapEditorStage).toHaveBeenCalledTimes(1));
    const opened = stageMock.openMapEditorStage.mock.calls[0]?.[0] as { name: string };
    expect(opened.name).toBe(alepha.store.get(adventureEditorSessionAtom)?.sandboxMap?.name);
    // No `/api/maps?adventure=…` list and no map fetch: there is nothing stored to fetch.
    expect(mock).not.toHaveBeenCalled();
  });

  it("opens another sandbox from File → New adventure, still writing nothing", async () => {
    const mock = vi.fn(() => Promise.resolve(new Response("[]", { status: 200 })));
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);
    await waitFor(() => expect(alepha.store.get(adventureEditorSessionAtom)).not.toBeNull());
    const first = alepha.store.get(adventureEditorSessionAtom);

    // The File-menu idiom used throughout `editor-shell.test.tsx`: focus the trigger, press Enter,
    // then click the item. A plain click on the trigger does not open this menubar.
    screen.getByRole("menuitem", { name: t("editor.shell.menu.file") }).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(
      await screen.findByRole("menuitem", { name: t("editor.shell.newAdventure") }),
    );

    await waitFor(() =>
      expect(alepha.store.get(adventureEditorSessionAtom)?.draftId).not.toBe(first?.draftId),
    );
    const second = alepha.store.get(adventureEditorSessionAtom);
    expect(second?.adventureId).toBeNull();
    expect(second?.sandboxMap?.id).not.toBe(first?.sandboxMap?.id);
    expect(mock).not.toHaveBeenCalled();
  });
});
