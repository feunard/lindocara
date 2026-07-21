import type { EditorMode } from "../../game/editor-state.js";
import { t } from "../../i18n.js";
import { ToggleGroup, ToggleGroupItem } from "../components/toggle-group.js";

const MODES: readonly EditorMode[] = ["field", "element", "event"];

/** The editor's one mode selector. A mode owns a collection — tiles, elements or events — so this
 *  is not the old layer pill renamed: `activeLayer` only ever moved the eraser.
 *
 *  This repo's `ToggleGroup` wraps Base UI, not Radix: single-select is `multiple={false}` (the
 *  default) with an array-valued `value`/`onValueChange`, and — unlike Radix's `type="single"` —
 *  Base UI has no built-in "no empty state" guard. Clicking the already-pressed segment fires
 *  `onValueChange([], …)`, so this control must swallow that itself: a segmented control has no
 *  empty state, and `onSelect` must never be told to deselect. */
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
      aria-label={t("editor.shell.mode.label")}
    >
      {MODES.map((value) => (
        <ToggleGroupItem key={value} value={value} aria-label={t(`editor.shell.mode.${value}`)}>
          {t(`editor.shell.mode.${value}`)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
