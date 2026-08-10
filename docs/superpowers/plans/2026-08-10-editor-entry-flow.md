# Editor scratch-adventure entry flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entering the editor mints a fresh, unsaved adventure and opens it directly, instead of landing on the `AdventurePickerScreen` list; opening an existing adventure becomes `File → Open`, and starting another becomes `File → New adventure`.

**Architecture:** One new seam, `ensureScratchAdventure()`, sits in `adventure-session.ts` beside the existing `loadAdventureSession()` and is the single definition of "mint a fresh unsaved adventure". `AdventureEditorScreen`'s no-session branch stops rendering the picker and runs that seam behind a ref latch. `AdventurePickerScreen.tsx` and the orphaned `editor-last-adventure.ts` are deleted.

**Tech Stack:** TypeScript, React 18, Alepha atoms (`adventureEditorSessionAtom`), stock shadcn from `@lindocara/ui`, Vitest + jsdom + `@testing-library/react`, Biome.

## Global Constraints

- **English only** in all code, comments, tests, docs and commit messages — even though the surrounding specs are in French.
- **Two component trees:** creator surfaces use stock shadcn (`@lindocara/ui`), never `ui/tiny-swords/`.
- **Every player-facing string lives in `packages/engine/src/i18n/en.ts` AND `fr.ts`.** `packages/engine/test/i18n.test.ts` enforces key parity — a key added to one file only fails the suite.
- **No `vi.mock` of the app's own modules for behaviour under test.** Existing editor tests stub `fetch` with `vi.stubGlobal` and mock only the WebGL stage (`map-editor-stage.js`, `map-preview.js`); follow that.
- **Biome:** `noNonNullAssertion` is on — no `!`. Run `npm run lint:fix` before committing.
- **No TypeScript `private` members** in Alepha classes; JSDoc comments are `/** … */` blocks.
- Gate command for the whole change: `npm run check` (catalog/map checks, lint, typecheck, test).

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/editor/src/ui/editor/adventure-session.ts` | The two session seams: open an existing adventure, mint a scratch one | Modify — add `ensureScratchAdventure()` |
| `packages/editor/src/ui/editor/AdventureEditorScreen.tsx` | Editor shell; owns the no-session branch and the menu handlers | Modify — bootstrap replaces the picker branch; add `newAdventure()` |
| `packages/editor/src/ui/editor/EditorMenuBar.tsx` | The menu row | Modify — add `onNewAdventure` + the File item |
| `packages/editor/src/ui/editor/AdventurePickerScreen.tsx` | The landing list | **Delete** |
| `packages/editor/src/ui/editor/editor-last-adventure.ts` | Orphaned last-adventure memory (zero consumers) | **Delete** |
| `packages/engine/src/i18n/en.ts`, `fr.ts` | Dictionaries | Modify — add 2 keys, remove 5 orphaned |
| `packages/editor/test/adventure-session.test.ts` | Unit test for the new seam | **Create** |
| `packages/editor/test/editor-bootstrap.test.tsx` | Entry-flow behaviour | Rewrite — all 3 current tests assert picker behaviour |
| `packages/editor/CLAUDE.md`, root `AGENTS.md` | Guides | Modify — document the new entry rule |

---

### Task 1: The `ensureScratchAdventure()` seam

**Files:**
- Modify: `packages/editor/src/ui/editor/adventure-session.ts`
- Test: `packages/editor/test/adventure-session.test.ts` (create)

**Interfaces:**
- Consumes: `createAdventureApi(input: CreateAdventureInput): Promise<CreatedAdventure>` from `@lindocara/client/api.js`; `draftFromAdventure(payload, infos: ReadonlyMap<string, DraftMemberInfo>): AdventureDraft` from `@lindocara/client/adventure-draft.js`; `solidMaskFromMapPayload` from `../../game/editor-state.js`; `entryEvents`/`exitEvents`/`monsterEvents` from `@lindocara/engine/map-events.js`; `t` from `@lindocara/client/i18n.js`.
- Produces: `ensureScratchAdventure(): Promise<AdventureEditorSession>` — used by Task 2 (entry bootstrap) and Task 3 (`File → New adventure`).

The point of this seam is that it builds the session from the create response's `defaultMap` and issues **no second request**. `loadAdventureSession` would re-`GET` the adventure and then `GET` every map; on a brand-new adventure that is two wasted round trips for data we already hold.

- [ ] **Step 1: Write the failing test**

Create `packages/editor/test/adventure-session.test.ts`:

```ts
import { setLocale, t } from "@lindocara/client/i18n.js";
import { ensureScratchAdventure } from "@lindocara/editor/ui/editor/adventure-session.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A minimal `MapPayload` shaped enough for `solidMaskFromMapPayload` and the event readers. */
function blankMap(id: string) {
  return {
    id,
    name: "Map 1",
    revision: 1,
    tilesetId: "tiny-swords",
    cols: 2,
    rows: 2,
    layers: [[], [], []],
    elements: [],
    events: [],
    markers: [],
    spawn: { col: 0, row: 0 },
    heightfield: "",
  };
}

