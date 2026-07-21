import type { CharacterAppearance } from "@lindocara/engine/character.js";
import type { PlayerClass } from "@lindocara/engine/game.js";
import type { PortraitArt } from "../store.js";
import { unitSheet } from "./tiny-swords-art.js";

export function playerPortrait(
  playerClass: PlayerClass,
  appearance: CharacterAppearance,
): PortraitArt {
  const sheet = unitSheet(playerClass, appearance, "idle");
  return { source: sheet.source, frames: sheet.frames };
}
