import { t, useLocale } from "@lindocara/client/i18n.js";
import type { TerrainMaterial } from "@lindocara/engine/hd2d/terrain-query.js";
import type { InteriorShellStyle } from "@lindocara/engine/map-environment.js";
import type {
  ElevationStep,
  RampDirection,
  StairsDirection,
} from "@lindocara/engine/tile-brush.js";
import { TINY_SWORDS_TERRAIN } from "@lindocara/renderer/tiny-swords-art.js";
import type { ReactNode } from "react";

import type { RectFillContent } from "../../game/editor-state.js";

/**
 * The elevation brushes, and they are RELATIVE now.
 *
 * One button per absolute level ("Sol", "Plateau +1", "Plateau +2", "Haut plateau +3") described
 * the range instead of the intent: an author who wanted a fourth plateau had nowhere to click, and
 * one who wanted to raise a slope had to work out what level it was already at. These three say
 * what the author means and stay correct whatever the range becomes. The preview tint is the level
 * each step LANDS on from flat ground, which is the honest illustration of a relative brush.
 */
const ELEVATION_STEPS: readonly { step: Exclude<ElevationStep, "keep">; previewLevel: 0 | 1 }[] = [
  { step: "ground", previewLevel: 0 },
  { step: "raise", previewLevel: 1 },
  { step: "lower", previewLevel: 0 },
];
const MATERIAL_OPTIONS: readonly TerrainMaterial[] = [
  "herbe",
  "sable",
  "neige",
  "glace",
  "grotte",
  "montagne",
  "volcan",
  "lave",
  "parquet",
  "lino-gris",
  "lino-jaune",
  "carrelage-beige",
];
const MATERIAL_SOURCES: Readonly<Record<Exclude<TerrainMaterial, "herbe">, string>> = {
  sable: "/assets/lindocara/tiny-swords/terrain/Tilemap_Flat.png",
  neige: "/assets/lindocara/hd2d/tileset-neige.png",
  glace: "/assets/lindocara/hd2d/tileset-glace.png",
  grotte: "/assets/lindocara/hd2d/tileset-grotte.png",
  montagne: "/assets/lindocara/hd2d/tileset-montagne.png",
  volcan: "/assets/lindocara/hd2d/tileset-volcan.png",
  lave: "/assets/lindocara/hd2d/tileset-lave.png",
  parquet: "/assets/lindocara/hd2d/interior-floor-atlas.png",
  "lino-gris": "/assets/lindocara/hd2d/floor-lino-gray-atlas.png",
  "lino-jaune": "/assets/lindocara/hd2d/floor-lino-yellow-atlas.png",
  "carrelage-beige": "/assets/lindocara/hd2d/floor-beige-tile-atlas.png",
};

/** Sprite-path previews for the editor's non-tile swatches. Exported so `EventPalette` draws its
 *  event-kind previews from the same source of truth (the "assets" repair — these exact paths). */
export const EDITOR_MARKER_PREVIEWS = {
  normal: "/assets/lindocara/tiny-swords/deco/17.png",
  entry: "/assets/lindocara/tiny-swords/units/blue/warrior/Warrior_Idle.png",
  exit: "/assets/lindocara/tiny-swords/deco/17.png",
  monster: "/assets/lindocara/tiny-swords/enemies/spear-goblin/idle.png",
  guard: "/assets/lindocara/tiny-swords/units/blue/warrior/Warrior_Idle.png",
  spawn: "/assets/lindocara/tiny-swords/units/blue/warrior/Warrior_Idle.png",
} as const;

