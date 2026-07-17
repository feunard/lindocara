import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  AssetDomain,
  AssetFrameMetadata,
  AssetNature,
  EditorAssetDefinition,
  EditorPlacementMetadata,
  TinySwordsCatalogEntry,
  TinySwordsCatalogFile,
  TinySwordsPack,
} from "../src/shared/tiny-swords-catalog.js";

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
export const RAW_INDEX_PATH = path.join(PROJECT_ROOT, "assets", "index.json");
export const CATALOG_SOURCE_PATH = path.join(
  PROJECT_ROOT,
  "assets",
  "lindocara-asset-catalog.json",
);
export const CLIENT_CATALOG_PATH = path.join(
  PROJECT_ROOT,
  "public",
  "assets",
  "lindocara",
  "tiny-swords",
  "catalog.json",
);
export const GENERATED_SHARED_PATH = path.join(
  PROJECT_ROOT,
  "src",
  "shared",
  "tiny-swords-catalog.generated.ts",
);
export const COVERAGE_REPORT_PATH = path.join(
  PROJECT_ROOT,
  "docs",
  "generated",
  "tiny-swords-catalog-coverage.md",
);

export interface RawAsset {
  path: string;
  pack: TinySwordsPack;
  category: string;
  name: string;
  w: number;
  h: number;
  alpha_bbox: [number, number, number, number] | null;
  x_frames: number;
  y_frames: number;
  est_frames: number;
  cell_hint?: number;
  error?: string;
}

export interface RawIndex {
  count: number;
  files: RawAsset[];
}

const PACKS = new Set<TinySwordsPack>([
  "Tiny Swords (Free Pack)",
  "Tiny Swords (Update 010)",
  "Tiny Swords (Enemy Pack)",
]);

const UI_PREFIXES = ["UI/", "UI Elements/"];

function isUi(raw: RawAsset): boolean {
  return UI_PREFIXES.some((prefix) => raw.category.startsWith(prefix));
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[()]/g, " ")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function packTag(pack: TinySwordsPack): string {
  if (pack === "Tiny Swords (Free Pack)") return "free";
  if (pack === "Tiny Swords (Update 010)") return "update-010";
  return "enemy-pack";
}

function domainOf(raw: RawAsset): AssetDomain {
  if (isUi(raw)) return "ui";
  if (/Buildings|\b(Hut|Tower|Cave|Boat|Cannon)\b/i.test(raw.category)) return "building";
  if (/^Terrain\/(Ground|Tileset|Water|Bridge)/.test(raw.category)) return "terrain";
  if (raw.category === "Deco" || raw.category.startsWith("Terrain/Decorations")) {
    return "decoration";
  }
  if (raw.category.startsWith("Resources") || raw.category.startsWith("Terrain/Resources")) {
    return "resource";
  }
  if (raw.category.startsWith("Units") || raw.category.includes("Factions/Knights/Troops")) {
    return "character";
  }
  if (raw.category.includes("Enemies/")) return "enemy";
  if (/Effects|Particle FX/.test(raw.category)) return "effect";
  return "reference";
}

function uiFamily(raw: RawAsset): string {
  if (raw.category.includes("Buttons")) return "button";
  if (raw.category.includes("Bars")) return "bar";
  if (raw.category.includes("Cursors")) return "cursor";
  if (raw.category === "UI/Pointers" && raw.name === "01") return "cursor";
  if (raw.category === "UI/Pointers") return "panel-corner";
  if (raw.category.includes("Human Avatars")) return "portrait";
  if (raw.category.includes("Icons")) return "icon";
  if (raw.category.includes("Papers")) return "paper";
  if (raw.category.includes("Ribbons")) return "ribbon";
  if (raw.category.includes("Banners")) return "banner";
  if (raw.category.includes("Wood Table")) return "panel";
  if (raw.category.includes("Swords")) return "ornament";
  return "component";
}

function uiState(name: string): "normal" | "hover" | "pressed" | "disabled" {
  if (/Pressed/i.test(name)) return "pressed";
  if (/Disable/i.test(name)) return "disabled";
  if (/Hover/i.test(name)) return "hover";
  return "normal";
}

