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

const SOURCE_URLS = import.meta.glob<string>("../assets/*.ogg", {
  eager: true,
  import: "default",
  query: "?url",
});

/** Resolves a shipped sample by file name. Throws rather than returning a broken url: a missing
 *  asset is a build mistake, and it should surface at the boundary that can name the file. */
export function audioAssetUrl(name: string): string {
  const resolved = SOURCE_URLS[`../assets/${name}`];
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
    // Repeated for as long as the hero stands on a cracking cell, so it needs variants for the
    // same reason a footstep does. Breaking and plunging happen once per fall and do not.
    "ice.crack": takes("craquement", 3),
    "ice.break": [audioAssetUrl("rupture.ogg")],
    "ice.plunge": [audioAssetUrl("plouf-glace.ogg")],
  };
}

/** The skid: held, not triggered, so it is not a bank key at all — see `SKID_LOOP`. */
export function skidLoopUrl(): string {
  return audioAssetUrl("glisse.ogg");
}

/**
 * Where `glisse.ogg` actually turns around.
 *
 * The file carries tail padding past this point on purpose: Opus mangles the last samples of an
 * encoded stream, and looping through them produced a measurable click at the seam. Playback turns
 * around here instead, and the margin is never heard. See `HeldLoopOptions.loopEnd`.
 */
export const SKID_LOOP_END_SECONDS = 1;
