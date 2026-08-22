import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@alepha/ui/components/ui/tooltip";
import { t, useLocale } from "@lindocara/client/i18n.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import type { MapFixedLighting } from "@lindocara/engine/map-lighting.js";
import type { MapWeather } from "@lindocara/engine/map-weather.js";
import {
  Blocks,
  CircleHelp,
  CloudRain,
  Eraser,
  FilePlus,
  Grid3x3,
  Layers,
  MousePointer2,
  Move,
  PaintBucket,
  Pencil,
  Play,
  Square,
  SunMoon,
  WandSparkles,
  ZoomIn,
} from "lucide-react";
import type { ComponentProps, ComponentType } from "react";

import type { EditorMode } from "../../game/editor-state.js";
import { EditorModeControl } from "./EditorModeControl.js";

/** The six canvas tools the toolbar exposes as buttons. `stairs` and scenery live in the palette. */
export type EditorPaintTool = "select" | "pan" | "pencil" | "rect" | "fill" | "eraser";
export type EditorLightingSelection = "cycle" | MapFixedLighting;

/** The i18n key for every selectable tool key's label, shared with the status bar. */
export const TOOL_LABEL_KEYS: Record<EditorPaintTool | "stairs", MessageKey> = {
  select: "editor.shell.tool.select",
  pan: "editor.tool.pan",
  pencil: "editor.shell.tool.pencil",
  rect: "editor.shell.tool.rect",
  fill: "editor.shell.tool.fill",
  eraser: "editor.tool.eraser",
  stairs: "editor.shell.tool.stairs",
};

/** Resolves a tool key to its translated label under the active locale. */
export function toolLabelText(key: EditorPaintTool | "stairs"): string {
  return t(TOOL_LABEL_KEYS[key]);
}

const PAINT_TOOLS: { key: EditorPaintTool; icon: ComponentType }[] = [
  { key: "select", icon: MousePointer2 },
  { key: "pan", icon: Move },
  { key: "pencil", icon: Pencil },
  { key: "rect", icon: Square },
  { key: "fill", icon: PaintBucket },
  { key: "eraser", icon: Eraser },
];

const WEATHER_OPTIONS: { value: MapWeather; label: MessageKey }[] = [
  { value: "none", label: "editor.weather.mode.none" },
  { value: "rain", label: "editor.weather.mode.rain" },
  { value: "storm", label: "editor.weather.mode.storm" },
];

const LIGHTING_OPTIONS: { value: EditorLightingSelection; label: MessageKey }[] = [
  { value: "cycle", label: "editor.dayNightCycle.mode.cycle" },
  { value: "day", label: "editor.dayNightCycle.mode.day" },
  { value: "night-start", label: "editor.dayNightCycle.mode.nightStart" },
  { value: "night-middle", label: "editor.dayNightCycle.mode.nightMiddle" },
  { value: "night-full", label: "editor.dayNightCycle.mode.nightFull" },
];

interface EditorToolbarProps {
  activeTool: EditorPaintTool | null;
  mode: EditorMode;
  showGrid: boolean;
  showDim: boolean;
  /** D18: the collision-visualisation overlay toggle — shades solid tiles and outlines element
   *  colliders. Off by default, threaded to the stage exactly like `showGrid`/`showDim`. */
  showCollisions: boolean;
  dayNightCycle: boolean;
  /** The map's authored weather, and the callback that changes it. Beside the lighting control
   *  because they are the same kind of decision: what the sky is doing over this map. */
  weather: MapWeather;
  onSelectWeather(weather: MapWeather): void;
  fixedLighting: MapFixedLighting;
  dayNightCycleAvailable: boolean;
  zoom: number;
  onNewMap(): void;
  canGenerateMap: boolean;
  onGenerateMap(): void;
  onSelectTool(tool: EditorPaintTool): void;
  onSelectMode(mode: EditorMode): void;
  onToggleGrid(): void;
  onToggleDim(): void;
  onToggleCollisions(): void;
  onSelectLighting(value: EditorLightingSelection): void;
  onCycleZoom(): void;
  onTest(): void;
  onOpenHelp(): void;
}

/** D16: every icon-only toolbar button gets a hover tooltip carrying the same string as its
 *  `aria-label` — a generic lucide glyph otherwise gives zero hint of what it does. `TooltipTrigger`'s
 *  `render` prop merges its hover/focus listeners onto the given `Button` (the same merge
 *  `DialogPrimitive.Close render={<Button .../>}` already relies on in `dialog.tsx`), so the button
 *  keeps its own `onClick`/`aria-pressed`/etc. untouched. */