function uiBaseId(raw: RawAsset): string {
  const family = uiFamily(raw);
  if (family === "button") {
    const color = /Red/i.test(raw.name) ? "red" : /Blue/i.test(raw.name) ? "blue" : "shared";
    const format = /9Slides/i.test(raw.name)
      ? "9-slice"
      : /3Slides/i.test(raw.name)
        ? "3-slice"
        : /Round/i.test(raw.name)
          ? "round"
          : /Square/i.test(raw.name)
            ? "square"
            : "fixed";
    const size = /Big/i.test(raw.name) ? "large" : /Small/i.test(raw.name) ? "small" : "tiny";
    return raw.category.startsWith("UI/Buttons")
      ? `ui.button.${color}.${uiState(raw.name)}.${format}`
      : `ui.button.${size}.${color}.${uiState(raw.name)}.${format}`;
  }
  if (raw.category.includes("Bars")) {
    const size = /Big/i.test(raw.name) ? "large" : "small";
    const part = /Fill/i.test(raw.name) ? "fill" : "base";
    return `ui.bar.${size}.${part}`;
  }
  if (raw.category.includes("Cursors")) {
    const role: Record<string, string> = {
      Cursor_01: "default",
      Cursor_02: "link",
      Cursor_03: "unavailable",
      Cursor_04: "resize-corners",
    };
    return `ui.cursor.${role[raw.name] ?? slug(raw.name)}`;
  }
  if (raw.category === "UI/Pointers" && raw.name === "01") return "ui.cursor.paint";
  if (raw.category === "UI/Pointers") return `ui.panel.corner.${slug(raw.name)}`;
  if (raw.category.includes("Human Avatars")) {
    return `ui.portrait.human.${slug(raw.name.replace("Avatars_", ""))}`;
  }
  if (raw.category.includes("Icons")) {
    return `ui.icon.${uiState(raw.name)}.${slug(raw.name.replace(/^(Disable|Pressed|Regular)_/, ""))}`;
  }
  return `ui.${family}.${slug(raw.name)}`;
}

function baseId(raw: RawAsset): string {
  if (isUi(raw)) return uiBaseId(raw);
  const domain = domainOf(raw);
  const category = slug(raw.category);
  const name = slug(raw.name);
  return `${domain}.${category}.${name}`;
}

function tagsOf(raw: RawAsset, domain: AssetDomain): string[] {
  const words = `${raw.category} ${raw.name} ${domain} ${packTag(raw.pack)}`
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 1);
  return [...new Set(words)];
}

function isAnimation(raw: RawAsset, domain: AssetDomain): boolean {
  if (domain === "ui" || domain === "terrain" || raw.category === "Deco") return false;
  if (/Buildings/.test(raw.category)) return false;
  if (/(_Idle|_Run|_Attack|_Move|_Spawn|_Highlight|Tree[1-4]|Bushe[1-4])$/i.test(raw.name)) {
    return raw.est_frames > 1;
  }
  return raw.est_frames > 1 && ["character", "enemy", "effect"].includes(domain);
}

function frameOf(raw: RawAsset, domain: AssetDomain): AssetFrameMetadata | undefined {
  if (!isAnimation(raw, domain)) return undefined;
  const axis = raw.x_frames > 1 || raw.w >= raw.h ? "x" : "y";
  const count = Math.max(1, axis === "x" ? raw.x_frames : raw.y_frames, raw.est_frames);
  const width = axis === "x" ? Math.floor(raw.w / count) : raw.w;
  const height = axis === "y" ? Math.floor(raw.h / count) : raw.h;
  return { width, height, count, axis, durationMs: domain === "effect" ? 800 : 1_400 };
}

function natureOf(
  raw: RawAsset,
  domain: AssetDomain,
  frame: AssetFrameMetadata | undefined,
): AssetNature {
  if (frame) return "animated";
  if (
    raw.category.includes("Tileset") ||
    raw.category.includes("UI Banners from the store page") ||
    raw.name.endsWith("_All") ||
    (domain === "ui" && raw.est_frames > 1)
  ) {
    return "sheet";
  }
  return "static";
}