describe("ensureScratchAdventure", () => {
  beforeEach(() => setLocale("en"));

  it("creates one adventure with the default title and needs no second request", async () => {
    const mock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/adventures" && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse({
            id: "adv-scratch",
            accountId: "acct",
            title: t("adventure.default_title"),
            maxPlayers: 4,
            version: 1,
            mapIds: ["map-1"],
            graph: { start: null, links: [] },
            registry: { switches: [], variables: [] },
            defaultMap: blankMap("map-1"),
          }, 201),
        );
      }
      return Promise.resolve(jsonResponse({ error: "unexpected_request" }, 500));
    });
    vi.stubGlobal("fetch", mock);

    const session = await ensureScratchAdventure();

    expect(session.adventureId).toBe("adv-scratch");
    expect(session.titleUntouched).toBe(true);
    expect(session.draft.title).toBe(t("adventure.default_title"));
    expect(session.draft.members.map((member) => member.mapId)).toEqual(["map-1"]);
    // Exactly one call, and it is the POST: no follow-up GET of the adventure or its maps.
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0] ?? [];
    expect(url).toBe("/api/adventures");
    expect((init as RequestInit | undefined)?.method).toBe("POST");
  });

  it("sends the localized default title", async () => {
    setLocale("fr");
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        bodies.push(String(init?.body ?? ""));
        return Promise.resolve(
          jsonResponse({
            id: "adv-fr",
            accountId: "acct",
            title: "Nouvelle aventure",
            maxPlayers: 4,
            version: 1,
            mapIds: ["map-1"],
            graph: { start: null, links: [] },
            registry: { switches: [], variables: [] },
            defaultMap: blankMap("map-1"),
          }, 201),
        );
      }),
    );

    await ensureScratchAdventure();

    expect(JSON.parse(bodies[0] ?? "{}").title).toBe("Nouvelle aventure");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:editor -- adventure-session`
Expected: FAIL — `ensureScratchAdventure` is not exported from `adventure-session.js`.

- [ ] **Step 3: Write the implementation**

Append to `packages/editor/src/ui/editor/adventure-session.ts`, and extend its existing imports with `createAdventureApi` and `t`:

```ts
import { createAdventureApi, fetchAdventure, fetchMap } from "@lindocara/client/api.js";
import { t } from "@lindocara/client/i18n.js";
import type { MapPayload } from "@lindocara/client/api.js";
```

```ts
/** One map's draft-facing facts read from a payload already in hand — the same shape `memberInfo`
 *  produces, minus its fetch. A freshly created adventure hands us its default map inline, so
 *  re-requesting it would be a round trip for data we are already holding. */
function memberInfoFromPayload(payload: MapPayload): DraftMemberInfo {
  const entries = entryEvents(payload.events);
  const exits = exitEvents(payload.events);
  const labelsOf = (events: readonly { id: string; name: string }[]) =>
    Object.fromEntries(events.flatMap((event) => (event.name ? [[event.id, event.name]] : [])));
  return {
    mapId: payload.id,
    name: payload.name,
    revision: payload.revision,
    solid: solidMaskFromMapPayload(payload),
    monsterCount: monsterEvents(payload.events).length,
    entryIds: entries.map((event) => event.id),
    exitIds: exits.map((event) => event.id),
    entryLabels: labelsOf(entries),
    exitLabels: labelsOf(exits),
  };
}

