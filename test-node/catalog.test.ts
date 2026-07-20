import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  editorDefinitions,
  PROJECT_ROOT,
  type RawIndex,
  readCatalogSource,
  readRawIndex,
  validateCatalog,
} from "../scripts/tiny-swords-catalog-lib.js";

const raw = readRawIndex();
const catalog = readCatalogSource();

describe("Tiny Swords semantic catalogue", () => {
  it("detects all 730 raw PNGs", () => {
    expect(raw.count).toBe(730);
    expect(raw.files).toHaveLength(730);
  });

  it("catalogues or explicitly ignores every UI PNG", () => {
    const uiPaths = raw.files
      .filter(
        (entry) => entry.category.startsWith("UI/") || entry.category.startsWith("UI Elements/"),
      )
      .map((entry) => entry.path);
    const entries = new Map(catalog.entries.map((entry) => [entry.sourcePath, entry]));
    expect(uiPaths).toHaveLength(167);
    for (const sourcePath of uiPaths) {
      const entry = entries.get(sourcePath);
      expect(entry?.ui, sourcePath).toBeDefined();
      expect(entry?.classification.status, sourcePath).toMatch(/catalogued|ignored/);
      if (entry?.classification.status === "ignored") {
        expect(entry.classification.reason.length, sourcePath).toBeGreaterThan(0);
      }
    }
  });

  it("uses unique stable identifiers", () => {
    const ids = catalog.entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points only at existing Tiny Swords files", () => {
    for (const entry of catalog.entries) {
      expect(entry.sourcePath.startsWith(`${entry.pack}/`), entry.id).toBe(true);
      expect(entry.sourcePath.includes("../"), entry.id).toBe(false);
      expect(
        existsSync(path.join(PROJECT_ROOT, "assets", ...entry.sourcePath.split("/"))),
        entry.id,
      ).toBe(true);
    }
  });

  it("matches every raw image dimension", () => {
    const indexed = new Map(raw.files.map((entry) => [entry.path, entry]));
    for (const entry of catalog.entries) {
      const source = indexed.get(entry.sourcePath);
      expect([entry.width, entry.height], entry.id).toEqual([source?.w, source?.h]);
    }
  });

  it("keeps animation frames inside their source image", () => {
    for (const entry of catalog.entries) {
      if (!entry.frame) continue;
      const occupied =
        entry.frame.axis === "x"
          ? entry.frame.width * entry.frame.count
          : entry.frame.height * entry.frame.count;
      expect(occupied, entry.id).toBeLessThanOrEqual(
        entry.frame.axis === "x" ? entry.width : entry.height,
      );
      expect(entry.frame.durationMs, entry.id).toBeGreaterThan(0);
    }
  });

  it("keeps every 3-slice and 9-slice valid", () => {
    for (const entry of catalog.entries) {
      const slice = entry.ui?.slice;
      if (!slice) continue;
      expect(slice.left + slice.right, entry.id).toBeLessThan(entry.width);
      if (slice.type === "nine") {
        expect(slice.top + slice.bottom, entry.id).toBeLessThan(entry.height);
      }
    }
  });

  it("keeps cursor hotspots inside the source image", () => {
    for (const entry of catalog.entries) {
      const hotspot = entry.ui?.hotspot;
      if (!hotspot) continue;
      expect(hotspot.x, entry.id).toBeGreaterThanOrEqual(0);
      expect(hotspot.y, entry.id).toBeGreaterThanOrEqual(0);
      expect(hotspot.x, entry.id).toBeLessThan(entry.width);
      expect(hotspot.y, entry.id).toBeLessThan(entry.height);
    }
  });

  it("gives every editor asset coherent shared placement metadata", () => {
    const editor = editorDefinitions(catalog);
    expect(editor.length).toBeGreaterThan(3);
    for (const entry of editor) {
      expect(entry.editor.allowedTerrain.length, entry.id).toBeGreaterThan(0);
      expect(entry.editor.visualFootprint.length, entry.id).toBeGreaterThan(0);
      const collider = entry.editor.collider;
      if (!collider) continue;
      // The collider is authored in FOOT space — origin `(col*64 + 32, (row+1)*64)` — so the
      // visual footprint's cells have to be translated into that same space before they can bound
      // it. Mirrors `buildingCollider` in `scripts/tiny-swords-catalog-lib.ts`: an asset may never
      // collide outside the cells it visibly occupies.
      const TILE_PX = 64;
      let left = Number.POSITIVE_INFINITY;
      let top = Number.POSITIVE_INFINITY;
      let right = Number.NEGATIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;
      for (const cell of entry.editor.visualFootprint) {
        left = Math.min(left, cell.col * TILE_PX - TILE_PX / 2);
        right = Math.max(right, (cell.col + 1) * TILE_PX - TILE_PX / 2);
        top = Math.min(top, cell.row * TILE_PX - TILE_PX);
        bottom = Math.max(bottom, (cell.row + 1) * TILE_PX - TILE_PX);
      }
      expect(collider.width, entry.id).toBeGreaterThan(0);
      expect(collider.height, entry.id).toBeGreaterThan(0);
      expect(collider.x, entry.id).toBeGreaterThanOrEqual(left);
      expect(collider.y, entry.id).toBeGreaterThanOrEqual(top);
      expect(collider.x + collider.width, entry.id).toBeLessThanOrEqual(right);
      expect(collider.y + collider.height, entry.id).toBeLessThanOrEqual(bottom);
    }
  });

  it("fails when a raw entry is added without a classification", () => {
    const first = raw.files[0];
    expect(first).toBeDefined();
    if (!first) return;
    const changed: RawIndex = {
      count: raw.count + 1,
      files: [...raw.files, { ...first, path: "Tiny Swords (Update 010)/UI/new-file.png" }],
    };
    const result = validateCatalog(changed, catalog);
    expect(result.errors.some((error) => error.includes("catalog has"))).toBe(true);
    expect(result.errors.some((error) => error.includes("raw path must be classified once"))).toBe(
      true,
    );
  });
});
