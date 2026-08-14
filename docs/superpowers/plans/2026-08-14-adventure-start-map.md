# Adventure Start Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an adventure one authored start map (`adventures.startMapId`), author it from the maps panel, and retire the `spawn` event kind that used to imply it.

**Architecture:** A nullable column whose absence means "derive", exactly like `adventureTestSessions.startMapId`. `HeroService.resolveHeroStart` drops from three tiers to two — the column, else the earliest member map — after a hand-written migration backfills today's tier-1/tier-2 answers so published adventures start where they start now. Only then does `"spawn"` leave `EVENT_KINDS`, with stored spawn events dropped on parse rather than rejecting their map.

**Tech Stack:** TypeScript, Alepha ORM (`$entity`/`$repository`) over SQLite, React 19 + `@alepha/ui`, Vitest (node for `engine`/`server`, jsdom for `editor`/`client`), Biome.

Increment 2 of [`docs/superpowers/specs/2026-08-14-spawn-and-start-map-design.md`](../specs/2026-08-14-spawn-and-start-map-design.md). Increment 1 (drawing the per-map hero start point) already shipped.

## Global Constraints

- **English only** — code, comments, commit messages, test names, docs. The sole exception is the VALUES inside `packages/engine/src/i18n/fr.ts`, which are French by definition.
- **No `Co-authored-by` trailer** or AI attribution on any commit.
- **Every player-facing string lives in both dictionaries.** `packages/engine/test/i18n.test.ts` asserts en/fr parity and rejects empty values.
- **`npm run db:generate` is BROKEN repo-wide** (a top-level `await` in `apps/main/src/main.ts` defeats drizzle-kit's bundling). Migrations here are **hand-written**. `npm run check:migrations -w @lindocara/main` still works and is the gate.
- **Never trust a client message.** Wire parsing lives in `packages/engine/src/adventure.ts`'s `parseAdventureInput`; the controller's body schema is deliberately `z.any()` and must stay that way.
- **D1 discipline:** `repo.transaction()` throws on D1 and `$transactional()` degrades to a no-op there, so never build an invariant out of a read-then-write pair. This plan's writes are all single-statement.
- **Collision comes only from the compiled heightfield.** Nothing here touches walkability.
- **Two component trees:** creator surfaces use `@alepha/ui`, never `ui/tiny-swords/`.
- Run `npm run check` before the final commit of each task. `npm run lint:fix` applies Biome formatting.

## Ordering is load-bearing

Three ordering constraints, each discovered by tracing rather than guessed:

1. **The backfill must precede the resolution change.** `resolveHeroStart`'s tier 1 is what makes a published adventure start on its spawn-event map. Delete it before `startMapId` is populated and Brumeval, Sombregué and La Baie silently restart on their oldest map.
2. **Resolution must stop reading `"spawn"` before the enum loses it.** `mapEvents.kind` is `db.default(z.enum(EVENT_KINDS), "normal")`, so `HeroService`'s `kind: { eq: "spawn" }` is a compile error the moment `EVENT_KINDS` shrinks.
3. **Nothing may still MINT a spawn event when the enum shrinks.** `procedural-map.ts` and five `scripts/legacy/*` files do today, and their helper signatures name the kind in union types — all compile errors otherwise.

Hence: column → resolution → star → bundle → stop minting → retire the kind.

## File Structure

| File | Task | Responsibility |
| --- | --- | --- |
| `packages/server/src/api/entities/adventures.ts` | 1 | the `startMapId` column |
| `apps/main/migrations/sqlite/<new>/` | 1 | `migration.sql` + `snapshot.json`, hand-written, with the backfill |
| `packages/engine/src/adventure.ts` | 1 | `AdventureInput.startMapId` + its tri-state parse |
| `packages/server/src/api/services/AdventureService.ts` | 1 | membership validation, the `in_use` guard, the write, the read payload |
| `packages/client/src/api.ts`, `adventure-draft.ts` | 1 | payload + draft round-trip |
| `packages/server/src/api/services/HeroService.ts` | 2 | two-tier resolution |
| `packages/editor/src/ui/editor/MapListPanel.tsx`, `AdventureEditorScreen.tsx` | 3 | the star |
| `packages/engine/src/adventure-bundle.ts`, `scripts/lib/bundle-validate.ts` | 4 | export/import carries it |
| `packages/editor/src/game/procedural-map.ts`, `scripts/legacy/*` | 5 | stop minting spawn events |
| `packages/engine/src/map-events.ts` + editor palette/dialog + i18n | 6 | retire the kind, drop stored ones |

---

### Task 1: The column, the wire, and the backfill

**Files:**
- Modify: `packages/server/src/api/entities/adventures.ts:20-42`
- Create: `apps/main/migrations/sqlite/20260814120000_adventure_start_map/migration.sql`
- Create: `apps/main/migrations/sqlite/20260814120000_adventure_start_map/snapshot.json`
- Modify: `packages/engine/src/adventure.ts:49-60` (`AdventureInput`), `:123-137` (the optional-field parsers), `:153-176` (`parseAdventureInput`)
- Modify: `packages/server/src/api/services/AdventureService.ts:56-66` (`StoredAdventure`), `:166-213` (`updateAdventure`), `:285-299` (`toStored`)
- Modify: `packages/client/src/api.ts:222-234` (`AdventurePayload`)
- Modify: `packages/client/src/adventure-draft.ts:36-44`, `:46-54`, `:110-120`, `:122-145`
- Test: `packages/server/test-api/adventures.test.ts`, `packages/client/test/adventure-draft.test.ts`

**Interfaces:**
- Produces: `AdventureInput.startMapId?: string | null` — **tri-state: absent = preserve stored, `null` = clear, string = set**. `AdventurePayload.startMapId: string | null`. `AdventureDraft.startMapId: string | null`. `StoredAdventure.startMapId: string | null`. Tasks 2, 3 and 4 all read these exact names.

- [ ] **Step 1: Write the failing server test**

Add to `packages/server/test-api/adventures.test.ts` (follow the file's existing `registerAndLogin` / `authedFetch` helpers):

```ts
  test("stores an explicit start map, refuses a foreign one, and clears on null", async () => {
    const { userId, token } = await registerAndLogin("startmap");
    const adventureId = await newAdventure(userId);
    const mapId = await newMapId(adventureId, token);

    const initial = await authedFetch(`/api/adventures/${adventureId}`, token);
    expect(await initial.json()).toMatchObject({ startMapId: null });

    const set = await putAdventure(adventureId, token, { startMapId: mapId });
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({ startMapId: mapId });

    // Omitting the field preserves it — the same "absent means preserve" contract audio and
    // registry already use, so a title-only save cannot silently unset the start map.
    const renamed = await putAdventure(adventureId, token, { title: "Renamed" });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ startMapId: mapId, title: "Renamed" });

    // A map belonging to somebody else's adventure is not a member of this one.
    const other = await registerAndLogin("startmap2");
    const foreignMap = await newMapId(await newAdventure(other.userId), other.token);
    const foreign = await putAdventure(adventureId, token, { startMapId: foreignMap });
    expect(foreign.status).toBe(400);
    expect((await foreign.json()).error).toBe("adventure_maps");

    const cleared = await putAdventure(adventureId, token, { startMapId: null });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ startMapId: null });
  });
```

If `putAdventure(id, token, patch)` does not already exist in that file, write it beside the other helpers: it PUTs `{ title: "Adventure", maxPlayers: 4, ...patch }` to `/api/adventures/${id}` with the bearer token. Read the file's existing helpers first and match their style rather than inventing a second idiom.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --project server test-api/adventures.test.ts -t "start map"
```

Expected: FAIL — the response has no `startMapId`.

- [ ] **Step 3: Add the column**

In `packages/server/src/api/entities/adventures.ts`, after the `audio` column:

```ts
    /** The one map a new hero starts on. Null means derive — today that is the adventure's
     *  earliest-created map. Deliberately NOT `maps.isFirst`, which is account-scoped behind a
     *  `(userId) WHERE is_first = 1` unique index and so cannot express a second adventure. */
    startMapId: z.string().optional(),
```

Plain `z.string().optional()`, not `z.uuid()` and not `db.ref(...)` — mirroring `adventureTestSessions.startMapId` (`packages/server/src/api/entities/adventureTestSessions.ts:26-27`), which deliberately carries no foreign key so a deleted map degrades to "derive" rather than blocking the delete.

- [ ] **Step 4: Hand-write the migration**

Create `apps/main/migrations/sqlite/20260814120000_adventure_start_map/migration.sql`:

```sql
-- Written by hand because `alepha db migrations create` cannot run in this repo (a top-level
-- `await` inside an `if` in `apps/main/src/main.ts` defeats drizzle-kit's bundling, and every
-- `alepha db` command boots that entry). `npm run check:migrations` is unaffected and is the gate.
--
-- The two UPDATEs reproduce, once and in SQL, the derivation `HeroService.resolveHeroStart` used to
-- perform on every join: tier 1 the earliest-created member map carrying a spawn event, then tier 2
-- the legacy `graph.start` map. Tier 3 (the earliest member map) is deliberately NOT baked in —
-- that is what a NULL column already means, and writing it would freeze a fallback that should stay
-- live. Without this backfill, deleting tier 1 in the next commit would silently restart every
-- published adventure on its oldest map.
ALTER TABLE `adventures` ADD `start_map_id` text;--> statement-breakpoint
UPDATE `adventures` SET `start_map_id` = (
  SELECT m.`id` FROM `maps` m
  JOIN `mapEvents` e ON e.`map_id` = m.`id`
  WHERE m.`adventure_id` = `adventures`.`id` AND e.`kind` = 'spawn'
  ORDER BY m.`created_at`
  LIMIT 1
) WHERE `start_map_id` IS NULL;--> statement-breakpoint
UPDATE `adventures` SET `start_map_id` = (
  SELECT m.`id` FROM `maps` m
  WHERE m.`adventure_id` = `adventures`.`id`
    AND m.`id` = json_extract(`adventures`.`graph`, '$.start.mapId')
) WHERE `start_map_id` IS NULL;
```

Table names are the entity names verbatim (`adventures`, `maps`, `mapEvents`); column names are snake_case. Statements are joined by `--> statement-breakpoint`.

- [ ] **Step 5: Hand-write the snapshot**

Copy `apps/main/migrations/sqlite/20260811150000_admin_audits_and_keys/snapshot.json` to the new directory, then make exactly three edits:

1. `id` → a fresh uuid of your own minting.
2. `prevIds` → `["97d8de37-700c-4efe-9888-3ee3f4ee49b2"]` (the copied snapshot's own `id`).
3. In the `ddl` array, immediately after the `adventures` column entry named `audio`, insert:

```json
{ "type": "text", "notNull": false, "autoincrement": false, "default": null, "generated": null, "name": "start_map_id", "entityType": "columns", "table": "adventures" }
```

That object is copied field-for-field from the existing `adventureTestSessions.start_map_id` entry in the same file — the repo's one precedent for a nullable text column.

- [ ] **Step 6: Verify the migration against the entities**

```bash
npm run check:migrations -w @lindocara/main
```

Expected: no drift reported. If it reports a diff, the snapshot and the entity disagree — fix the snapshot, never the entity, and never edit an already-committed migration.

- [ ] **Step 7: Parse it off the wire**

In `packages/engine/src/adventure.ts`, add to the `AdventureInput` interface:

```ts
  /** Tri-state: absent preserves the stored value, `null` clears it, a string sets it. The same
   *  shape `audio` and `registry` use, plus an explicit clear — an author must be able to hand the
   *  start map back to the derivation, not only move it. */
  startMapId?: string | null;
```

And beside `parseOptionalAudio` (`:123-137`), the matching parser:

```ts
function parseOptionalStartMapId(value: unknown): { ok: true; startMapId?: string | null } | null {
  const record = value as Record<string, unknown>;
  if (record.startMapId === undefined) return { ok: true };
  if (record.startMapId === null) return { ok: true, startMapId: null };
  if (typeof record.startMapId !== "string" || !MAP_ID_PATTERN.test(record.startMapId)) return null;
  return { ok: true, startMapId: record.startMapId };
}
```

`MAP_ID_PATTERN` is already declared at `adventure.ts:22` and is what the graph validates map ids with — reuse it rather than `isUuid`, so the two agree. Then wire it into `parseAdventureInput`'s result spread (`:153-176`), following the `audio`/`registry` lines exactly:

```ts
    ...(startMapId.startMapId !== undefined ? { startMapId: startMapId.startMapId } : {}),
```

returning `null` from `parseAdventureInput` when `parseOptionalStartMapId` returns `null`, the same way the audio and registry parsers already gate it.

- [ ] **Step 8: Validate and write it in the service**

In `packages/server/src/api/services/AdventureService.ts`'s `updateAdventure`, after the `maxPlayers` check and before the graph block:

```ts
    // `undefined` preserves; `null` clears; a string must name a map of THIS adventure. A foreign or
    // deleted id would otherwise persist and resolve to nothing at join time, which reads to the
    // player as "the adventure starts in the wrong place" with nothing logged.
    if (typeof input.startMapId === "string") {
      const target = await this.maps.findById(input.startMapId);
      if (!target || target.adventureId !== id) {
        throw new Error("maps: the start map must belong to this adventure");
      }
    }
    if (input.startMapId !== undefined && (row.startMapId ?? null) !== (input.startMapId ?? null)) {
      const used = await this.parties.findMany({ where: { adventureId: { eq: id } }, limit: 1 });
      if (used.length > 0) throw new Error("in_use: a party still references this adventure");
    }
```

The `maps:` prefix is already wired end to end — `rethrowAsAdventureError` maps it to 400 `adventure_maps` (`adventureAuthoring.ts:50`), which `api.ts` maps to `adventure.error.maps`, which exists in both dictionaries. No new error code, no new i18n.

The `in_use` guard is the same one the graph's start-pin move already uses, for the same reason: a live party's heroes were placed by the old answer.

Then add to the `updateById` patch, beside the existing conditional spreads:

```ts
      ...(input.startMapId !== undefined ? { startMapId: input.startMapId ?? undefined } : {}),
```

Add `startMapId: string | null` to `StoredAdventure` (`:56-66`) and `startMapId: row.startMapId ?? null` to `toStored` (`:285-299`).

- [ ] **Step 9: Carry it to the client**

`packages/client/src/api.ts` — add `startMapId: string | null;` to `AdventurePayload`. `AdventureInput` is imported type-only from the engine, so it needs no edit here.

`packages/client/src/adventure-draft.ts`:
- `AdventureDraft` gains `startMapId: string | null`.
- `emptyDraft()` gains `startMapId: null`.
- `toAdventureInput()` gains `startMapId: draft.startMapId` to its returned object.
- `draftFromAdventure()`: add `startMapId?: string | null` to its inline structural `payload` parameter type and `startMapId: payload.startMapId ?? null` to the returned draft.

Then fix the two call sites the new required draft field breaks: `packages/editor/src/ui/editor/adventure-session.ts:97` (the sandbox literal — pass nothing; `draftFromAdventure`'s `?? null` covers it) and any test fixture the compiler points at.

- [ ] **Step 10: Write the draft round-trip test**

Add to `packages/client/test/adventure-draft.test.ts`:

```ts
  it("round-trips the start map through the draft and the input", () => {
    const draft = draftFromAdventure(
      { title: "A", maxPlayers: 4, mapIds: ["m1"], startMapId: "m1" },
      new Map(),
    );
    expect(draft.startMapId).toBe("m1");
    expect(toAdventureInput(draft)?.startMapId).toBe("m1");
    // An adventure that never chose one reads as null, not undefined: the wire's `null` means
    // "clear", and a draft that said `undefined` would silently mean "preserve" instead.
    expect(draftFromAdventure({ title: "A", maxPlayers: 4, mapIds: [] }, new Map()).startMapId)
      .toBeNull();
  });
```

- [ ] **Step 11: Run everything**

```bash
npx vitest run --project server test-api/adventures.test.ts
npx vitest run --project client test/adventure-draft.test.ts
npm run check
```

Expected: all green.

- [ ] **Step 12: Commit**

```bash
git add packages/server/src/api/entities/adventures.ts apps/main/migrations/sqlite/20260814120000_adventure_start_map packages/engine/src/adventure.ts packages/server/src/api/services/AdventureService.ts packages/client/src/api.ts packages/client/src/adventure-draft.ts packages/server/test-api/adventures.test.ts packages/client/test/adventure-draft.test.ts packages/editor/src/ui/editor/adventure-session.ts
git commit -m "feat(server): an adventure names its start map, and the migration backfills it"
```

---

### Task 2: Resolution reads the column

**Files:**
- Modify: `packages/server/src/api/services/HeroService.ts:1-25` (docblock), `:319-355` (`resolveHeroStart`)
- Test: `packages/server/test-api/heroes.test.ts:278-325`

**Interfaces:**
- Consumes: `adventures.startMapId` from Task 1.
- Produces: nothing new. `resolveHeroStart(adventureId)` keeps its signature and its `HeroStart | null` return.

- [ ] **Step 1: Write the failing test**

In `packages/server/test-api/heroes.test.ts`, REPLACE the existing test `"Tier 1: a spawn event wins over graph.start when both exist"` (`:278-325`) with the one below. It uses the same helpers that test already used — `registerAndLogin`, `newPlayableAdventureWithMap`, `newMap`, `authedFetch`, `newParty`, `spawnAt`, `BEYOND_SPAWN` — and the same assertion mechanism: create a hero through the real endpoint and read the map it landed on.

```ts
  test("the adventure's startMapId decides the start map", async () => {
    const { token } = await registerAndLogin("herostartmap");
    const { adventureId, mapId } = await newPlayableAdventureWithMap(token);
    const other = await newMap(token, adventureId, "Beyond");
    await alepha.inject(MapService).saveHeightfield(other, spawnAt(BEYOND_SPAWN));

    // Pinned BEFORE any party exists: Task 1's `in_use` guard refuses moving the start map out from
    // under a live party, exactly as the old graph-start pin did.
    const pinned = await authedFetch(`/api/adventures/${adventureId}`, token, {
      method: "PUT",
      body: JSON.stringify({ title: "Donjon", maxPlayers: 4, startMapId: other }),
    });
    expect(pinned.status).toBe(200);

    const partyId = await newParty(token, adventureId);
    const response = await authedFetch(`/api/parties/${partyId}/heroes`, token, {
      method: "POST",
      body: JSON.stringify({ name: "Bornhere", class: "warrior" }),
    });
    expect(response.status).toBe(201);
    const hero = (await response.json()) as { mapId: string; x: number; y: number; z: number };
    expect(hero.mapId).not.toBe(mapId);
    // The column decides the MAP; the position is still the destination's own heightfield spawn.
    expect(hero).toMatchObject({ mapId: other, x: BEYOND_SPAWN.x, y: 0, z: BEYOND_SPAWN.z });
  });

  test("an adventure that never chose one starts on its earliest map", async () => {
    const { token } = await registerAndLogin("heronostartmap");
    const { adventureId, mapId } = await newPlayableAdventureWithMap(token);
    await newMap(token, adventureId, "Beyond");

    const partyId = await newParty(token, adventureId);
    const response = await authedFetch(`/api/parties/${partyId}/heroes`, token, {
      method: "POST",
      body: JSON.stringify({ name: "Derived", class: "warrior" }),
    });
    expect(response.status).toBe(201);
    // A null column is not a broken adventure — it is the derivation, and it must keep working.
    expect((await response.json()) as { mapId: string }).toMatchObject({ mapId });
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --project server test-api/heroes.test.ts -t "startMapId wins"
```

Expected: FAIL — the second map is not chosen, because nothing reads the column.

- [ ] **Step 3: Rewrite the resolution**

Replace the three tiers in `resolveHeroStart` (`:326-354`) with two:

```ts
    // Tier 1: the adventure's authored start map, when it still names a member.
    if (row.startMapId) {
      const chosen = memberMaps.find((map) => map.id === row.startMapId);
      if (chosen) return startOn(chosen);
    }
    // Tier 2: the earliest-created member map. This is what a null column MEANS — an adventure that
    // never chose is playable from its first map, exactly as before.
    return startOn(memberMaps[0]);
```

Delete the `spawn`-event query and the `graph.start` tier entirely, along with the `mapEvents` repository field if nothing else in the class uses it (check before removing).

**A deleted or foreign `startMapId` falls through to tier 2 rather than failing** — that is why the column carries no foreign key. Say so in a comment.

- [ ] **Step 4: Clear the column when the start map is deleted**

Read-time fallback alone would leave a dangling id in the row: harmless to a player (tier 2 catches
it) but wrong in the editor, where the star would show no map selected while the column still names
one. Clear it at the source, mirroring `reassignFirstIfNeeded` — which sits on the very last line of
the same method.

In `packages/server/src/api/services/MapService.ts`'s `deleteMap`, beside the existing
`await this.reassignFirstIfNeeded(row.userId);`:

```ts
    // One conditional single-statement write, never a read-then-write: `$transactional()` degrades
    // to a no-op on D1, so a `findById` + `updateById` pair here would race a concurrent delete.
    await this.adventures.updateMany(
      { id: { eq: row.adventureId }, startMapId: { eq: id } },
      { startMapId: undefined },
    );
```

Check `updateMany`'s exact signature against its other uses in this file (`setFirstMap` at `:515-524`
uses it) and match them. If the repository cannot express "set to null" through `undefined`, use
whatever `setFirstMap`'s clear-then-set does for its own boolean.

Add to `packages/server/test-api/maps.test.ts` a case proving it: set a start map, delete that map
with `?force=true`, and assert the adventure reads back `startMapId: null` — and that a hero created
afterwards still lands on a real map rather than failing.

- [ ] **Step 5: Rewrite the docblock**

`HeroService.ts:7-23` describes the three tiers in prose. Rewrite it for two, and delete the sentence claiming tier 1 lands "on that event's cell" — the final review of increment 1 flagged it as already stale against `startOn`, which reads only `decoded.spawns[0]`.

- [ ] **Step 6: Run the tests**

```bash
npx vitest run --project server test-api/heroes.test.ts test-api/maps.test.ts
npm run typecheck:server
```

Expected: green, exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/api/services/HeroService.ts packages/server/src/api/services/MapService.ts packages/server/test-api/heroes.test.ts packages/server/test-api/maps.test.ts
git commit -m "feat(server): the start map is read, not derived from a spawn event"
```

---

### Task 3: The star in the maps panel

**Files:**
- Modify: `packages/editor/src/ui/editor/MapListPanel.tsx` (props ~`:38-71`, the row body ~`:250-300`)
- Modify: `packages/editor/src/ui/editor/AdventureEditorScreen.tsx` (the `<MapListPanel …>` props ~`:1820-1840`)
- Modify: `packages/engine/src/i18n/en.ts`, `fr.ts`
- Test: `packages/editor/test/map-list-panel.test.tsx:185-192`

**Interfaces:**
- Consumes: `AdventureDraft.startMapId`, `updateAdventureApi`, `toAdventureInput` (Task 1).
- Produces: two `MapListPanel` props — `startMapId: string | null` and `onSetStartMap(id: string): void`.

- [ ] **Step 1: Add the strings**

`packages/engine/src/i18n/en.ts`, beside the other `editor.shell.maps.*` keys:

```ts
  "editor.shell.maps.start": "Start map",
  "editor.shell.maps.setStart": "Make this the start map",
```

`fr.ts`:

```ts
  "editor.shell.maps.start": "Carte de départ",
  "editor.shell.maps.setStart": "Faire de cette carte le départ",
```

- [ ] **Step 2: Write the failing test**

In `packages/editor/test/map-list-panel.test.tsx`, REPLACE the test `"has no start affordance now — the graph is no longer authored"` (`:185-192`) with:

```ts
  it("marks the start map and moves it on click — the graph stays gone, this is not it", async () => {
    vi.stubGlobal("fetch", mapsBackend());
    const onSetStartMap = vi.fn();
    render(<Harness startMapId="m1" onSetStartMap={onSetStartMap} />);
    await screen.findByRole("button", { name: "Frostfen" });

    // The map that IS the start says so; the one that is not offers to become it.
    expect(screen.getByRole("button", { name: `${t("editor.shell.maps.start")} Verdant Reach` }))
      .toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: `${t("editor.shell.maps.setStart")} Frostfen` }),
    );
    expect(onSetStartMap).toHaveBeenCalledWith("m2");
  });
```

Add `startMapId` and `onSetStartMap` to the `Harness` overrides object and forward them, defaulting to `null` and `() => {}` — the file already follows that pattern for every other prop.

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run --project editor test/map-list-panel.test.tsx -t "marks the start map"
```

Expected: FAIL — no such button.

- [ ] **Step 4: Add the props and the control**

Add to `MapListPanelProps`:

```ts
  /** The adventure's authored start map, or null while it still derives (the earliest map). */
  startMapId: string | null;
  /** Make this map the start. The screen owns the write, like every other adventure-level edit. */
  onSetStartMap(id: string): void;
```

In the row, BEFORE the `{stored && (…)}` rename/delete block, a `Star` button from `lucide-react`. Two rules:

- It is **always visible**, not `opacity-0 group-hover:opacity-100` like rename and delete. It is a status indicator as much as a control — an author must see which map is the start without hovering every row.
- The current start map's button is **disabled** and labelled `editor.shell.maps.start`; every other row's is enabled and labelled `editor.shell.maps.setStart`. Both labels are `aria-label={`${label} ${map.name}`}`, matching the rename/delete convention in the same file.

For the **sandbox** (`adventureId === null`): the one listed map is the start by construction, so render the disabled `start` variant. Do not offer to move a start that has nowhere to move to and no row to write.

- [ ] **Step 5: Wire the screen**

In `AdventureEditorScreen.tsx`, pass `startMapId={session?.draft.startMapId ?? null}` and an `onSetStartMap` that updates the draft and PUTs it:

```ts
  // Written through immediately rather than parked until the settings dialog saves: the maps panel
  // already owns its own create/rename/delete calls, and a star that needed a second, unrelated
  // save to stick would read as broken.
  function setStartMap(id: string): void {
    const latest = alepha.store.get(adventureEditorSessionAtom);
    if (!latest?.adventureId) return;
    const draft = { ...latest.draft, startMapId: id };
    const input = toAdventureInput(draft);
    if (!input) return;
    setSession({ ...latest, draft, savedDraft: JSON.stringify(draft) });
    void updateAdventureApi(latest.adventureId, input).catch(fail);
  }
```

Import `updateAdventureApi` and `toAdventureInput` if the file does not already have them.

- [ ] **Step 6: Run the tests**

```bash
npx vitest run --project editor test/map-list-panel.test.tsx
npx vitest run --project editor test/editor-shell.test.tsx
npm run test:engine
```

Expected: green. The engine run is what proves en/fr parity for the two new keys.

- [ ] **Step 7: See it**

The dev server is pinned to port 5273 with `strictPort`; if it is already running, use it — do not start a second one or kill the running one. Use the `playwright-cli` skill (this project's standing rule for browser work; never the Claude-in-Chrome extension). Open `http://localhost:5273/editor`, and confirm the star is visible without hovering and that the current start map's star is visibly the set one.

- [ ] **Step 8: Commit**

```bash
git add packages/editor/src/ui/editor/MapListPanel.tsx packages/editor/src/ui/editor/AdventureEditorScreen.tsx packages/engine/src/i18n/en.ts packages/engine/src/i18n/fr.ts packages/editor/test/map-list-panel.test.tsx
git commit -m "feat(editor): the maps panel names the adventure's start map"
```

---

### Task 4: Export and import carry it

**Files:**
- Modify: `packages/engine/src/adventure-bundle.ts:50-62` (the bundle type), `:69-137` (`parseAdventureBundle`), `:262-305` (`rewriteBundleIds`)
- Modify: `scripts/lib/bundle-validate.ts:268-271`
- Test: `packages/engine/test/` — add to whichever bundle suite already covers `parseAdventureBundle` round-trips

**Interfaces:**
- Consumes: nothing from Task 3.
- Produces: `AdventureBundle.adventure.startMapId?: string` — the id of a map **within the bundle**, remapped on import.

- [ ] **Step 1: Write the failing test**

Add to the engine's bundle test suite a case proving the field survives a parse and is remapped by `rewriteBundleIds` exactly as `graph.start.mapId` is. Model it on the existing `rewriteBundleIds` assertions in that file — read them first and match the fixture style, then assert:

```ts
    expect(rewritten.adventure.startMapId).toBe(mapping.mapIds.get(bundle.adventure.startMapId));
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test:engine
```

Expected: FAIL on the new case.

- [ ] **Step 3: Add the field, parse it, remap it**

- Type: add `startMapId?: string;` to the `adventure` object at `:53-59`, beside the optional `audio` — the existing precedent for a backwards-compatible optional bundle field.
- Parse: after the per-map loop, validate that when present it names a bundle map. `seenIds` (`:92`/`:108`) already holds that set, so this is one membership check; return `null` when it fails, consistent with every other rejection in that function.
- Remap: in `rewriteBundleIds`, beside the `graph.start` rewrite at `:291-297`, apply the same `mapId(mapping, …)` helper.

- [ ] **Step 4: Prefer the field in the validator**

`scripts/lib/bundle-validate.ts:268-271` currently derives the start map from a spawn event. Change the fallback chain to prefer the explicit field, keeping the spawn-event derivation for bundles authored before it existed:

```ts
  const startMapId =
    options.startMapId ??
    bundle.adventure.startMapId ??
    bundle.maps.find((map) => map.events.some((event) => event.kind === "spawn"))?.id;
```

The spawn-event arm dies in Task 6; leave it here for now so this task stands alone.

- [ ] **Step 5: Run the tests**

```bash
npm run test:engine && npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/adventure-bundle.ts scripts/lib/bundle-validate.ts packages/engine/test
git commit -m "feat(engine): an adventure bundle carries its start map"
```

---

### Task 5: Nothing mints a spawn event any more

**Files:**
- Modify: `packages/editor/src/game/procedural-map.ts:671-679`
- Modify: `scripts/legacy/baie-cent-voiles/maps.ts:497` + `campaign.ts:224-239`
- Modify: `scripts/legacy/cite-assiegee/maps.ts:195` + `campaign.ts:174-189`
- Modify: `scripts/legacy/liin-adventure/maps.ts:1453` + `campaign.ts:222-237`
- Modify: `scripts/legacy/brumeval/maps.ts:254` + `:95-114` (`fEvent`'s kind union)
- Modify: `scripts/legacy/sombregue/maps.ts:152-160`, `:406`
- Modify: `scripts/legacy/seed-brumeval.ts:401-402`
- Test: `packages/editor/test/procedural-map.test.ts:71`

**Interfaces:**
- Consumes: `AdventureBundle.adventure.startMapId` (Task 4).
- Produces: nothing. After this task, no code path creates a `kind: "spawn"` event.

- [ ] **Step 1: Update the procedural-map test**

`packages/editor/test/procedural-map.test.ts:71` asserts `generated.events.some((event) => event.kind === "spawn")`. The generator's spawn event was the adventure-start anchor; the generated map's own `map.spawn` cell is what actually places a hero. Replace the assertion with one that the generated map's spawn cell is inside its bounds and on standable ground — read the surrounding test for the helpers it already has, and assert the real property rather than deleting the coverage.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --project editor test/procedural-map.test.ts
```

Expected: FAIL on the rewritten assertion.

- [ ] **Step 3: Stop the generator minting one**

Delete the spawn-event construction at `procedural-map.ts:671-679`. The generator already sets the map's own `spawn`; the event added nothing a hero could stand on.

- [ ] **Step 4: Convert the five seed scripts**

Each script builds a bundle. For each: delete the spawn-event construction (and, where it exists, the helper's `"spawn"` union member), and instead set `adventure.startMapId` on the bundle to the id of the map that carried it. The five sites are listed under **Files** above; each `campaign.ts` helper signature that names `"spawn" | "entry" | "exit"` loses the `"spawn"` member.

`scripts/legacy/seed-brumeval.ts:401-402` verifies the round-trip by finding the spawn event — change it to assert the bundle's `startMapId` names the abbaye map instead, keeping the verification rather than dropping it.

- [ ] **Step 5: Run the tooling typecheck and the suites**

```bash
npm run typecheck && npm run check
```

Expected: green. `tsconfig.tooling.json` covers `scripts/`, so a missed union member fails here.

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src/game/procedural-map.ts scripts/legacy packages/editor/test/procedural-map.test.ts
git commit -m "refactor(editor,scripts): authored content names its start map instead of anchoring it"
```

---

### Task 6: Retire the spawn event kind

**Files:**
- Modify: `packages/engine/src/map-events.ts:50-68` (docblock), `:70-85` (`EVENT_KINDS`), `:360-363` (`spawnEvents`), `:653-656` (the parse loop), `:839-845` (the anchor-command guard)
- Modify: `packages/editor/src/ui/editor/EventPalette.tsx:31-54`
- Modify: `packages/editor/src/ui/editor/EventDialog.tsx:1286-1294`
- Modify: `packages/engine/src/i18n/en.ts:1944`, `:1949-1950`; `fr.ts:1964`, `:1969-1970`
- Modify: `scripts/lib/bundle-validate.ts` (drop the spawn-event arm added in Task 4)
- Test: `packages/engine/test/map-events.test.ts`, `packages/editor/test/editor-shell.test.tsx:943-1010`, `event-palette.test.tsx:304`, `event-preview.test.ts:24-39`, `editor-state.test.ts:1241`, `packages/engine/test/liin-adventure-bundle.test.ts:450-457`

**Interfaces:**
- Consumes: nothing mints a spawn event (Task 5).
- Produces: `EVENT_KINDS` without `"spawn"`; `parseMapEvents` silently drops stored spawn events.

- [ ] **Step 1: Write the failing test**

Add to `packages/engine/test/map-events.test.ts`:

```ts
  it("drops a stored spawn event instead of rejecting the whole map", () => {
    // `parseMapEvents` rejects the ENTIRE list on an unknown kind (one bad kind, no map), and
    // stored spawn events exist in the database and in the checked-in legacy bundles. Dropping is
    // the migration: a spawn event was inert at runtime, so losing it loses nothing observable.
    // Same discipline as `"glace-fine"` in `hd2d/map-data.ts`.
    const events = parseMapEvents(
      [
        { id: "11111111-1111-4111-8111-111111111111", col: 1, row: 1, kind: "spawn", ordinal: 1, pages: [defaultEventPage()] },
        { id: "22222222-2222-4222-8222-222222222222", col: 2, row: 2, kind: "normal", ordinal: 2, pages: [defaultEventPage()] },
      ],
      40,
      30,
    );
    expect(events).not.toBeNull();
    expect(events).toHaveLength(1);
    expect(events?.[0]?.kind).toBe("normal");
  });
```

Match the fixture shape the surrounding tests in that file already use for a valid event — read one first.

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test:engine -- map-events
```

Expected: FAIL — currently the spawn event parses and the length is 2.

- [ ] **Step 3: Retire the kind, with the drop**

In `packages/engine/src/map-events.ts`:

```ts
/**
 * The retired adventure-start anchor kind, still readable from storage.
 *
 * `parseMapEvents` rejects the WHOLE LIST on one unknown kind — the entire map, not the one event —
 * so simply dropping `"spawn"` from `EVENT_KINDS` would have made every map that ever carried one
 * unparseable, and with it every adventure that owns that map. Dropping the event is the entire
 * migration: a spawn event was inert at runtime (it only ever selected which map an adventure
 * started on, and `adventures.startMapId` holds that now), so a dropped one loses nothing an author
 * or a player could observe. Same discipline as `"glace-fine"` in `hd2d/map-data.ts`.
 *
 * Safe to delete once no stored map contains one — which nothing in this repo can prove, since
 * authored maps live in the database.
 */
const RETIRED_SPAWN_KIND = "spawn";
```

Remove `"spawn"` from `EVENT_KINDS`; in the parse loop at `:655`, BEFORE the `isEventKind` check:

```ts
    if (record.kind === RETIRED_SPAWN_KIND) continue;
```

Delete `spawnEvents()` (`:360-363` — verified zero callers), the `kind === "spawn"` clause in the anchor-command guard at `:841`, and the `spawn` paragraph in the docblock at `:60-63` plus its mention at `:65`.

- [ ] **Step 4: Follow the compile errors**

`npm run typecheck` now points at every remaining reference. Expected: `EventPalette.tsx`'s `FUNCTIONAL_KINDS` (`:42`) and its exhaustive `EVENT_KIND_LABEL` record (`:53`), and `EventDialog.tsx:1286-1294`'s anchor branch (drop the `spawn` disjunct and collapse the ternary to the anchor hint). Update the `EventPalette` docblock at `:31-41`, which justifies `spawn` by name.

Delete `editor.event.kind.spawn` and `editor.event.kind.spawn.hint` from BOTH dictionaries.

**Do not touch** `EDITOR_MARKER_PREVIEWS.spawn` (`TerrainPalette.tsx:20-27`) — that key is shared with the Field-mode hero-start swatch, which stays.

- [ ] **Step 5: Update the tests the removal invalidates**

- `packages/editor/test/editor-shell.test.tsx:943-1010` — two tests place a spawn EVENT through the palette. Delete them; the kind no longer exists.
- `packages/editor/test/event-palette.test.tsx:304` and `packages/editor/test/editor-state.test.ts:1241` use `"spawn"` as their example of a NON-runtime kind that stays enabled under the runtime cap. Substitute another non-runtime kind (`entry` or `exit`) so the coverage survives.
- `packages/editor/test/event-preview.test.ts:24-39` enumerates all nine kinds — drop the `"spawn"` row.
- `packages/engine/test/liin-adventure-bundle.test.ts:450-457` asserts the bundle has exactly one spawn event. That bundle still contains one on disk; rewrite the assertion to prove it is DROPPED (`expect(spawns).toHaveLength(0)`) — which is the real behaviour now and is exactly the regression guard the coercion needs.

- [ ] **Step 6: Drop the validator's spawn arm**

`scripts/lib/bundle-validate.ts` — remove the `bundle.maps.find(… kind === "spawn")` fallback added in Task 4, leaving `options.startMapId ?? bundle.adventure.startMapId`, and update the `no start map` error message to name the field rather than the event.

- [ ] **Step 7: Full check**

```bash
npm run check
```

Expected: green, including the two bundle suites that parse `liin-adventure-ia.json` and `cite-assiegee.json` at module load — those are the real proof the drop works on stored data.

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/map-events.ts packages/editor/src/ui/editor/EventPalette.tsx packages/editor/src/ui/editor/EventDialog.tsx packages/engine/src/i18n/en.ts packages/engine/src/i18n/fr.ts scripts/lib/bundle-validate.ts packages/engine/test packages/editor/test
git commit -m "refactor(engine): the spawn event kind retires, and stored ones are dropped on parse"
```

---

## Out of scope, on purpose

- `maps.isFirst` and `POST /api/maps/:id/first` — account-scoped, client-dead, and confusable with the start map. Removing them is a separate schema change that must not ride in this migration.
- Regenerating the checked-in `adventures/legacy/*.json` bundles. Task 6's drop makes them parse correctly as they stand; regenerating is a separate content operation.
- `packages/engine/src/i18n/fr.ts`'s curly/straight apostrophe mix (73 vs 44) — house-wide, pre-existing, not this feature's to settle.
