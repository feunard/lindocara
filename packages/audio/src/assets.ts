/**
 * The shipped samples, resolved through the bundler.
 *
 * The glob is the ONE import boundary for physical audio files, exactly as
 * `renderer/tiny-swords-assets.ts` is for raw art: callers deal in bank keys, never in paths. That
 * is what lets the game and the lab share one copy of a footstep — neither app can reach the
 * other's `public/`, but both bundle this package.
 *
 * **Vite-only, and deliberately kept out of `bank.ts`.** `import.meta.glob` does not exist under a
 * plain Node test runner, so the bank itself takes urls and knows nothing about where they came
 * from; only this module, which no test imports, depends on the bundler.
 */

/** `undefined` = not looked up yet, `null` = there is no bundler here at all (see `sources`). */
let sourceUrls: Record<string, string> | null | undefined;

/**
 * The bundler's view of `assets/`, resolved once and lazily.
 *
 * Lazily because `import.meta.glob` is a Vite TRANSFORM, not a function: under a plain Node runner
 * it survives as a property access on `import.meta` and throws the moment it is evaluated. Left at
 * module scope, that made merely IMPORTING this file fatal for any Node tool that reached it
 * transitively — `apps/lab`'s `build-map.ts` pulls in the lab's chest, which pulls in its audio,
 * which pulls in this. Nothing in that path ever wanted a url; it just paid for the import.
 */
function sources(): Record<string, string> | null {
  if (sourceUrls !== undefined) return sourceUrls;
  try {
    sourceUrls = import.meta.glob<string>("../assets/*.ogg", {
      eager: true,
      import: "default",
      query: "?url",
    });
  } catch {
    sourceUrls = null;
  }
  return sourceUrls;
}

/**
 * Resolves a shipped sample by file name.
 *
 * Under a bundler this throws for an unknown name rather than returning a broken url: a missing
 * asset is a build mistake, and it should surface at the boundary that can name the file. With no
 * bundler it hands back the plain path instead — a Node tool that reached this module by accident
 * gets something inert rather than a crash, and nothing in that context ever fetches it.
 */
export function audioAssetUrl(name: string): string {
  const urls = sources();
  if (!urls) return `/${name}`;
  const resolved = urls[`../assets/${name}`];
  if (!resolved) throw new Error(`Missing bundled audio asset: ${name}`);
  return resolved;
}

function takes(prefix: string, count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => audioAssetUrl(`${prefix}-${index + 1}.ogg`));
}

/**
 * Every key the movement rule can narrate, and the takes behind it.
 *
 * The counts are not arbitrary. Grass and sand carry five takes because the pack ships five;
 * snow and ice carry three because the studio generated three, and three is already enough once
 * `pickVariant` and the pitch jitter are doing their work. What has ONE take — a jump, a landing,
 * a canopy opening — has one because it happens once per event, not once per stride.
 */
export function movementSampleKeys(): Record<string, readonly string[]> {
  return {
    "step.grass": takes("step-grass", 5),
    "step.sand": takes("step-sand", 5),
    "step.snow": takes("pas-neige", 3),
    "step.ice": takes("pas-glace", 3),
    swim: takes("swim", 4),
    jump: [audioAssetUrl("jump.ogg")],
    land: [audioAssetUrl("land.ogg")],
    "water.enter": [audioAssetUrl("water-in.ogg")],
    "water.leave": [audioAssetUrl("water-out.ogg")],
    "glider.open": [audioAssetUrl("glider-open.ogg")],
  };
}

/** The skid: held, not triggered, so it is not a bank key at all — see `SKID_LOOP`. */
export function skidLoopUrl(): string {
  return audioAssetUrl("glisse.ogg");
}

/** The rain bed: held like the skid, and for the same reason. Weather is a STATE, not an event. */
export function rainLoopUrl(): string {
  return audioAssetUrl("rain-loop.ogg");
}

/**
 * Where `rain-loop.ogg` turns around, ahead of its own end.
 *
 * Two separate reasons, and both are why the file is longer than this number. The seam itself is an
 * equal-power crossfade of the take's tail over its head, so the loop point is a level match rather
 * than a splice; and Opus mangles the last samples of an encoded stream (see `SKID_LOOP_END_SECONDS`
 * for where that was first measured), so the margin past this point is never played.
 */
export const RAIN_LOOP_END_SECONDS = 3.4;

/** The two wooden-door takes first selected for the lab, now shared with building transitions. */
export function doorOpenSampleUrls(): readonly string[] {
  return takes("door-open", 2);
}

/**
 * Where `glisse.ogg` actually turns around.
 *
 * The file carries tail padding past this point on purpose: Opus mangles the last samples of an
 * encoded stream, and looping through them produced a measurable click at the seam. Playback turns
 * around here instead, and the margin is never heard. See `HeldLoopOptions.loopEnd`.
 */
export const SKID_LOOP_END_SECONDS = 1;
