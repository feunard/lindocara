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
import { Button } from "../components/button.js";

/** The five paint tools the toolbar exposes as buttons. `stairs` and scenery live in the palette. */
export type EditorPaintTool = "select" | "pencil" | "rect" | "fill" | "eraser";

/** French labels for every selectable tool key, shared with the status bar. */
export const TOOL_LABELS: Record<EditorPaintTool | "stairs", string> = {
  select: "Sélection",
  pencil: "Crayon",
  rect: "Rectangle",
  fill: "Remplissage",
  eraser: "Gomme",
  stairs: "Escalier",
};

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
  showGrid: boolean;
  zoom: number;
  canSave: boolean;
  onNewMap(): void;
  onSave(): void;
  onDeleteMap(): void;
  onSelectTool(tool: EditorPaintTool): void;
  onSelectLayer(layer: 0 | 1 | 2): void;
  onToggleGrid(): void;
  onCycleZoom(): void;
  onTest(): void;
}

/** The wireframe's 42px toolbar: file actions · paint tools · layer group (+ reserved EV slot) ·
 *  view toggles · zoom · flex spacer · Tester. Stock shadcn buttons and lucide icons only. */
export function EditorToolbar({
  activeTool,
  activeLayer,
  showGrid,
  zoom,
  canSave,
  onNewMap,
  onSave,
  onDeleteMap,
  onSelectTool,
  onSelectLayer,
  onToggleGrid,
  onCycleZoom,
  onTest,
}: EditorToolbarProps) {
  return (
    <div className="flex h-[42px] flex-none items-center gap-1 border-b border-zinc-200 bg-zinc-50 px-2">
      <Button variant="ghost" size="icon" aria-label="Nouvelle carte" onClick={onNewMap}>
        <FilePlus />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Enregistrer"
        disabled={!canSave}
        onClick={onSave}
      >
        <Save />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Supprimer la carte" onClick={onDeleteMap}>
        <Trash2 />
      </Button>

      <Separator />

      {PAINT_TOOLS.map(({ key, icon: Icon }) => (
        <Button
          key={key}
          variant={activeTool === key ? "secondary" : "ghost"}
          size="icon"
          aria-label={TOOL_LABELS[key]}
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
            aria-label={`Calque ${layer + 1}`}
            aria-pressed={activeLayer === layer}
            onClick={() => onSelectLayer(layer)}
          >
            {layer + 1}
          </Button>
        ))}
        <Button variant="ghost" size="icon-sm" aria-label="Événements" disabled>
          EV
        </Button>
      </div>

      <Separator />

      <Button
        variant={showGrid ? "secondary" : "ghost"}
        size="icon"
        aria-label="Grille"
        aria-pressed={showGrid}
        onClick={onToggleGrid}
      >
        <Grid3x3 />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Estomper les autres calques" disabled>
        <Layers />
      </Button>
      <Button
        variant="outline"
        size="sm"
        aria-label="Zoom"
        className="tabular-nums"
        onClick={onCycleZoom}
      >
        <ZoomIn />
        {zoom} %
      </Button>

      <div className="flex-1" />

      <Button size="sm" onClick={onTest}>
        <Play />
        Tester
      </Button>
    </div>
  );
}

function Separator() {
  return <div className="mx-1 h-5 w-px bg-zinc-200" />;
}