/**
 * Mint a fresh, unsaved adventure and return the editor session for it — the one definition of
 * "new scratch adventure", used by the entry bootstrap and by File → New adventure so the two
 * cannot drift.
 *
 * `POST /api/adventures` is atomic: it creates the adventure AND its first map, and answers with
 * both, so this is a single round trip. `titleUntouched` is what makes it read as unsaved — the
 * first ⌘S opens `FirstSaveDialog` for the real name instead of saving under the default one.
 */
export async function ensureScratchAdventure(): Promise<AdventureEditorSession> {
  const created = await createAdventureApi({
    title: t("adventure.default_title"),
    maxPlayers: 4,
  });
  const infos = new Map<string, DraftMemberInfo>([
    [created.defaultMap.id, memberInfoFromPayload(created.defaultMap)],
  ]);
  const draft = draftFromAdventure(created, infos);
  return {
    adventureId: created.id,
    draftId: crypto.randomUUID(),
    draft,
    invalidatedLinks: [],
    savedDraft: JSON.stringify(draft),
    titleUntouched: true,
  };
}
```

Then refactor the existing `memberInfo` to reuse it, so the two cannot diverge:

```ts
export async function memberInfo(mapId: string): Promise<DraftMemberInfo> {
  return memberInfoFromPayload(await fetchMap(mapId));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:editor -- adventure-session`
Expected: PASS, 2 tests.

Then confirm nothing else regressed: `npm run test:editor`
Expected: the pre-existing `editor-bootstrap` failures do NOT appear yet — this task changes no screen.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck:editor && npm run lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src/ui/editor/adventure-session.ts packages/editor/test/adventure-session.test.ts
git commit -m "feat(editor): add the scratch-adventure session seam"
```

---

### Task 2: Entry bootstrap replaces the picker

**Files:**
- Modify: `packages/editor/src/ui/editor/AdventureEditorScreen.tsx:269-275` (the `AdventureEditorScreen` function)
- Delete: `packages/editor/src/ui/editor/AdventurePickerScreen.tsx`
- Delete: `packages/editor/src/ui/editor/editor-last-adventure.ts`
- Modify: `packages/engine/src/i18n/en.ts`, `packages/engine/src/i18n/fr.ts`
- Test: `packages/editor/test/editor-bootstrap.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `ensureScratchAdventure(): Promise<AdventureEditorSession>` (Task 1).
- Produces: nothing new for later tasks; `AdventureEditorScreen` keeps its signature.

**The hazard this task exists to avoid:** React 18 strict mode double-invokes effects, and any re-render before the request settles fires another `POST`. Each call succeeds, so nothing errors — the author just silently gets two untitled adventures per visit, and (by design, there is no cleanup) both persist. The latch must be a `useRef` checked **and set before** the `await`, never after it.

- [ ] **Step 1: Add the four i18n keys**

None of these exist yet (`editor.retry` included — verified by grep).

In `packages/engine/src/i18n/en.ts`, beside `"editor.shell.load"` (line ~1239):

```ts
  "editor.shell.newAdventure": "New adventure",
  "editor.shell.preparing": "Preparing a new adventure…",
  "editor.shell.preparing.failed": "Could not start a new adventure.",
  "editor.retry": "Retry",
```

In `packages/engine/src/i18n/fr.ts`, beside `"editor.shell.load"` (line ~1254):

```ts
  "editor.shell.newAdventure": "Nouvelle aventure",
  "editor.shell.preparing": "Préparation d'une nouvelle aventure…",
  "editor.shell.preparing.failed": "Impossible de démarrer une nouvelle aventure.",
  "editor.retry": "Réessayer",
```

`editor.shell.newAdventure` stays a separate key from `adventure.default_title` even though the English reads the same: one is a command, the other is stored data.

- [ ] **Step 2: Remove the five orphaned picker keys**

Delete from BOTH `en.ts` and `fr.ts` — these have no consumer once the picker is gone (verified by grep; the other `editor.picker.*` keys are reused by `LoadAdventureDialog` and MUST stay):

```
editor.picker.title
editor.picker.subtitle
editor.picker.empty
editor.picker.create.heading
editor.picker.create.submit
```

Keep: `editor.picker.loading`, `editor.picker.maps`, `editor.picker.author`, `editor.picker.playable`, `editor.picker.draft`, `editor.picker.open`.

- [ ] **Step 3: Write the failing test**

Replace the whole body of `packages/editor/test/editor-bootstrap.test.tsx`. Keep its existing `mountScreen` helper and the two `vi.mock` stage mocks verbatim (lines 1-30 of the current file) — they are why the screen can mount at all — and replace the `describe` block with:

```tsx
describe("AdventureEditorScreen scratch entry", () => {
  let alephaInstances: Array<{ stop(): Promise<void> }> = [];

  beforeEach(() => {
    setLocale("en");
    localStorage.clear();
  });

  afterEach(async () => {
    for (const alepha of alephaInstances) await alepha.stop();
    alephaInstances = [];
  });

  function scratchResponse() {
    return jsonResponse(
      {
        ...adventurePayload("adv-scratch", t("adventure.default_title")),
        mapIds: ["map-1"],
        defaultMap: {
          id: "map-1",
          name: "Map 1",
          revision: 1,
          tilesetId: "tiny-swords",
          cols: 2,
          rows: 2,
          layers: [[], [], []],
          elements: [],
          events: [],
          markers: [],
          spawn: { col: 0, row: 0 },
          heightfield: "",
        },
      },
      201,
    );
  }

  it("mints exactly one scratch adventure on entry and never renders a picker", async () => {
    const mock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/adventures" && init?.method === "POST") {
        return Promise.resolve(scratchResponse());
      }
      if (url === "/api/maps/map-1") {
        return Promise.resolve(jsonResponse({ error: "not_found" }, 404));
      }
      return Promise.resolve(jsonResponse([], 200));
    });
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);

    await waitFor(() =>
      expect(alepha.store.get(adventureEditorSessionAtom)?.adventureId).toBe("adv-scratch"),
    );
    expect(alepha.store.get(adventureEditorSessionAtom)?.titleUntouched).toBe(true);
    // The latch: strict mode double-invokes the effect, and every extra POST is a stray
    // untitled adventure that nothing ever cleans up.
    expect(
      mock.mock.calls.filter(
        ([url, init]) => url === "/api/adventures" && (init as RequestInit)?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("shows a retry instead of a blank stage when the create fails", async () => {
    let attempts = 0;
    const mock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/adventures" && init?.method === "POST") {
        attempts += 1;
        if (attempts === 1) return Promise.resolve(jsonResponse({ error: "server_error" }, 500));
        return Promise.resolve(scratchResponse());
      }
      return Promise.resolve(jsonResponse([], 200));
    });
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);

    const retry = await screen.findByRole("button", { name: t("editor.retry") });
    expect(alepha.store.get(adventureEditorSessionAtom)).toBeNull();

    await userEvent.click(retry);
    await waitFor(() =>
      expect(alepha.store.get(adventureEditorSessionAtom)?.adventureId).toBe("adv-scratch"),
    );
  });

  it("shows no error banner when the session has expired", async () => {
    const mock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/adventures" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ error: "session_expired" }, 401));
      }
      return Promise.resolve(jsonResponse([], 200));
    });
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);

    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: t("editor.retry") })).toBeNull();
    expect(alepha.store.get(adventureEditorSessionAtom)).toBeNull();
  });
});
```

All four strings these tests reference were added in Step 1.

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:editor -- editor-bootstrap`
Expected: FAIL — the picker still renders and no `POST` is issued on mount.

