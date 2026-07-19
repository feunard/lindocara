import { Check } from "lucide-react";
import { t, useLocale } from "../../i18n.js";

interface EditorStatusBarProps {
  mapName: string;
  cols: number;
  rows: number;
  cursor: string;
  saved: boolean;
  activeLayer: 0 | 1 | 2;
  toolLabel: string;
  zoom: number;
}

/** The wireframe's 26px status strip: current map, dimensions, cursor cell, saved flag, active
 *  layer, active tool, zoom. Purely static-prop-driven; Task 9 wires the live cursor cell. */
export function EditorStatusBar({
  mapName,
  cols,
  rows,
  cursor,
  saved,
  activeLayer,
  toolLabel,
  zoom,
}: EditorStatusBarProps) {
  useLocale();
  return (
    <div className="flex h-[26px] flex-none items-center border-t border-zinc-200 bg-zinc-50 px-3 text-[11.5px] text-zinc-500 tabular-nums">
      <span className="flex items-center gap-1.5">
        <span className="size-[7px] rounded-[2px] bg-zinc-900" />
        <span className="font-medium text-zinc-600">{mapName}</span>
      </span>
      <Divider />
      <span>{`${cols}×${rows}`}</span>
      <Divider />
      <span>{t("editor.shell.status.cursor", { cursor })}</span>

      <span className="flex-1" />

      {saved && (
        <>
          <span className="flex items-center gap-1.5 font-medium text-green-600">
            <Check className="size-3" />
            {t("editor.shell.status.saved")}
          </span>
          <Divider />
        </>
      )}
      <span>{t("editor.shell.layer", { n: activeLayer + 1 })}</span>
      <Divider />
      <span>{toolLabel}</span>
      <Divider />
      <span>{`${zoom} %`}</span>
    </div>
  );
}

function Divider() {
  return <span className="mx-3 h-[13px] w-px bg-zinc-200" />;
}
