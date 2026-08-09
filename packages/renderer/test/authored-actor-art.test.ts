import type { MonsterSpecies } from "@lindocara/engine/game.js";
import { NPC_MODEL_ASSETS } from "@lindocara/engine/tiny-swords-catalog.js";
import { describe, expect, it } from "vitest";
import { TINY_SWORDS_ENEMIES } from "../src/enemy-art.js";
import { authoredActorSheet, guardSheet, monsterActorSheet } from "../src/hd2d/game-renderer.js";
import { tinySwordsSourceUrl } from "../src/tiny-swords-assets.js";

describe("authored HD-2D actor art", () => {
  it("uses the authored idle, run and attack strips with their exact geometry", () => {
    const asset = NPC_MODEL_ASSETS.find((entry) => entry.motions?.run && entry.motions.attack);
    expect(asset?.frame).toBeDefined();
    expect(asset?.motions?.run?.frame).toBeDefined();
    expect(asset?.motions?.attack?.frame).toBeDefined();
    if (!asset?.frame || !asset.motions?.run?.frame || !asset.motions.attack?.frame) return;

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
      footOffset: asset.motions.run.footOffset,
      axis: asset.motions.run.frame.axis,
    });
    expect(authoredActorSheet(asset.id, "attack")).toEqual({
      source: tinySwordsSourceUrl(asset.motions.attack.sourcePath),
      frames: asset.motions.attack.frame.count,
      frameWidth: asset.motions.attack.frame.width,
      frameHeight: asset.motions.attack.frame.height,
      footOffset: asset.motions.attack.footOffset,
      axis: asset.motions.attack.frame.axis,
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

  it("uses a selected guard model's native attack instead of freezing its idle strip", () => {
    const asset = NPC_MODEL_ASSETS.find((entry) => entry.motions?.attack);
    expect(asset?.motions?.attack).toBeDefined();
    if (!asset?.motions?.attack) return;
    expect(guardSheet({ graphicAssetId: asset.id }, "attack")).toEqual(
      authoredActorSheet(asset.id, "attack"),
    );
  });
});
