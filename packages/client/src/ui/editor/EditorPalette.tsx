import type { ComponentProps } from "react";
import type { EditorMode } from "../../game/editor-state.js";
import { ElementPalette } from "./ElementPalette.js";
import { EventPalette } from "./EventPalette.js";
import { TerrainPalette } from "./TerrainPalette.js";

interface EditorPaletteProps {
  mode: EditorMode;
  field: ComponentProps<typeof TerrainPalette>;
  element: ComponentProps<typeof ElementPalette>;
  event: ComponentProps<typeof EventPalette>;
}

/**
 * The left sidebar's thin dispatcher: each mode owns its own collection and therefore its own
 * palette body, so this renders exactly one of `TerrainPalette` (Field) / `ElementPalette` (Element)
 * / `EventPalette` (Event) — never a mix. Introduced in Task 11 to replace `TerrainPalette`'s old
 * two-way `eventMode` branch.
 */
export function EditorPalette({ mode, field, element, event }: EditorPaletteProps) {
  switch (mode) {
    case "field":
      return <TerrainPalette {...field} />;
    case "element":
      return <ElementPalette {...element} />;
    case "event":
      return <EventPalette {...event} />;
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}
