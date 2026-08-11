import { t, useLocale } from "@lindocara/client/i18n.js";
import { Check, CircleDashed } from "lucide-react";
import type { EditorMode } from "../../game/editor-state.js";

interface EditorStatusBarProps {
  mapName: string;
  cols: number;
  rows: number;
  cursor: { col: number; row: number } | null;
  saved: boolean;
  /** True while the session is an unsaved local sandbox. `saved` only reports "no unsaved EDITS",
   *  which is vacuously true for a map that has never been written at all — showing its green tick
   *  there would tell the author their work is safe when nothing of it exists yet. */
  sandbox: boolean;
  mode: EditorMode;
  toolLabel: string;
  zoom: number;
  /** Camera heading, 0..359. Shown because once the camera can turn, "which way is north on this
   *  map" stops being obvious from the picture alone. */
  yaw: number;
}

/** The wireframe's 26px status strip: current map, dimensions, cursor cell, saved flag, active
 *  mode, active tool, zoom. Purely static-prop-driven; Task 9 wires the live cursor cell. */
export function EditorStatusBar({
  mapName,
  cols,
  rows,
  cursor,
  saved,
  sandbox,
  mode,
  toolLabel,
  zoom,
  yaw,
}: EditorStatusBarProps) {
  useLocale();
  return (
    <div className="flex h-[26px] flex-none items-center border-t border-zinc-200 bg-zinc-50 px-3 text-[11.5px] text-zinc-500 tabular-nums">
      <span className="flex items-center gap-1.5">
        <span className="size-[7px] rounded-[2px] bg-zinc-900" />
        <span className="font-medium text-zinc-600">{mapName}</span>
      </span>
      <Divider />
      <span>{`${t("editor.cols")} ${cols} × ${t("editor.rows")} ${rows}`}</span>
      <Divider />
      <span>
        {t("editor.shell.status.cursor", {
          col: cursor ? cursor.col + 1 : "—",
          row: cursor ? cursor.row + 1 : "—",
        })}
      </span>

      <span className="flex-1" />

      {sandbox ? (
        <>
          <span className="flex items-center gap-1.5 font-medium text-amber-600">
            <CircleDashed className="size-3" />
            {t("editor.shell.status.sandbox")}
          </span>
          <Divider />
        </>
      ) : (
        saved && (
          <>
            <span className="flex items-center gap-1.5 font-medium text-green-600">
              <Check className="size-3" />
              {t("editor.shell.status.saved")}
            </span>
            <Divider />
          </>
        )
      )}
      <span>{t(`editor.shell.mode.${mode}`)}</span>
      <Divider />
      <span>{toolLabel}</span>
      <Divider />
      <span>{`${zoom} %`}</span>
      <Divider />
      <span>{`${yaw}°`}</span>
    </div>
  );
}

function Divider() {
  return <span className="mx-3 h-[13px] w-px bg-zinc-200" />;
}
