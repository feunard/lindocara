import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";

export function StatusBar() {
  useLocale();
  const status = useUiStore((s) => s.status);
  const fps = useUiStore((s) => s.frameRate);
  const playing = useUiStore((s) => s.game !== null);

  return (
    <div id="status">
      <span className="status-message">{status ? t(status.key, status.params) : ""}</span>
      {playing && (
        <span className="status-fps" title={t("status.fps_label")}>
          {t("status.fps", { fps: fps ?? "—" })}
        </span>
      )}
    </div>
  );
}