function ToolbarIconButton({
  label,
  children,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button aria-label={label} {...props}>
            {children}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The wireframe's 42px toolbar: new-map · paint tools · Field/Element/Event mode control · view
 *  toggles · zoom · flex spacer · Tester. Stock shadcn buttons and lucide icons only.
 *
 *  C10: the toolbar no longer carries a Save or Delete-map icon button — both were redundant with
 *  ⌘S/autosave and the Cartes panel's own per-map delete, and left an author guessing which trash can
 *  or disk icon they were about to hit. Save stays reachable via ⌘S and the File-menu item; map
 *  deletion stays only in `MapListPanel`. */
export function EditorToolbar({
  activeTool,
  mode,
  showGrid,
  showDim,
  showCollisions,
  dayNightCycle,
  weather,
  onSelectWeather,
  fixedLighting,
  dayNightCycleAvailable,
  zoom,
  onNewMap,
  canGenerateMap,
  onGenerateMap,
  onSelectTool,
  onSelectMode,
  onToggleGrid,
  onToggleDim,
  onToggleCollisions,
  onSelectLighting,
  onCycleZoom,
  onTest,
  onOpenHelp,
}: EditorToolbarProps) {
  useLocale();
  return (
    <div className="flex h-[42px] flex-none items-center gap-1 border-b border-zinc-200 bg-white px-2">
      <ToolbarIconButton label={t("editor.new")} variant="ghost" size="icon" onClick={onNewMap}>
        <FilePlus />
      </ToolbarIconButton>
      <ToolbarIconButton
        label={t("editor.generator.action")}
        variant="ghost"
        size="icon"
        disabled={!canGenerateMap}
        onClick={onGenerateMap}
      >
        <WandSparkles />
      </ToolbarIconButton>

      <Separator />

      {PAINT_TOOLS.map(({ key, icon: Icon }) => (
        <ToolbarIconButton
          key={key}
          label={toolLabelText(key)}
          variant={activeTool === key ? "secondary" : "ghost"}
          size="icon"
          aria-pressed={activeTool === key}
          onClick={() => onSelectTool(key)}
        >
          <Icon />
        </ToolbarIconButton>
      ))}

      <Separator />

      <EditorModeControl mode={mode} onSelect={onSelectMode} />

      <Separator />

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={t("editor.dayNightCycle.settings")}
                  variant={dayNightCycle ? "secondary" : "outline"}
                  size="icon"
                  disabled={!dayNightCycleAvailable}
                />
              }
            >
              <SunMoon />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("editor.dayNightCycle.settings")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("editor.dayNightCycle.settings")}</DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={dayNightCycle ? "cycle" : fixedLighting}
            onValueChange={(value) => onSelectLighting(value as EditorLightingSelection)}
          >
            {LIGHTING_OPTIONS.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {t(option.label)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={t("editor.weather.settings")}
                  variant={weather === "none" ? "outline" : "secondary"}
                  size="icon"
                  disabled={!dayNightCycleAvailable}
                />
              }
            >
              <CloudRain />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("editor.weather.settings")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("editor.weather.settings")}</DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={weather}
            onValueChange={(value) => onSelectWeather(value as MapWeather)}
          >
            {WEATHER_OPTIONS.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {t(option.label)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolbarIconButton
        label={t("editor.shell.grid.aria")}
        variant={showGrid ? "secondary" : "ghost"}
        size="icon"
        aria-pressed={showGrid}
        onClick={onToggleGrid}
      >
        <Grid3x3 />
      </ToolbarIconButton>
      <ToolbarIconButton
        label={t("editor.shell.dimOtherLayers")}
        variant={showDim ? "secondary" : "ghost"}
        size="icon"
        aria-pressed={showDim}
        onClick={onToggleDim}
      >
        <Layers />
      </ToolbarIconButton>
      <ToolbarIconButton
        label={t("editor.shell.collisions.aria")}
        variant={showCollisions ? "secondary" : "ghost"}
        size="icon"
        aria-pressed={showCollisions}
        onClick={onToggleCollisions}
      >
        <Blocks />
      </ToolbarIconButton>
      <ToolbarIconButton
        label={t("editor.shell.zoom.aria")}
        variant="outline"
        size="sm"
        className="tabular-nums"
        onClick={onCycleZoom}
      >
        <ZoomIn />
        {zoom} %
      </ToolbarIconButton>

      <div className="flex-1" />

      <ToolbarIconButton
        label={t("editor.help.open")}
        variant="ghost"
        size="icon"
        onClick={onOpenHelp}
      >
        <CircleHelp />
      </ToolbarIconButton>

      <Button size="sm" onClick={onTest}>
        <Play />
        {t("editor.shell.test")}
      </Button>
    </div>
  );
}

function Separator() {
  return <div className="mx-1 h-5 w-px bg-zinc-200" />;
}
