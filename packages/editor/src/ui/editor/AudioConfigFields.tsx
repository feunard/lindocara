import { Label } from "@alepha/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
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
} from "@lindocara/engine/audio-catalog.js";

const INHERIT = "__inherit";
const SILENCE = "__silence";

type AudioField = "music" | "ambience" | "combatMusic" | MusicProfileField;

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
      onChange(value: AdventureAudioConfig): void;
    }
  | {
      variant: "map";
      value: MapAudioConfig;
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

export function AudioConfigFields(props: AudioConfigFieldsProps) {
  useLocale();

  function update(field: AudioField, encoded: string | null): void {
    if (encoded === null) return;
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
    const tracks = field === "ambience" ? AMBIENCE_TRACKS : MUSIC_TRACKS;
    const track = tracks.find((candidate) => candidate.id === value);
    return track ? optionLabel(track) : t("editor.audio.none");
  }

  return (
    <div className="grid gap-3">
      {AUDIO_FIELDS.map((field) => {
        const tracks = field === "ambience" ? AMBIENCE_TRACKS : MUSIC_TRACKS;
        const id = `audio-${props.variant}-${field}`;
        return (
          <div key={field} className="grid gap-1.5">
            <Label htmlFor={id}>{t(`editor.audio.${field}`)}</Label>
            <Select value={encodedValue(field)} onValueChange={(value) => update(field, value)}>
              <SelectTrigger id={id} className="w-full">
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
          </div>
        );
      })}
    </div>
  );
}
