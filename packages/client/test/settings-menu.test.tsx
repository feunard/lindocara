import { getAudioSettings, setAudioSettings } from "@lindocara/client/game/audio-settings.js";
import { setLocale } from "@lindocara/client/i18n.js";
import { useUiStore } from "@lindocara/client/store.js";
import { SettingsMenu } from "@lindocara/client/ui/SettingsMenu.js";
import { getDisplaySettings, setDisplaySettings } from "@lindocara/renderer/display-settings.js";
import { getInputSettings, resetInputBindings } from "@lindocara/renderer/input-settings.js";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("SettingsMenu", () => {
  beforeEach(() => {
    setLocale("en");
    setAudioSettings({ muted: false, sfxVolume: 0.65, ambientVolume: 0.45 });
    setDisplaySettings({ healthBars: "both", grid: false });
    resetInputBindings();
    useUiStore.setState({ settingsOpen: false, game: null });
  });

  it("chooses allied and enemy health bars independently", async () => {
    useUiStore.setState({ settingsOpen: true });
    render(<SettingsMenu />);
    await userEvent.click(screen.getByRole("tab", { name: "Interface" }));
    await userEvent.selectOptions(screen.getByRole("combobox"), "enemies");
    expect(getDisplaySettings().healthBars).toBe("enemies");
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
    // By name, not by being the only checkbox on the panel — it no longer is.
    await userEvent.click(screen.getByRole("checkbox", { name: "Mute all sounds" }));
    expect(getAudioSettings().muted).toBe(true);
  });

  it("toggles the tile grid without disturbing the other display settings", async () => {
    useUiStore.setState({ settingsOpen: true });
    render(<SettingsMenu />);
    await userEvent.click(screen.getByRole("tab", { name: "Interface" }));
    const grid = screen.getByRole("checkbox", { name: "Show tile grid and hitboxes" });
    expect(grid).not.toBeChecked();

    await userEvent.click(grid);
    expect(getDisplaySettings().grid).toBe(true);
    expect(getDisplaySettings().healthBars).toBe("both");

    await userEvent.click(grid);
    expect(getDisplaySettings().grid).toBe(false);
  });

  it("closes via resume", async () => {
    useUiStore.setState({ settingsOpen: true });
    render(<SettingsMenu inGame />);
    await userEvent.click(screen.getByRole("button", { name: /resume/i }));
    expect(useUiStore.getState().settingsOpen).toBe(false);
  });

  it("keeps remapping behind the controls tab and captures a new key", async () => {
    useUiStore.setState({ settingsOpen: true });
    render(<SettingsMenu />);

    expect(screen.queryByRole("button", { name: "Remap Move up" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Controls" }));
    await userEvent.click(screen.getByRole("button", { name: "Remap Move up" }));
    fireEvent.keyDown(window, { code: "KeyI" });

    expect(getInputSettings().keyboard.moveUp).toEqual([{ code: "KeyI" }]);
    expect(screen.getByRole("button", { name: "Remap Move up" })).toHaveTextContent("I");
  });

  it("shows familiar PS5 button names while preserving physical mappings", async () => {
    useUiStore.setState({ settingsOpen: true });
    render(<SettingsMenu />);

    await userEvent.click(screen.getByRole("tab", { name: "Controls" }));
    await userEvent.click(screen.getByRole("tab", { name: "Controller" }));
    await userEvent.selectOptions(screen.getByLabelText("Button labels"), "playstation");
    await userEvent.click(screen.getByText("Combat & abilities"));

    expect(
      screen.getByRole("button", { name: "Remap Primary attack / ability 1" }),
    ).toHaveTextContent("Cross");
  });

  it("owns the switch-character and logout actions instead of the player frame", async () => {
    const switchCharacter = vi.fn();
    const logout = vi.fn();
    useUiStore.setState({
      settingsOpen: true,
      game: {
        attack: vi.fn(),
        interact: vi.fn(),
        usePotion: vi.fn(),
        release: vi.fn(),
        castSkill: vi.fn(),
        sendChat: vi.fn(),
        switchCharacter,
        logout,
        attachMinimap: vi.fn(),
        attachWorldMap: vi.fn(),
      },
    });
    render(<SettingsMenu inGame />);
    await userEvent.click(screen.getByRole("button", { name: "Return to saves" }));
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(switchCharacter).toHaveBeenCalledOnce();
    expect(logout).toHaveBeenCalledOnce();
  });
});
