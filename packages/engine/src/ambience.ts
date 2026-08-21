/**
 * The live presentation layer an authored page can lay over a map's own sky and soundtrack.
 *
 * Weather, the clock and the music all existed as state before this: weather rides in the
 * heightfield, the clock is a map flag, the soundtrack is chosen by situation from the adventure's
 * audio config. None of them was ADDRESSABLE, so an author could build the tomb and not make the
 * sky turn when the party opened it.
 *
 * **This is presentation and only presentation.** `map-weather.ts` says it outright for weather and
 * the rule holds for all three: nothing here may touch collision, speed or any outcome. The server
 * owns WHEN it changes, the client owns what that looks and sounds like.
 *
 * **A room holds it, not a party.** The override lives in room memory beside the monsters and the
 * loot, so it resets with the room, and a hero arriving later reads the CURRENT value from the
 * welcome rather than the map's authored one. That is the deliberate line: the durable half of an
 * adventure is party state, and an author who wants a storm to outlive an empty room writes the
 * switch that means "the tomb is open" and sets the weather from the page that switch selects.
 */

import type { MusicTrackId } from "./audio-catalog.js";
import { isMusicTrackId } from "./audio-catalog.js";
import { type MapWeather, parseMapWeather } from "./map-weather.js";

/** `null` is the map's own clock, which is the state every room starts in. */
export type AmbienceDayCycle = "day" | "night" | null;

export interface AmbienceState {
  /** `null`: the weather the map itself was authored with. */
  weather: MapWeather | null;
  /** `null`: the map's own day/night clock, running normally. */
  dayCycle: AmbienceDayCycle;
  /** `null`: the soundtrack the adventure authored for this map. */
  music: MusicTrackId | null;
}

export const NO_AMBIENCE_OVERRIDE: AmbienceState = {
  weather: null,
  dayCycle: null,
  music: null,
};

export function isAmbienceDayCycle(value: unknown): value is AmbienceDayCycle {
  return value === null || value === "day" || value === "night";
}

/**
 * Total parse of a wire ambience block. Every field is present and explicitly nullable rather than
 * optional: an override has to be able to say "back to the map's own", and an absent key cannot
 * mean both "unchanged" and "cleared" at once.
 */
export function parseAmbienceState(value: unknown): AmbienceState | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.weather !== null && parseMapWeather(record.weather) === null) return null;
  if (!isAmbienceDayCycle(record.dayCycle)) return null;
  if (record.music !== null && !isMusicTrackId(record.music)) return null;
  return {
    weather: record.weather as MapWeather | null,
    dayCycle: record.dayCycle,
    music: record.music as MusicTrackId | null,
  };
}
