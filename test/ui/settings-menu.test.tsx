import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { getAudioSettings, setAudioSettings } from "../../src/client/game/audio-settings.js";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { SettingsMenu } from "../../src/client/ui/SettingsMenu.js";

describe("SettingsMenu", () => {
  beforeEach(() => {
    setLocale("en");
    setAudioSettings({ muted: false, sfxVolume: 0.65, ambientVolume: 0.45 });
    useUiStore.setState({ settingsOpen: false });
  });

  it("renders nothing when closed", () => {
    const { container } = render(<SettingsMenu />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows audio controls and toggles mute", async () => {
    useUiStore.setState({ settingsOpen: true });
    render(<SettingsMenu />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(getAudioSettings().muted).toBe(true);
  });

  it("closes via resume", async () => {
    useUiStore.setState({ settingsOpen: true });
    render(<SettingsMenu />);
    await userEvent.click(screen.getByRole("button", { name: /resume/i }));
    expect(useUiStore.getState().settingsOpen).toBe(false);
  });
});
