import { useEffect, useState, useSyncExternalStore } from "react";
import { TinyButton } from "@/ui/tiny-swords/TinyButton.js";
import type { MessageKey } from "../../shared/i18n/index.js";
import {
  type ControlId,
  type ControllerLayout,
  firstConnectedGamepad,
  gamepadBindingLabel,
  getInputSettings,
  keyboardBindingLabel,
  pressedGamepadBinding,
  resetInputBindings,
  setControllerLayout,
  setGamepadBinding,
  setKeyboardBinding,
  subscribeInputSettings,
} from "../game/input-settings.js";
import { t, useLocale } from "../i18n.js";
import { TinySelect } from "./tiny-swords/TinySelect.js";

type InputDevice = "keyboard" | "gamepad";

interface ControlDefinition {
  id: ControlId;
  label: MessageKey;
}

interface ControlGroup {
  id: "movement" | "combat" | "shortcuts";
  label: MessageKey;
  controls: readonly ControlDefinition[];
}

const CONTROL_GROUPS: readonly ControlGroup[] = [
  {
    id: "movement",
    label: "settings.controls.group.movement",
    controls: [
      { id: "moveUp", label: "settings.controls.move_up" },
      { id: "moveDown", label: "settings.controls.move_down" },
      { id: "moveLeft", label: "settings.controls.move_left" },
      { id: "moveRight", label: "settings.controls.move_right" },
    ],
  },
  {
    id: "combat",
    label: "settings.controls.group.combat",
    controls: [
      { id: "target", label: "settings.controls.target" },
      { id: "skill1", label: "settings.controls.skill_1" },
      { id: "skill2", label: "settings.controls.skill_2" },
      { id: "skill3", label: "settings.controls.skill_3" },
      { id: "skill4", label: "settings.controls.skill_4" },
      { id: "skill5", label: "settings.controls.skill_5" },
      { id: "interact", label: "settings.controls.interact" },
      { id: "potion", label: "settings.controls.potion" },
      { id: "release", label: "settings.controls.release" },
    ],
  },
  {
    id: "shortcuts",
    label: "settings.controls.group.shortcuts",
    controls: [
      { id: "map", label: "settings.controls.map" },
      { id: "chat", label: "settings.controls.chat" },
      { id: "settings", label: "settings.controls.settings" },
    ],
  },
];

const CONTROLLER_LAYOUTS: readonly { id: ControllerLayout; label: MessageKey }[] = [
  { id: "xbox", label: "settings.controls.layout.xbox" },
  { id: "playstation", label: "settings.controls.layout.playstation" },
  { id: "switch", label: "settings.controls.layout.switch" },
  { id: "generic", label: "settings.controls.layout.generic" },
];

interface CaptureState {
  device: InputDevice;
  control: ControlId;
}

function useInputSettings() {
  return useSyncExternalStore(subscribeInputSettings, getInputSettings, getInputSettings);
}

