/**
 * The smallest WebAudio surface this package actually touches.
 *
 * Hand-rolled rather than mocked: it RECORDS what reached it — every source started, at what rate,
 * at what gain — so a test can assert the thing that matters (the ear heard two different takes)
 * instead of asserting that a function was called.
 */

export interface StartedSource {
  buffer: AudioBuffer | null;
  rate: number;
  gain: number;
  loop: boolean;
  loopEnd: number;
  stopped: boolean;
  disconnected: boolean;
}

export interface GainRamp {
  target: number;
  at: number;
  timeConstant: number;
}

export class FakeAudioContext {
  currentTime = 0;
  readonly destination = { kind: "destination" } as unknown as AudioNode;
  readonly started: StartedSource[] = [];
  readonly ramps: GainRamp[] = [];
  /** Urls whose bytes must fail to decode, to prove a bad sample stays silent instead of throwing. */
  readonly undecodable = new Set<string>();
  #decoding: string[] = [];

  /** Names which url the next `decodeAudioData` call corresponds to. The real API takes only bytes,
   *  so the test declares the mapping instead of the fake guessing it. */
  expectDecode(urls: readonly string[]): void {
    this.#decoding = [...urls];
  }

  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> {
    const url = this.#decoding.shift();
    if (url !== undefined && this.undecodable.has(url)) {
      return Promise.reject(new Error(`undecodable: ${url}`));
    }
    return Promise.resolve({
      duration: bytes.byteLength / 1_000,
      length: bytes.byteLength,
      numberOfChannels: 1,
      sampleRate: 48_000,
    } as AudioBuffer);
  }

  createBufferSource(): AudioBufferSourceNode {
    const record: StartedSource = {
      buffer: null,
      rate: 1,
      gain: Number.NaN,
      loop: false,
      loopEnd: 0,
      stopped: false,
      disconnected: false,
    };
    const node = {
      set buffer(value: AudioBuffer | null) {
        record.buffer = value;
      },
      get buffer() {
        return record.buffer;
      },
      set loop(value: boolean) {
        record.loop = value;
      },
      get loop() {
        return record.loop;
      },
      set loopEnd(value: number) {
        record.loopEnd = value;
      },
      get loopEnd() {
        return record.loopEnd;
      },
      playbackRate: {
        set value(v: number) {
          record.rate = v;
        },
        get value() {
          return record.rate;
        },
      },
      connect: (target: unknown) => {
        // The gain node this source is wired into carries the level; reading it back here is what
        // lets a test see the two together as one shot rather than as two unrelated nodes.
        const gain = target as { __record?: { gain: number } };
        if (gain.__record) record.gain = gain.__record.gain;
        return target;
      },
      start: () => {
        this.started.push(record);
      },
      stop: () => {
        record.stopped = true;
      },
      disconnect: () => {
        record.disconnected = true;
      },
    };
    return node as unknown as AudioBufferSourceNode;
  }

  createGain(): GainNode {
    const record = { gain: 1 };
    const ramps = this.ramps;
    const node = {
      __record: record,
      gain: {
        set value(v: number) {
          record.gain = v;
        },
        get value() {
          return record.gain;
        },
        setTargetAtTime: (target: number, at: number, timeConstant: number) => {
          record.gain = target;
          ramps.push({ target, at, timeConstant });
        },
      },
      connect: (target: unknown) => target,
      disconnect: () => undefined,
    };
    return node as unknown as GainNode;
  }
}

export function fakeContext(): { context: BaseAudioContext; fake: FakeAudioContext } {
  const fake = new FakeAudioContext();
  return { context: fake as unknown as BaseAudioContext, fake };
}

/** A deterministic stand-in for `Math.random`, cycling through the values a test cares about. */
export function sequence(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length] ?? 0;
    index += 1;
    return value;
  };
}
