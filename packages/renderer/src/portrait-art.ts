import type { CharacterAppearance } from "@lindocara/engine/character.js";
import type { PlayerClass } from "@lindocara/engine/game.js";
/** Portrait sprite art: a sheet path and its frame count. Owned by the renderer; the client
 *  store re-exports it so HUD components keep importing it from `store`. */
export interface PortraitArt {
  source: string;
  frames: number;
}

import { unitSheet } from "./tiny-swords-art.js";

export function playerPortrait(
  playerClass: PlayerClass,
  appearance: CharacterAppearance,
): PortraitArt {
  const sheet = unitSheet(playerClass, appearance, "idle");
  return { source: sheet.source, frames: sheet.frames };
}
