import type { MonsterSpecies } from "@lindocara/engine/game.js";
import { NPC_MODEL_ASSETS } from "@lindocara/engine/tiny-swords-catalog.js";
import { describe, expect, it } from "vitest";

import { TINY_SWORDS_ENEMIES } from "../src/enemy-art.js";
import {
  authoredActorSheet,
  guardSheet,
  HD2D_ACTOR_TEXTURE_URLS,
  monsterActorSheet,
  SHEEP_ACTOR_FRAME_MS,
} from "../src/hd2d/game-renderer.js";
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

  it("renders both harvestable sheep as smoothly tweened actors with their native hop strips", () => {
    const happyIdle = authoredActorSheet("resource.resources-sheep.happysheep-idle", "idle");
    const happyRun = authoredActorSheet("resource.resources-sheep.happysheep-idle", "run");
    const freeRun = authoredActorSheet("resource.terrain-resources-meat-sheep.sheep-idle", "run");
    if (!happyIdle || !happyRun || !freeRun) throw new Error("sheep actor sheets are missing");

    expect(happyIdle).toMatchObject({ frames: 8, frameWidth: 128, frameHeight: 128 });
    expect(happyRun).toEqual({
      source: tinySwordsSourceUrl(
        "Tiny Swords (Update 010)/Resources/Sheep/HappySheep_Bouncing.png",
      ),
      frames: 6,
      frameWidth: 128,
      frameHeight: 128,
      footOffset: 42,
      axis: "x",
    });
    expect(freeRun).toMatchObject({
      source: tinySwordsSourceUrl(
        "Tiny Swords (Free Pack)/Terrain/Resources/Meat/Sheep/Sheep_Move.png",
      ),
      frames: 4,
    });
    expect(SHEEP_ACTOR_FRAME_MS.run).toBeCloseTo(1_000 / 9);
    expect(HD2D_ACTOR_TEXTURE_URLS.map((texture) => texture.url)).toEqual(
      expect.arrayContaining([happyIdle.source, happyRun.source, freeRun.source]),
    );
  });

  it("keeps the species sheet for missing or invalid authored assets", () => {
    const [species] = Object.keys(TINY_SWORDS_ENEMIES) as MonsterSpecies[];
    expect(species).toBeDefined();
    if (!species) return;
    expect(monsterActorSheet(species, "attack", "missing-model")).toBe(
      TINY_SWORDS_ENEMIES[species].attack,
    );
  });

  it("uses the species-owned war pig art for the runner pursuer", () => {
    expect(monsterActorSheet("war_pig", "idle", null)).toBe(TINY_SWORDS_ENEMIES.war_pig.idle);
    expect(monsterActorSheet("war_pig", "run", null)).toBe(TINY_SWORDS_ENEMIES.war_pig.run);
    expect(monsterActorSheet("war_pig", "attack", null)).toBe(TINY_SWORDS_ENEMIES.war_pig.attack);
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
