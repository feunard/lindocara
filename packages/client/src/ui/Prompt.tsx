import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";

export function Prompt() {
  useLocale();
  const prompt = useUiStore((s) => s.prompt);
  const interiorDoorId = useUiStore((s) => s.interiorDoorId);

  // Interior panel supersedes the floating prompt
  if (prompt === null || interiorDoorId !== null) return null;
  return <div id="prompt">{t(prompt.key, prompt.params)}</div>;
}
