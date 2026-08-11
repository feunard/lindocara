import { createSampleBank } from "@lindocara/audio/bank.js";
import { beforeEach, describe, expect, it } from "vitest";

import { fakeContext, sequence } from "./fake-context.js";

const GRASS = ["/sfx/step-grass-1.ogg", "/sfx/step-grass-2.ogg", "/sfx/step-grass-3.ogg"];

function bytes(size = 400): ArrayBuffer {
  return new ArrayBuffer(size);
}

describe("the sample bank", () => {
  let harness = fakeContext();

  beforeEach(() => {
    harness = fakeContext();
  });

  async function loadedBank(random?: () => number) {
    const bank = createSampleBank({
      context: harness.context,
      ...(random ? { random } : {}),
    });
    bank.define("step.grass", GRASS);
    harness.fake.expectDecode(GRASS);
    await bank.load(bank.sources(), { source: async () => bytes() });
    return bank;
  }

  it("collects every url its keys can reach, so a preloader can weigh the whole bank", async () => {
    const bank = createSampleBank({ context: harness.context });
    bank.define("step.grass", GRASS);
    bank.define("step.snow", ["/sfx/pas-neige-1.ogg", "/sfx/step-grass-1.ogg"]);
    // The shared url appears once: a preloader must not download it twice.
    expect(bank.sources()).toEqual([...GRASS, "/sfx/pas-neige-1.ogg"]);
  });

  it("reports progress across the whole set and decodes each url once", async () => {
    const bank = createSampleBank({ context: harness.context });
    bank.define("step.grass", GRASS);
    const progress: number[] = [];
    let fetched = 0;
    harness.fake.expectDecode(GRASS);
    await bank.load(bank.sources(), {
      onProgress: (value) => progress.push(value),
      source: async () => {
        fetched += 1;
        return bytes();
      },
    });
    expect(fetched).toBe(3);
    expect(progress.at(-1)).toBe(1);
    expect(GRASS.every((url) => bank.decoded(url))).toBe(true);

    // A second load of an already-decoded url must not fetch it again.
    await bank.load(bank.sources(), { source: async () => bytes() });
    expect(fetched).toBe(3);
  });

  it("plays a different take on successive shots", async () => {
    const bank = await loadedBank(sequence([0, 0.5, 0.5, 0.5, 0.99, 0.5]));
    bank.play("step.grass");
    bank.play("step.grass");
    bank.play("step.grass");
    const takes = harness.fake.started.map((source) => source.buffer);
    expect(harness.fake.started).toHaveLength(3);
    expect(new Set(takes).size).toBeGreaterThan(1);
  });

  it("varies pitch and level on every shot, and applies the caller's own gain", async () => {
    const bank = await loadedBank(sequence([0, 1, 1]));
    bank.play("step.grass", { gain: 0.5 });
    const shot = harness.fake.started[0];
    expect(shot?.rate).toBeGreaterThan(1);
    // 0.5 asked for, jittered up: still centred on what the caller wanted.
    expect(shot?.gain).toBeGreaterThan(0.5);
    expect(shot?.gain).toBeLessThan(0.6);
  });

  it("plays a voice exactly as recorded and hands back its duration", async () => {
    const bank = createSampleBank({ context: harness.context, random: sequence([0, 1]) });
    const line = "/voice/grota-1.ogg";
    harness.fake.expectDecode([line]);
    await bank.load([line], { source: async () => bytes(2_400) });

    const playing = bank.playSource(line, { vary: false });
    expect(playing?.duration).toBeCloseTo(2.4, 8);
    const shot = harness.fake.started[0];
    // Untouched: jittering a spoken line is the one thing that must not happen to it.
    expect(shot?.rate).toBe(1);
    expect(shot?.gain).toBe(1);

    playing?.stop();
    expect(shot?.stopped).toBe(true);
  });

  it("stays silent instead of throwing when a sample never decoded", async () => {
    const bank = createSampleBank({ context: harness.context });
    bank.define("step.grass", GRASS);
    harness.fake.undecodable.add(GRASS[1] ?? "");
    harness.fake.expectDecode(GRASS);
    await expect(
      bank.load(bank.sources(), { source: async () => bytes() }),
    ).resolves.toBeUndefined();

    expect(bank.decoded(GRASS[1] ?? "")).toBe(false);
    expect(bank.decoded(GRASS[0] ?? "")).toBe(true);
    // The undecodable take is still IN the key: narrowing the key to what happens to be ready
    // would quietly cost it its variety. It simply plays nothing when it comes up.
    expect(() => bank.play("step.grass")).not.toThrow();
  });

  it("returns null for a key nothing has defined or decoded", async () => {
    const bank = createSampleBank({ context: harness.context });
    expect(bank.play("step.lava")).toBeNull();
    bank.define("step.lava", ["/sfx/lava.ogg"]);
    expect(bank.play("step.lava")).toBeNull();
    expect(bank.loop("/sfx/lava.ogg", {})).toBeNull();
  });

  it("survives a source that fails outright", async () => {
    const bank = createSampleBank({ context: harness.context });
    bank.define("step.grass", GRASS);
    await expect(
      bank.load(bank.sources(), {
        source: async () => {
          throw new Error("network down");
        },
      }),
    ).resolves.toBeUndefined();
    expect(bank.play("step.grass")).toBeNull();
  });
});

describe("a held loop", () => {
  it("loops, ramps towards its level and honours a tail margin", async () => {
    const harness = fakeContext();
    const bank = createSampleBank({ context: harness.context });
    const skid = "/sfx/glisse.ogg";
    harness.fake.expectDecode([skid]);
    await bank.load([skid], { source: async () => new ArrayBuffer(400) });

    const loop = bank.loop(skid, { loopEnd: 1 });
    expect(loop).not.toBeNull();
    const source = harness.fake.started[0];
    expect(source?.loop).toBe(true);
    // Turn around before the region Opus mangles, rather than looping straight through the click.
    expect(source?.loopEnd).toBe(1);
    // Silent until something opens it: a held loop is driven, never merely present.
    expect(source?.gain).toBe(0);

    loop?.setGain(0.6, 0.12);
    expect(harness.fake.ramps.at(-1)).toMatchObject({ target: 0.6, timeConstant: 0.12 });

    // Ramped, never assigned: a gain written outright 60 times a second rasps.
    loop?.setGain(0.2);
    expect(harness.fake.ramps.at(-1)?.target).toBe(0.2);

    loop?.stop();
    expect(source?.stopped).toBe(true);
    expect(source?.disconnected).toBe(true);
    // Stopped is final: a late frame must not resurrect it.
    loop?.setGain(1);
    expect(harness.fake.ramps.at(-1)?.target).toBe(0.2);
  });

  it("clamps a nonsense level to silence rather than passing it to the mixer", async () => {
    const harness = fakeContext();
    const bank = createSampleBank({ context: harness.context });
    const url = "/sfx/fire.ogg";
    harness.fake.expectDecode([url]);
    await bank.load([url], { source: async () => new ArrayBuffer(400) });
    const loop = bank.loop(url, {});
    loop?.setGain(Number.NaN);
    expect(harness.fake.ramps.at(-1)?.target).toBe(0);
    loop?.setGain(-3);
    expect(harness.fake.ramps.at(-1)?.target).toBe(0);
  });
});