function footOffset(raw: RawAsset, domain: AssetDomain): number {
  if (domain === "ui" || raw.alpha_bbox === null) return 0;
  return Math.max(0, raw.h - raw.alpha_bbox[3]);
}

function visualCells(width: number, height: number): { col: number; row: number }[] {
  const cols = Math.max(1, Math.ceil(width / 64));
  const rows = Math.max(1, Math.ceil(height / 64));
  const firstCol = -Math.floor(cols / 2);
  const result: { col: number; row: number }[] = [];
  for (let row = -(rows - 1); row <= 0; row++) {
    for (let col = firstCol; col < firstCol + cols; col++) result.push({ col, row });
  }
  return result;
}

function bottomCollision(width: number, rows = 1): { col: number; row: number }[] {
  const cols = Math.max(1, Math.ceil(width / 64));
  const firstCol = -Math.floor(cols / 2);
  const result: { col: number; row: number }[] = [];
  for (let row = -(rows - 1); row <= 0; row++) {
    for (let col = firstCol; col < firstCol + cols; col++) result.push({ col, row });
  }
  return result;
}

function editorMetadata(
  raw: RawAsset,
  domain: AssetDomain,
  frame: AssetFrameMetadata | undefined,
): EditorPlacementMetadata | undefined {
  const normalized = raw.path.replaceAll("\\", "/");
  const frameWidth = frame?.width ?? raw.w;
  const frameHeight = frame?.height ?? raw.h;
  const common = {
    visualFootprint: visualCells(frameWidth, frameHeight),
    renderLayer: "object" as const,
  };

  if (domain === "building" && raw.est_frames === 1 && !raw.category.includes("Enemy Pack")) {
    return {
      ...common,
      category: "buildings",
      allowedTerrain: ["grass"],
      collisionFootprint: bottomCollision(frameWidth, Math.min(2, Math.ceil(frameHeight / 64))),
    };
  }

  if (/Terrain\/Resources\/Wood\/Trees\/(Tree[1-4]|Stump [1-4])\.png$/.test(normalized)) {
    return {
      ...common,
      category: raw.name.startsWith("Tree") ? "trees" : "farm-and-village",
      allowedTerrain: ["grass"],
      renderLayer: raw.name.startsWith("Tree") ? "canopy" : "object",
      collisionFootprint: [{ col: 0, row: 0 }],
    };
  }

  if (raw.category === "Terrain/Decorations/Bushes") {
    return {
      ...common,
      category: "vegetation",
      allowedTerrain: ["grass"],
      collisionFootprint: [],
    };
  }

  if (/Terrain\/(Decorations\/)?(Rocks|Water\/Rocks)/.test(raw.category)) {
    return {
      ...common,
      category: "rocks",
      // The legacy editor allowed its four dry rock variants in shallows. Preserve that authored
      // map behavior while also exposing the pack's dedicated water-rock families.
      allowedTerrain: ["grass", "water"],
      collisionFootprint: bottomCollision(frameWidth),
    };
  }

  if (raw.category === "Terrain/Decorations/Rocks in the Water") {
    return {
      ...common,
      category: "rocks",
      allowedTerrain: ["grass", "water"],
      collisionFootprint: bottomCollision(frameWidth),
    };
  }

  if (raw.category === "Terrain/Decorations/Rubber Duck") {
    return {
      ...common,
      category: "small-decor",
      allowedTerrain: ["water"],
      collisionFootprint: [],
    };
  }

  if (raw.category === "Deco") {
    return {
      ...common,
      category: raw.name === "17" ? "signs" : "small-decor",
      allowedTerrain: ["grass"],
      collisionFootprint: [],
    };
  }

  if (
    /Terrain\/Resources\/(Wood\/Wood Resource|Meat\/Meat Resource|Tools)/.test(raw.category) ||
    (/Terrain\/Resources\/Gold\/(Gold Stones|Gold Resource)/.test(raw.category) &&
      !raw.name.includes("Highlight")) ||
    (raw.category === "Resources/Resources" && /_Idle/.test(raw.name))
  ) {
    return {
      ...common,
      category: raw.category.includes("Tools") ? "farm-and-village" : "resources",
      allowedTerrain: ["grass"],
      collisionFootprint: raw.category.includes("Gold Stones") ? bottomCollision(frameWidth) : [],
    };
  }

  return undefined;
}

