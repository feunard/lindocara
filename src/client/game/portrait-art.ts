import type { CharacterAppearance } from "../../shared/character.js";
import type { PlayerClass } from "../../shared/game.js";
import type { PortraitArt } from "../store.js";
import { unitSheet } from "./tiny-swords-art.js";

export function playerPortrait(
  playerClass: PlayerClass,
  appearance: CharacterAppearance,
): PortraitArt {
  const sheet = unitSheet(playerClass, appearance, "idle");
  return { source: sheet.source, frames: sheet.frames };
}
