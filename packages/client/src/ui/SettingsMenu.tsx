import {
  getDisplaySettings,
  setDisplaySettings,
  subscribeDisplaySettings,
} from "@lindocara/renderer/display-settings.js";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { TinyButton } from "@/ui/tiny-swords/TinyButton.js";
import {
  getAudioSettings,
  setAudioSettings,
  subscribeAudioSettings,
} from "../game/audio-settings.js";
import { t, useLocale } from "../i18n.js";
import { getGameNavigation } from "../state/navigation.js";
import { useUiStore } from "../store.js";
import { ControlsSettings } from "./ControlsSettings.js";
import { MenuNav, useMenuItem } from "./tiny-swords/menu-nav.js";
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

function SettingsMenuItem({
  order,
  onActivate,
  disabled,
  children,
}: {
  order: number;
  onActivate: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const item = useMenuItem({ order, onActivate, disabled: disabled === true });
  return (
    <span ref={item.ref} {...item.itemProps} style={{ display: "contents" }}>
      {children}
    </span>
  );
}

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
      <MenuNav
        orientation="vertical"
        confirmControl="interact"
        onBack={() => setSettingsOpen(false)}
      >
        <TinyPanel className="settings-panel">
          <header className="settings-header">
            <h2 id="settings-title">{t("settings.title")}</h2>
            <SettingsMenuItem order={0} onActivate={() => setSettingsOpen(false)}>
              <TinyIconButton
                type="button"
                className="settings-close"
                aria-label={t("settings.close")}
                title={t("settings.close")}
              >
                &times;
              </TinyIconButton>
            </SettingsMenuItem>
          </header>

          <div className="settings-tabs" role="tablist" aria-label={t("settings.categories")}>
            {(["audio", "interface", "controls"] as const).map((candidate, index) => (
              <SettingsMenuItem
                key={candidate}
                order={10 + index}
                onActivate={() => setTab(candidate)}
              >
                <TinyButton type="button" size="sm" role="tab" aria-selected={tab === candidate}>
                  {t(`settings.${candidate}`)}
                </TinyButton>
              </SettingsMenuItem>
            ))}
          </div>

          <div className="settings-body">
            {tab === "audio" && (
              <div className="settings-pane" role="tabpanel">
                <p className="settings-section-label">{t("settings.audio")}</p>
                <SettingsMenuItem
                  order={20}
                  onActivate={() => setAudioSettings({ muted: !audio.muted })}
                >
                  <TinyCheckbox
                    className="settings-toggle"
                    checked={audio.muted}
                    onChange={(event) => setAudioSettings({ muted: event.target.checked })}
                  >
                    {t("settings.mute")}
                  </TinyCheckbox>
                </SettingsMenuItem>

                <SettingsMenuItem
                  order={21}
                  disabled={audio.muted}
                  onActivate={() =>
                    setAudioSettings({
                      sfxVolume: audio.sfxVolume >= 1 ? 0 : Math.min(1, audio.sfxVolume + 0.1),
                    })
                  }
                >
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
                </SettingsMenuItem>

                <SettingsMenuItem
                  order={22}
                  disabled={audio.muted}
                  onActivate={() =>
                    setAudioSettings({
                      ambientVolume:
                        audio.ambientVolume >= 1 ? 0 : Math.min(1, audio.ambientVolume + 0.1),
                    })
                  }
                >
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
                </SettingsMenuItem>
              </div>
            )}

            {tab === "interface" && (
              <div className="settings-pane" role="tabpanel">
                <p className="settings-section-label">{t("settings.interface")}</p>
                <SettingsMenuItem
                  order={20}
                  onActivate={() => {
                    const values = ["both", "allies", "enemies", "none"] as const;
                    const index = values.indexOf(display.healthBars);
                    setDisplaySettings({
                      healthBars: values[(index + 1) % values.length] ?? "both",
                    });
                  }}
                >
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
                </SettingsMenuItem>

                <SettingsMenuItem
                  order={21}
                  onActivate={() => setDisplaySettings({ grid: !display.grid })}
                >
                  <TinyCheckbox
                    className="settings-toggle"
                    checked={display.grid}
                    onChange={(event) => setDisplaySettings({ grid: event.target.checked })}
                  >
                    {t("settings.grid")}
                  </TinyCheckbox>
                </SettingsMenuItem>
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
                  <SettingsMenuItem
                    order={30}
                    onActivate={() => (game ? game.switchCharacter() : window.location.reload())}
                  >
                    <TinyButton type="button">{t("hud.switch_character")}</TinyButton>
                  </SettingsMenuItem>
                  <SettingsMenuItem
                    order={31}
                    onActivate={() => {
                      if (game) {
                        game.returnToTitle();
                        return;
                      }
                      // Defensive fallback for a settings menu somehow open with no live game
                      // handle — mirrors `game/session.ts`'s `returnToTitle`: clear the session,
                      // then navigate through the seam (the store no longer does either itself).
                      useUiStore.getState().clearedGameSession();
                      const nav = getGameNavigation();
                      nav?.setActiveParty(null);
                      nav?.toMenu();
                    }}
                  >
                    <TinyButton type="button">{t("hud.return_to_title")}</TinyButton>
                  </SettingsMenuItem>
                </div>
              </div>
            )}
          </div>

          <footer className="settings-footer">
            <SettingsMenuItem order={40} onActivate={() => setSettingsOpen(false)}>
              <TinyButton type="button" className="settings-resume">
                {t(inGame ? "settings.resume" : "settings.done")}
              </TinyButton>
            </SettingsMenuItem>
          </footer>
        </TinyPanel>
      </MenuNav>
    </section>
  );
}