function uiMetadata(raw: RawAsset, id: string): TinySwordsCatalogEntry["ui"] | undefined {
  if (!isUi(raw)) return undefined;
  const family = uiFamily(raw);
  const state = uiState(raw.name);
  const common = { family, state } as const;
  if (raw.category.includes("UI Banners from the store page")) return { family };
  if (raw.category.startsWith("UI/Buttons") && /3Slides/.test(raw.name)) {
    return { ...common, slice: { type: "three", left: 64, right: 64 } };
  }
  if (raw.category.startsWith("UI/Buttons") && /9Slides/.test(raw.name)) {
    return { ...common, slice: { type: "nine", top: 64, right: 64, bottom: 64, left: 64 } };
  }
  if (raw.name === "Carved_3Slides") {
    return { family: "panel", slice: { type: "three", left: 64, right: 64 } };
  }
  if (raw.name === "Carved_9Slides") {
    return {
      family: "panel",
      slice: { type: "nine", top: 64, right: 64, bottom: 64, left: 64 },
    };
  }
  if (raw.category.includes("Cursors")) {
    if (raw.name === "Cursor_01") return { family, hotspot: { x: 0, y: 0 } };
    if (raw.name === "Cursor_02") return { family, hotspot: { x: 12, y: 4 } };
    if (raw.name === "Cursor_03") return { family, hotspot: { x: 32, y: 32 } };
    return { family, componentOf: "ui.cursor.resize" };
  }
  if (id === "ui.cursor.paint") return { family, hotspot: { x: 0, y: 0 } };
  return common;
}

function classification(raw: RawAsset, role: string): TinySwordsCatalogEntry["classification"] {
  if (raw.category.includes("UI Banners from the store page")) {
    return {
      status: "ignored",
      reason: "Store-page presentation composite; runtime uses the separated UI components.",
    };
  }
  return { status: "catalogued", role };
}

function roleOf(raw: RawAsset, domain: AssetDomain): string {
  if (domain === "ui") return `${uiFamily(raw)}-${raw.est_frames > 1 ? "component-sheet" : "skin"}`;
  if (domain === "building") return "world-building";
  if (domain === "terrain") return "terrain-source";
  if (domain === "decoration") return "world-decoration";
  if (domain === "resource") return "world-resource";
  if (domain === "character") return "character-animation";
  if (domain === "enemy") return "enemy-animation";
  if (domain === "effect") return "visual-effect";
  return "source-reference";
}

export function readRawIndex(): RawIndex {
  return JSON.parse(readFileSync(RAW_INDEX_PATH, "utf8")) as RawIndex;
}

export function createCatalogSource(index: RawIndex): TinySwordsCatalogFile {
  const rawBaseIds = index.files.map(baseId);
  const baseCounts = new Map<string, number>();
  for (const id of rawBaseIds) baseCounts.set(id, (baseCounts.get(id) ?? 0) + 1);
  const used = new Map<string, number>();

  const entries = index.files.map((raw, rawIndex): TinySwordsCatalogEntry => {
    const initial = rawBaseIds[rawIndex] ?? `reference.asset.${rawIndex}`;
    const withPack =
      (baseCounts.get(initial) ?? 0) > 1 ? `${initial}.${packTag(raw.pack)}` : initial;
    const seen = used.get(withPack) ?? 0;
    used.set(withPack, seen + 1);
    const id = seen === 0 ? withPack : `${withPack}.${seen + 1}`;
    const domain = domainOf(raw);
    const frame = frameOf(raw, domain);
    const role = roleOf(raw, domain);
    const ui = uiMetadata(raw, id);
    const editor = editorMetadata(raw, domain, frame);
    return {
      id,
      sourcePath: raw.path,
      pack: raw.pack,
      domain,
      category: raw.category,
      tags: tagsOf(raw, domain),
      width: raw.w,
      height: raw.h,
      nature: natureOf(raw, domain, frame),
      ...(frame ? { frame } : {}),
      anchor: domain === "ui" ? { x: 0.5, y: 0.5 } : { x: 0.5, y: 1 },
      footOffset: footOffset(raw, domain),
      classification: classification(raw, role),
      ...(ui ? { ui } : {}),
      ...(editor ? { editor } : {}),
    };
  });
  return { version: 1, generatedFrom: "assets/index.json", entries };
}

