import type { MonsterSpecies } from "@lindocara/engine/game.js";
import { NPC_MODEL_ASSETS } from "@lindocara/engine/tiny-swords-catalog.js";
import { describe, expect, it } from "vitest";
import { TINY_SWORDS_ENEMIES } from "../src/enemy-art.js";
import { authoredActorSheet, guardSheet, monsterActorSheet } from "../src/hd2d/game-renderer.js";
import { tinySwordsSourceUrl } from "../src/tiny-swords-assets.js";

describe("authored HD-2D actor art", () => {
  it("uses the authored idle and run strips with their exact geometry", () => {
    const asset = NPC_MODEL_ASSETS.find((entry) => entry.motions?.run);
    expect(asset?.frame).toBeDefined();
    expect(asset?.motions?.run?.frame).toBeDefined();
    if (!asset?.frame || !asset.motions?.run?.frame) return;

    expect(authoredActorSheet(asset.id, "idle")).toEqual({
      source: tinySwordsSourceUrl(asset.sourcePath),
      frames: asset.frame.count,
      frameWidth: asset.frame.width,
      frameHeight: asset.frame.height,
      footOffset: asset.footOffset,
      axis: asset.frame.axis,
    });
    expect(authoredActorSheet(asset.id, "run")).toEqual({
      source: tinySwordsSourceUrl(asset.motions.run.sourcePath),
      frames: asset.motions.run.frame.count,
      frameWidth: asset.motions.run.frame.width,
      frameHeight: asset.motions.run.frame.height,
      footOffset: asset.footOffset,
      axis: asset.motions.run.frame.axis,
    });
  });

  it("keeps the species sheet for missing or invalid authored assets", () => {
    const [species] = Object.keys(TINY_SWORDS_ENEMIES) as MonsterSpecies[];
    expect(species).toBeDefined();
    if (!species) return;
    expect(monsterActorSheet(species, "attack", "missing-model")).toBe(
      TINY_SWORDS_ENEMIES[species].attack,
    );
  });

  it("uses the guard model selected by the author", () => {
    const asset = NPC_MODEL_ASSETS.find((entry) => entry.frame);
    expect(asset).toBeDefined();
    if (!asset) return;
    expect(guardSheet({ graphicAssetId: asset.id }, "idle")).toEqual(
      authoredActorSheet(asset.id, "idle"),
    );
  });
});
