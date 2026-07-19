# Adventure State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Party-owned switches/variables/self-switches, server-side page selection, and events visible in the running game as appearance-only entities. No command execution.

**Spec:** `docs/superpowers/specs/2026-07-19-adventure-state-design.md` — Decisions bind. This is the first tranche to touch the game runtime; the two-players-two-rules, one-command-per-tick, and server-decides-outcomes invariants in CLAUDE.md are the law.

## Global Constraints

All prior plans' constraints hold (`.js` imports; semicolons; no `!`; `noUncheckedIndexedAccess`; `noUnusedParameters`; platform-free `shared/`; wire parsing returns null; two-tree rule; i18n parity; no React in `client/game/`; mutation proof per test; D1 chunking; full `npm run check` green per task). New, binding here:

- **No mutation path for state in this tranche.** The coordinator loads and pushes snapshots; nothing writes switches except the install/load path. `self_switches` schema exists but nothing writes it.
- **Events never enter collision.** `WorldInfo.events` is appearance-only, the third member of the `elements`/`layers` family, and carries the SAME rule comment.
- **Page evaluation happens on state-change and join, never per tick.**
- **Registry limits:** `MAX_REGISTRY_SWITCHES = 200`, `MAX_REGISTRY_VARIABLES = 200`, names ≤ 32 chars.

---

### Task 1: shared — registry, state, page selection

`src/shared/adventure-state.ts`: `AdventureRegistry { switches: RegistryEntry[]; variables: RegistryEntry[] }` (`RegistryEntry { id: /^\d{4}$/, name }`), limits, `parseAdventureRegistry` (total, null on malformed, duplicate-id reject). `PartyAdventureState { switches: Record<id, boolean>; variables: Record<id, number>; selfSwitches: Record<eventKey, boolean> }` (`eventKey = ${eventId}:${A-D}`), `parsePartyAdventureState` total. `activePageIndex(event: MapEvent, state): number | null` — XP's rule: highest-position page whose conditions ALL hold; unknown ids read as false/0; no page → null (dormant). Tests: a table over condition combinations incl. unknown ids, multi-page precedence (page 3 beats page 1 when both hold), self-switch keying; mutation proofs (highest→lowest flips the precedence test; unknown-id-as-true flips its case).

### Task 2: D1 — registry column + state table

`adventure.registry` TEXT (JSON, default empty registry) + `party_adventure_state` table (party_id pk/fk cascade, switches/variables/self_switches TEXT JSON, updated_at). Migration additive. Server: adventure CRUD carries the registry (validated by the shared parser; adventure PUT rejects a registry that would orphan ids still referenced by events? NO — out of scope, record as a known gap: deleting a registry entry leaves event conditions pointing at an unknown id, which reads as false — the fail-closed direction; comment it). Load/save helpers for party state with the same never-throw degrade posture as `decodeLayers` (log + empty state). Tests: round-trips, cascade, degrade-on-corrupt logs and yields empty.

### Task 3: coordinator + room — state ownership and page evaluation

The runtime task. `GameSession` (party coordinator): loads `party_adventure_state` on first room admission, holds it, pushes a read-only snapshot to each `World` room on room start and on change (no change source exists yet — the push-on-change path is built and tested via a test-only mutation seam, clearly marked as t5's entry point); debounced save (5s) + save on party-empty. `World`: stores the snapshot; on snapshot install and on hero join, evaluates `activePageIndex` for the room's map events (loaded from D1 with the map — extend the room's map load to carry events); active events enter the room's appearance state. NOTHING else in the tick loop changes. Follow `docs/adventure-runtime-architecture.md` for the coordinator↔room messaging seam (party chat/victory already cross it — reuse that mechanism, do not invent a channel). Tests against the real DO harness: two rooms of one party see the same snapshot; join-time evaluation; a seam-driven state change re-evaluates pages in BOTH rooms; empty-party save. Mutation proofs: evaluation at join skipped → test fails; snapshot not shared cross-room → fails.

### Task 4: protocol + client — events on the wire, rendered

`WorldInfo.events: readonly WorldEventSnapshot[]` (`{ id, col, row, graphicAssetId | null, onTop: boolean }` — the active page's appearance only) + delta upsert/removal collections following the existing `elements`-style validation; `parseServerMessage` extended (null on malformed, same discipline); resync includes events. Client: `net.ts` map upsert/removal validation; renderer draws events via the catalogue crop machinery in the decor pass (or `#tilesAbove` when `onTop`), appearance-only — the comment carries the family rule. Tests: protocol accept/reject table; delta application; renderer-side pure draw-decision function (the `paintEventCell` precedent — reuse it if the editor's function fits; do NOT fork a third crop path). Mutation proofs on the parser's reject branches and the onTop routing.

### Task 5: editor — registry dialog + condition pickers

Registry editor dialog (menu Jeu → « Base de données… », un-disable it: two dense lists, add/rename, ids minted `0001`-style monotonic, delete allowed with the known-gap comment from Task 2); event dialog's condition ids become shadcn Selects over the registry (`0001 · name`), falling back to the raw input when the registry is empty (with a hint linking the database dialog). The adventure save carries the registry. Tests: mint/rename/round-trip; picker shows registry entries; empty-registry fallback; mutation proofs.

### Task 6: browser pass + docs

Playwright: author a registry (2 switches), set an event's page-2 condition on switch 0001, enter the game with a party (the real game view), verify the event is ABSENT (switch off = page dormant or page-1 fallback per the authored conditions)... state cannot be flipped in-game yet (no mutation path) — so ALSO verify via the test seam or a direct D1 write that flipping the switch changes which page shows after rejoin. Two-hero variant if feasible: both see the same. Docs: CLAUDE.md (adventure state: party-owned, coordinator-held, appearance-only events on the wire, page selection server-side) + roadmap.

---

**Final:** whole-branch review on the runtime invariants (opus), fix wave, reconcile origin, merge, push.