- [ ] **Step 5: Replace the picker branch with the bootstrap**

In `AdventureEditorScreen.tsx`, delete the `AdventurePickerScreen` import (line 88) and replace the screen function (lines 269-275) with:

```tsx
export function AdventureEditorScreen() {
  const [session] = useStore(adventureEditorSessionAtom);
  if (session?.adventureId) {
    return <AdventureEditorInner key={session.adventureId} adventureId={session.adventureId} />;
  }
  return <AdventureEditorBootstrap />;
}

/**
 * The no-session branch: mint a scratch adventure and open it. Entering the editor no longer asks
 * which adventure to work on — that is `File → Open` now — so this is the only path in.
 *
 * The `startedRef` latch is load-bearing. React 18 strict mode double-invokes this effect in
 * development, and any re-render before the request settles would fire a second `POST`. Both calls
 * succeed, so nothing surfaces as an error: the author simply accumulates untitled adventures that
 * nothing ever cleans up. The latch is therefore checked and set BEFORE the await, never after.
 */
function AdventureEditorBootstrap() {
  useLocale();
  const router = useRouter();
  const [, setSession] = useStore(adventureEditorSessionAtom);
  const [failed, setFailed] = useState(false);
  const startedRef = useRef(false);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the explicit retry trigger
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const created = await ensureScratchAdventure();
        if (!cancelled) setSession(created);
      } catch (caught) {
        if (cancelled) return;
        startedRef.current = false;
        // A dead session is already being redirected to /auth by the client's global 401 seam;
        // showing a retry on top of that would be a second, contradictory answer.
        if (isSessionError(errorCode(caught))) return;
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, setSession]);

  return (
    <main className="editor-root editor-chrome flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-950">
      {failed ? (
        <div className="flex flex-col items-center gap-3">
          <p role="alert" className="text-sm text-destructive">
            {t("editor.shell.preparing.failed")}
          </p>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setFailed(false);
                setAttempt((current) => current + 1);
              }}
            >
              {t("editor.retry")}
            </Button>
            <Button variant="outline" onClick={() => void router.push("menu")}>
              {t("editor.shell.quit")}
            </Button>
          </div>
        </div>
      ) : (
        <p role="status" className="text-sm text-zinc-500">
          {t("editor.shell.preparing")}
        </p>
      )}
    </main>
  );
}
```

