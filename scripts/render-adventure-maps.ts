import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parseAdventureBundle } from "@lindocara/engine/adventure-bundle.js";
import { parseMapData } from "@lindocara/engine/map-data.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { TINY_SWORDS_TILESET } from "@lindocara/engine/tilesets/tiny-swords.js";
import { editorAsset } from "@lindocara/engine/tiny-swords-catalog.js";
import { tileDrawAt } from "@lindocara/renderer/tile-draw.js";
import sharp, { type OverlayOptions } from "sharp";

const ASSET_ROOT = path.resolve("packages/catalog/assets");
const TILESET_PATH = path.join(
  ASSET_ROOT,
  "Tiny Swords (Free Pack)",
  "Terrain",
  "Tileset",
  "Tilemap_color1.png",
);
const WATER = { r: 71, g: 171, b: 169, alpha: 1 };

interface RenderOptions {
  bundlePath: string;
  outputDir: string;
  mapFilter: string | null;
  maxWidth: number;
}

function optionsFrom(argv: readonly string[]): RenderOptions {
  const positional = argv.find((value) => !value.startsWith("--"));
  const option = (prefix: string) =>
    argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
  return {
    bundlePath: path.resolve(positional ?? "adventures/liin-adventure-ia.json"),
    outputDir: path.resolve(option("--out=") ?? "artifacts/adventure-map-previews"),
    mapFilter: option("--map="),
    maxWidth: Number(option("--max-width=") ?? 1800),
  };
}

function fileSlug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function assetFrameRect(definition: NonNullable<ReturnType<typeof editorAsset>>) {
  if (definition.editor.sourceRect) return definition.editor.sourceRect;
  if (definition.frame) {
    return { x: 0, y: 0, width: definition.frame.width, height: definition.frame.height };
  }
  return { x: 0, y: 0, width: definition.width, height: definition.height };
}

async function assetBuffer(
  assetId: string,
  cache: Map<string, Promise<Buffer>>,
): Promise<{ buffer: Buffer; width: number; height: number } | null> {
  const definition = editorAsset(assetId);
  if (!definition) return null;
  const rect = assetFrameRect(definition);
  let loading = cache.get(assetId);
  if (!loading) {
    loading = sharp(path.join(ASSET_ROOT, definition.sourcePath))
      .extract({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })
      .png()
      .toBuffer();
    cache.set(assetId, loading);
  }
  return { buffer: await loading, width: rect.width, height: rect.height };
}

async function main(): Promise<void> {
  const options = optionsFrom(process.argv.slice(2));
  const bundle = parseAdventureBundle(JSON.parse(await readFile(options.bundlePath, "utf8")));
  if (!bundle) throw new Error(`Invalid adventure bundle: ${options.bundlePath}`);
  await mkdir(options.outputDir, { recursive: true });

  const tileCache = new Map<string, Promise<Buffer>>();
  const assetCache = new Map<string, Promise<Buffer>>();
  const maps = bundle.maps.filter(
    (map) =>
      options.mapFilter === null ||
      map.name.toLocaleLowerCase("fr").includes(options.mapFilter.toLocaleLowerCase("fr")),
  );
  if (maps.length === 0) throw new Error(`No map matches "${options.mapFilter}"`);

  for (const map of maps) {
    const data = parseMapData(map);
    if (!data) throw new Error(`Invalid map payload: ${map.name}`);
    const width = map.cols * TILE_SIZE;
    const height = map.rows * TILE_SIZE;
    const composites: OverlayOptions[] = [];

    for (const layer of data.layers) {
      for (let row = 0; row < map.rows; row += 1) {
        for (let col = 0; col < map.cols; col += 1) {
          const draw = tileDrawAt(TINY_SWORDS_TILESET, layer, col, row);
          if (!draw) continue;
          const brightness =
            (((draw.tint >> 16) & 0xff) + ((draw.tint >> 8) & 0xff) + (draw.tint & 0xff)) /
            (3 * 255);
          const cacheKey = `${draw.cell.col}:${draw.cell.row}:${draw.rotationQuarterTurns}:${brightness}`;
          let loading = tileCache.get(cacheKey);
          if (!loading) {
            loading = sharp(TILESET_PATH)
              .extract({
                left: draw.cell.col * TILE_SIZE,
                top: draw.cell.row * TILE_SIZE,
                width: TILE_SIZE,
                height: TILE_SIZE,
              })
              .rotate(draw.rotationQuarterTurns * 90)
              .modulate({ brightness })
              .png()
              .toBuffer();
            tileCache.set(cacheKey, loading);
          }
          composites.push({
            input: await loading,
            left: col * TILE_SIZE,
            top: row * TILE_SIZE,
          });
        }
      }
    }

    for (const element of map.elements) {
      const definition = editorAsset(element.assetId);
      const frame = await assetBuffer(element.assetId, assetCache);
      if (!definition || !frame) continue;
      const x = element.col * TILE_SIZE + TILE_SIZE / 2 + element.offsetX * 16;
      const y = (element.row + 1) * TILE_SIZE + definition.footOffset + element.offsetY * 16;
      const left = Math.round(x - frame.width * definition.anchor.x);
      const top = Math.round(y - frame.height * definition.anchor.y);
      if (left < 0 || top < 0 || left + frame.width > width || top + frame.height > height)
        continue;
      composites.push({ input: frame.buffer, left, top });
    }

    for (const event of map.events) {
      const page = [...event.pages]
        .reverse()
        .find((candidate) => candidate.graphicAssetId !== null);
      if (!page?.graphicAssetId) continue;
      const definition = editorAsset(page.graphicAssetId);
      const frame = await assetBuffer(page.graphicAssetId, assetCache);
      if (!definition || !frame) continue;
      const unit =
        definition.role === "character-animation" || definition.role === "enemy-animation";
      const scale = unit
        ? 1
        : Math.min((TILE_SIZE * 1.6) / frame.width, (TILE_SIZE * 1.6) / frame.height);
      const drawWidth = Math.max(1, Math.round(frame.width * scale));
      const drawHeight = Math.max(1, Math.round(frame.height * scale));
      const input =
        scale === 1
          ? frame.buffer
          : await sharp(frame.buffer)
              .resize(drawWidth, drawHeight, { kernel: sharp.kernel.nearest })
              .png()
              .toBuffer();
      const x = event.col * TILE_SIZE + TILE_SIZE / 2;
      const y = (event.row + 1) * TILE_SIZE + (unit ? definition.footOffset : 0);
      const left = Math.round(x - drawWidth * (unit ? definition.anchor.x : 0.5));
      const top = Math.round(y - drawHeight * (unit ? definition.anchor.y : 1));
      if (left < 0 || top < 0 || left + drawWidth > width || top + drawHeight > height) continue;
      composites.push({ input, left, top });
    }

    const outputWidth = Math.min(width, Math.max(320, options.maxWidth));
    const outputPath = path.join(options.outputDir, `${fileSlug(map.name)}.png`);
    const native = await sharp({
      create: { width, height, channels: 4, background: WATER },
    })
      .composite(composites)
      .png()
      .toBuffer();
    await sharp(native)
      .resize({ width: outputWidth, kernel: sharp.kernel.nearest })
      .png()
      .toFile(outputPath);
    console.log(`${map.name}: ${outputPath}`);
  }
}

await main();
