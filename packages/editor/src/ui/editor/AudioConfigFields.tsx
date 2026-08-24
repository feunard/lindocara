import { Button } from "@alepha/ui/components/ui/button";
import { Label } from "@alepha/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@alepha/ui/components/ui/tooltip";
import { t, useLocale } from "@lindocara/client/i18n.js";
import {
  type AdventureAudioConfig,
  AMBIENCE_TRACKS,
  type AmbienceTrackId,
  type MapAudioConfig,
  MUSIC_PROFILE_FIELDS,
  MUSIC_PROFILES,
  MUSIC_TRACKS,
  type MusicProfileField,
  type MusicProfileId,
  type MusicTrackId,
  musicTracksForProfile,
  type UploadedMusicTrack,
} from "@lindocara/engine/audio-catalog.js";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const INHERIT = "__inherit";
const SILENCE = "__silence";

type AudioField = "music" | "ambience" | "combatMusic" | MusicProfileField;
type AudioPreviewTarget = {
  field: AudioField;
  src: string;
  label: string;
};
type AudioPreviewState = AudioPreviewTarget & {
  playing: boolean;
};

const AUDIO_FIELDS = [
  ...MUSIC_PROFILE_FIELDS,
  "ambience",
  "music",
  "combatMusic",
] as const satisfies readonly AudioField[];

type AudioConfigFieldsProps =
  | {
      variant: "adventure";
      value: AdventureAudioConfig;
      uploadedTracks?: undefined;
      onChange(value: AdventureAudioConfig): void;
    }
  | {
      variant: "map";
      value: MapAudioConfig;
      uploadedTracks?: readonly UploadedMusicTrack[];
      onChange(value: MapAudioConfig): void;
    };

function optionLabel(track: { title: string; author: string }): string {
  return `${track.title} · ${track.author}`;
}

function profileLabel(item: { title: string; bpm: number }): string {
  return `${item.title} · ${item.bpm} BPM`;
}

function isProfileField(field: AudioField): field is MusicProfileField {
  return MUSIC_PROFILE_FIELDS.some((candidate) => candidate === field);
}

function samePreview(
  current: AudioPreviewState | null,
  target: AudioPreviewTarget,
): current is AudioPreviewState {
  return current?.field === target.field && current.src === target.src;
}

function releaseAudio(audio: HTMLAudioElement | null): void {
  if (!audio) return;
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
}

