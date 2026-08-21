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
export const MAP_WEATHERS = ["none", "rain"] as const;
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
  return weather === "rain";
}
