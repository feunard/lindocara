import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { t, useLocale } from "@lindocara/client/i18n.js";
import {
  INTERIOR_SHELL_STYLES,
  type InteriorShell,
  type InteriorShellStyle,
  type MapEnvironment,
} from "@lindocara/engine/map-environment.js";
import { useEffect, useState } from "react";

type ShellChoice = "exterior" | "interior-none" | InteriorShellStyle;

const STYLE_PREVIEWS: Record<InteriorShellStyle, { image: string; atlas?: boolean }> = {
  timber: { image: "/assets/lindocara/hd2d/buildings/wall-timber.png" },
  castle: { image: "/assets/lindocara/hd2d/buildings/cream-stone.png" },
  cave: { image: "/assets/lindocara/hd2d/tileset-grotte.png", atlas: true },
  mountain: { image: "/assets/lindocara/hd2d/tileset-montagne.png", atlas: true },
  volcano: { image: "/assets/lindocara/hd2d/tileset-volcan.png", atlas: true },
  ice: { image: "/assets/lindocara/hd2d/tileset-glace.png", atlas: true },
  snow: { image: "/assets/lindocara/hd2d/tileset-neige.png", atlas: true },
};

interface MapInteriorShellDialogProps {
  open: boolean;
  mapName: string;
  environment: MapEnvironment;
  initial?: InteriorShell | undefined;
  canMakeInterior: boolean;
  onOpenChange(open: boolean): void;
  onSave(environment: MapEnvironment, shell?: InteriorShell): Promise<boolean>;
}

export function MapInteriorShellDialog({
  open,
  mapName,
  environment,
  initial,
  canMakeInterior,
  onOpenChange,
  onSave,
}: MapInteriorShellDialogProps) {
  useLocale();
  const [choice, setChoice] = useState<ShellChoice>(
    environment === "exterior" ? "exterior" : (initial?.style ?? "interior-none"),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChoice(environment === "exterior" ? "exterior" : (initial?.style ?? "interior-none"));
    setSaving(false);
  }, [environment, initial?.style, open]);

  async function save(): Promise<void> {
    if (saving) return;
    setSaving(true);
    try {
      const saved =
        choice === "exterior"
          ? await onSave("exterior")
          : choice === "interior-none"
            ? await onSave("interior")
            : await onSave("interior", { style: choice });
      if (saved) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  const interiorDisabled = !canMakeInterior && environment !== "interior";
  const selectedStyle = choice === "exterior" || choice === "interior-none" ? null : choice;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("editor.interiorShell.title", { name: mapName })}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t("editor.interiorShell.hint")}</p>
        {interiorDisabled ? (
          <p
            role="alert"
            className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
          >
            {t("editor.interiorShell.startWarning")}
          </p>
        ) : null}
        <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <button
            type="button"
            role="radio"
            aria-checked={choice === "exterior"}
            className={`flex min-h-24 flex-col justify-between rounded-md border p-3 text-left transition-colors ${
              choice === "exterior"
                ? "border-zinc-900 bg-zinc-100 ring-1 ring-zinc-900"
                : "border-zinc-200 hover:bg-zinc-50"
            }`}
            onClick={() => setChoice("exterior")}
          >
            <span className="text-sm font-medium">{t("editor.interiorShell.exterior")}</span>
            <span className="text-muted-foreground text-xs">
              {t("editor.interiorShell.exteriorHint")}
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={choice === "interior-none"}
            disabled={interiorDisabled}
            className={`flex min-h-24 flex-col justify-between rounded-md border bg-[#020307] p-3 text-left text-zinc-100 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              choice === "interior-none"
                ? "border-zinc-100 ring-2 ring-zinc-700"
                : "border-zinc-700 hover:border-zinc-500"
            }`}
            onClick={() => setChoice("interior-none")}
          >
            <span className="text-sm font-medium">{t("editor.interiorShell.none")}</span>
            <span className="text-xs text-zinc-400">{t("editor.interiorShell.noneHint")}</span>
          </button>
          {INTERIOR_SHELL_STYLES.map((style) => {
            const preview = STYLE_PREVIEWS[style];
            return (
              <button
                key={style}
                type="button"
                role="radio"
                aria-checked={choice === style}
                disabled={interiorDisabled}
                className={`relative min-h-24 overflow-hidden rounded-md border text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  choice === style
                    ? "border-zinc-900 ring-2 ring-zinc-900"
                    : "border-zinc-300 hover:border-zinc-500"
                }`}
                onClick={() => setChoice(style)}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-0 bg-cover bg-center [image-rendering:pixelated]"
                  style={{
                    backgroundImage: `linear-gradient(to top, rgb(0 0 0 / 0.82), transparent 70%), url(${preview.image})`,
                    ...(preview.atlas
                      ? {
                          backgroundSize: "auto, 288px 192px",
                          backgroundPosition: "center, 75% 80%",
                        }
                      : {}),
                  }}
                />
                <span className="absolute right-2 bottom-2 left-2 text-sm font-semibold text-white drop-shadow-sm">
                  {t(`editor.interiorShell.style.${style}`)}
                </span>
              </button>
            );
          })}
        </div>
        {selectedStyle ? (
          <p className="rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-700">
            {t("editor.interiorShell.structuralFloor", {
              terrain: t(`editor.interiorShell.floor.${selectedStyle}`),
            })}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("editor.delete.cancel")}
          </Button>
          <Button
            disabled={saving || (interiorDisabled && choice !== "exterior")}
            onClick={() => void save()}
          >
            {t("editor.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
