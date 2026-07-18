import { useEffect, useState, useSyncExternalStore } from "react";
import { logout } from "../api.js";
import {
  getAudioSettings,
  setAudioSettings,
  subscribeAudioSettings,
} from "../game/audio-settings.js";
import {
  getDisplaySettings,
  setDisplaySettings,
  subscribeDisplaySettings,
} from "../game/display-settings.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";
import { ControlsSettings } from "./ControlsSettings.js";
import { Button } from "./pixelact-ui/button/index.js";
import { TinyCheckbox } from "./tiny-swords/TinyCheckbox.js";
import { TinyIconButton } from "./tiny-swords/TinyIconButton.js";
import { TinyPanel } from "./tiny-swords/TinyPanel.js";
import { TinyRange } from "./tiny-swords/TinyRange.js";
import { TinySelect } from "./tiny-swords/TinySelect.js";

function useAudioSettings() {
  return useSyncExternalStore(subscribeAudioSettings, getAudioSettings, getAudioSettings);
}

function useDisplaySettings() {
  return useSyncExternalStore(subscribeDisplaySettings, getDisplaySettings, getDisplaySettings);
}

type SettingsTab = "audio" | "interface" | "controls";

export function SettingsMenu({ inGame = false }: { inGame?: boolean }) {
  useLocale();
  const open = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const game = useUiStore((s) => s.game);
  const audio = useAudioSettings();
  const display = useDisplaySettings();
  const [tab, setTab] = useState<SettingsTab>("audio");

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.code !== "Escape") return;
      setSettingsOpen(false);
      event.preventDefault();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, setSettingsOpen]);

  if (!open) return null;

  const percent = (value: number) => Math.round(value * 100);

  return (
    <section
      id="settings-menu"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setSettingsOpen(false);
      }}
    >
      <TinyPanel className="settings-panel">
        <header className="settings-header">
          <h2 id="settings-title">{t("settings.title")}</h2>
          <TinyIconButton
            type="button"
            className="settings-close"
            aria-label={t("settings.close")}
            title={t("settings.close")}
            onClick={() => setSettingsOpen(false)}
          >
            &times;
          </TinyIconButton>
        </header>

        <div className="settings-tabs" role="tablist" aria-label={t("settings.categories")}>
          {(["audio", "interface", "controls"] as const).map((candidate) => (
            <Button
              key={candidate}
              type="button"
              size="sm"
              role="tab"
              aria-selected={tab === candidate}
              onClick={() => setTab(candidate)}
            >
              {t(`settings.${candidate}`)}
            </Button>
          ))}
        </div>

        <div className="settings-body">
          {tab === "audio" && (
            <div className="settings-pane" role="tabpanel">
              <p className="settings-section-label">{t("settings.audio")}</p>
              <TinyCheckbox
                className="settings-toggle"
                checked={audio.muted}
                onChange={(event) => setAudioSettings({ muted: event.target.checked })}
              >
                {t("settings.mute")}
              </TinyCheckbox>

              <label className="settings-row" htmlFor="settings-sfx">
                <span className="settings-row-label">
                  {t("settings.sfx")}
                  <span className="settings-value">{percent(audio.sfxVolume)}%</span>
                </span>
                <TinyRange
                  id="settings-sfx"
                  min={0}
                  max={100}
                  value={percent(audio.sfxVolume)}
                  disabled={audio.muted}
                  onChange={(event) =>
                    setAudioSettings({ sfxVolume: Number(event.target.value) / 100 })
                  }
                />
              </label>

              <label className="settings-row" htmlFor="settings-ambient">
                <span className="settings-row-label">
                  {t("settings.ambient")}
                  <span className="settings-value">{percent(audio.ambientVolume)}%</span>
                </span>
                <TinyRange
                  id="settings-ambient"
                  min={0}
                  max={100}
                  value={percent(audio.ambientVolume)}
                  disabled={audio.muted}
                  onChange={(event) =>
                    setAudioSettings({ ambientVolume: Number(event.target.value) / 100 })
                  }
                />
              </label>
            </div>
          )}

          {tab === "interface" && (
            <div className="settings-pane" role="tabpanel">
              <p className="settings-section-label">{t("settings.interface")}</p>
              <label className="settings-row" htmlFor="settings-health-bars">
                <span className="settings-row-label">{t("settings.health_bars")}</span>
                <TinySelect
                  id="settings-health-bars"
                  value={display.healthBars}
                  onChange={(event) =>
                    setDisplaySettings({
                      healthBars: event.target.value as typeof display.healthBars,
                    })
                  }
                >
                  <option value="both">{t("settings.health_bars_both")}</option>
                  <option value="allies">{t("settings.health_bars_allies")}</option>
                  <option value="enemies">{t("settings.health_bars_enemies")}</option>
                  <option value="none">{t("settings.health_bars_none")}</option>
                </TinySelect>
              </label>

              <TinyCheckbox
                className="settings-toggle"
                checked={display.grid}
                onChange={(event) => setDisplaySettings({ grid: event.target.checked })}
              >
                {t("settings.grid")}
              </TinyCheckbox>
            </div>
          )}

          {tab === "controls" && (
            <div className="settings-pane" role="tabpanel">
              <ControlsSettings />
            </div>
          )}

          {inGame && (
            <div className="settings-pane settings-session-pane">
              <p className="settings-section-label">{t("settings.session")}</p>
              <div className="settings-session-actions">
                <Button
                  type="button"
                  onClick={() => (game ? game.switchCharacter() : window.location.reload())}
                >
                  {t("hud.switch_character")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="danger"
                  onClick={() => (game ? game.logout() : logout())}
                >
                  {t("hud.logout")}
                </Button>
              </div>
            </div>
          )}
        </div>

        <footer className="settings-footer">
          <Button type="button" className="settings-resume" onClick={() => setSettingsOpen(false)}>
            {t(inGame ? "settings.resume" : "settings.done")}
          </Button>
        </footer>
      </TinyPanel>
    </section>
  );
}
