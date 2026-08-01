import { SessionCombatAudio } from "@lindocara/client/game/session-combat-audio.js";
import { GameSound } from "@lindocara/client/game/sound.js";
import type { EventCode } from "@lindocara/engine/protocol.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("session combat audio", () => {
  let now = 1_000;

  beforeEach(() => {
    now = 1_000;
    vi.stubGlobal("Audio", FakeAudio);
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    FakeAudio.created = [];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function harness() {
    const sound = new GameSound();
    sound.configureScene({
      music: "town-theme",
      ambience: null,
      combatMusic: "battle-theme",
    });
    const connection = { attack: vi.fn() };
    return {
      sound,
      connection,
      session: new SessionCombatAudio(sound, () => connection),
    };
  }

  it("sends an empty-space attack intent without starting combat music", () => {
    const { connection, session } = harness();

    session.attack();

    expect(connection.attack).toHaveBeenCalledOnce();
    expect(FakeAudio.created.map((audio) => audio.src)).toEqual([
      "/assets/lindocara/audio/town-theme.mp3",
    ]);
  });

  it("starts combat music from an authoritative living threat", () => {
    const { session } = harness();

    session.setServerThreat([{ dead: false, threatening: true }]);

    const combat = FakeAudio.created.at(-1);
    if (!combat) throw new Error("missing combat channel");
    combat.currentTime = 7;
    session.setServerThreat([{ dead: false, threatening: true }]);
    session.setServerThreat([
      { dead: true, threatening: true },
      { dead: false, threatening: true },
    ]);

    expect(combat.src).toBe("/assets/lindocara/audio/battle-theme.mp3");
    expect(FakeAudio.created.at(-1)).toBe(combat);
    expect(combat.currentTime).toBe(7);
  });

  it.each([
    "combat.hit",
    "combat.hurt",
  ] satisfies EventCode[])("starts combat music from the confirmed %s event", (code) => {
    const { session } = harness();

    session.confirmedEvent(code);

    expect(FakeAudio.created.at(-1)?.src).toBe("/assets/lindocara/audio/battle-theme.mp3");
  });

  it("absorbs a transient missing threat and returns to retained exploration after a real end", () => {
    const { session, sound } = harness();
    const exploration = FakeAudio.created[0];
    if (!exploration) throw new Error("missing exploration channel");
    exploration.currentTime = 37;

    session.setServerThreat([{ dead: false, threatening: true }]);
    now += 650;
    sound.update(now);
    const combat = FakeAudio.created.at(-1);
    if (!combat) throw new Error("missing combat channel");
    combat.currentTime = 12;
    expect(exploration.volume).toBe(0);

    session.setServerThreat([]);
    now += 250;
    sound.update(now);
    session.setServerThreat([{ dead: false, threatening: true }]);
    now += 1_000;
    sound.update(now);

    expect(exploration.volume).toBe(0);
    expect(combat.currentTime).toBe(12);

    session.setServerThreat([]);
    now += 501;
    sound.update(now);
    now += 650;
    sound.update(now);

    expect(exploration.currentTime).toBe(37);
    expect(exploration.volume).toBeGreaterThan(0);
    expect(combat.volume).toBe(0);
    expect(combat.currentTime).toBe(0);
  });
});
