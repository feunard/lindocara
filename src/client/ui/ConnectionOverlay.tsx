import { t } from "../i18n.js";
import { useUiStore } from "../store.js";

/** A deliberately small, local-only overlay while the socket moves/reconnects. */
export function ConnectionOverlay() {
  const reconnect = useUiStore((state) => state.reconnect);
  if (!reconnect) return null;
  const transition = reconnect.kind === "transition";
  return (
    <section className="connection-overlay" role="status" aria-live="polite">
      <div className="connection-overlay__panel">
        <h2>{t(transition ? "transition.title" : "reconnect.title")}</h2>
        <p>
          {t(
            transition ? "transition.copy" : "reconnect.copy",
            transition ? undefined : { attempt: reconnect.attempt },
          )}
        </p>
        <button type="button" onClick={reconnect.cancelReconnect}>
          {t("reconnect.cancel")}
        </button>
      </div>
    </section>
  );
}
