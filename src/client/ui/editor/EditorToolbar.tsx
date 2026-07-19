import {
  Eraser,
  FilePlus,
  Grid3x3,
  Layers,
  MousePointer2,
  PaintBucket,
  Pencil,
  Play,
  Save,
  Square,
  Trash2,
  ZoomIn,
} from "lucide-react";
import type { ComponentType } from "react";
import type { MessageKey } from "../../../shared/i18n/index.js";
import { t, useLocale } from "../../i18n.js";
import { Button } from "../components/button.js";

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

const LAYERS: (0 | 1 | 2)[] = [0, 1, 2];

interface EditorToolbarProps {
  activeTool: EditorPaintTool | null;
  activeLayer: 0 | 1 | 2;
  eventActive: boolean;
  showGrid: boolean;
  showDim: boolean;
  zoom: number;
  canSave: boolean;
  onNewMap(): void;
  onSave(): void;
  onDeleteMap(): void;
  onSelectTool(tool: EditorPaintTool): void;
  onSelectLayer(layer: 0 | 1 | 2): void;
  onSelectEvents(): void;
  onToggleGrid(): void;
  onToggleDim(): void;
  onCycleZoom(): void;
  onTest(): void;
}

/** The wireframe's 42px toolbar: file actions · paint tools · layer group (+ reserved EV slot) ·
 *  view toggles · zoom · flex spacer · Tester. Stock shadcn buttons and lucide icons only. */
export function EditorToolbar({
  activeTool,
  activeLayer,
  eventActive,
  showGrid,
  showDim,
  zoom,
  canSave,
  onNewMap,
  onSave,
  onDeleteMap,
  onSelectTool,
  onSelectLayer,
  onSelectEvents,
  onToggleGrid,
  onToggleDim,
  onCycleZoom,
  onTest,
}: EditorToolbarProps) {
  useLocale();
  return (
    <div className="flex h-[42px] flex-none items-center gap-1 border-b border-zinc-200 bg-zinc-50 px-2">
      <Button variant="ghost" size="icon" aria-label={t("editor.new")} onClick={onNewMap}>
        <FilePlus />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("editor.save")}
        disabled={!canSave}
        onClick={onSave}
      >
        <Save />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("editor.shell.deleteMap")}
        onClick={onDeleteMap}
      >
        <Trash2 />
      </Button>

      <Separator />

      {PAINT_TOOLS.map(({ key, icon: Icon }) => (
        <Button
          key={key}
          variant={activeTool === key ? "secondary" : "ghost"}
          size="icon"
          aria-label={toolLabelText(key)}
          aria-pressed={activeTool === key}
          onClick={() => onSelectTool(key)}
        >
          <Icon />
        </Button>
      ))}

      <Separator />

      <div className="flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5">
        {LAYERS.map((layer) => (
          <Button
            key={layer}
            variant={activeLayer === layer ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={t("editor.shell.layer", { n: layer + 1 })}
            aria-pressed={activeLayer === layer}
            onClick={() => onSelectLayer(layer)}
          >
            {layer + 1}
          </Button>
        ))}
        <Button
          variant={eventActive ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label={t("editor.shell.events")}
          aria-pressed={eventActive}
          onClick={onSelectEvents}
        >
          {t("editor.shell.events.short")}
        </Button>
      </div>

      <Separator />

      <Button
        variant={showGrid ? "secondary" : "ghost"}
        size="icon"
        aria-label={t("editor.shell.grid.aria")}
        aria-pressed={showGrid}
        onClick={onToggleGrid}
      >
        <Grid3x3 />
      </Button>
      <Button
        variant={showDim ? "secondary" : "ghost"}
        size="icon"
        aria-label={t("editor.shell.dimOtherLayers")}
        aria-pressed={showDim}
        onClick={onToggleDim}
      >
        <Layers />
      </Button>
      <Button
        variant="outline"
        size="sm"
        aria-label={t("editor.shell.zoom.aria")}
        className="tabular-nums"
        onClick={onCycleZoom}
      >
        <ZoomIn />
        {zoom} %
      </Button>

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
