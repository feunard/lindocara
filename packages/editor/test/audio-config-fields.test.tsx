import { setLocale } from "@lindocara/client/i18n.js";
import { AudioConfigFields } from "@lindocara/editor/ui/editor/AudioConfigFields.js";
import {
  DEFAULT_ADVENTURE_AUDIO,
  musicTracksForProfile,
  uploadedMusicTrack,
} from "@lindocara/engine/audio-catalog.js";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeAudio {
  static created: FakeAudio[] = [];

  src: string;
  preload = "";
  paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(src = "") {
    this.src = src;
    FakeAudio.created.push(this);
  }

  play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });

  pause = vi.fn(() => {
    this.paused = true;
  });
}

describe("AudioConfigFields", () => {
  beforeEach(() => {
    setLocale("en");
    FakeAudio.created = [];
    vi.stubGlobal("Audio", FakeAudio);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plays and pauses an explicitly selected map track", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <AudioConfigFields variant="map" value={{ music: "plain-1" }} onChange={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: /Listen Sunlit Plain/i }));
    expect(FakeAudio.created).toHaveLength(1);
    const audio = FakeAudio.created[0];
    expect(audio?.src).toBe("/assets/lindocara/audio/plain_1.mp3");
    expect(audio?.play).toHaveBeenCalledOnce();
    expect(audio?.paused).toBe(false);

    await user.click(screen.getByRole("button", { name: /Pause Sunlit Plain/i }));
    expect(audio?.pause).toHaveBeenCalledOnce();
    expect(audio?.paused).toBe(true);

    await user.click(screen.getByRole("button", { name: /Listen Sunlit Plain/i }));
    expect(FakeAudio.created).toHaveLength(1);
    expect(audio?.play).toHaveBeenCalledTimes(2);

    rerender(<AudioConfigFields variant="map" value={{ music: "forest-1" }} onChange={vi.fn()} />);
    await waitFor(() => expect(audio?.pause).toHaveBeenCalledTimes(2));
  });

  it("previews the first resolved track for a dynamic adventure profile", async () => {
    const user = userEvent.setup();
    const expected = musicTracksForProfile(DEFAULT_ADVENTURE_AUDIO.explorationProfile)[0];
    if (!expected) throw new Error("missing default exploration music");

    render(
      <AudioConfigFields variant="adventure" value={DEFAULT_ADVENTURE_AUDIO} onChange={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: /Listen Main Exploration/i }));
    expect(FakeAudio.created).toHaveLength(1);
    expect(FakeAudio.created[0]?.src).toBe(expected.src);
  });

  it("offers and previews an uploaded sound on old and new map configurations", async () => {
    const uploaded = uploadedMusicTrack(
      "0198d55c-5b67-7000-8000-000000000001~0198d55c-5b67-7000-8000-000000000002~Q291cnNlIGR1IHRvaXQ.ogg",
      "Course du toit",
      "Mira",
    );
    if (!uploaded) throw new Error("invalid uploaded sound fixture");

    const user = userEvent.setup();
    render(
      <AudioConfigFields
        variant="map"
        value={{ music: uploaded.id }}
        uploadedTracks={[uploaded]}
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Listen Course du toit/i }));
    expect(FakeAudio.created[0]?.src).toBe(uploaded.src);
  });
});
