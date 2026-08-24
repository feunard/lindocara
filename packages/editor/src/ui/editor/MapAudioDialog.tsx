import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { fetchMapSoundsApi, uploadMapSoundApi } from "@lindocara/client/api.js";
import { t, useLocale } from "@lindocara/client/i18n.js";
import { type MapAudioConfig, type UploadedMusicTrack } from "@lindocara/engine/audio-catalog.js";
import { Upload } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";

import { AudioConfigFields } from "./AudioConfigFields.js";

interface MapAudioDialogProps {
  open: boolean;
  mapName: string;
  initial: MapAudioConfig;
  onOpenChange(open: boolean): void;
  onSave(audio: MapAudioConfig): Promise<boolean>;
  listSounds?(): Promise<UploadedMusicTrack[]>;
  uploadSound?(file: File): Promise<UploadedMusicTrack>;
}

export function MapAudioDialog({
  open,
  mapName,
  initial,
  onOpenChange,
  onSave,
  listSounds = fetchMapSoundsApi,
  uploadSound = uploadMapSoundApi,
}: MapAudioDialogProps) {
  useLocale();
  const [audio, setAudio] = useState<MapAudioConfig>(initial);
  const [uploadedTracks, setUploadedTracks] = useState<UploadedMusicTrack[]>([]);
  const [loadingSounds, setLoadingSounds] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setAudio(initial);
      setSaving(false);
      setUploadError(false);
    }
  }, [initial, open]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoadingSounds(true);
    void listSounds()
      .then((tracks) => {
        if (current) setUploadedTracks(tracks);
      })
      .catch(() => {
        if (current) setUploadError(true);
      })
      .finally(() => {
        if (current) setLoadingSounds(false);
      });
    return () => {
      current = false;
    };
  }, [listSounds, open]);

  async function upload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || uploading) return;
    setUploading(true);
    setUploadError(false);
    try {
      const track = await uploadSound(file);
      setUploadedTracks((current) => [track, ...current.filter((item) => item.id !== track.id)]);
      setAudio((current) => ({ ...current, music: track.id }));
    } catch {
      setUploadError(true);
    } finally {
      setUploading(false);
    }
  }

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
        <div className="bg-muted/30 grid gap-2 rounded-md border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1">
              <p className="text-sm font-medium">{t("editor.audio.uploadTitle")}</p>
              <p className="text-muted-foreground text-xs">{t("editor.audio.uploadHint")}</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/mp4,audio/aac,audio/flac"
              className="sr-only"
              aria-label={t("editor.audio.uploadButton")}
              onChange={(event) => void upload(event)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload />
              {t(uploading ? "editor.audio.uploading" : "editor.audio.uploadButton")}
            </Button>
          </div>
          {loadingSounds && (
            <p className="text-muted-foreground text-xs">{t("editor.audio.uploadLoading")}</p>
          )}
          {uploadError && (
            <p role="alert" className="text-destructive text-xs">
              {t("editor.audio.uploadError")}
            </p>
          )}
        </div>
        <AudioConfigFields
          variant="map"
          value={audio}
          uploadedTracks={uploadedTracks}
          onChange={setAudio}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("adventure.delete.cancel")}
          </Button>
          <Button disabled={saving || uploading} onClick={() => void save()}>
            {t("editor.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
