# Brumeval Adventure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed the complete Brumeval intro adventure (3 maps, 3 NPCs, monsters, 6 chained quests, boss, victory) as authored content via the `/api/*` surface, verify it end to end in a browser, and ship it to production.

**Architecture:** One idempotent Node script, `scripts/seed-brumeval.ts` (run via `tsx`), imports the pure brushes/parsers from `@lindocara/engine` to build map bodies locally, validates them with the same total parsers the server uses, then PUTs maps/adventure in the validation-safe order (content without exits → exits+graph cumulatively → registry+quests). No engine/server code changes expected; any runtime bug found during E2E gets its own fix-with-test loop.

**Tech Stack:** Node 20+, `tsx`, plain `fetch` with manual session cookie (loadtest.mjs pattern), `@lindocara/engine` brushes (`paintRectAutotile`, `paintElevation`, `paintStairs`, `resolveWholeLayer`, `encodeTileLayer`), playwright-cli for E2E.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-24-brumeval-adventure-design.md` — content tables are normative (names, species, counts, quest ids 0001–0006, switch 0001).
- Maps: exactly 3 layers, RLE-encoded; tile ids only from tileset `tiny-swords`; ≤400 elements, ≤64 events/map; spawn/entries walkable.
- Events: functional kinds (`entry`/`exit`/`spawn`) have exactly 1 page, `commands: []`; conditions absent = explicit `null`, never omitted keys.
- Quests: schema v2 in `adventure.registry.quests`; `validateAuthoredQuests` must return zero `error` diagnostics before the final adventure PUT.
- Authoring order (load-bearing): all maps must have their exits bound in the graph in the same PUT transaction (`adventure` field on the map PUT) or the save 409s.
- French authored prose, ≤200 chars per `say`/dialogue slot; ≤48-char titles.
- Prod is `https://lindocara.alepha.dev/` behind `--allow-remote --allow-production` style explicit flags; auth rate limit 8/60s (single account, fine).
- `npm run check` green before every push; deploy via `npm run deploy` (applies nothing to D1 — no schema change in this project).

---

### Task 1: Seed script skeleton — HTTP client, auth, idempotent shell

**Files:**
- Create: `scripts/seed-brumeval.ts`
- Modify: `package.json` (add `"seed:brumeval": "tsx scripts/seed-brumeval.ts"`)

**Interfaces:**
- Produces: `requestJson(path, init?)` (cookie-aware fetch, throws on non-2xx with body text), `ensureSession(username, password)` (register→409→login), `findAdventureByTitle(title)`, CLI flags `--target=http://localhost:5173`, `--allow-remote`, `--allow-production`, `--reset` (delete existing adventure by title first), env `SEED_PASSWORD`.

- [ ] **Step 1:** Write the skeleton copying `scripts/loadtest.mjs` lines 43–115 (target gating, `sessionCookie`, `requestJson`) into typed TS. Account: `brumeval-author` / `SEED_PASSWORD` env (default a strong local-only constant).
- [ ] **Step 2:** `--reset` support: `GET /api/adventures`, find title `Brumeval`, `DELETE /api/adventures/:id` when present.
- [ ] **Step 3:** Verify against local dev: `npm run seed:brumeval -- --target=http://localhost:5173` logs a session id and an empty adventure list. Expected: exits 0.
- [ ] **Step 4:** Commit `feat(seed): brumeval seed skeleton`.

### Task 2: Map builders — terrain, elements, functional events

**Files:**
- Modify: `scripts/seed-brumeval.ts` (or `scripts/seed-brumeval/maps.ts` if >600 lines: split by map)

**Interfaces:**
- Consumes: engine exports `emptyLayer`, `encodeTileLayer`, `paintRectAutotile`, `paintElevation`, `paintStairs`, `resolveWholeLayer`, `TINY_SWORDS_TILESET`, `parseMapData`, `parseMapEvents`.
- Produces: `buildAbbaye(): MapContent`, `buildRonceclair(): MapContent`, `buildAntre(): MapContent` where `MapContent = { name, cols, rows, layers: string[3], elements, spawn, events, exits: ExitPlan[] }` — `events` excludes exits; `ExitPlan = { event: MapEvent, dest: { toMap: "ronceclair"|"abbaye"|"antre", entryEventId: string } | "end" }`. All event uuids minted with `crypto.randomUUID()` but **stable per run** (mint once, reference by variable).

Layout per spec: Abbaye 28×20 (monastery + houses west, vineyard east with 5 `spear_goblin` monster events radius ~96–128, spawn event on the parvis, NPC events Anselme/Aldric, entry from south, exit south); Ronceclair 40×25 (dense trees, goblin camp with 4 `torch_goblin` + 3 `spear_goblin`, 3 cache events `deco` graphic with self-switch-A one-shot `changeItems +1 health_potion`, `player-touch` area event running `enterArea "camp-gnoll"`, 3 `gnoll_marauder`, entries north/east, exits north/east); Antre 24×16 (elevation-ringed arena, 2 `skull_guard`, boss `minotaur_brute` event named Malgrin with on-defeat `setSwitch 0001 true`, NPC Lise entry-side, entry west, exits west + end behind arena).

- [ ] **Step 1:** Implement the three builders. Paint grass base, water border where wanted, elevation + `paintStairs` on Antre, trees/bushes/rocks elements. Keep monster patrols ≥3 tiles from entries/spawn.
- [ ] **Step 2:** Local validation harness inside the script: for each built map run `parseMapData`/`parseMapEvents` round-trip and assert non-null and spawn-walkable via `terrainFromMap`+`resolveTerrain`. Fail loudly with the map name.
- [ ] **Step 3:** Run the script in dry-run mode (`--dry-run`: build+validate, no HTTP). Expected: `3 maps valid`.
- [ ] **Step 4:** Commit `feat(seed): brumeval map builders`.

