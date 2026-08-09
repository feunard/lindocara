import { t, useLocale } from "@lindocara/client/i18n.js";
import type { StairsDirection, StairsLowLevel } from "@lindocara/engine/tile-brush.js";
import type { TerrainMaterial } from "@lindocara/engine/hd2d/terrain-query.js";
import { TINY_SWORDS_TERRAIN } from "@lindocara/renderer/tiny-swords-art.js";
import type { ReactNode } from "react";
import type { RectFillContent } from "../../game/editor-state.js";

const ELEVATION_LEVELS: (0 | 1 | 2)[] = [0, 1, 2];
const STAIRS_DIRECTION_OPTIONS: readonly StairsDirection[] = ["east", "west"];
const STAIRS_LOW_LEVEL_OPTIONS: readonly StairsLowLevel[] = [0, 1];
const MATERIAL_OPTIONS: readonly TerrainMaterial[] = [
  "herbe",
  "sable",
  "neige",
  "glace",
  "glace-fine",
];
const MATERIAL_BACKGROUNDS: Readonly<Record<Exclude<TerrainMaterial, "herbe">, string>> = {
  sable: "linear-gradient(145deg, #e6c57a, #b98345)",
  neige: "linear-gradient(145deg, #ffffff, #b9d7df)",
  glace: "linear-gradient(145deg, #d8fbff, #69b9d1)",
  "glace-fine": "repeating-linear-gradient(135deg, #c9f4fb 0 7px, #7fc9dc 7px 9px)",
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
  /** True while the fill tool is active: fill has no water primitive, so the water swatch is gated. */
  fillActive: boolean;
  /** True while the stairs stamp is the active tool. */
  stairsActive: boolean;
  /** The side reached by climbing; walking the opposite way descends. */
  stairsDirection: StairsDirection;
  /** 0 connects ground to +1; 1 connects +1 to +2. */
  stairsLowLevel: StairsLowLevel;
  /** True while the hero-spawn tool is the active tool, so its palette button reads as pressed. */
  spawnActive: boolean;
  onPickContent(content: RectFillContent): void;
  onSelectStairs(): void;
  onStairsDirectionChange(direction: StairsDirection): void;
  onStairsLowLevelChange(level: StairsLowLevel): void;
  onSelectSpawn(): void;
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
  fillActive,
  stairsActive,
  stairsDirection,
  stairsLowLevel,
  spawnActive,
  onPickContent,
  onSelectStairs,
  onStairsDirectionChange,
  onStairsLowLevelChange,
  onSelectSpawn,
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
  const selectedLevel = content.kind === "elevation" ? content.level : 0;
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
              onClick={() =>
                onPickContent({ kind: "elevation", material, level: selectedLevel })
              }
            />
          ))}
          <SwatchButton
            label={t("editor.tool.water")}
            active={waterActive}
            preview={<TerrainTilePreview kind="water" level={0} />}
            disabled={fillActive}
            title={fillActive ? t("editor.shell.fill.water_disabled") : undefined}
            onClick={() => onPickContent({ kind: "block", block: "water" })}
          />
        </div>

        <div className="flex flex-col gap-1 px-0.5">
          <span className="text-[11.5px] text-zinc-500">
            {t("editor.shell.terrain.elevationLabel")}
          </span>
          <div className="grid grid-cols-3 gap-1">
            {ELEVATION_LEVELS.map((level) => {
              const active =
                terrainActive && selectedMaterial !== null && selectedLevel === level;
              return (
                <button
                  key={level}
                  type="button"
                  aria-label={t("editor.shell.terrain.level", { level })}
                  aria-pressed={active}
                  onClick={() =>
                    onPickContent({
                      kind: "elevation",
                      material: selectedMaterial ?? "herbe",
                      level,
                    })
                  }
                  className={`flex min-w-0 flex-col items-center gap-1 rounded-md border p-1 text-[10px] font-medium ${
                    active
                      ? "border-zinc-900 bg-zinc-900 text-zinc-50"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400"
                  }`}
                >
                  <TerrainMaterialPreview material={selectedMaterial ?? "herbe"} level={level} />
                  <span className="w-full truncate">{t(`editor.shell.terrain.level${level}`)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-2">
          <SwatchButton
            label={t("editor.shell.tool.stairs")}
            active={stairsActive}
            preview={
              <TerrainTilePreview
                kind="stairs"
                level={stairsLowLevel}
                direction={stairsDirection}
              />
            }
            onClick={onSelectStairs}
          />

          <fieldset className="flex flex-col gap-1">
            <legend className="text-[11px] font-medium text-zinc-600">
              {t("editor.stairs.highSide")}
            </legend>
            <div className="grid grid-cols-2 gap-1">
              {STAIRS_DIRECTION_OPTIONS.map((direction) => (
                <button
                  key={direction}
                  type="button"
                  aria-pressed={stairsActive && stairsDirection === direction}
                  className={`rounded border px-2 py-1 text-[10.5px] ${
                    stairsActive && stairsDirection === direction
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-200 text-zinc-600 hover:border-zinc-400"
                  }`}
                  onClick={() => onStairsDirectionChange(direction)}
                >
                  {t(`editor.stairs.direction.${direction}`)}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-1">
            <legend className="text-[11px] font-medium text-zinc-600">
              {t("editor.stairs.transition")}
            </legend>
            <div className="grid grid-cols-2 gap-1">
              {STAIRS_LOW_LEVEL_OPTIONS.map((lowLevel) => (
                <button
                  key={lowLevel}
                  type="button"
                  aria-pressed={stairsActive && stairsLowLevel === lowLevel}
                  className={`rounded border px-2 py-1 text-[10.5px] ${
                    stairsActive && stairsLowLevel === lowLevel
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-200 text-zinc-600 hover:border-zinc-400"
                  }`}
                  onClick={() => onStairsLowLevelChange(lowLevel)}
                >
                  {t("editor.stairs.transitionLevels", {
                    low: lowLevel,
                    high: lowLevel + 1,
                  })}
                </button>
              ))}
            </div>
          </fieldset>

          <p className="text-[10.5px] leading-snug text-zinc-500">
            {t("editor.stairs.hint", {
              up: t(`editor.stairs.direction.${stairsDirection}`),
              down: t(`editor.stairs.direction.${oppositeDirection(stairsDirection)}`),
            })}
          </p>
        </div>
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

function TerrainMaterialPreview({
  material,
  level,
}: {
  material: TerrainMaterial;
  level: 0 | 1 | 2;
}) {
  if (material === "herbe") return <TerrainTilePreview kind="grass" level={level} />;
  return (
    <span
      aria-hidden="true"
      className="size-8 flex-none rounded border border-black/10 shadow-inner"
      style={{
        background: MATERIAL_BACKGROUNDS[material],
        filter: level === 1 ? "brightness(.9)" : level === 2 ? "brightness(.8)" : undefined,
      }}
    />
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
  level: 0 | 1 | 2;
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
          filter: level === 1 ? "brightness(.86)" : level === 2 ? "brightness(.72)" : undefined,
          imageRendering: "pixelated",
          transform: "translate(-50%, -50%) scale(.5)",
        }}
      />
    </span>
  );
}

function oppositeDirection(direction: StairsDirection): StairsDirection {
  if (direction === "east") return "west";
  return "east";
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
