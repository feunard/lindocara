import { Segmented } from "@alepha/ui/components/ui/segmented";
import { t } from "@lindocara/client/i18n.js";
import type { EditorMode } from "../../game/editor-state.js";

const MODES: readonly EditorMode[] = ["field", "element", "event"];

/**
 * The editor's one mode selector. A mode owns a collection — tiles, elements or events — so this is
 * not the old layer pill renamed: `activeLayer` only ever moved the eraser.
 *
 * `Segmented` rather than a hand-styled `ToggleGroup`. The old version painted its active segment
 * with `data-[state=on]:bg-zinc-900`, a Radix attribute — but this tree is Base UI, which reports
 * selection through `aria-pressed` and never sets `data-state`. That selector matched nothing, so
 * the "solid dark fill" its docblock promised had never once rendered; what showed was the faint
 * `bg-muted` default it was written to replace. `Segmented` owns its own `data-state`, its sliding
 * thumb, and a single-select model with no empty state — so the guard the old control needed
 * against being told to deselect is gone with it.
 */
export function EditorModeControl({
  mode,
  onSelect,
}: {
  mode: EditorMode;
  onSelect: (mode: EditorMode) => void;
}) {
  return (
    <Segmented
      size="sm"
      value={mode}
      onChange={(next) => onSelect(next as EditorMode)}
      options={MODES.map((value) => ({ value, label: t(`editor.shell.mode.${value}`) }))}
      aria-label={t("editor.shell.mode.label")}
    />
  );
}