### Task 3: NPC programs and quest registry

**Files:**
- Modify: `scripts/seed-brumeval.ts` (or `scripts/seed-brumeval/quests.ts`)

**Interfaces:**
- Consumes: event/quest types from engine (`EventCommand`, `AuthoredQuestDefinition`, `validateAuthoredQuests`).
- Produces: `npcEvents` wired into map builders (Anselme page1 base + page2 after 0001; Aldric; Lise page1 lore + page2 cond switch 0001 with `choices` → `endAdventure`); `buildQuests(refs): AuthoredQuestDefinition[]` for ids 0001–0006 exactly as the spec table (givers/turn-ins referencing NPC event uuids, kill/collect/reach/defeat-target objectives, rewards, `nextQuestId` chain, 8 French dialogue slots for giver quests); `buildRegistry(refs)` returning `{switches:[{id:"0001",name:"Malgrin vaincu"}], variables:[], quests}`.

- [ ] **Step 1:** Write NPC dialogue programs (French, ≤200 chars/beat) and quest definitions.
- [ ] **Step 2:** In the dry-run harness, run `validateAuthoredQuests` against the built adventure+maps model; assert zero `error` diagnostics (print warnings).
- [ ] **Step 3:** `npm run seed:brumeval -- --dry-run` → Expected: `3 maps valid, 6 quests valid, 0 errors`.
- [ ] **Step 4:** Commit `feat(seed): brumeval npcs and quest registry`.

### Task 4: Seed orchestration + self-verification

**Files:**
- Modify: `scripts/seed-brumeval.ts`

**Interfaces:**
- Consumes: Tasks 1–3 outputs.
- Produces: full seed flow: ① `POST /api/adventures` `{title:"Brumeval", maxPlayers:4}` (yields map 1 = Abbaye) + `POST /api/maps` ×2; ② `PUT` each map with content, **no exits**, `expectedRevision`; ③ `PUT` each map again adding exit events + cumulative `adventure:{title,maxPlayers,graph}` binding every exit authored so far (dest entry uuids from step ②'s stored events); ④ final `PUT /api/adventures/:id` with graph + registry(+quests); ⑤ verification: re-`GET` adventure + all maps, assert map/event/quest counts, graph completeness, and that `resolveAdventureStart` tier-1 (spawn event on Abbaye) will hold (spawn event present).

- [ ] **Step 1:** Implement ①–⑤; make re-runs idempotent (find-or-create by title; `--reset` for a clean slate).
- [ ] **Step 2:** Run against local dev twice (fresh + rerun). Expected: both exit 0, second run updates in place without duplicating.
- [ ] **Step 3:** Open the editor in a browser (playwright-cli) on the seeded adventure: maps render, events/monsters/quests visible, adventure shows playable.
- [ ] **Step 4:** Commit `feat(seed): brumeval full seed + verification`.

### Task 5: E2E play-through (local) — fix everything it surfaces

**Files:**
- Test: manual scripted campaign via playwright-cli against `npm run dev`; screenshots to `docs/screenshots/brumeval-*.png` (keep the best 2–3 only)

- [ ] **Step 1:** Register a player account, create a party on Brumeval, create a warrior hero, enter.
- [ ] **Step 2:** Play the chain: Q1 talk Anselme → Q2 kill 5 spear goblins (vineyard) → turn in → Q3 talk Aldric → map 2 → Q4 4 torch goblins + 3 fioles (caches one-shot proven: reopen gives nothing) → Q5 reach camp-gnoll area + 3 gnolls → map 3 → Q6 kill Malgrin (switch 0001 flips: Lise page 2) → endAdventure via Lise choice → victory screen. Journal `!`/`?` markers and progress notifications checked at each beat. Zero console errors.
- [ ] **Step 3:** Difficulty tuning pass: if a naked level-1 warrior cannot survive the vineyard, thin monster density/patrols in the builders and re-seed (`--reset`). Re-verify.
- [ ] **Step 4:** Any runtime bug found → systematic-debugging, fix in the owning package with a test, `npm run check`.
- [ ] **Step 5:** Commit fixes + `docs(screenshots): brumeval play-through`.

### Task 6: Ship — check, push, deploy, seed prod, verify

- [ ] **Step 1:** `npm run check` → green. Push `main`.
- [ ] **Step 2:** `npm run deploy` (no D1 migration needed; if `npm run check` or deploy reveals drift from the pulled commits, fix first).
- [ ] **Step 3:** `npm run seed:brumeval -- --target=https://lindocara.alepha.dev --allow-remote --allow-production` with a real `SEED_PASSWORD`.
- [ ] **Step 4:** Quick prod verification with playwright-cli: login as a fresh account, see Brumeval listed when creating a party, enter, talk to Anselme, kill one goblin, journal updates. Zero console errors.
- [ ] **Step 5:** Final commit/push of any doc updates; report with screenshots.

## Self-Review

- Spec coverage: maps (T2), NPCs/dialogues (T3), quests (T3), seed order constraint (T4 ③ cumulative graph), E2E incl. one-shot caches, switch page flips, victory (T5), prod (T6). End-exit placement behind arena (T2 Antre). ✓
- No placeholder steps: content is normatively defined in the spec tables; builders reference exact engine APIs. ✓
- Interface consistency: `MapContent`/`ExitPlan` defined once (T2) and consumed (T4); NPC uuid refs flow T2→T3→T4 via a shared `refs` object. ✓
