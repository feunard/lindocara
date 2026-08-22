import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { t, useLocale } from "@lindocara/client/i18n.js";
import type { MapAudioConfig } from "@lindocara/engine/audio-catalog.js";
import { useEffect, useState } from "react";

import { AudioConfigFields } from "./AudioConfigFields.js";

interface MapAudioDialogProps {
  open: boolean;
  mapName: string;
  initial: MapAudioConfig;
  onOpenChange(open: boolean): void;
  onSave(audio: MapAudioConfig): Promise<boolean>;
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAudio(initial);
      setSaving(false);
    }
  }, [initial, open]);

  async function save(): Promise<void> {
    if (saving) return;
    setSaving(true);
    try {
      if (await onSave(audio)) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("editor.audio.mapTitle", { name: mapName })}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t("editor.audio.mapHint")}</p>
        <AudioConfigFields variant="map" value={audio} onChange={setAudio} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("adventure.delete.cancel")}
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {t("editor.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
