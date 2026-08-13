/**
 * Alepha `$atom`s for the slice of application state that used to live on the zustand store
 * (`store.ts`) but is not part of the 60Hz game bridge: which persistent party/save is active,
 * the creator editor's draft/test sessions, the equipped quick-item loadout, and per-hero
 * quest-tracking overrides.
 *
 * The game bridge itself (`self`, `selfState`, cooldowns, `party`, chat, overlay flags, the
 * `GameHandle`...) STAYS on zustand — see the root AGENTS.md and `packages/client/AGENTS.md`: every
 * `store.set` on an atom validates its schema and fires an unfiltered global event, which
 * disqualifies atoms from anything written 20-60x/s.
 *
 * React reads/writes these through `useStore`/`useSelector` (`alepha/react`). Non-React code
 * (`game/session.ts`) never imports this module directly — `packages/client/src/game/**` must not
 * import `alepha`/`alepha/react` and must never write an atom directly (see `state/navigation.ts`'s
 * docblock for the seam it uses instead). The editor package's own draft model reads/writes
 * `adventureEditorSessionAtom` directly through `useStore`, same as every other React caller here —
 * there is no zustand shim left for it to go through.
 *
 * Schemas for the complex, externally-owned shapes (`PartyListing`, `AdventureTestSession`,
 * `AdventureEditorSession`) are typed passthroughs (`ZType.custom`, see below) rather than
 * hand-mirrored zod shapes: `api.ts`/`store.ts` already own those types and validate/produce them
 * at their own boundaries (the D1-backed API, the editor's own draft model) — re-validating their
 * internal shape here would just be a second, driftable copy of the same contract. `quickItemsAtom`
 * is the deliberate exception — see its own docblock.
 */
import { CONSUMABLE_IDS, type ConsumableId } from "@lindocara/engine/consumables.js";
import { $atom, z } from "alepha";
import type { AdventureTestSession, PartyListing } from "../api.js";
import type { AdventureEditorSession } from "../store.js";

// `z.custom` is alepha's typed-passthrough escape hatch (`ZodProvider.ts`): it carries the type and
// validates nothing, which is what these atoms want — the shapes below are owned and checked at
// their own boundaries. It is exposed on alepha's own `z` rather than reached for by importing the
// `zod` package directly from this workspace package (which resolves alepha's own nested `zod`
// dependency, a structurally distinct instance zod's nominal-ish `_zod` brand treats as
// incompatible). Used for the typed-passthrough schemas below only, as `z.custom<T>()`.

/**
 * One hotbar slot: a real consumable id, or empty. Unlike the passthrough schemas above,
 * `quickItemsAtom` needs a real check — see its own docblock for why.
 */
const quickItemSlotSchema = z.enum(CONSUMABLE_IDS).nullable();

/** A `z.tuple` of the slot schema above, not `ZType.custom` — see `quickItemsAtom`'s docblock. */
const quickItemsSchema = z.tuple([quickItemSlotSchema, quickItemSlotSchema, quickItemSlotSchema]);

const DEFAULT_QUICK_ITEMS: [ConsumableId | null, ConsumableId | null, ConsumableId | null] = [
  "health_potion",
  "mana_potion",
  "invisibility_potion",
];

/** The persistent party/save currently driving this game session, or null outside one. */
export const activePartyAtom = $atom({
  name: "lindocara.activeParty",
  schema: z.custom<PartyListing | null>(),
  default: null,
});

/** The disposable real-runtime session the creator editor launched to playtest a map. Never a
 *  save — see `AdventureTestOverlay.tsx`/`game/session.ts`. */
export const adventureTestSessionAtom = $atom({
  name: "lindocara.adventureTestSession",
  schema: z.custom<AdventureTestSession | null>(),
  default: null,
});

/** The adventure/map draft the creator editor is currently authoring. Read/written directly through
 *  `useStore(adventureEditorSessionAtom)` by the editor package (`AdventureEditorScreen.tsx` and its
 *  dialogs) — there is no zustand shim in the way any more. */
export const adventureEditorSessionAtom = $atom({
  name: "lindocara.adventureEditorSession",
  schema: z.custom<AdventureEditorSession | null>(),
  default: null,
});

/**
 * The three hotbar consumable slots. `localStorage`-persisted: a player's potion loadout is a
 * preference, not part of any save, so it should survive a reload the same way audio settings do
 * (this is a small behaviour upgrade over the old zustand field, which reset every reload).
 *
 * This is the one atom in this module that carries a real schema instead of `ZType.custom` — every
 * other atom above is fed exclusively by this app's own React writers, but a `localStorage` value
 * is attacker/corruption surface: a stale key from a previous build, hand-edited devtools, or a
 * half-written quota-exceeded write. `StateManager.bindWebStorage()`
 * (`.vendor/alepha/src/core/providers/StateManager.ts`) reads the persisted JSON and calls
 * `safeValidate(atom.schema, value)` — on failure it removes the bad key and silently keeps the
 * atom's already-seeded default, never throwing. `z.custom<T>()` is zod's `custom()` called with
 * no predicate, which accepts literally any value, so it can never fail that check — a corrupted
 * payload would flow straight through into `useQuickItem`'s hotkey dispatch. `z.tuple` of a real
 * `z.enum(CONSUMABLE_IDS).nullable()` slot schema actually rejects it.
 */
export const quickItemsAtom = $atom({
  name: "lindocara.quickItems",
  schema: quickItemsSchema,
  default: DEFAULT_QUICK_ITEMS,
  persist: "localStorage",
});

/**
 * Which title/menu backdrop is shown: `v1` is the Tiny Swords diorama (`TinySwordsMenuScene`),
 * `v2` the launch-gate living backdrop (`LaunchBackdrop`, the painted parallax landscape).
 * `localStorage`-persisted for the same reason as `quickItemsAtom` — a look preference should
 * survive a reload — and carries a real `z.enum` rather than a passthrough for the same reason
 * too: a persisted value is corruption surface, and a bad key must fall back to `v1`.
 */
export const backdropVersionAtom = $atom({
  name: "lindocara.backdropVersion",
  schema: z.enum(["v1", "v2"]),
  default: "v1" as const,
  persist: "localStorage",
});

/** Per-session player overrides for the tracked authored-quest set; absent means active/ready
 *  quests are tracked by default (see `Hud.tsx`). Deliberately NOT persisted: it resets with every
 *  fresh game session, same as before. */
export const questTrackingAtom = $atom({
  name: "lindocara.questTracking",
  schema: z.record(z.text(), z.boolean()),
  default: {},
});
