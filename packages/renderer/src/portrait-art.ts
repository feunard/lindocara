import type { CharacterAppearance } from "@lindocara/engine/character.js";
import type { PlayerClass } from "@lindocara/engine/game.js";
/** Portrait sprite art: a sheet path and its frame count. Owned by the renderer; the client
 *  store re-exports it so HUD components keep importing it from `store`. */
export interface PortraitArt {
  source: string;
  frames: number;
  directionRows: number;
}

import { unitSheet } from "./tiny-swords-art.js";

export function playerPortrait(
  playerClass: PlayerClass,
  appearance: CharacterAppearance,
): PortraitArt {
  if (appearance.body === "priest")
    return {
      source: new URL("./assets/characters/priest/portrait.png", import.meta.url).href,
      frames: 1,
      directionRows: 1,
    };
  const sheet = unitSheet(playerClass, appearance, "idle");
  return {
    source: sheet.source,
    frames: sheet.frames,
    directionRows: sheet.directionRows ?? 1,
  };
}
