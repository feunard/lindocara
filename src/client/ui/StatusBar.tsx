import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";

export function StatusBar() {
  useLocale();
  const status = useUiStore((s) => s.status);

  return <div id="status">{status ? t(status.key, status.params) : ""}</div>;
}
