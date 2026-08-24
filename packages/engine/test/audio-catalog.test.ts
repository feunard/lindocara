import { describe, expect, it } from "vitest";

import {
  DEFAULT_ADVENTURE_AUDIO,
  isMusicTrackId,
  musicTrack,
  parseAdventureAudioConfig,
  parseMapAudioConfig,
  resolveMapAudio,
  selectMusicSituation,
  uploadedMusicTrack,
} from "../src/audio-catalog.js";

const UPLOADED_FILE_ID =
  "0198d55c-5b67-7000-8000-000000000001~0198d55c-5b67-7000-8000-000000000002~Q291cnNlIGR1IHRvaXQ.ogg";
const UPLOADED_TRACK_ID = `uploaded:${UPLOADED_FILE_ID}` as const;

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

  it("accepts a bounded uploaded map sound id and resolves its authenticated stream", () => {
    expect(isMusicTrackId(UPLOADED_TRACK_ID)).toBe(true);
    expect(parseMapAudioConfig({ music: UPLOADED_TRACK_ID })).toEqual({
      music: UPLOADED_TRACK_ID,
    });
    expect(musicTrack(UPLOADED_TRACK_ID)).toMatchObject({
      id: UPLOADED_TRACK_ID,
      src: `/api/map-sounds/${encodeURIComponent(UPLOADED_FILE_ID)}/content`,
      loopable: true,
    });
    expect(uploadedMusicTrack(UPLOADED_FILE_ID, "Course du toit", "Mira")).toMatchObject({
      title: "Course du toit",
      author: "Mira",
    });
    expect(isMusicTrackId("uploaded:../../secret.ogg")).toBe(false);
    expect(parseMapAudioConfig({ music: "uploaded:not-a-file.mp3" })).toBeNull();
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
