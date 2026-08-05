/**
 * The runtime player profile SHAPE, split out of `profile.ts` so platform-free consumers can
 * type-import it without pulling that module's D1/workers half into their program: `profile.ts`
 * reaches `D1PreparedStatement` and `cloudflare:workers` through its imports, which the
 * Node-hosted Alepha realtime rooms (`src/api/realtime/`) can neither resolve nor typecheck.
 * `profile.ts` re-exports both names, so every existing legacy importer is untouched.
 */
import type { AuthoredQuestProgress } from "@lindocara/engine/adventure-state.js";
import type { CharacterAppearance, Equipment } from "@lindocara/engine/character.js";
import type { CombatCooldownState } from "@lindocara/engine/cooldowns.js";
import type { LifeState } from "@lindocara/engine/death.js";
import type { PlayerClass } from "@lindocara/engine/game.js";
import type { Inventory, QuestState } from "@lindocara/engine/protocol.js";
import type { ClassResourceState } from "@lindocara/engine/resources.js";
// Type-only, so nothing of `world-runtime.ts`'s import graph reaches a program that only wants
// this shape — the whole reason this module was split out of `profile.ts` in the first place. The
// convention is declared once, there, where every runtime entity reads it; a second structurally
// identical declaration here would compile and then drift.
import type { WorldPosition } from "./world/world-runtime.js";

export interface PlayerProfile extends WorldPosition {
  id: string;
  nick: string;
  level: number;
  xp: number;
  hp: number;
  appearance: CharacterAppearance;
  class: PlayerClass;
  equipment: Equipment;
  inventory: Inventory;
  /** Settled additive harvest ledger already represented in `inventory.gold`. Server-only. */
  harvestGoldLedgerBaseline?: number;
  quest: QuestState;
  /** Personal authored quests. Party-scoped authored progress lives in GameSession instead. */
  authoredQuestProgress?: Record<string, AuthoredQuestProgress>;
  zoneId: string;
  instanceId: string;
  sessionEpoch: number;
  wardRunExpiresAt: number | null;
  life: LifeState;
  /** Null exactly when `life` is "alive". */
  corpse: WorldPosition | null;
  resource?: ClassResourceState;
  cooldowns?: CombatCooldownState;
  consumableCooldownUntil?: number;
  damageBoostUntil?: number;
  forgottenUntil?: number;
  invisibleUntil?: number;
  resurrectionAt?: number;
  /** Hero-owned talent ids. Legacy characters keep this session-local until an explicit migration. */
  talents?: readonly string[];
}

export type SaveableProfile = PlayerProfile;
