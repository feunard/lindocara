import type { MonsterSpecies } from "../../shared/game.js";

const ROOT = "/assets/lindocara/vendor";

/**
 * The three foreign monster packs (CraftPix goblin/orc/ogre/skeleton, Fantasy Trolls) this file
 * used to hold two exports for. `VENDOR_QUEST_ART` (wood/gold/meat) moved to
 * `tiny-swords-art.ts` as `TINY_SWORDS_QUEST_ART` — it is genuinely Tiny Swords art and needed a
 * home that survives deleting these packs.
 *
 * `VENDOR_MONSTER_ART` stays here, unreferenced, now that `renderer.ts` draws every monster from
 * the animated Tiny Swords Enemy Pack instead (`enemy-art.ts`'s `TINY_SWORDS_ENEMIES`, wired up via
 * `monsterAnimations()`). Nothing imports this map any more; it is dead weight kept only until
 * Task 4 deletes it along with the old monster packs it points at — do not add a new reader.
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