export function readCatalogSource(): TinySwordsCatalogFile {
  return JSON.parse(readFileSync(CATALOG_SOURCE_PATH, "utf8")) as TinySwordsCatalogFile;
}

function rawByPath(index: RawIndex): Map<string, RawAsset> {
  return new Map(index.files.map((raw) => [raw.path, raw]));
}

function fail(errors: string[], message: string): void {
  errors.push(message);
}

export interface CatalogReport {
  raw: number;
  catalogued: number;
  editor: number;
  ui: number;
  ignored: number;
  unclassified: string[];
}

export function validateCatalog(
  index: RawIndex,
  catalog: TinySwordsCatalogFile,
): { errors: string[]; report: CatalogReport } {
  const errors: string[] = [];
  const rawPaths = rawByPath(index);
  const ids = new Set<string>();
  const seenPaths = new Map<string, number>();

  if (index.count !== index.files.length)
    fail(errors, `raw count ${index.count} != ${index.files.length}`);
  if (catalog.entries.length !== index.files.length) {
    fail(
      errors,
      `catalog has ${catalog.entries.length} entries for ${index.files.length} raw files`,
    );
  }

  for (const entry of catalog.entries) {
    if (ids.has(entry.id)) fail(errors, `duplicate id: ${entry.id}`);
    ids.add(entry.id);
    seenPaths.set(entry.sourcePath, (seenPaths.get(entry.sourcePath) ?? 0) + 1);
    const raw = rawPaths.get(entry.sourcePath);
    if (!raw) {
      fail(errors, `catalog path is absent from index: ${entry.sourcePath}`);
      continue;
    }
    if (!PACKS.has(entry.pack) || entry.pack !== raw.pack)
      fail(errors, `invalid pack: ${entry.id}`);
    const normalized = entry.sourcePath.replaceAll("\\", "/");
    if (!normalized.startsWith(`${entry.pack}/`) || normalized.includes("../")) {
      fail(errors, `path leaves Tiny Swords pack: ${entry.sourcePath}`);
    }
    if (!existsSync(path.join(PROJECT_ROOT, "assets", ...normalized.split("/")))) {
      fail(errors, `missing file: ${entry.sourcePath}`);
    }
    if (entry.width !== raw.w || entry.height !== raw.h)
      fail(errors, `dimension mismatch: ${entry.id}`);
    if (
      entry.classification.status === "ignored" &&
      entry.classification.reason.trim().length === 0
    ) {
      fail(errors, `ignored without reason: ${entry.id}`);
    }
    if (isUi(raw) && !entry.ui) fail(errors, `UI entry has no curated UI metadata: ${entry.id}`);
    if (entry.frame) {
      const occupied =
        entry.frame.axis === "x"
          ? entry.frame.width * entry.frame.count
          : entry.frame.height * entry.frame.count;
      const available = entry.frame.axis === "x" ? entry.width : entry.height;
      if (
        entry.frame.width <= 0 ||
        entry.frame.height <= 0 ||
        entry.frame.count <= 0 ||
        entry.frame.durationMs <= 0 ||
        occupied > available
      ) {
        fail(errors, `invalid frame metadata: ${entry.id}`);
      }
    }
    const slice = entry.ui?.slice;
    if (
      slice?.type === "three" &&
      (slice.left <= 0 || slice.right <= 0 || slice.left + slice.right >= entry.width)
    ) {
      fail(errors, `invalid 3-slice: ${entry.id}`);
    }
    if (
      slice?.type === "nine" &&
      (slice.top <= 0 ||
        slice.right <= 0 ||
        slice.bottom <= 0 ||
        slice.left <= 0 ||
        slice.left + slice.right >= entry.width ||
        slice.top + slice.bottom >= entry.height)
    ) {
      fail(errors, `invalid 9-slice: ${entry.id}`);
    }
    const hotspot = entry.ui?.hotspot;
    if (
      hotspot &&
      (hotspot.x < 0 || hotspot.y < 0 || hotspot.x >= entry.width || hotspot.y >= entry.height)
    ) {
      fail(errors, `invalid cursor hotspot: ${entry.id}`);
    }
    if (entry.editor) {
      if (entry.editor.allowedTerrain.length === 0 || entry.editor.visualFootprint.length === 0) {
        fail(errors, `incoherent editor placement: ${entry.id}`);
      }
      const visual = new Set(entry.editor.visualFootprint.map((cell) => `${cell.col}:${cell.row}`));
      for (const cell of entry.editor.collisionFootprint) {
        if (!visual.has(`${cell.col}:${cell.row}`))
          fail(errors, `collision outside visual footprint: ${entry.id}`);
      }
    }
  }

  for (const raw of index.files) {
    if ((seenPaths.get(raw.path) ?? 0) !== 1)
      fail(errors, `raw path must be classified once: ${raw.path}`);
  }

  const unclassified = index.files.filter((raw) => !seenPaths.has(raw.path)).map((raw) => raw.path);
  return {
    errors,
    report: {
      raw: index.files.length,
      catalogued: catalog.entries.filter((entry) => entry.classification.status === "catalogued")
        .length,
      editor: catalog.entries.filter((entry) => entry.editor !== undefined).length + 2,
      ui: catalog.entries.filter((entry) => entry.domain === "ui").length,
      ignored: catalog.entries.filter((entry) => entry.classification.status === "ignored").length,
      unclassified,
    },
  };
}

