import type { MonsterSpecies } from "../../shared/game.js";

const ROOT = "/assets/lindocara/vendor";

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

export const VENDOR_QUEST_ART = {
  wood: `${ROOT}/quests/wood.png`,
  gold: `${ROOT}/quests/gold.png`,
  meat: `${ROOT}/quests/meat.png`,
} as const;
