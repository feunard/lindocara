import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADVENTURE_AUDIO,
  parseAdventureAudioConfig,
  parseMapAudioConfig,
  resolveMapAudio,
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
      music: "plain-1",
      ambience: "swamp-ambience",
      combatMusic: "boss-1",
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
      music: null,
      ambience: null,
      combatMusic: "boss-1",
    });
  });
});
