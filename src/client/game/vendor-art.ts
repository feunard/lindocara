import type { MonsterSpecies } from "../../shared/game.js";

const ROOT = "/assets/lindocara/vendor";

export const VENDOR_MONSTER_ART: Record<MonsterSpecies, string> = {
  goblin_scout: `${ROOT}/monsters/goblin.png`,
  goblin_raider: `${ROOT}/monsters/goblin.png`,
  orc_marauder: `${ROOT}/monsters/orc.png`,
  ogre_brute: `${ROOT}/monsters/ogre.png`,
  bone_guard: `${ROOT}/monsters/skeleton-1.png`,
  bone_crusader: `${ROOT}/monsters/skeleton-2.png`,
  bone_warden: `${ROOT}/monsters/skeleton-3.png`,
  mire_troll: `${ROOT}/monsters/troll-1.png`,
  gate_troll: `${ROOT}/monsters/troll-2.png`,
};

export const VENDOR_QUEST_ART = {
  wood: `${ROOT}/quests/wood.png`,
  gold: `${ROOT}/quests/gold.png`,
  meat: `${ROOT}/quests/meat.png`,
} as const;
