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

  constructor(src: string) {
    this.src = src;
    FakeAudio.created.push(this);
  }

  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
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
    now += 650;
    sound.update(now);

    expect(FakeAudio.created[0]).toBe(exploration);
    expect(exploration.currentTime).toBe(37);
    expect(exploration.volume).toBeCloseTo(0.144);
    expect(combat?.volume).toBe(0);
    expect(combat?.currentTime).toBe(0);
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
});