`isSessionError` already exists in `AdventureEditorScreen.tsx:190` — reuse it. The identical copy in `AdventurePickerScreen.tsx:35-37` dies with that file; do not add a third.

`errorCode` (line 12) and `useRef` (line 68) are already imported in this file. Verify `useState`, `useEffect` and `Button` are too, and add only what is missing.

- [ ] **Step 6: Delete the two dead files**

```bash
git rm packages/editor/src/ui/editor/AdventurePickerScreen.tsx
git rm packages/editor/src/ui/editor/editor-last-adventure.ts
```

`editor-last-adventure.ts` has zero consumers (verified by grep); its docstring describes an abandoned attempt at this same goal, and its "resume the last adventure" premise is explicitly rejected by the spec.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test:editor -- editor-bootstrap`
Expected: PASS, 3 tests.

Run: `npm run test:editor`
Expected: all pass. `editor-shell.test.tsx` uses `editor.picker.open` inside the **Load dialog**, which survives — if it fails, a surviving key was deleted in Step 2; restore it.

- [ ] **Step 8: Verify i18n parity and lint**

Run: `npm test -w @lindocara/engine -- i18n && npm run typecheck:editor && npm run lint`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add -A packages/editor packages/engine/src/i18n
git commit -m "feat(editor): open into a scratch adventure instead of a picker"
```

---

### Task 3: `File → New adventure`

**Files:**
- Modify: `packages/editor/src/ui/editor/EditorMenuBar.tsx:17-45` (props) and `:114-128` (the File menu)
- Modify: `packages/editor/src/ui/editor/AdventureEditorScreen.tsx` (add `newAdventure()`, pass `onNewAdventure`)
- Test: `packages/editor/test/editor-bootstrap.test.tsx` (append the mint case)
- Test: `packages/editor/test/editor-shell.test.tsx` (append the dirty-guard case, after line 690)

**Interfaces:**
- Consumes: `ensureScratchAdventure()` (Task 1); the existing `dirty` state and `setSession` in `AdventureEditorInner`.
- Produces: `EditorMenuBarProps.onNewAdventure(): void`.

- [ ] **Step 1: Write the failing test**

Append inside the `describe` block of `editor-bootstrap.test.tsx`:

