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
  MUSIC_TRACKS,
  type MusicTrackId,
} from "@lindocara/engine/audio-catalog.js";

const INHERIT = "__inherit";
const SILENCE = "__silence";

type AudioField = "music" | "ambience" | "combatMusic";

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

export function AudioConfigFields(props: AudioConfigFieldsProps) {
  useLocale();

  function update(field: AudioField, encoded: string | null): void {
    if (encoded === null) return;
    if (props.variant === "map") {
      const next: MapAudioConfig = { ...props.value };
      if (encoded === INHERIT) delete next[field];
      else if (encoded === SILENCE) next[field] = null;
      else if (field === "ambience") next[field] = encoded as AmbienceTrackId;
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
    if (value === SILENCE) return t("editor.audio.none");
    const tracks = field === "ambience" ? AMBIENCE_TRACKS : MUSIC_TRACKS;
    const track = tracks.find((candidate) => candidate.id === value);
    return track ? optionLabel(track) : t("editor.audio.none");
  }

  return (
    <div className="grid gap-3">
      {(["music", "ambience", "combatMusic"] as const).map((field) => {
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
                <SelectItem value={SILENCE}>{t("editor.audio.none")}</SelectItem>
                {tracks.map((track) => (
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
