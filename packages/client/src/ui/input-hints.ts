import {
  type ControlId,
  gamepadBindingLabel,
  getInputMode,
  getInputSettings,
  type InputMode,
  type InputSettings,
  keyboardBindingLabel,
  subscribeInputMode,
  subscribeInputSettings,
} from "@lindocara/renderer/input-settings.js";
import { useSyncExternalStore } from "react";

export function useInputModeSettings(): {
  mode: InputMode;
  settings: InputSettings;
} {
  const mode = useSyncExternalStore(subscribeInputMode, getInputMode, getInputMode);
  const settings = useSyncExternalStore(subscribeInputSettings, getInputSettings, getInputSettings);
  return { mode, settings };
}

export function controlBindingLabels(
  control: ControlId,
  mode: InputMode,
  settings: InputSettings,
): string[] {
  if (mode === "gamepad") {
    return settings.gamepad[control].map((binding) =>
      gamepadBindingLabel(binding, settings.controllerLayout),
    );
  }
  return settings.keyboard[control].map(keyboardBindingLabel);
}

export function controlBindingLabel(
  control: ControlId,
  mode: InputMode,
  settings: InputSettings,
): string {
  return controlBindingLabels(control, mode, settings).join(" / ") || "-";
}