```tsx
  it("mints another scratch from File → New adventure, guarding unsaved edits", async () => {
    let created = 0;
    const mock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/adventures" && init?.method === "POST") {
        created += 1;
        return Promise.resolve(
          created === 1
            ? scratchResponse()
            : jsonResponse(
                {
                  ...adventurePayload("adv-second", t("adventure.default_title")),
                  mapIds: [],
                  defaultMap: {
                    id: "map-2",
                    name: "Map 1",
                    revision: 1,
                    tilesetId: "tiny-swords",
                    cols: 2,
                    rows: 2,
                    layers: [[], [], []],
                    elements: [],
                    events: [],
                    markers: [],
                    spawn: { col: 0, row: 0 },
                    heightfield: "",
                  },
                },
                201,
              ),
        );
      }
      if (url.startsWith("/api/maps/")) {
        return Promise.resolve(jsonResponse({ error: "not_found" }, 404));
      }
      return Promise.resolve(jsonResponse([], 200));
    });
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);
    await waitFor(() =>
      expect(alepha.store.get(adventureEditorSessionAtom)?.adventureId).toBe("adv-scratch"),
    );

    // The File-menu idiom used throughout `editor-shell.test.tsx`: focus the trigger, press Enter,
    // then click the item. A plain click on the trigger does not open this menubar.
    screen.getByRole("menuitem", { name: t("editor.shell.menu.file") }).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(
      await screen.findByRole("menuitem", { name: t("editor.shell.newAdventure") }),
    );

    await waitFor(() =>
      expect(alepha.store.get(adventureEditorSessionAtom)?.adventureId).toBe("adv-second"),
    );
    expect(created).toBe(2);
  });

```

- [ ] **Step 1b: Write the dirty-guard test where the stage harness lives**

The guard test belongs in `packages/editor/test/editor-shell.test.tsx`, not the bootstrap file: making the shell dirty requires a resolved stage, and that file already has `markDirty()` (line 655) plus the `mountReady`/`mapsBackend` harness. Add it immediately after the existing `"raises the dirty guard when switching maps…"` test (line 669-690), in the same `describe`, following that test's exact idiom:

```tsx
  it("guards File → New adventure with the dirty confirm, and mints nothing when declined", async () => {
    const mock = mapsBackend(twoMaps);
    vi.stubGlobal("fetch", mock);
    await mountReady(alepha);
    await screen.findByRole("button", { name: "Frostfen" });
    markDirty();

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    screen.getByRole("menuitem", { name: t("editor.shell.menu.file") }).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(
      await screen.findByRole("menuitem", { name: t("editor.shell.newAdventure") }),
    );

    expect(confirm).toHaveBeenCalledWith(t("editor.shell.exit.confirm"));
    // Declined: no adventure was created, and the stage was never reopened for a new one.
    expect(mock).not.toHaveBeenCalledWith(
      "/api/adventures",
      expect.objectContaining({ method: "POST" }),
    );
    expect(stageMock.openMapEditorStage).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run both tests to verify they fail**

Run: `npm run test:editor -- editor-bootstrap editor-shell`
Expected: FAIL — no `New adventure` menu item exists, so `findByRole` times out in both new cases.

- [ ] **Step 3: Add the menu bar prop and item**

In `EditorMenuBar.tsx`, add to `EditorMenuBarProps` beside `onOpenLoad`:

```ts
  /** Start a fresh unsaved adventure, from File → « Nouvelle aventure ». Dirty-guarded by the
   *  shell, exactly like `onOpenLoad`. */
  onNewAdventure(): void;
```

Destructure `onNewAdventure` in the parameter list, then add the item as the FIRST entry of the File menu, above `New map`:

```tsx
            <MenubarItem onClick={onNewAdventure}>{t("editor.shell.newAdventure")}</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={onNewMap}>
```

`⌘N` stays on `New map` — the new item takes no shortcut.

- [ ] **Step 4: Add the handler in the shell**

In `AdventureEditorScreen.tsx`, beside `loadAdventure` (around line 437), add:

```tsx
  // File → New adventure: same dirty guard as `loadAdventure`, then swap the session for a fresh
  // scratch. `AdventureEditorInner` is keyed by `adventureId`, so this remounts every room-local
  // editor state cleanly rather than leaking the previous adventure's stage.
  function newAdventure(): void {
    if (savingMapRef.current) return;
    if (dirty && !window.confirm(t("editor.shell.exit.confirm"))) return;
    setError(null);
    void (async () => {
      try {
        setSession(await ensureScratchAdventure());
      } catch (caught) {
        fail(caught);
      }
    })();
  }
