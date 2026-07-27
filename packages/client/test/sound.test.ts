import { GameSound } from "@lindocara/client/game/sound.js";
import { afterEach, describe, expect, it, vi } from "vitest";

class FakeAudio {
  static created: FakeAudio[] = [];
  readonly src: string;
  loop = false;
  preload = "";
  volume = 1;
  currentTime = 0;
  paused = false;

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

  it("loads exploration and ambience channels, then restores exploration after combat", () => {
    vi.stubGlobal("Audio", FakeAudio);
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

    const now = performance.now();
    sound.combatPulse();
    expect(FakeAudio.created.at(-1)?.src).toBe("/assets/lindocara/audio/battle-theme.mp3");

    sound.update(now + 9_000);
    expect(FakeAudio.created.at(-1)?.src).toBe("/assets/lindocara/audio/town-theme.mp3");
  });
});
