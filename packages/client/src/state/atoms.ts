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
 * (`game/session.ts`, and the zustand store's own deprecated editor-facing shims) never imports
 * this module directly — `packages/client/src/game/**` must not import `alepha`/`alepha/react` and
 * must never write an atom directly (see `state/navigation.ts`'s docblock for the seam it uses
 * instead).
 *
 * Schemas for the complex, externally-owned shapes (`PartyListing`, `AdventureTestSession`,
 * `AdventureEditorSession`) are typed passthroughs (`Type.custom`, see below) rather than
 * hand-mirrored zod shapes: `api.ts`/`store.ts` already own those types and validate/produce them
 * at their own boundaries (the D1-backed API, the editor's own draft model) — re-validating their
 * internal shape here would just be a second, driftable copy of the same contract.
 */
import type { ConsumableId } from "@lindocara/engine/consumables.js";
import { $atom, Type, z } from "alepha";
import type { AdventureTestSession, PartyListing } from "../api.js";
import type { AdventureEditorSession } from "../store.js";

// Alepha's own `z` is a deliberately narrow wrapper (`ZodProvider.ts`) that does not expose
// `.custom`. `Type` is alepha's own documented "raw zod namespace" escape hatch
// (`TypeProvider.ts`) — the SAME zod module instance `z`/`$atom` resolve against, unlike importing
// the `zod` package directly from this workspace package (which resolves alepha's own nested `zod`
// dependency, a structurally distinct instance zod's nominal-ish `_zod` brand treats as
// incompatible). Used for the typed-passthrough schemas below only, as `Type.custom<T>()`.

const DEFAULT_QUICK_ITEMS: readonly [
  ConsumableId | null,
  ConsumableId | null,
  ConsumableId | null,
] = ["health_potion", "mana_potion", "invisibility_potion"];

/** The persistent party/save currently driving this game session, or null outside one. */
export const activePartyAtom = $atom({
  name: "lindocara.activeParty",
  schema: Type.custom<PartyListing | null>(),
  default: null,
});

/** The disposable real-runtime session the creator editor launched to playtest a map. Never a
 *  save — see `AdventureTestOverlay.tsx`/`game/session.ts`. */
export const adventureTestSessionAtom = $atom({
  name: "lindocara.adventureTestSession",
  schema: Type.custom<AdventureTestSession | null>(),
  default: null,
});

/** The adventure/map draft the creator editor is currently authoring. Still read/written through a
 *  deprecated zustand shim by the (not-yet-migrated) editor package — see `store.ts`. */
export const adventureEditorSessionAtom = $atom({
  name: "lindocara.adventureEditorSession",
  schema: Type.custom<AdventureEditorSession | null>(),
  default: null,
});

/** The three hotbar consumable slots. `localStorage`-persisted: a player's potion loadout is a
 *  preference, not part of any save, so it should survive a reload the same way audio settings do
 *  (this is a small behaviour upgrade over the old zustand field, which reset every reload). */
export const quickItemsAtom = $atom({
  name: "lindocara.quickItems",
  schema: Type.custom<readonly [ConsumableId | null, ConsumableId | null, ConsumableId | null]>(),
  default: DEFAULT_QUICK_ITEMS,
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