function bridgeDefinitions(catalog: TinySwordsCatalogFile): EditorAssetDefinition[] {
  const bridge = catalog.entries.find((entry) =>
    entry.sourcePath.endsWith("Terrain/Bridge/Bridge_All.png"),
  );
  if (!bridge) throw new Error("Bridge_All is missing from the catalogue");
  const common = {
    sourcePath: bridge.sourcePath,
    pack: bridge.pack,
    domain: bridge.domain,
    category: "bridges",
    role: "walkable-bridge",
    tags: [...bridge.tags, "walkable", "crossing"],
    nature: "static" as const,
    anchor: { x: 0.5, y: 1 },
    footOffset: 0,
  };
  return [
    {
      ...common,
      id: "terrain.bridge.wood.horizontal",
      width: 192,
      height: 64,
      editor: {
        category: "bridges",
        allowedTerrain: ["water"],
        renderLayer: "ground",
        visualFootprint: [
          { col: -1, row: 0 },
          { col: 0, row: 0 },
          { col: 1, row: 0 },
        ],
        collisionFootprint: [],
        terrainOverride: "walkable",
        sourceRect: { x: 0, y: 0, width: 192, height: 64 },
      },
    },
    {
      ...common,
      id: "terrain.bridge.wood.vertical",
      width: 64,
      height: 192,
      editor: {
        category: "bridges",
        allowedTerrain: ["water"],
        renderLayer: "ground",
        visualFootprint: [
          { col: 0, row: -2 },
          { col: 0, row: -1 },
          { col: 0, row: 0 },
        ],
        collisionFootprint: [],
        terrainOverride: "walkable",
        sourceRect: { x: 0, y: 64, width: 64, height: 192 },
      },
    },
  ];
}

export function editorDefinitions(catalog: TinySwordsCatalogFile): EditorAssetDefinition[] {
  const definitions = catalog.entries.flatMap((entry): EditorAssetDefinition[] => {
    if (!entry.editor || entry.classification.status !== "catalogued") return [];
    return [
      {
        id: entry.id,
        sourcePath: entry.sourcePath,
        pack: entry.pack,
        domain: entry.domain,
        category: entry.category,
        role: entry.classification.role,
        tags: entry.tags,
        width: entry.frame?.width ?? entry.width,
        height: entry.frame?.height ?? entry.height,
        nature: entry.nature,
        ...(entry.frame ? { frame: entry.frame } : {}),
        anchor: entry.anchor,
        footOffset: entry.footOffset,
        editor: entry.editor,
      },
    ];
  });
  return [...definitions, ...bridgeDefinitions(catalog)].sort((a, b) => a.id.localeCompare(b.id));
}