export function AudioConfigFields(props: AudioConfigFieldsProps) {
  useLocale();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [preview, setPreview] = useState<AudioPreviewState | null>(null);

  useEffect(() => {
    return () => {
      releaseAudio(audioRef.current);
      audioRef.current = null;
    };
  }, []);

  function stopPreview(): void {
    releaseAudio(audioRef.current);
    audioRef.current = null;
    setPreview(null);
  }

  function update(field: AudioField, encoded: string | null): void {
    if (encoded === null) return;
    if (preview?.field === field) stopPreview();
    if (props.variant === "map") {
      const next: MapAudioConfig = { ...props.value };
      if (encoded === INHERIT) delete next[field];
      else if (encoded === SILENCE) next[field] = null;
      else if (field === "ambience") next[field] = encoded as AmbienceTrackId;
      else if (isProfileField(field)) next[field] = encoded as MusicProfileId;
      else next[field] = encoded as MusicTrackId;
      props.onChange(next);
      return;
    }
    props.onChange({
      ...props.value,
      [field]:
        encoded === SILENCE
          ? null
          : field === "ambience"
            ? (encoded as AmbienceTrackId)
            : isProfileField(field)
              ? (encoded as MusicProfileId)
              : (encoded as MusicTrackId),
    });
  }

  function tracksForField(field: AudioField) {
    if (field === "ambience") return AMBIENCE_TRACKS;
    return [...MUSIC_TRACKS, ...(props.uploadedTracks ?? [])];
  }

  function previewSource(field: AudioField): string | null {
    const value = props.value[field];
    if (value === undefined || value === null) return null;
    if (isProfileField(field)) {
      return musicTracksForProfile(value as MusicProfileId)[0]?.src ?? null;
    }
    if (field === "ambience") {
      return AMBIENCE_TRACKS.find((track) => track.id === value)?.src ?? null;
    }
    return tracksForField(field).find((track) => track.id === value)?.src ?? null;
  }

  function previewTarget(field: AudioField): AudioPreviewTarget | null {
    const src = previewSource(field);
    return src ? { field, src, label: selectedLabel(field) } : null;
  }

  function playAudio(audio: HTMLAudioElement, target: AudioPreviewTarget): void {
    void audio.play().catch(() => {
      if (audioRef.current === audio) audioRef.current = null;
      setPreview((current) => (samePreview(current, target) ? null : current));
    });
  }

  function togglePreview(target: AudioPreviewTarget | null): void {
    if (!target) return;
    if (samePreview(preview, target) && audioRef.current) {
      if (preview.playing) {
        audioRef.current.pause();
        setPreview({ ...target, playing: false });
      } else {
        playAudio(audioRef.current, target);
        setPreview({ ...target, playing: true });
      }
      return;
    }

    releaseAudio(audioRef.current);
    const audio = new Audio(target.src);
    audio.preload = "auto";
    audio.onended = () => {
      if (audioRef.current === audio) audioRef.current = null;
      setPreview((current) => (samePreview(current, target) ? null : current));
    };
    audio.onerror = () => {
      if (audioRef.current === audio) audioRef.current = null;
      setPreview((current) => (samePreview(current, target) ? null : current));
    };
    audioRef.current = audio;
    setPreview({ ...target, playing: true });
    playAudio(audio, target);
  }

  function encodedValue(field: AudioField): string {
    const value = props.value[field];
    if (value === undefined) return INHERIT;
    return value ?? SILENCE;
  }

  function selectedLabel(field: AudioField): string {
    const value = encodedValue(field);
    if (value === INHERIT) return t("editor.audio.inherit");
    if (value === SILENCE)
      return t(isProfileField(field) ? "editor.audio.noProfile" : "editor.audio.none");
    if (isProfileField(field)) {
      const item = MUSIC_PROFILES.find((candidate) => candidate.id === value);
      return item ? profileLabel(item) : t("editor.audio.none");
    }
    const tracks = tracksForField(field);
    const track = tracks.find((candidate) => candidate.id === value);
    return track ? optionLabel(track) : t("editor.audio.none");
  }

  // The live preview must stop only when this render changes the selected source behind it
  useEffect(() => {
    if (!preview) return;
    const current = previewTarget(preview.field);
    if (!current || current.src !== preview.src) stopPreview();
  }, [props.value, props.uploadedTracks, preview?.field, preview?.src]);

  return (
    <div className="grid gap-3">
      {AUDIO_FIELDS.map((field) => {
        const tracks = tracksForField(field);
        const id = `audio-${props.variant}-${field}`;
        const target = previewTarget(field);
        const playing = target ? samePreview(preview, target) && preview.playing : false;
        const previewLabel = target
          ? `${t(playing ? "editor.audio.pause" : "editor.audio.preview")} ${target.label}`
          : t("editor.audio.previewUnavailable");
        return (
          <div key={field} className="grid gap-1.5">
            <Label htmlFor={id}>{t(`editor.audio.${field}`)}</Label>
            <div className="flex items-center gap-1.5">
              <Select value={encodedValue(field)} onValueChange={(value) => update(field, value)}>
                <SelectTrigger id={id} className="min-w-0 flex-1">
                  <SelectValue>{selectedLabel(field)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {props.variant === "map" && (
                    <SelectItem value={INHERIT}>{t("editor.audio.inherit")}</SelectItem>
                  )}
                  <SelectItem value={SILENCE}>
                    {t(isProfileField(field) ? "editor.audio.noProfile" : "editor.audio.none")}
                  </SelectItem>
                  {isProfileField(field)
                    ? MUSIC_PROFILES.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {profileLabel(item)}
                        </SelectItem>
                      ))
                    : tracks.map((track) => (
                        <SelectItem key={track.id} value={track.id}>
                          {optionLabel(track)}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <Button
                    type="button"
                    variant={playing ? "secondary" : "outline"}
                    size="icon-sm"
                    aria-label={previewLabel}
                    aria-pressed={target ? playing : undefined}
                    disabled={!target}
                    onClick={() => togglePreview(target)}
                  >
                    {playing ? <Pause /> : <Play />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{previewLabel}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        );
      })}
    </div>
  );
}
