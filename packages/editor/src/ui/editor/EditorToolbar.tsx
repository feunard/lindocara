import { t, useLocale } from "@lindocara/client/i18n.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import { Button } from "@lindocara/ui/components/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@lindocara/ui/components/tooltip.js";
import {
  Blocks,
  Eraser,
  FilePlus,
  Grid3x3,
  Layers,
  MousePointer2,
  PaintBucket,
  Pencil,
  Play,
  Square,
  ZoomIn,
} from "lucide-react";
import type { ComponentProps, ComponentType } from "react";
import type { EditorMode } from "../../game/editor-state.js";
import { EditorModeControl } from "./EditorModeControl.js";

/** The five paint tools the toolbar exposes as buttons. `stairs` and scenery live in the palette. */
export type EditorPaintTool = "select" | "pencil" | "rect" | "fill" | "eraser";

/** The i18n key for every selectable tool key's label, shared with the status bar. */
export const TOOL_LABEL_KEYS: Record<EditorPaintTool | "stairs", MessageKey> = {
  select: "editor.shell.tool.select",
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
  { key: "pencil", icon: Pencil },
  { key: "rect", icon: Square },
  { key: "fill", icon: PaintBucket },
  { key: "eraser", icon: Eraser },
];

interface EditorToolbarProps {
  activeTool: EditorPaintTool | null;
  mode: EditorMode;
  showGrid: boolean;
  showDim: boolean;
  /** D18: the collision-visualisation overlay toggle — shades solid tiles and outlines element
   *  colliders. Off by default, threaded to the stage exactly like `showGrid`/`showDim`. */
  showCollisions: boolean;
  zoom: number;
  onNewMap(): void;
  onSelectTool(tool: EditorPaintTool): void;
  onSelectMode(mode: EditorMode): void;
  onToggleGrid(): void;
  onToggleDim(): void;
  onToggleCollisions(): void;
  onCycleZoom(): void;
  onTest(): void;
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
  zoom,
  onNewMap,
  onSelectTool,
  onSelectMode,
  onToggleGrid,
  onToggleDim,
  onToggleCollisions,
  onCycleZoom,
  onTest,
}: EditorToolbarProps) {
  useLocale();
  return (
    <div className="flex h-[42px] flex-none items-center gap-1 border-b border-zinc-200 bg-zinc-50 px-2">
      <ToolbarIconButton label={t("editor.new")} variant="ghost" size="icon" onClick={onNewMap}>
        <FilePlus />
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