function idForPath(catalog: TinySwordsCatalogFile, suffix: string): string {
  const entry = catalog.entries.find((candidate) => candidate.sourcePath.endsWith(suffix));
  if (!entry) throw new Error(`catalogue UI path missing: ${suffix}`);
  return entry.id;
}

function refForPath(catalog: TinySwordsCatalogFile, suffix: string) {
  const id = idForPath(catalog, suffix);
  const entry = catalog.entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`catalogue UI id missing: ${id}`);
  return {
    id,
    sourcePath: entry.sourcePath,
    ...(entry.ui?.hotspot ? { hotspot: entry.ui.hotspot } : {}),
    ...(entry.ui?.slice ? { slice: entry.ui.slice } : {}),
  };
}

export function uiAssets(catalog: TinySwordsCatalogFile) {
  const ref = (suffix: string) => refForPath(catalog, suffix);
  return {
    button: {
      blue: {
        normal: ref("UI/Buttons/Button_Blue_3Slides.png"),
        hover: ref("UI/Buttons/Button_Hover_3Slides.png"),
        pressed: ref("UI/Buttons/Button_Blue_3Slides_Pressed.png"),
        disabled: ref("UI/Buttons/Button_Disable_3Slides.png"),
      },
      red: {
        normal: ref("UI/Buttons/Button_Red_3Slides.png"),
        hover: ref("UI/Buttons/Button_Hover_3Slides.png"),
        pressed: ref("UI/Buttons/Button_Red_3Slides_Pressed.png"),
        disabled: ref("UI/Buttons/Button_Disable_3Slides.png"),
      },
    },
    panel: {
      carved: ref("UI/Banners/Carved_9Slides.png"),
      paper: ref("UI Elements/UI Elements/Papers/RegularPaper.png"),
    },
    control: {
      checkbox: {
        normal: ref("UI Elements/UI Elements/Buttons/SmallBlueSquareButton_Regular.png"),
        checked: ref("UI Elements/UI Elements/Buttons/SmallBlueSquareButton_Pressed.png"),
      },
      rangeThumb: ref("UI Elements/UI Elements/Buttons/TinyRoundBlueButton.png"),
      iconButton: {
        normal: ref("UI Elements/UI Elements/Buttons/SmallBlueSquareButton_Regular.png"),
        pressed: ref("UI Elements/UI Elements/Buttons/SmallBlueSquareButton_Pressed.png"),
        danger: ref("UI Elements/UI Elements/Buttons/SmallRedSquareButton_Regular.png"),
      },
      slot: ref("UI Elements/UI Elements/Banners/Banner_Slots.png"),
      icon: {
        quest: ref("UI Elements/UI Elements/Icons/Icon_01.png"),
        oath: ref("UI Elements/UI Elements/Icons/Icon_02.png"),
        sword: ref("UI Elements/UI Elements/Icons/Icon_03.png"),
        potion: ref("UI Elements/UI Elements/Icons/Icon_04.png"),
        gold: ref("UI Elements/UI Elements/Icons/Icon_05.png"),
        crystal: ref("UI Elements/UI Elements/Icons/Icon_06.png"),
      },
    },
    cursor: {
      default: ref("UI Elements/UI Elements/Cursors/Cursor_01.png"),
      link: ref("UI Elements/UI Elements/Cursors/Cursor_02.png"),
      interact: ref("UI Elements/UI Elements/Cursors/Cursor_02.png"),
      move: ref("UI Elements/UI Elements/Cursors/Cursor_02.png"),
      paint: ref("UI/Pointers/01.png"),
      unavailable: ref("UI Elements/UI Elements/Cursors/Cursor_03.png"),
    },
    bar: {
      largeBase: ref("UI Elements/UI Elements/Bars/BigBar_Base.png"),
      largeFill: ref("UI Elements/UI Elements/Bars/BigBar_Fill.png"),
      smallBase: ref("UI Elements/UI Elements/Bars/SmallBar_Base.png"),
      smallFill: ref("UI Elements/UI Elements/Bars/SmallBar_Fill.png"),
    },
    scene: {
      cloudOne: ref("Terrain/Decorations/Clouds/Clouds_01.png"),
      cloudTwo: ref("Terrain/Decorations/Clouds/Clouds_02.png"),
      cloudThree: ref("Terrain/Decorations/Clouds/Clouds_05.png"),
      bridge: ref("Terrain/Bridge/Bridge_All.png"),
      foam: ref("Terrain/Water/Foam/Foam.png"),
      houseOne: ref("Buildings/Blue Buildings/House1.png"),
      houseThree: ref("Buildings/Blue Buildings/House3.png"),
      tower: ref("Buildings/Blue Buildings/Tower.png"),
      castle: ref("Buildings/Blue Buildings/Castle.png"),
      treeThree: ref("Terrain/Resources/Wood/Trees/Tree3.png"),
      treeFour: ref("Terrain/Resources/Wood/Trees/Tree4.png"),
      rockTwo: ref("Terrain/Decorations/Rocks/Rock2.png"),
      bush: ref("Deco/09.png"),
      sign: ref("Deco/17.png"),
      fire: ref("Particle FX/Fire_01.png"),
      dust: ref("Particle FX/Dust_01.png"),
    },
  } as const;
}

