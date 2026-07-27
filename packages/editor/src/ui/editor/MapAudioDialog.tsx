import { t, useLocale } from "@lindocara/client/i18n.js";
import type { MapAudioConfig } from "@lindocara/engine/audio-catalog.js";
import { Button } from "@lindocara/ui/components/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@lindocara/ui/components/dialog.js";
import { useEffect, useState } from "react";
import { AudioConfigFields } from "./AudioConfigFields.js";

interface MapAudioDialogProps {
  open: boolean;
  mapName: string;
  initial: MapAudioConfig;
  onOpenChange(open: boolean): void;
  onSave(audio: MapAudioConfig): void;
}

export function MapAudioDialog({
  open,
  mapName,
  initial,
  onOpenChange,
  onSave,
}: MapAudioDialogProps) {
  useLocale();
  const [audio, setAudio] = useState<MapAudioConfig>(initial);

  useEffect(() => {
    if (open) setAudio(initial);
  }, [initial, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent key={`${mapName}:${open}`} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("editor.audio.mapTitle", { name: mapName })}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("editor.audio.mapHint")}</p>
        <AudioConfigFields variant="map" value={audio} onChange={setAudio} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("adventure.delete.cancel")}
          </Button>
          <Button onClick={() => onSave(audio)}>{t("editor.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
