import type { CharacterAppearance } from "../../shared/character.js";
import type { MonsterSpecies, PlayerClass } from "../../shared/game.js";
import type { PortraitArt } from "../store.js";
import { ENEMY_PORTRAITS } from "./enemy-art.js";
import { unitSheet } from "./tiny-swords-art.js";

export function playerPortrait(
  playerClass: PlayerClass,
  appearance: CharacterAppearance,
): PortraitArt {
  const sheet = unitSheet(playerClass, appearance, "idle");
  return { source: sheet.source, frames: sheet.frames, kind: "unit" };
}

export function guardPortrait(): PortraitArt {
  return playerPortrait("warrior", { body: "wayfarer", primaryColor: "moss" });
}

export function monsterPortrait(species: MonsterSpecies): PortraitArt {
  return { source: ENEMY_PORTRAITS[species], frames: 1, kind: "enemy" };
}
