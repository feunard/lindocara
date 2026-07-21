import type { RectFillContent } from "../../game/editor-state.js";
import { t, useLocale } from "../../i18n.js";

const ELEVATION_LEVELS: (0 | 1 | 2)[] = [0, 1, 2];

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
  /** True while the hero-spawn tool is the active tool, so its palette button reads as pressed. */
  spawnActive: boolean;
  onPickContent(content: RectFillContent): void;
  onSelectStairs(): void;
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
  spawnActive,
  onPickContent,
  onSelectStairs,
  onSelectSpawn,
}: TerrainPaletteProps) {
  useLocale();

  // Gated on `terrainActive` (UX wave #11): a terrain swatch is pressed only when a terrain tool is the
  // one active selection, never merely because `content` still remembers a grass/water pick made
  // before a spawn or decoration was selected.
  const grassActive = terrainActive && content.kind === "block" && content.block === "grass";
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
          <SwatchButton
            label={t("editor.tool.grass")}
            active={grassActive}
            onClick={() => onPickContent({ kind: "block", block: "grass" })}
          />
          <SwatchButton
            label={t("editor.tool.water")}
            active={waterActive}
            disabled={fillActive}
            title={fillActive ? t("editor.shell.fill.water_disabled") : undefined}
            onClick={() => onPickContent({ kind: "block", block: "water" })}
          />
        </div>

        <div className="flex items-center justify-between gap-2 px-0.5">
          <span className="text-[11.5px] text-zinc-500">
            {t("editor.shell.terrain.elevationLabel")}
          </span>
          <div className="flex gap-0.5 rounded-lg bg-zinc-100 p-0.5">
            {ELEVATION_LEVELS.map((level) => {
              const active =
                terrainActive && content.kind === "elevation" && content.level === level;
              return (
                <button
                  key={level}
                  type="button"
                  aria-label={t("editor.shell.terrain.level", { level })}
                  aria-pressed={active}
                  onClick={() => onPickContent({ kind: "elevation", level })}
                  className={`flex size-6 items-center justify-center rounded-md text-[12px] font-medium tabular-nums ${
                    active ? "bg-zinc-900 text-zinc-50" : "text-zinc-600 hover:bg-zinc-200/70"
                  }`}
                >
                  {level}
                </button>
              );
            })}
          </div>
        </div>

        <SwatchButton
          label={t("editor.shell.tool.stairs")}
          active={stairsActive}
          onClick={onSelectStairs}
        />
        <SwatchButton label={t("editor.tool.spawn")} active={spawnActive} onClick={onSelectSpawn} />
      </div>
    </aside>
  );
}

export function SwatchButton({
  label,
  active,
  disabled,
  title,
  onClick,
}: {
  label: string;
  active: boolean;
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
      className={`rounded-md px-2 py-1.5 text-left text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-zinc-900 text-zinc-50" : "text-zinc-600 hover:bg-zinc-200/70"
      }`}
    >
      {label}
    </button>
  );
}
