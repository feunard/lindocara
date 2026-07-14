import type { MonsterSpecies } from "../../shared/game.js";

const ROOT = "/assets/lindocara/vendor";

/**
 * The three foreign monster packs (CraftPix goblin/orc/ogre/skeleton, Fantasy Trolls) this file
 * used to hold two exports for. `VENDOR_QUEST_ART` (wood/gold/meat) moved to
 * `tiny-swords-art.ts` as `TINY_SWORDS_QUEST_ART` — it is genuinely Tiny Swords art and needed a
 * home that survives deleting these packs.
 *
 * `VENDOR_MONSTER_ART` stays here, unchanged, because `renderer.ts` still draws every monster
 * from it as a single static texture per species. `enemy-art.ts` (this same commit) vendors the
 * real, animated Tiny Swords Enemy Pack art and its `TINY_SWORDS_ENEMIES` table, but nothing
 * consumes it yet — the renderer switches over in the next task, and only then does this file (and
 * the old monster packs) get deleted. Deleting it now, before the renderer stops importing it,
 * would delete a texture something still draws.
 */
export const VENDOR_MONSTER_ART: Record<MonsterSpecies, string> = {
  spear_goblin: `${ROOT}/monsters/goblin.png`,
  torch_goblin: `${ROOT}/monsters/goblin.png`,
  gnoll_marauder: `${ROOT}/monsters/orc.png`,
  minotaur_brute: `${ROOT}/monsters/ogre.png`,
  skull_guard: `${ROOT}/monsters/skeleton-1.png`,
  skull_crusader: `${ROOT}/monsters/skeleton-2.png`,
  skull_warden: `${ROOT}/monsters/skeleton-3.png`,
  mire_troll: `${ROOT}/monsters/troll-1.png`,
  gate_troll: `${ROOT}/monsters/troll-2.png`,
};
