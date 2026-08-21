/**
 * The weather a map is authored with: presentation, and presentation only.
 *
 * It sits beside `MapEnvironment` deliberately, and it obeys the same rule the layers, the elements
 * and the events obey: **appearance never touches collision**. No value here may reach `canStand`
 * or `resolveGroundMovement`, and the heightfield remains the single geometry. Rain that made
 * ground slippery would be a movement rule wearing a weather name, and it would have to live in
 * `hd2d/locomotion.ts` with the other three materials' friction, not here.
 *
 * The values REPLACE one another rather than composing: a storm is rain plus lightning, not a flag
 * beside it, so an author picks one state and every consumer switches on one value.
 */
export const MAP_WEATHERS = ["none", "rain", "storm"] as const;
export type MapWeather = (typeof MAP_WEATHERS)[number];

export const DEFAULT_MAP_WEATHER: MapWeather = "none";

/** Never throws: an unknown value from a database row or a wire frame is not weather. */
export function parseMapWeather(value: unknown): MapWeather | null {
  return typeof value === "string" && (MAP_WEATHERS as readonly string[]).includes(value)
    ? (value as MapWeather)
    : null;
}

/** Whether this state falls rain, whatever else it does. The one question every consumer of the
 *  downpour asks, so a state added beside `rain` cannot forget to answer it. */
export function weatherRains(weather: MapWeather): boolean {
  return weather === "rain" || weather === "storm";
}

/** Whether this state flashes and thunders. */
export function weatherStorms(weather: MapWeather): boolean {
  return weather === "storm";
}

/**
 * How long a storm waits between strikes, and how much that wait varies.
 *
 * Long enough that a strike is an event rather than a strobe, varied enough that a player never
 * learns the beat. The variation is DERIVED from the strike's own index, never rolled: see
 * `stormStrikeAt`.
 */
export const STORM_STRIKE_PERIOD_MS = 11_000;
export const STORM_STRIKE_JITTER_MS = 5_000;

/**
 * How long after the flash the clap arrives.
 *
 * Light first, then sound, because a flash and a simultaneous clap read as a bug. This is a
 * PRESENTATION offset, not a physics simulation: distance to the strike is not modelled, and a
 * fixed short delay is what sells the height of the sky.
 */
export const STORM_THUNDER_DELAY_MS = 900;

/** How long the flash itself lasts, from the first blink to full darkness again. */
export const STORM_FLASH_MS = 420;

/** FNV-1a, the same hash `mapDayCycleOffset` uses to give one map its own phase. */
function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface StormStrike {
  /** Which strike this is, counted from the epoch. Stable, so a consumer can fire once per strike
   *  and a second consumer can agree with it without being told. */
  index: number;
  /** Milliseconds since this strike's flash began. */
  sinceMs: number;
}

/**
 * Which strike a storm is on at `epochMs`, and how long ago it began.
 *
 * **The decision this function IS, written down.** A party sees one storm, so two heroes standing
 * side by side must flash together. The obvious way to get that is for the room to schedule strikes
 * and broadcast them, the way every OUTCOME is decided server-side. This does not do that, and the
 * reason is that a flash is not an outcome: it decides nothing, it can be missed with no
 * consequence, and paying a broadcast per room every few seconds forever to synchronise a
 * decoration is the wrong trade.
 *
 * Instead it is derived, exactly as the day/night cycle already is (`mapDayCycleOffset`): a pure
 * function of the wall clock and the map's own key, so every client in that map computes the same
 * strikes without a message, and two maps never flash in unison. The cost is that clients whose
 * clocks differ see the strike at slightly different moments -- which is bounded by the clock skew
 * between two machines, is invisible next to the deliberate 900 ms thunder delay, and never
 * disagrees about WHETHER a strike happened.
 *
 * The jitter is derived from the strike index rather than rolled, so this stays pure: the engine
 * has no clock and no `Math.random`, and a strike that could not be recomputed would break the
 * agreement between the flash and the clap.
 */
export function stormStrikeAt(epochMs: number, key: string): StormStrike {
  const offset = hashOf(key) % STORM_STRIKE_PERIOD_MS;
  const shifted = epochMs + offset;
  const index = Math.floor(shifted / STORM_STRIKE_PERIOD_MS);
  // Each strike slides inside its own slot by a hash of its index, so the gap between two strikes
  // is never twice the same and never zero.
  const slide = (hashOf(`${key}:${index}`) % STORM_STRIKE_JITTER_MS) - STORM_STRIKE_JITTER_MS / 2;
  const start = index * STORM_STRIKE_PERIOD_MS + slide;
  const sinceMs = shifted - start;
  // A negative age means this slot's strike has not fired yet: report the PREVIOUS one, which is
  // the strike whose thunder may still be rolling.
  if (sinceMs >= 0) return { index, sinceMs };
  const previous = index - 1;
  const previousSlide =
    (hashOf(`${key}:${previous}`) % STORM_STRIKE_JITTER_MS) - STORM_STRIKE_JITTER_MS / 2;
  return {
    index: previous,
    sinceMs: shifted - (previous * STORM_STRIKE_PERIOD_MS + previousSlide),
  };
}

/**
 * The flash's brightness at `sinceMs`, from 0 to 1.
 *
 * Two blinks rather than one ramp: real lightning is a stroke and its return stroke, and a single
 * smooth pulse reads as someone turning a lamp up. The second blink is weaker and slightly later,
 * which is the whole shape.
 */
export function stormFlashIntensity(sinceMs: number): number {
  if (sinceMs < 0 || sinceMs > STORM_FLASH_MS) return 0;
  const t = sinceMs / STORM_FLASH_MS;
  const first = Math.exp(-((t - 0.05) ** 2) / 0.0018);
  const second = 0.55 * Math.exp(-((t - 0.28) ** 2) / 0.004);
  return Math.min(1, first + second);
}
