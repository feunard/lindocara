import { getAudioSettings, setAudioSettings } from "@lindocara/client/game/audio-settings.js";
import { currentLocale, setLocale } from "@lindocara/client/i18n.js";
import {
  cancelHudLayoutEdit,
  isHudLayoutEditing,
  reloadHudLayout,
} from "@lindocara/client/state/hud-layout.js";
import { useUiStore } from "@lindocara/client/store.js";
import { SettingsMenu } from "@lindocara/client/ui/SettingsMenu.js";
import { getCameraSettings, setCameraSettings } from "@lindocara/renderer/camera-settings.js";
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
    setCameraSettings({
      followSpeed: 1,
      horizontalSensitivity: 1,
      verticalSensitivity: 1,
    });
    resetInputBindings();
    localStorage.clear();
    reloadHudLayout();
    useUiStore.setState({ settingsOpen: false, game: null });
  });

  it("chooses allied and enemy health bars independently", async () => {
    useUiStore.setState({ settingsOpen: true });
    render(<SettingsMenu />);
    await userEvent.click(screen.getByRole("tab", { name: "Interface" }));
    await userEvent.selectOptions(screen.getByLabelText("Nearby health bars"), "enemies");
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

  it("keeps language selection inside the interface settings", async () => {
    useUiStore.setState({ settingsOpen: true });
    render(<SettingsMenu />);
    await userEvent.click(screen.getByRole("tab", { name: "Interface" }));

    await userEvent.selectOptions(screen.getByLabelText("Language"), "fr");
    expect(currentLocale()).toBe("fr");
  });

  it("persists independent camera follow, horizontal and vertical speeds", async () => {
    useUiStore.setState({ settingsOpen: true });
    render(<SettingsMenu inGame />);
    await userEvent.click(screen.getByRole("tab", { name: "Camera" }));

    fireEvent.change(screen.getByRole("slider", { name: /Movement follow speed/ }), {
      target: { value: 135 },
    });
    fireEvent.change(screen.getByRole("slider", { name: /Horizontal orientation speed/ }), {
      target: { value: 80 },
    });
    fireEvent.change(screen.getByRole("slider", { name: /Vertical tilt speed/ }), {
      target: { value: 55 },
    });

    expect(getCameraSettings()).toEqual({
      followSpeed: 1.35,
      horizontalSensitivity: 0.8,
      verticalSensitivity: 0.55,
    });
  });

  it("closes via resume", async () => {
    useUiStore.setState({ settingsOpen: true });
    render(<SettingsMenu inGame />);
    await userEvent.click(screen.getByRole("button", { name: /resume/i }));
    expect(useUiStore.getState().settingsOpen).toBe(false);
  });

  it("returns to the game in interface edit mode from the interface pane", async () => {
    useUiStore.setState({ settingsOpen: true });
    render(<SettingsMenu inGame />);
    await userEvent.click(screen.getByRole("tab", { name: "Interface" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit interface" }));

    expect(useUiStore.getState().settingsOpen).toBe(false);
    expect(isHudLayoutEditing()).toBe(true);
    cancelHudLayoutEdit();
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
    expect(screen.getByRole("button", { name: "Remap Jump" })).toHaveTextContent("Cross");
    await userEvent.click(screen.getByText("Combat & abilities"));

    expect(screen.getByRole("button", { name: "Remap Basic attack" })).toHaveTextContent("L2");
    expect(screen.getByRole("button", { name: "Remap Ability 1" })).toHaveTextContent("Square");
    expect(screen.getByRole("button", { name: "Remap Ability 2" })).toHaveTextContent("Triangle");
    expect(screen.getByRole("button", { name: "Remap Ability 3" })).toHaveTextContent("Circle");
    expect(screen.getByRole("button", { name: "Remap Ultimate" })).toHaveTextContent("R3");
    expect(screen.getByRole("button", { name: "Remap Release spirit" })).toHaveTextContent(
      "Options",
    );
    await userEvent.click(screen.getByText("Menus & shortcuts"));
    expect(screen.getByRole("button", { name: "Remap Options / back" })).toHaveTextContent(
      "Options",
    );
  });

  it("owns the switch-character and back-to-title actions instead of the player frame", async () => {
    const switchCharacter = vi.fn();
    const returnToTitle = vi.fn();
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
        logout: vi.fn(),
        returnToTitle,
        attachMinimap: vi.fn(),
        attachWorldMap: vi.fn(),
      },
    });
    render(<SettingsMenu inGame />);
    await userEvent.click(screen.getByRole("button", { name: "Return to saves" }));
    // Leaving a party is not signing out: the button returns to the title and keeps the session,
    // so it must never reach `logout`, which revokes the cookie server-side and reloads.
    await userEvent.click(screen.getByRole("button", { name: "Back to title" }));
    expect(switchCharacter).toHaveBeenCalledOnce();
    expect(returnToTitle).toHaveBeenCalledOnce();
  });
});
