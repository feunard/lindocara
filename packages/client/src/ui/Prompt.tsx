import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";
import { controlBindingLabel, useInputModeSettings } from "./input-hints.js";

export function Prompt() {
  useLocale();
  const { mode, settings } = useInputModeSettings();
  const prompt = useUiStore((s) => s.prompt);
  const interiorDoorId = useUiStore((s) => s.interiorDoorId);

  // Interior panel supersedes the floating prompt
  if (prompt === null || interiorDoorId !== null) return null;
  const text = t(prompt.key, prompt.params).replace(
    "[E]",
    `[${controlBindingLabel("interact", mode, settings)}]`,
  );
  return <div id="prompt">{text}</div>;
}