```

Pass it at the `<EditorMenuBar>` call site (line ~1446), beside `onOpenLoad`:

```tsx
          onNewAdventure={() => newAdventure()}
```

Import `ensureScratchAdventure` alongside the existing `loadAdventureSession` import.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:editor -- editor-bootstrap editor-shell`
Expected: PASS — 4 tests in `editor-bootstrap`, and `editor-shell` green with its new case.

Run: `npm run test:editor`
Expected: all pass.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck:editor && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/editor
git commit -m "feat(editor): add File → New adventure"
```

---

### Task 4: Document the new entry rule

**Files:**
- Modify: `packages/editor/CLAUDE.md` (a symlink to `AGENTS.md` — edit the real file)
- Modify: `AGENTS.md` (root, the "Maps and the editor" section)
- Modify: `docs/adventure-editor-roadmap.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update the editor package guide**

In `packages/editor/AGENTS.md`, under `## Responsibility`, add:

```markdown
- Entering the editor mints a fresh **unsaved scratch adventure** (`ensureScratchAdventure()` in
  `src/ui/editor/adventure-session.ts`) and opens it. There is no landing/picker page: reaching an
  existing adventure is `File → Open`, and starting another is `File → New adventure`. Abandoned
  scratches are deliberately NOT cleaned up — they are deleted by hand from the Open dialog, so no
  unsaved work can vanish unasked.
- The entry bootstrap's ref latch is load-bearing: without it, React strict mode's double-invoked
  effect mints two adventures per visit, silently, and nothing ever collects them.
```

- [ ] **Step 2: Update the root guide**

In the root `AGENTS.md`, in the "Maps and the editor" section, after the sentence describing the merged `adventure-editor` screen, add:

```markdown
Entering the editor opens a fresh unsaved adventure rather than a picker: `AdventureEditorScreen`'s
no-session branch calls `ensureScratchAdventure()`, which is one atomic `POST /api/adventures`
(the route returns the default map with it, so there is no second round trip). `File → Open` reaches
an existing adventure and `File → New adventure` starts another; both are dirty-guarded. Untitled
scratches accumulate by design and are deleted by hand from the Open dialog.
```

- [ ] **Step 3: Update the roadmap**

`docs/adventure-editor-roadmap.md` is organised as tranche sections. Insert a new section immediately **before** `## How to work` (line ~312), after the last tranche:

```markdown
## Entry flow — the scratch adventure (2026-08-10)

The editor no longer opens on a list. Entering it mints a fresh unsaved adventure
(`ensureScratchAdventure()`) and drops you on its blank map; `File → Open` reaches an existing one
and `File → New adventure` starts another, both dirty-guarded. `AdventurePickerScreen` is deleted,
and so is `editor-last-adventure.ts` — an orphan that solved this same problem by reopening the last
adventure, a premise this rejects.

Untitled scratches are deliberately never collected: they are deleted by hand from the Open dialog,
so nothing unsaved can disappear unasked. Expect the Open list to accumulate them.

See [the design](./superpowers/specs/2026-08-10-editor-entry-flow-design.md).
```

- [ ] **Step 4: Run the full gate**

Run: `npm run check`
Expected: catalog/map checks, lint, typecheck and the whole test suite pass.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/AGENTS.md AGENTS.md docs/adventure-editor-roadmap.md
git commit -m "docs(editor): record the scratch-adventure entry rule"
```

---

## Verification

After Task 4, confirm the flow by hand — the tests cover the wiring, not how it feels:

1. `preview_start` with `{name: "dev"}` (port 5273), log in, navigate to `/editor`.
2. Expect the stage to appear with a blank map and no picker.
3. `File → Open` lists existing adventures; opening one switches to it.
4. `File → New adventure` returns to a blank scratch; with unsaved paint down, it prompts first.
5. `⌘S` opens the name popup, not a silent save.
6. Check the browser console and `preview_logs` for errors.