interface TerrainPaletteProps {
  /** The active terrain content (grass / water / one elevation level), highlighted in the palette. */
  content: RectFillContent;
  /** UX wave #11: whether a terrain paint tool (pencil/rect/fill) is the ONE active selection. The
   *  terrain swatches read as pressed only when it is — otherwise a spawn/decoration/event owns the
   *  selection and no terrain swatch may also light up (no Herbe AND a spawn at once). */
  terrainActive: boolean;
  /** True while the stairs stamp is the active tool. */
  stairsActive: boolean;
  /** True while the hero-spawn tool is the active tool, so its palette button reads as pressed. */
  spawnActive: boolean;
  /** Passages exist only on an interior shell. */
  interior: boolean;
  wallOpeningOperation: "open" | "close" | null;
  wallOpeningPending: boolean;
  undergroundOperation: "dig" | "tunnel" | "fill" | "shaft" | "stairs" | null;
  undergroundDepth: number;
  undergroundStyle: InteriorShellStyle;
  undergroundWidth: number;
  undergroundLength: number;
  undergroundDirection: RampDirection;
  editingDepth: number | null;
  basementAscentTarget: number;
  basementUpStairsActive: boolean;
  upperStorey: number;
  upperStairsActive: boolean;
  onPickContent(content: RectFillContent): void;
  onSelectStairs(): void;
  onSelectSpawn(): void;
  onSelectWallOpening(operation: "open" | "close"): void;
  onSelectUnderground(operation: "dig" | "tunnel" | "fill" | "shaft" | "stairs"): void;
  onUndergroundDepthChange(depth: number): void;
  onUndergroundStyleChange(style: InteriorShellStyle): void;
  onUndergroundSizeChange(width: number, length: number): void;
  onUndergroundDirectionChange(direction: RampDirection): void;
  onSelectBasementUpStairs(): void;
  onBasementAscentTargetChange(depth: number): void;
  onSelectUpperStairs(): void;
  onUpperStoreyChange(storey: number): void;
}

/**
 * The Field mode's palette: terrains (grass, water), the grass-elevation level group, the stairs
 * stamp and the hero-spawn tool. Stock shadcn + inline sprite previews only — no Tiny Swords
 * component ever reaches the creator tree.
 *
 * Markers are dead (UX wave #12): entries, exits and monster spawns are typed events now, placed with
 * the EV tool's kind selector rather than their own marker tools.
 *
 * Split out of the old two-way `eventMode` branch (Task 11): the Décor section and the event body
 * now live in `ElementPalette`/`EventPalette`, one component per mode, dispatched by `EditorPalette`.
 */