export function ControlsSettings() {
  useLocale();
  const settings = useInputSettings();
  const [device, setDevice] = useState<InputDevice>("keyboard");
  const [capture, setCapture] = useState<CaptureState | null>(null);
  const [gamepadName, setGamepadName] = useState(() => firstConnectedGamepad()?.id ?? null);

  useEffect(() => {
    const refresh = () => setGamepadName(firstConnectedGamepad()?.id ?? null);
    window.addEventListener("gamepadconnected", refresh);
    window.addEventListener("gamepaddisconnected", refresh);
    return () => {
      window.removeEventListener("gamepadconnected", refresh);
      window.removeEventListener("gamepaddisconnected", refresh);
    };
  }, []);

  useEffect(() => {
    if (capture?.device !== "keyboard") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        [
          "ShiftLeft",
          "ShiftRight",
          "ControlLeft",
          "ControlRight",
          "AltLeft",
          "AltRight",
          "MetaLeft",
          "MetaRight",
        ].includes(event.code)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setKeyboardBinding(capture.control, { code: event.code });
      setCapture(null);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [capture]);

  useEffect(() => {
    if (capture?.device !== "gamepad") return;
    let frame = 0;
    const initialGamepad = firstConnectedGamepad();
    let armed = !initialGamepad || pressedGamepadBinding(initialGamepad) === null;
    const poll = () => {
      const gamepad = firstConnectedGamepad();
      const pressed = gamepad ? pressedGamepadBinding(gamepad) : null;
      if (!armed) armed = pressed === null;
      else if (pressed) {
        setGamepadBinding(capture.control, pressed);
        setCapture(null);
        return;
      }
      frame = window.requestAnimationFrame(poll);
    };
    frame = window.requestAnimationFrame(poll);
    return () => window.cancelAnimationFrame(frame);
  }, [capture]);

  const bindingLabel = (control: ControlId): string => {
    if (capture?.control === control && capture.device === device)
      return t(
        device === "keyboard" ? "settings.controls.press_key" : "settings.controls.press_button",
      );
    if (device === "keyboard")
      return settings.keyboard[control].map(keyboardBindingLabel).join(" / ");
    return settings.gamepad[control]
      .map((binding) => gamepadBindingLabel(binding, settings.controllerLayout))
      .join(" / ");
  };

  return (
    <div className="controls-settings">
      <div
        className="controls-device-tabs"
        role="tablist"
        aria-label={t("settings.controls.device")}
      >
        <TinyButton
          type="button"
          size="sm"
          role="tab"
          aria-selected={device === "keyboard"}
          onClick={() => {
            setCapture(null);
            setDevice("keyboard");
          }}
        >
          {t("settings.controls.keyboard")}
        </TinyButton>
        <TinyButton
          type="button"
          size="sm"
          role="tab"
          aria-selected={device === "gamepad"}
          onClick={() => {
            setCapture(null);
            setDevice("gamepad");
          }}
        >
          {t("settings.controls.gamepad")}
        </TinyButton>
      </div>

      {device === "gamepad" && (
        <div className="controller-profile">
          <label htmlFor="settings-controller-layout">{t("settings.controls.layout")}</label>
          <TinySelect
            id="settings-controller-layout"
            value={settings.controllerLayout}
            onChange={(event) => setControllerLayout(event.target.value as ControllerLayout)}
          >
            {CONTROLLER_LAYOUTS.map((layout) => (
              <option key={layout.id} value={layout.id}>
                {t(layout.label)}
              </option>
            ))}
          </TinySelect>
          <small
            className={
              gamepadName ? "controller-status controller-status--online" : "controller-status"
            }
          >
            {gamepadName
              ? t("settings.controls.connected", { name: gamepadName })
              : t("settings.controls.disconnected")}
          </small>
        </div>
      )}

      <p className="controls-hint">
        {t(
          device === "keyboard"
            ? "settings.controls.keyboard_hint"
            : "settings.controls.gamepad_hint",
        )}
      </p>

      <div className="controls-groups">
        {CONTROL_GROUPS.map((group) => (
          <details
            key={group.id}
            className="controls-group"
            open={group.id === "movement" || undefined}
          >
            <summary>{t(group.label)}</summary>
            <div className="controls-bindings">
              {group.controls.map((control) => (
                <div key={control.id} className="control-binding-row">
                  <span>{t(control.label)}</span>
                  <button
                    type="button"
                    className={
                      capture?.control === control.id && capture.device === device
                        ? "control-binding control-binding--listening"
                        : "control-binding"
                    }
                    aria-label={t("settings.controls.remap", { action: t(control.label) })}
                    onClick={() => setCapture({ device, control: control.id })}
                  >
                    {bindingLabel(control.id)}
                  </button>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>

      <div className="controls-actions">
        {capture && (
          <TinyButton type="button" size="sm" variant="secondary" onClick={() => setCapture(null)}>
            {t("settings.controls.cancel")}
          </TinyButton>
        )}
        <TinyButton
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => resetInputBindings(device)}
        >
          {t("settings.controls.reset")}
        </TinyButton>
      </div>
    </div>
  );
}
