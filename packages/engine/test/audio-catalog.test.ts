import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADVENTURE_AUDIO,
  parseAdventureAudioConfig,
  parseMapAudioConfig,
  resolveMapAudio,
  selectMusicSituation,
} from "../src/audio-catalog.js";

describe("authored audio catalogue", () => {
  it("accepts catalogue ids and rejects arbitrary asset URLs", () => {
    expect(
      parseAdventureAudioConfig({
        music: "plain-1",
        ambience: "swamp-ambience",
        combatMusic: "boss-1",
      }),
    ).toEqual({
      ...DEFAULT_ADVENTURE_AUDIO,
      music: "plain-1",
      ambience: "swamp-ambience",
      combatMusic: "boss-1",
      explorationProfile: null,
      combatProfile: null,
    });
    expect(
      parseAdventureAudioConfig({
        music: "https://example.com/untrusted.mp3",
        ambience: null,
        combatMusic: null,
      }),
    ).toBeNull();
  });

  it("distinguishes map inheritance from an explicit silent override", () => {
    const overrides = parseMapAudioConfig({
      ambience: null,
      combatMusic: "boss-1",
    });
    expect(overrides).not.toBeNull();
    expect(resolveMapAudio(DEFAULT_ADVENTURE_AUDIO, overrides ?? {})).toEqual({
      ...DEFAULT_ADVENTURE_AUDIO,
      ambience: null,
      combatMusic: "boss-1",
      dangerProfile: null,
      combatProfile: null,
      bossProfile: null,
    });
  });

  it("selects dynamic music from one centralized priority", () => {
    const calmNight = {
      nightWeight: 0.8,
      discovery: false,
      danger: false,
      combat: false,
      boss: false,
    };
    expect(selectMusicSituation(calmNight)).toBe("night");
    expect(selectMusicSituation({ ...calmNight, discovery: true })).toBe("discovery");
    expect(selectMusicSituation({ ...calmNight, discovery: true, danger: true })).toBe("danger");
    expect(selectMusicSituation({ ...calmNight, danger: true, combat: true })).toBe("combat");
    expect(selectMusicSituation({ ...calmNight, combat: true, boss: true })).toBe("boss");
  });

  it("validates profile ids while keeping omitted map fields inheritable", () => {
    expect(parseMapAudioConfig({ explorationProfile: "snow", nightProfile: null })).toEqual({
      explorationProfile: "snow",
      nightProfile: null,
    });
    expect(parseMapAudioConfig({ dangerProfile: "unknown-profile" })).toBeNull();
  });
});
