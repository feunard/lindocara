import { GameSound } from "@lindocara/client/game/sound.js";
import { afterEach, describe, expect, it, vi } from "vitest";

class FakeAudio {
  static created: FakeAudio[] = [];
  readonly src: string;
  loop = false;
  preload = "";
  volume = 1;
  currentTime = 0;
  paused = true;
  playCalls = 0;

  constructor(src: string) {
    this.src = src;
    FakeAudio.created.push(this);
  }

  play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }
}

class FakeAudioContext {
  state: AudioContextState = "running";

  resume(): Promise<void> {
    return Promise.resolve();
  }
}

describe("GameSound authored scene audio", () => {
  afterEach(() => {
    FakeAudio.created = [];
    vi.unstubAllGlobals();
  });

  it("crossfades from authoritative threat and resumes exploration at its retained position", () => {
    vi.stubGlobal("Audio", FakeAudio);
    let now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const sound = new GameSound();
    sound.configureScene({
      music: "town-theme",
      ambience: "swamp-ambience",
      combatMusic: "battle-theme",
    });

    expect(FakeAudio.created.map((audio) => audio.src)).toEqual([
      "/assets/lindocara/audio/town-theme.mp3",
      "/assets/lindocara/audio/swamp-ambience.ogg",
    ]);

    const exploration = FakeAudio.created[0];
    if (!exploration) throw new Error("missing exploration channel");
    exploration.currentTime = 37;

    sound.setCombatThreatened(true);
    const combat = FakeAudio.created.at(-1);
    expect(combat?.src).toBe("/assets/lindocara/audio/battle-theme.mp3");

    now += 650;
    sound.update(now);
    expect(exploration.volume).toBe(0);
    expect(combat?.volume).toBeCloseTo(0.144);

    now += 100;
    sound.setCombatThreatened(false);
    now += 500;
    sound.update(now);
    now += 650;
    sound.update(now);

    expect(FakeAudio.created[0]).toBe(exploration);
    expect(exploration.currentTime).toBe(37);
    expect(exploration.volume).toBeCloseTo(0.144);
    expect(combat?.volume).toBe(0);
    expect(combat?.currentTime).toBe(0);

    sound.setCombatThreatened(true);
    now += 650;
    sound.update(now);

    expect(FakeAudio.created.at(-1)).toBe(combat);
    expect(combat?.currentTime).toBe(0);
    expect(combat?.volume).toBeCloseTo(0.144);
  });

  it("preserves one active combat playback across movement and direction changes", () => {
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("sample loading disabled"))),
    );
    let now = 2_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const sound = new GameSound();
    sound.configureScene({
      music: "town-theme",
      ambience: null,
      combatMusic: "battle-theme",
    });
    sound.unlock();
    sound.setCombatThreatened(true);
    now += 650;
    sound.update(now);

    const combat = FakeAudio.created.find((audio) => audio.src.endsWith("battle-theme.mp3"));
    if (!combat) throw new Error("missing combat channel");
    combat.currentTime = 19;
    const starts = combat.playCalls;

    // `session.ts` routes every movement keydown through `unlock()`, including key repeat and
    // direction changes. Repeated gestures must only confirm that playback is available.
    sound.unlock();
    sound.unlock();
    sound.unlock();

    expect(FakeAudio.created.filter((audio) => audio.src.endsWith("battle-theme.mp3"))).toEqual([
      combat,
    ]);
    expect(combat.currentTime).toBe(19);
    expect(combat.playCalls).toBe(starts);
  });

  it("treats an identical scene configuration as an idempotent confirmation", () => {
    vi.stubGlobal("Audio", FakeAudio);
    let now = 2_500;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const sound = new GameSound();
    const scene = {
      music: "town-theme",
      ambience: null,
      combatMusic: "battle-theme",
    } as const;
    sound.configureScene(scene);
    sound.setCombatThreatened(true);
    now += 650;
    sound.update(now);

    const combat = FakeAudio.created.at(-1);
    if (!combat) throw new Error("missing combat channel");
    combat.currentTime = 23;

    sound.configureScene({ ...scene });
    now += 1_000;
    sound.update(now);

    expect(FakeAudio.created.at(-1)).toBe(combat);
    expect(combat.currentTime).toBe(23);
    expect(combat.volume).toBeCloseTo(0.144);
  });

  it("ignores a transient missing threat snapshot while combat is still active", () => {
    vi.stubGlobal("Audio", FakeAudio);
    let now = 3_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const sound = new GameSound();
    sound.configureScene({
      music: "town-theme",
      ambience: null,
      combatMusic: "battle-theme",
    });

    const exploration = FakeAudio.created[0];
    if (!exploration) throw new Error("missing exploration channel");
    sound.setCombatThreatened(true);
    now += 650;
    sound.update(now);
    const combat = FakeAudio.created.at(-1);
    expect(exploration.volume).toBe(0);
    if (!combat) throw new Error("missing combat channel");
    combat.currentTime = 12;

    sound.setCombatThreatened(false);
    now += 250;
    sound.update(now);
    sound.setCombatThreatened(true);
    now += 1_000;
    sound.update(now);

    expect(exploration.volume).toBe(0);
    expect(combat.volume).toBeCloseTo(0.144);
    expect(combat.currentTime).toBe(12);
  });

  it("keeps attack activity as a fallback when no aggro snapshot has arrived yet", () => {
    vi.stubGlobal("Audio", FakeAudio);
    let now = 5_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const sound = new GameSound();
    sound.configureScene({
      music: "town-theme",
      ambience: null,
      combatMusic: "battle-theme",
    });

    sound.combatPulse();
    expect(FakeAudio.created.at(-1)?.src).toBe("/assets/lindocara/audio/battle-theme.mp3");
    now += 8_001;
    sound.update(now);
    now += 650;
    sound.update(now);
    expect(FakeAudio.created[0]?.volume).toBeCloseTo(0.144);
  });

  it("keeps a fresh attack pulse after the server releases its last threat", () => {
    vi.stubGlobal("Audio", FakeAudio);
    let now = 10_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const sound = new GameSound();
    sound.configureScene({
      music: "town-theme",
      ambience: null,
      combatMusic: "battle-theme",
    });

    sound.setCombatThreatened(true);
    now += 650;
    sound.update(now);
    sound.setCombatThreatened(false);
    sound.combatPulse();
    now += 501;
    sound.update(now);

    expect(FakeAudio.created[0]?.volume).toBe(0);
    expect(FakeAudio.created.at(-1)?.volume).toBeCloseTo(0.144);
  });

  it("starts and stops the generated guardian warning without duplicating its loop", () => {
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("sample loading disabled"))),
    );
    const sound = new GameSound();
    sound.unlock();

    sound.setSeaGuardianNearby(true);
    sound.setSeaGuardianNearby(true);
    const warnings = FakeAudio.created.filter((audio) =>
      audio.src.endsWith("sea-guardian-near.wav"),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ loop: true, paused: false });

    sound.setSeaGuardianNearby(false);
    expect(warnings[0]?.paused).toBe(true);
  });
});
