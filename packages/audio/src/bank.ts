/**
 * The shared sample bank: decoded audio held once, played back with the variation that keeps a
 * small bank from sounding small.
 *
 * This is the primitive extracted from `apps/lab/src/core/audio.ts`, which is where it was built
 * and tuned. What did NOT come with it is that file's POLICY — zone music, the day/night ambience
 * crossfade, scheduling, the ten-second wait before the first note. Those differ between the lab
 * and the game for real reasons, and a shared abstraction over both would serve neither. What is
 * shared is exactly this: hold buffers, pick a take, jitter it, and hold a loop open.
 *
 * **No module-level mutable state**, the same rule `@lindocara/hd2d` follows: every bank owns its
 * own context, buffers and destination, because the lab opens one and the game opens another.
 */

import { createHeldLoop, type HeldLoop, type HeldLoopOptions } from "./held-loop.js";
import { jitterGain, jitterRate, pickVariant } from "./variation.js";

export interface SampleBankOptions {
  context: BaseAudioContext;
  /** Everything the bank plays goes here. Defaults to the context's own output. */
  destination?: AudioNode;
  /** Injected so a test can pin which take is chosen and what it is jittered to. */
  random?: () => number;
}

export interface PlayOptions {
  /** Level, before jitter. 1 is the sample as recorded. */
  gain?: number;
  /** Deliberate transposition, before jitter — an annoyed sheep, a wooden tick lifted out of a
   *  footstep. Multiplied by the jitter rather than replaced by it. */
  rate?: number;
  /**
   * `false` plays the take exactly as recorded.
   *
   * Reserved for a voice: jittering a spoken line is precisely what must not happen to it, and it
   * is why the lab routed its NPC takes around `jouer()` rather than through it.
   */
  vary?: boolean;
}

/** A sample that is playing, for the callers that need to interrupt or time it. */
export interface PlayingSample {
  /** Seconds, as recorded — the banner paces its typewriter off this. */
  readonly duration: number;
  stop(): void;
}

export interface SampleBank {
  /** Names a key and the takes it may draw from. Re-defining a key replaces its takes. */
  define(key: string, urls: readonly string[]): void;
  /** Every url any defined key can reach — what a preloader has to fetch, and what weighs a
   *  loading screen. */
  sources(): readonly string[];
  /** Whether a url has been decoded and can actually be heard. */
  decoded(url: string): boolean;
  /**
   * Fetches and decodes. Never rejects and never throws for one bad url: a missing sound must not
   * take a scene down with it, so it simply stays silent (the caller can see that through
   * `decoded`). `onProgress` reports 0..1 over the whole set.
   */
  load(urls: readonly string[], options?: LoadOptions): Promise<void>;
  /** Plays one take of `key`, or `null` when nothing under that key is decoded yet. */
  play(key: string, options?: PlayOptions): PlayingSample | null;
  /** Plays one exact url — for a key whose takes are not interchangeable, such as a voice. */
  playSource(url: string, options?: PlayOptions): PlayingSample | null;
  /** Opens a held loop on an already-decoded url, or `null` if it is not decoded. */
  loop(url: string, options: Omit<HeldLoopOptions, "destination">): HeldLoop | null;
}

export interface LoadOptions {
  onProgress?: (progress: number) => void;
  /**
   * Where the bytes come from. Defaults to `fetch`.
   *
   * The lab overrides it: its loading screen has already downloaded every asset as a blob, and
   * fetching them a second time to decode them would download the whole bank twice.
   */
  source?: (url: string) => Promise<ArrayBuffer | Blob | undefined>;
}

async function fetchSource(url: string): Promise<ArrayBuffer | undefined> {
  const response = await fetch(url);
  if (!response.ok) return undefined;
  return response.arrayBuffer();
}

export function createSampleBank(options: SampleBankOptions): SampleBank {
  const { context } = options;
  const destination = options.destination ?? context.destination;
  const random = options.random ?? Math.random;
  const buffers = new Map<string, AudioBuffer>();
  const keys = new Map<string, readonly string[]>();

  function start(url: string, play: PlayOptions): PlayingSample | null {
    const buffer = buffers.get(url);
    if (!buffer) return null;
    const vary = play.vary ?? true;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = vary ? jitterRate(play.rate ?? 1, random) : (play.rate ?? 1);
    const gain = context.createGain();
    gain.gain.value = vary ? jitterGain(play.gain ?? 1, random) : (play.gain ?? 1);
    source.connect(gain);
    gain.connect(destination);
    source.start();
    let stopped = false;
    return {
      duration: buffer.duration,
      stop() {
        if (stopped) return;
        stopped = true;
        try {
          source.stop();
        } catch {
          /* already ended */
        }
      },
    };
  }

  return {
    define(key, urls) {
      keys.set(key, [...urls]);
    },
    sources() {
      return [...new Set([...keys.values()].flat())];
    },
    decoded(url) {
      return buffers.has(url);
    },
    async load(urls, loadOptions = {}) {
      const source = loadOptions.source ?? fetchSource;
      const unique = [...new Set(urls)];
      let done = 0;
      const step = (): void => {
        done += 1;
        loadOptions.onProgress?.(unique.length === 0 ? 1 : done / unique.length);
      };
      await Promise.all(
        unique.map(async (url) => {
          if (buffers.has(url)) {
            step();
            return;
          }
          try {
            const data = await source(url);
            if (data) {
              const bytes = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
              buffers.set(url, await context.decodeAudioData(bytes));
            }
          } catch {
            /* a missing or undecodable sound must not take the scene down with it */
          }
          step();
        }),
      );
    },
    play(key, playOptions = {}) {
      const takes = keys.get(key);
      if (!takes || takes.length === 0) return null;
      // The variant is chosen among the DEFINED takes, then checked for a buffer — not chosen among
      // the decoded ones. Silently narrowing to what happens to be ready would make a key quietly
      // lose its variety while a slow decode is in flight, which is the one thing this bank exists
      // to prevent.
      const url = takes[pickVariant(takes.length, random)];
      return url === undefined ? null : start(url, playOptions);
    },
    playSource(url, playOptions = {}) {
      return start(url, playOptions);
    },
    loop(url, loopOptions) {
      const buffer = buffers.get(url);
      if (!buffer) return null;
      return createHeldLoop(context, buffer, { ...loopOptions, destination });
    },
  };
}
