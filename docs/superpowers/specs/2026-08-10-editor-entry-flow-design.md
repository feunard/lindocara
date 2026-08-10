# Editor entry flow — open into a scratch adventure

Date: 2026-08-10
Status: validated in brainstorming, ready for an implementation plan

## Goal

Entering the editor must drop the author straight onto a canvas they can paint on. Today it lands on
`AdventurePickerScreen` — a list of the account's adventures plus a create form — so the first thing
the tool asks is an administrative question ("which adventure?") before it has shown a single tile.

The new rule: **entering the editor mints a fresh, unsaved adventure and opens it.** Reaching an
existing adventure becomes an explicit act — `File → Open` — rather than a toll gate on the way in.

This inverts a rule the picker states in its own docstring ("entering the editor never silently picks
or creates data"). That rule is deliberately retired: it optimised for never surprising the author
with data, at the cost of making the common case — "I want to draw something" — the slowest path.

## What already exists

Four findings from reading the package; each one shrinks the work.

- **`File → Open` is already built.** `EditorMenuBar`'s `onOpenLoad` opens `LoadAdventureDialog`,
  which lists the account's adventures and can open **and delete** them. Nothing about opening needs
  to be written.
- **"Born unnamed, named at first save" is already built.** The session carries `titleUntouched`, and
  `⌘S` on an unnamed adventure opens `FirstSaveDialog`, which writes title and map in one atomic
  `/api/maps/:id` request. The scratch adventure inherits this untouched.
- **`POST /api/adventures` is atomic and returns the default map.** `AdventureController` creates the
  adventure and its first map in one transaction and answers `AdventurePayload & { defaultMap }`, so
  minting a scratch is a single round trip with no follow-up fetch.
- **`adventure.default_title`** already exists in both dictionaries ("New adventure" / "Nouvelle
  aventure"). No new name string is needed for the adventure itself.

And one piece of debris: **`editor-last-adventure.ts` has zero consumers.** Its docstring describes an
abandoned "UX wave #15" that solved this same problem a different way — reopen the last-edited
adventure, "so there is no picker page", falling through to instant-create. That premise is rejected
here (entering always gives a *fresh* scratch, never a resumed one), so the module is deleted rather
than revived.

## Decisions

| Question | Decision |
| --- | --- |
| What "unsaved" means | A **real adventure row**, created on entry, presented as unsaved. Not an in-memory draft. |
| Why not a true in-memory "Untitled" | A map cannot exist without an adventure (`createMapApi(adventureId, …)`), and saving is `PUT /api/maps/:id` on an existing row. Every downstream surface — stage, map panel, Test, quests, registry — assumes real server ids. Deferring row creation would rewrite all of them for a semantic nicety. |
| Starting another adventure from inside one | A new **`File → New adventure`** item, above `New map`. `⌘N` stays on `New map`. |
| Abandoned scratches | **Kept.** No auto-cleanup. They are deleted by hand through `File → Open`, which already has a delete button. Nothing ever vanishes on its own. |
| The picker screen | **Deleted outright.** Its two jobs survive as delete (Open dialog) and create (the new File item). |

The scratch-cleanup decision is worth stating plainly because it has a visible cost: every editor
visit leaves an untitled adventure behind, and the `File → Open` list will accumulate them. That was
chosen over automatic discard so that no unsaved work can ever disappear without the author asking
for it.

## Shape

### `ensureScratchAdventure()` — the new seam

Added to `adventure-session.ts`, beside `loadAdventureSession`. That module already describes itself
as "the one definition of *open this adventure for editing*"; this becomes the matching one
definition of *mint a fresh unsaved adventure*, so the entry bootstrap and `File → New adventure`
cannot drift apart.

It posts `{ title: t("adventure.default_title"), maxPlayers: 4 }`, then builds the session from the
response's adventure and `defaultMap` **without a second request**, with `titleUntouched: true`.

### How "unsaved" is shown

No new badge. `titleUntouched` already means "this adventure has never been named", and the shell
already has a dirty indicator for unsaved edits; a scratch reads as unsaved because it carries the
default title and, the moment anything is painted, the existing dirty marker. The affordance that
matters is `⌘S` opening `FirstSaveDialog`, which is unchanged.

### Entry

`AdventureEditorScreen` currently reads:

```
if (session?.adventureId) return <AdventureEditorInner … />
return <AdventurePickerScreen />
```

The fallback becomes a bootstrap: run `ensureScratchAdventure()`, render a minimal "preparing" state
while it is in flight, install the session when it lands. The picker branch disappears.

### Menu

`EditorMenuBar` gains an `onNewAdventure` prop rendered above `New map`. Both `New adventure` and
`Open` pass through the editor's existing dirty confirm (`editor.shell.exit.confirm`) when the
current adventure has unsaved edits — the same guard `loadMap` already applies when switching maps.

### Save

Unchanged. `⌘S` on a scratch still opens `FirstSaveDialog`; confirming still sends title and map as
one transaction. The scratch simply *is* an adventure whose title was never touched, which is the
state that dialog was written for.

## The hazard: double-minting

**A naive `useEffect` bootstrap creates two adventures.** React 18 strict mode double-invokes effects
in development, and any re-render before the request resolves fires another `POST`. Because each call
is atomic and successful, nothing errors — the author simply ends up with two untitled rows per
visit, and (given the no-cleanup decision above) both persist.

The latch must be a ref checked and set **before** the request is issued, never after the `await`.
A cancelled/unmounted bootstrap must not install its session, and must not retry on remount.

This is the single most likely defect in the change, and it is invisible without an explicit test, so
the plan must assert *exactly one* create call across a strict-mode double mount.

## Error handling

- A failed create leaves the editor with nothing to show. Render the error surface with **Retry** and
  **Quit**; there is no picker to fall back to any more. It must not present an empty shell that looks
  like a working editor with a blank map.
- Session errors (`session_expired`, `unauthorized`) keep deferring to the client's global 401
  redirect seam, exactly as `isSessionError` does in the surfaces that survive. The bootstrap shows no
  banner for those.
- The dirty guard is a hard stop: if the author cancels it, no scratch is minted and no adventure is
  opened.

## Testing

jsdom component tests, in the editor package's existing Vitest project:

- Entering the editor mints exactly **one** scratch adventure and renders no picker — asserted across
  a strict-mode double mount.
- `File → New adventure` mints another scratch, and prompts first when the current one is dirty;
  cancelling mints nothing.
- `File → Open` prompts when dirty; cancelling opens nothing.
- A failing create renders Retry, not a blank stage.
- Session errors render no error banner (the global redirect owns them).

Two new i18n keys land in both dictionaries and the existing parity test enforces them: the
`New adventure` menu item, and the bootstrap's "preparing" caption. The menu label stays a **separate
key** from `adventure.default_title` even though both read "New adventure" today — one is a command,
the other is a piece of stored data, and letting a menu label reuse a default title couples two things
that will want to diverge.

## Out of scope

- Any change to how maps, quests, the registry or Test behave once an adventure is open.
- Automatic cleanup or garbage collection of untitled adventures.
- Reopening the last-edited adventure (explicitly rejected; its dead module is removed).