export function TerrainPalette({
  content,
  terrainActive,
  stairsActive,
  spawnActive,
  interior,
  wallOpeningOperation,
  wallOpeningPending,
  undergroundOperation,
  undergroundDepth,
  undergroundStyle,
  undergroundWidth,
  undergroundLength,
  undergroundDirection,
  editingDepth,
  basementAscentTarget,
  basementUpStairsActive,
  upperStorey,
  upperStairsActive,
  onPickContent,
  onSelectStairs,
  onSelectSpawn,
  onSelectWallOpening,
  onSelectUnderground,
  onUndergroundDepthChange,
  onUndergroundStyleChange,
  onUndergroundSizeChange,
  onUndergroundDirectionChange,
  onSelectBasementUpStairs,
  onBasementAscentTargetChange,
  onSelectUpperStairs,
  onUpperStoreyChange,
}: TerrainPaletteProps) {
  useLocale();

  // Gated on `terrainActive` (UX wave #11): a terrain swatch is pressed only when a terrain tool is the
  // one active selection, never merely because `content` still remembers a grass/water pick made
  // before a spawn or decoration was selected.
  const selectedMaterial: TerrainMaterial | null =
    content.kind === "elevation"
      ? (content.material ?? "herbe")
      : content.block === "grass"
        ? "herbe"
        : null;
  // A relative brush has no selected level to echo; the material swatches preview at ground level,
  // which is what "paint this material here" looks like on the map an author starts from.
  const selectedStep =
    content.kind === "elevation" && "step" in content ? content.step : ("keep" as ElevationStep);
  const selectedLevel = content.kind === "elevation" && "level" in content ? content.level : 0;
  const waterActive = terrainActive && content.kind === "block" && content.block === "water";

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-r border-zinc-200 bg-zinc-50"
      aria-label={t("editor.shell.palette.aria")}
    >
      <div className="flex h-8 flex-none items-center justify-between border-b border-zinc-200 px-3">
        <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
          {t("editor.shell.terrain.heading")}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
        <div className="grid grid-cols-2 gap-1.5">
          {MATERIAL_OPTIONS.map((material) => (
            <SwatchButton
              key={material}
              label={
                material === "herbe"
                  ? t("editor.tool.grass")
                  : t(`editor.palette.terrain.${material}`)
              }
              active={terrainActive && selectedMaterial === material}
              preview={<TerrainMaterialPreview material={material} level={selectedLevel} />}
              // Picking a material changes the ground and leaves the height alone: `keep`. Choosing
              // a colour is not a reason to flatten the plateau it is painted on.
              onClick={() => onPickContent({ kind: "elevation", material, step: "keep" })}
            />
          ))}
          <SwatchButton
            label={t("editor.tool.water")}
            active={waterActive}
            preview={<TerrainTilePreview kind="water" level={0} />}
            onClick={() => onPickContent({ kind: "block", block: "water" })}
          />
        </div>

        <div className="flex flex-col gap-1 px-0.5">
          <span className="text-[11.5px] text-zinc-500">
            {t("editor.shell.terrain.elevationLabel")}
          </span>
          <div className="grid grid-cols-3 gap-1">
            {ELEVATION_STEPS.map(({ step, previewLevel }) => {
              const active = terrainActive && selectedMaterial !== null && selectedStep === step;
              return (
                <button
                  key={step}
                  type="button"
                  aria-label={t(`editor.shell.terrain.step.${step}`)}
                  aria-pressed={active}
                  onClick={() =>
                    onPickContent({
                      kind: "elevation",
                      material: selectedMaterial ?? "herbe",
                      step,
                    })
                  }
                  className={`flex min-w-0 flex-col items-center gap-1 rounded-md border p-1 text-[10px] font-medium ${
                    active
                      ? "border-zinc-900 bg-zinc-900 text-zinc-50"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400"
                  }`}
                >
                  <TerrainMaterialPreview
                    material={selectedMaterial ?? "herbe"}
                    level={previewLevel}
                  />
                  <span className="w-full truncate">{t(`editor.shell.terrain.step.${step}`)}</span>
                </button>
              );
            })}
          </div>
          <p className="px-0.5 text-[10px] text-zinc-400">{t("editor.shell.terrain.step.hint")}</p>
        </div>

        {/* One button. The map derives the direction, the complete descending run and its safe
            adjacent width from the clicked edge; the preview shows every cell before commit. */}
        <div
          data-testid="terrain-stairs"
          className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-2"
        >
          <SwatchButton
            label={t("editor.shell.tool.stairs")}
            active={stairsActive}
            preview={<TerrainTilePreview kind="stairs" level={0} direction="east" />}
            onClick={onSelectStairs}
          />
          <p className="text-[10.5px] leading-snug text-zinc-500">{t("editor.stairs.hint")}</p>
        </div>
        <div
          data-testid="terrain-wall-openings"
          className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-2"
        >
          <span className="px-1 text-[11.5px] font-medium text-zinc-600">
            {t("editor.wallOpening.heading")}
          </span>
          <div className="grid grid-cols-2 gap-1">
            <SwatchButton
              label={t("editor.wallOpening.open")}
              active={wallOpeningOperation === "open"}
              disabled={!interior}
              preview={<WallOpeningPreview open />}
              onClick={() => onSelectWallOpening("open")}
            />
            <SwatchButton
              label={t("editor.wallOpening.close")}
              active={wallOpeningOperation === "close"}
              disabled={!interior}
              preview={<WallOpeningPreview open={false} />}
              onClick={() => onSelectWallOpening("close")}
            />
          </div>
          <p className="px-1 text-[10.5px] leading-snug text-zinc-500">
            {wallOpeningPending
              ? t("editor.wallOpening.pending")
              : interior
                ? t("editor.wallOpening.hint")
                : t("editor.wallOpening.exterior")}
          </p>
        </div>
        <div
          data-testid="terrain-underground"
          className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-2"
        >
          <span className="px-1 text-[11.5px] font-medium text-zinc-600">
            {t("editor.underground.heading")}
          </span>
          <div className="grid grid-cols-2 gap-1">
            <SwatchButton
              label={t("editor.underground.dig")}
              active={undergroundOperation === "dig"}
              onClick={() => onSelectUnderground("dig")}
            />
            <SwatchButton
              label={t("editor.underground.tunnel")}
              active={undergroundOperation === "tunnel"}
              onClick={() => onSelectUnderground("tunnel")}
            />
            <SwatchButton
              label={t("editor.underground.shaft")}
              active={undergroundOperation === "shaft"}
              onClick={() => onSelectUnderground("shaft")}
            />
            <SwatchButton
              label={t("editor.underground.stairs")}
              active={undergroundOperation === "stairs"}
              onClick={() => onSelectUnderground("stairs")}
            />
            <SwatchButton
              label={t("editor.underground.fill")}
              active={undergroundOperation === "fill"}
              onClick={() => onSelectUnderground("fill")}
            />
          </div>
          <label className="grid grid-cols-[1fr_4.5rem] items-center gap-2 text-[10.5px] text-zinc-500">
            <span>{t("editor.underground.depth")}</span>
            <input
              className="h-7 rounded border border-zinc-200 px-2"
              type="number"
              min={1}
              max={16}
              value={undergroundDepth}
              onChange={(event) => onUndergroundDepthChange(Number(event.currentTarget.value))}
            />
          </label>
          <label className="grid grid-cols-[1fr_7rem] items-center gap-2 text-[10.5px] text-zinc-500">
            <span>{t("editor.underground.style")}</span>
            <select
              className="h-7 rounded border border-zinc-200 bg-white px-1"
              value={undergroundStyle}
              onChange={(event) =>
                onUndergroundStyleChange(event.currentTarget.value as InteriorShellStyle)
              }
            >
              {(["cave", "castle", "timber", "volcano", "mountain", "ice", "snow"] as const).map(
                (style) => (
                  <option key={style} value={style}>
                    {t(`editor.interiorShell.style.${style}`)}
                  </option>
                ),
              )}
            </select>
          </label>
          {undergroundOperation === "shaft" ? null : (
            <div className="grid grid-cols-2 gap-1">
              <label className="text-[10px] text-zinc-500">
                {t("editor.underground.width")}
                <input
                  className="mt-0.5 h-7 w-full rounded border border-zinc-200 px-2"
                  type="number"
                  min={1}
                  max={32}
                  value={undergroundWidth}
                  onChange={(event) =>
                    onUndergroundSizeChange(Number(event.currentTarget.value), undergroundLength)
                  }
                />
              </label>
              <label className="text-[10px] text-zinc-500">
                {t("editor.underground.length")}
                <input
                  className="mt-0.5 h-7 w-full rounded border border-zinc-200 px-2"
                  type="number"
                  min={1}
                  max={64}
                  value={undergroundLength}
                  onChange={(event) =>
                    onUndergroundSizeChange(undergroundWidth, Number(event.currentTarget.value))
                  }
                />
              </label>
            </div>
          )}
          {undergroundOperation === "tunnel" || undergroundOperation === "stairs" ? (
            <label className="grid grid-cols-[1fr_7rem] items-center gap-2 text-[10.5px] text-zinc-500">
              <span>{t("editor.underground.direction")}</span>
              <select
                className="h-7 rounded border border-zinc-200 bg-white px-1"
                value={undergroundDirection}
                onChange={(event) =>
                  onUndergroundDirectionChange(event.currentTarget.value as RampDirection)
                }
              >
                {(["north", "east", "south", "west"] as const).map((direction) => (
                  <option key={direction} value={direction}>
                    {t(`editor.underground.direction.${direction}`)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="px-1 text-[10.5px] leading-snug text-zinc-500">
            {t(`editor.underground.hint.${undergroundOperation ?? "dig"}`)}
          </p>
        </div>
        {editingDepth !== null && editingDepth > 0 ? (
          <div
            data-testid="terrain-basement-ascent"
            className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-2"
          >
            <span className="px-1 text-[11.5px] font-medium text-zinc-600">
              {t("editor.basementAscent.heading")}
            </span>
            <SwatchButton
              label={t("editor.basementAscent.stairs")}
              active={basementUpStairsActive}
              onClick={onSelectBasementUpStairs}
            />
            <label className="grid grid-cols-[1fr_7rem] items-center gap-2 text-[10.5px] text-zinc-500">
              <span>{t("editor.basementAscent.target")}</span>
              <select
                className="h-7 rounded border border-zinc-200 bg-white px-1"
                value={basementAscentTarget}
                onChange={(event) =>
                  onBasementAscentTargetChange(Number(event.currentTarget.value))
                }
              >
                {Array.from({ length: editingDepth }, (_unused, depth) => (
                  <option key={depth} value={depth}>
                    {depth === 0 ? t("editor.level.surface") : `−${depth}`}
                  </option>
                ))}
              </select>
            </label>
            <p className="px-1 text-[10.5px] leading-snug text-zinc-500">
              {t("editor.basementAscent.hint")}
            </p>
          </div>
        ) : null}
        {interior && (editingDepth === null || editingDepth < 0) ? (
          <div
            data-testid="terrain-upper-storeys"
            className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-2"
          >
            <span className="px-1 text-[11.5px] font-medium text-zinc-600">
              {t("editor.upperStorey.heading")}
            </span>
            <SwatchButton
              label={t("editor.upperStorey.stairs")}
              active={upperStairsActive}
              onClick={onSelectUpperStairs}
            />
            <label className="grid grid-cols-[1fr_4.5rem] items-center gap-2 text-[10.5px] text-zinc-500">
              <span>{t("editor.upperStorey.target")}</span>
              <input
                className="h-7 rounded border border-zinc-200 px-2"
                type="number"
                min={1}
                max={16}
                value={upperStorey}
                onChange={(event) => onUpperStoreyChange(Number(event.currentTarget.value))}
              />
            </label>
            <p className="px-1 text-[10.5px] leading-snug text-zinc-500">
              {t("editor.upperStorey.hint")}
            </p>
          </div>
        ) : null}
        <SwatchButton
          label={t("editor.tool.spawn")}
          active={spawnActive}
          preview={<SpriteSheetPreview source={EDITOR_MARKER_PREVIEWS.spawn} frame={192} />}
          onClick={onSelectSpawn}
        />
        <p className="px-2 text-[10.5px] leading-snug text-zinc-400">
          {t("editor.tool.spawn.hint")}
        </p>
      </div>
    </aside>
  );
}

function WallOpeningPreview({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="relative size-8 flex-none overflow-hidden rounded border border-black/10 bg-zinc-100"
    >
      <span className="absolute top-1/2 left-1 h-2 w-3 -translate-y-1/2 rounded-sm bg-zinc-700" />
      <span
        className={`absolute top-1/2 right-1 h-2 -translate-y-1/2 rounded-sm bg-zinc-700 ${open ? "w-3" : "w-6"}`}
      />
      {open ? <span className="absolute bottom-1 left-1/2 h-4 w-px bg-emerald-500" /> : null}
    </span>
  );
}

function TerrainMaterialPreview({
  material,
  level,
}: {
  material: TerrainMaterial;
  level: 0 | 1 | 2 | 3;
}) {
  if (material === "herbe") return <TerrainTilePreview kind="grass" level={level} />;
  const atlasCol = level === 0 ? 0 : 5;
  return (
    <span
      aria-hidden="true"
      className="relative size-8 flex-none overflow-hidden rounded border border-black/10 bg-zinc-100 shadow-inner"
    >
      <span
        className="absolute top-1/2 left-1/2 size-16"
        style={{
          backgroundImage: `url("${MATERIAL_SOURCES[material]}")`,
          backgroundPosition: `${-atlasCol * 64}px 0`,
          backgroundRepeat: "no-repeat",
          filter:
            level === 1
              ? "brightness(.9)"
              : level === 2
                ? "brightness(.8)"
                : level === 3
                  ? "brightness(.7)"
                  : undefined,
          imageRendering: "pixelated",
          transform: "translate(-50%, -50%) scale(.5)",
        }}
      />
    </span>
  );
}

export function SwatchButton({
  label,
  description,
  active,
  preview,
  disabled,
  title,
  onClick,
}: {
  label: string;
  /** Optional secondary presentation text. Kept aria-hidden so the button's stable accessible name
   * remains `label`, which is also what keyboard users and palette tests target. */
  description?: ReactNode;
  active: boolean;
  preview?: ReactNode;
  disabled?: boolean | undefined;
  title?: string | undefined;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-zinc-900 text-zinc-50" : "text-zinc-600 hover:bg-zinc-200/70"
      }`}
    >
      {preview}
      <span className="min-w-0">
        <span className="block truncate">{label}</span>
        {description === undefined ? null : (
          <span
            aria-hidden="true"
            className={`block text-[10px] font-normal ${active ? "text-zinc-300" : "text-zinc-400"}`}
          >
            {description}
          </span>
        )}
      </span>
    </button>
  );
}

function TerrainTilePreview({
  kind,
  level,
  direction = "east",
}: {
  kind: "grass" | "water" | "stairs";
  level: 0 | 1 | 2 | 3;
  direction?: StairsDirection;
}) {
  if (kind === "stairs") {
    return (
      <span
        aria-hidden="true"
        className="relative size-8 flex-none overflow-hidden rounded border border-black/10 bg-zinc-100"
      >
        <span
          className="absolute top-1/2 left-1/2"
          style={{
            width: 64,
            height: 128,
            backgroundImage: `url("${TINY_SWORDS_TERRAIN.tileset}")`,
            backgroundPosition: `${direction === "west" ? -192 : 0}px -256px`,
            backgroundRepeat: "no-repeat",
            filter: level === 1 ? "brightness(.86)" : undefined,
            imageRendering: "pixelated",
            transform: "translate(-50%, -50%) scale(.25)",
            transformOrigin: "center",
          }}
        />
      </span>
    );
  }

  const isWater = kind === "water";
  const atlasCol = level === 0 ? 0 : 5;
  const atlasRow = 0;
  return (
    <span
      aria-hidden="true"
      className="relative size-8 flex-none overflow-hidden rounded border border-black/10 bg-zinc-100"
    >
      <span
        className="absolute top-1/2 left-1/2 size-16"
        style={{
          backgroundImage: `url("${isWater ? TINY_SWORDS_TERRAIN.water : TINY_SWORDS_TERRAIN.tileset}")`,
          backgroundPosition: `${-atlasCol * 64}px ${-atlasRow * 64}px`,
          backgroundRepeat: "no-repeat",
          filter:
            level === 1
              ? "brightness(.86)"
              : level === 2
                ? "brightness(.72)"
                : level === 3
                  ? "brightness(.62)"
                  : undefined,
          imageRendering: "pixelated",
          transform: "translate(-50%, -50%) scale(.5)",
        }}
      />
    </span>
  );
}

export function SpriteSheetPreview({ source, frame }: { source: string; frame?: number }) {
  const nativeSize = frame ?? 64;
  const scale = Math.min(32 / nativeSize, 1);
  return (
    <span
      aria-hidden="true"
      className="relative size-8 flex-none overflow-hidden rounded border border-black/10 bg-zinc-100"
    >
      <span
        className="absolute top-1/2 left-1/2 flex-none"
        style={{
          width: nativeSize,
          height: nativeSize,
          backgroundImage: `url("${source}")`,
          backgroundPosition: "0 0",
          backgroundRepeat: "no-repeat",
          imageRendering: "pixelated",
          transform: `translate(-50%, -50%) scale(${scale})`,
        }}
      />
    </span>
  );
}
