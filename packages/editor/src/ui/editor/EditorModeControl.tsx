import { t } from "@lindocara/client/i18n.js";
import { ToggleGroup, ToggleGroupItem } from "@lindocara/client/ui/components/toggle-group.js";
import type { EditorMode } from "../../game/editor-state.js";

const MODES: readonly EditorMode[] = ["field", "element", "event"];

/** The editor's one mode selector. A mode owns a collection — tiles, elements or events — so this
 *  is not the old layer pill renamed: `activeLayer` only ever moved the eraser.
 *
 *  This repo's `ToggleGroup` wraps Base UI, not Radix: single-select is `multiple={false}` (the
 *  default) with an array-valued `value`/`onValueChange`, and — unlike Radix's `type="single"` —
 *  Base UI has no built-in "no empty state" guard. Clicking the already-pressed segment fires
 *  `onValueChange([], …)`, so this control must swallow that itself: a segmented control has no
 *  empty state, and `onSelect` must never be told to deselect.
 *
 *  D11: the generated `toggleVariants` active state (`data-[state=on]:bg-muted`) reads as barely a
 *  shade off the idle segment — an author cannot tell which mode is active at a glance. `spacing={0}`
 *  turns the three loose buttons into one flush-bordered group (the existing `group-data-[spacing=0]`
 *  rules in `toggle-group.tsx` already do the joined-segment layout); the container's border+tint
 *  reads as a single control, and the per-item `data-[state=on]` override gives the active segment a
 *  solid dark fill with a light label — the same "active = filled dark, inactive = outline" contrast
 *  `TerrainPalette`'s elevation swatches already use, so the active mode is unmistakable. */
export function EditorModeControl({
  mode,
  onSelect,
}: {
  mode: EditorMode;
  onSelect: (mode: EditorMode) => void;
}) {
  return (
    <ToggleGroup
      value={[mode]}
      onValueChange={(next) => {
        const value = next[0];
        if (value) onSelect(value as EditorMode);
      }}
      spacing={0}
      className="rounded-lg border border-zinc-300 bg-zinc-100 p-0.5"
      aria-label={t("editor.shell.mode.label")}
    >
      {MODES.map((value) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={t(`editor.shell.mode.${value}`)}
          className="px-3 text-zinc-600 hover:text-zinc-900 data-[state=on]:bg-zinc-900 data-[state=on]:text-zinc-50 data-[state=on]:shadow-sm data-[state=on]:hover:bg-zinc-900 data-[state=on]:hover:text-zinc-50"
        >
          {t(`editor.shell.mode.${value}`)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