export function clientCatalogJson(catalog: TinySwordsCatalogFile): string {
  const compact = {
    version: catalog.version,
    entries: catalog.entries.map((entry) => ({
      id: entry.id,
      sourcePath: entry.sourcePath,
      pack: entry.pack,
      domain: entry.domain,
      category: entry.category,
      tags: entry.tags,
      width: entry.width,
      height: entry.height,
      nature: entry.nature,
      ...(entry.frame ? { frame: entry.frame } : {}),
      classification: entry.classification,
      ...(entry.editor ? { editor: entry.editor } : {}),
    })),
  };
  return `${JSON.stringify(compact)}\n`;
}

export function generatedSharedSource(catalog: TinySwordsCatalogFile): string {
  const definitions = editorDefinitions(catalog);
  const selectedUi = uiAssets(catalog);
  return `/* Generated by scripts/build-tiny-swords-catalog.ts. Run npm run catalog:build. */\nimport type { EditorAssetDefinition } from "./tiny-swords-catalog.js";\n\nexport const GENERATED_EDITOR_ASSETS = ${JSON.stringify(definitions, null, 2)} as const satisfies readonly EditorAssetDefinition[];\n\nexport const GENERATED_TINY_SWORDS_UI_ASSETS = ${JSON.stringify(selectedUi, null, 2)} as const;\n`;
}

export function sourceCatalogJson(catalog: TinySwordsCatalogFile): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

export function coverageReportMarkdown(
  catalog: TinySwordsCatalogFile,
  report: CatalogReport,
): string {
  const ignored = catalog.entries.filter((entry) => entry.classification.status === "ignored");
  const ignoredRows = ignored.map((entry) => {
    const reason = entry.classification.status === "ignored" ? entry.classification.reason : "";
    return `| \`${entry.id}\` | \`${entry.sourcePath}\` | ${reason} |`;
  });
  const unclassified =
    report.unclassified.length === 0
      ? "None."
      : report.unclassified.map((sourcePath) => `- \`${sourcePath}\``).join("\n");
  return `# Tiny Swords catalogue coverage\n\nGenerated by \`npm run catalog:build\`. Do not edit this report by hand.\n\n| Metric | Count |\n| --- | ---: |\n| Raw PNGs indexed | ${report.raw} |\n| Catalogued for a semantic role | ${report.catalogued} |\n| UI PNGs covered | ${report.ui} |\n| Assets available in the editor | ${report.editor} |\n| Explicitly ignored | ${report.ignored} |\n| Unclassified | ${report.unclassified.length} |\n\n## Explicitly ignored\n\n| Stable id | Source | Reason |\n| --- | --- | --- |\n${ignoredRows.join("\n")}\n\n## Unclassified entries\n\n${unclassified}\n`;
}
