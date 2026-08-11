/**
 * A sound that is HELD, not triggered: wind, a fire, a hero skidding on ice.
 *
 * The distinction is the whole reason this type exists beside the one-shot bank. A skid is not a
 * series of skid noises — it is one continuous sound whose level tracks how badly the hero is
 * sliding, updated every animation frame. Re-triggering a sample at 60 Hz gives a machine-gun
 * stutter; ramping a gain gives a sound that swells and dies.
 */

export interface HeldLoopOptions {
  /** Where the loop plays back to. */
  destination: AudioNode;
  /**
   * Where to jump back to the start, in seconds, when the file carries tail padding past its real
   * loop point.
   *
   * Opus perceptibly mangles the last samples of an encoded stream — its transform window has no
   * context beyond the end of the file — and looping straight through that produced a measurable
   * click at the seam (up to 36x the signal's normal sample-to-sample step, in the lab's
   * measurements). Files exported with a margin declare it here so playback turns around BEFORE the
   * damaged region, which is then never heard. Files without a margin leave this undefined and loop
   * over their whole duration.
   */
  loopEnd?: number;
  /** Level to start at. Defaults to silence, which is what every gain-driven loop wants. */
  gain?: number;
}

export interface HeldLoop {
  /**
   * Moves the level towards `value`, reaching it over roughly `timeConstant` seconds.
   *
   * Always a ramp, never an assignment: this is called once per frame by things like a skid, and
   * setting the gain outright 60 times a second is audible as a rasp rather than as a swell.
   */
  setGain(value: number, timeConstant?: number): void;
  /** Stops the loop and releases its nodes. The loop cannot be restarted. */
  stop(): void;
}

/** The default smoothing. Long enough to hide the per-frame steps, short enough to feel reactive. */
const DEFAULT_TIME_CONSTANT = 0.1;

export function createHeldLoop(
  context: BaseAudioContext,
  buffer: AudioBuffer,
  options: HeldLoopOptions,
): HeldLoop {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  if (options.loopEnd !== undefined && options.loopEnd > 0) source.loopEnd = options.loopEnd;

  const gain = context.createGain();
  gain.gain.value = Math.max(0, options.gain ?? 0);
  source.connect(gain);
  gain.connect(options.destination);
  source.start();

  let stopped = false;
  return {
    setGain(value, timeConstant = DEFAULT_TIME_CONSTANT) {
      if (stopped) return;
      const target = Number.isFinite(value) ? Math.max(0, value) : 0;
      const constant = Number.isFinite(timeConstant) && timeConstant > 0 ? timeConstant : 0.001;
      gain.gain.setTargetAtTime(target, context.currentTime, constant);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      // A source that already ended throws on `stop()`. Nothing here can tell the difference and
      // nothing needs to: the intent is "be silent and release", and it already is.
      try {
        source.stop();
      } catch {
        /* already ended */
      }
      source.disconnect();
      gain.disconnect();
    },
  };
}
