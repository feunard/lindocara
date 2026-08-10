import { DynamicMusicPlayer } from "@lindocara/client/game/dynamic-music.js";
import {
  DEFAULT_ADVENTURE_AUDIO,
  musicTracksForSituation,
} from "@lindocara/engine/audio-catalog.js";
import { afterEach, describe, expect, it, vi } from "vitest";

class FakeAudio {
  static created: FakeAudio[] = [];
  readonly src: string;
  duration = 140;
  currentTime = 0;
  loop = false;
  preload = "";
  volume = 1;
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

const CALM = {
  nightWeight: 0,
  discovery: false,
  danger: false,
  combat: false,
  boss: false,
};

describe("DynamicMusicPlayer", () => {
  afterEach(() => {
    FakeAudio.created = [];
    vi.unstubAllGlobals();
  });

  it("crossfades playlist seams and follows the centralized situation priority", () => {
    vi.stubGlobal("Audio", FakeAudio);
    const player = new DynamicMusicPlayer(
      DEFAULT_ADVENTURE_AUDIO,
      () => 0.32,
      () => true,
    );
    const exploration = musicTracksForSituation(DEFAULT_ADVENTURE_AUDIO, "exploration");
    const danger = musicTracksForSituation(DEFAULT_ADVENTURE_AUDIO, "danger");
    const combat = musicTracksForSituation(DEFAULT_ADVENTURE_AUDIO, "combat");
    if (!exploration[0] || !danger[0] || !combat[0]) throw new Error("missing default music");

    player.start(0);
    player.update(3_500);
    const first = FakeAudio.created[0];
    expect(first?.src).toBe(exploration[0].src);
    expect(first?.volume).toBeCloseTo(0.32);

    if (!first) throw new Error("missing first exploration deck");
    first.currentTime = 137;
    player.update(4_000);
    const second = FakeAudio.created.at(-1);
    expect(second?.src).toBe((exploration[1] ?? exploration[0]).src);
    player.update(7_500);
    expect(second?.volume).toBeCloseTo(0.32);
    expect(first).toMatchObject({ currentTime: 0, paused: true, volume: 0 });

    player.setState({ ...CALM, danger: true }, 8_000);
    expect(FakeAudio.created.at(-1)?.src).toBe(danger[0].src);
    player.update(9_800);
    expect(player.activeSituation).toBe("danger");

    player.setState({ ...CALM, danger: true, combat: true }, 10_000);
    expect(FakeAudio.created.at(-1)?.src).toBe(combat[0].src);
    player.update(10_650);
    expect(player.activeSituation).toBe("combat");

    player.setState({ ...CALM, danger: true, combat: true, boss: true }, 11_000);
    expect(player.activeSituation).toBe("boss");

    player.stop();
    expect(player.activeSituation).toBe("exploration");
    expect(FakeAudio.created.every((audio) => audio.paused)).toBe(true);
  });
});
