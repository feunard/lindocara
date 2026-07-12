import { useSyncExternalStore } from "react";
import {
  getAudioSettings,
  setAudioSettings,
  subscribeAudioSettings,
} from "../game/audio-settings.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";

function useAudioSettings() {
  return useSyncExternalStore(subscribeAudioSettings, getAudioSettings, getAudioSettings);
}

export function SettingsMenu() {
  useLocale();
  const open = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const audio = useAudioSettings();

  if (!open) return null;

  const percent = (value: number) => Math.round(value * 100);

  return (
    <section id="settings-menu" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="settings-panel">
        <header className="settings-header">
          <h2 id="settings-title">{t("settings.title")}</h2>
          <button
            type="button"
            className="settings-close"
            aria-label={t("settings.close")}
            title={t("settings.close")}
            onClick={() => setSettingsOpen(false)}
          >
            &times;
          </button>
        </header>

        <div className="settings-body">
          <p className="settings-section-label">{t("settings.audio")}</p>

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={audio.muted}
              onChange={(event) => setAudioSettings({ muted: event.target.checked })}
            />
            <span>{t("settings.mute")}</span>
          </label>

          <label className="settings-row">
            <span className="settings-row-label">
              {t("settings.sfx")}
              <span className="settings-value">{percent(audio.sfxVolume)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={percent(audio.sfxVolume)}
              disabled={audio.muted}
              onChange={(event) =>
                setAudioSettings({ sfxVolume: Number(event.target.value) / 100 })
              }
            />
          </label>

          <label className="settings-row">
            <span className="settings-row-label">
              {t("settings.ambient")}
              <span className="settings-value">{percent(audio.ambientVolume)}%</span>
            </span>
            <input
              type="range"
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

        <footer className="settings-footer">
          <button type="button" className="settings-resume" onClick={() => setSettingsOpen(false)}>
            {t("settings.resume")}
          </button>
        </footer>
      </div>
    </section>
  );
}
