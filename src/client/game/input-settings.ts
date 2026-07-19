export const CONTROL_IDS = [
  "moveUp",
  "moveDown",
  "moveLeft",
  "moveRight",
  "skill1",
  "skill2",
  "skill3",
  "skill4",
  "skill5",
  "interact",
  "potion",
  "release",
  "map",
  "talents",
  "chat",
  "settings",
] as const;

export type ControlId = (typeof CONTROL_IDS)[number];
export type ControllerLayout = "xbox" | "playstation" | "switch" | "generic";

export interface KeyboardBinding {
  code: string;
}

export type GamepadBinding =
  | { kind: "button"; index: number }
  | { kind: "axis"; index: number; direction: -1 | 1 };

export interface InputSettings {
  controllerLayout: ControllerLayout;
  keyboard: Record<ControlId, KeyboardBinding[]>;
  gamepad: Record<ControlId, GamepadBinding[]>;
}

const STORAGE_KEY = "lindocara.input";
const INPUT_BINDINGS_VERSION = 2;
const GAMEPAD_AXIS_THRESHOLD = 0.55;
const listeners = new Set<() => void>();

export const DEFAULT_INPUT_SETTINGS: InputSettings = {
  controllerLayout: "xbox",
  keyboard: {
    moveUp: [{ code: "KeyW" }, { code: "ArrowUp" }],
    moveDown: [{ code: "KeyS" }, { code: "ArrowDown" }],
    moveLeft: [{ code: "KeyA" }, { code: "ArrowLeft" }],
    moveRight: [{ code: "KeyD" }, { code: "ArrowRight" }],
    // Logical skill order (basic to ultimate), with the requested numpad mirror.
    skill1: [{ code: "KeyO" }, { code: "Numpad5" }],
    skill2: [{ code: "KeyM" }, { code: "Numpad3" }],
    skill3: [{ code: "KeyL" }, { code: "Numpad2" }],
    skill4: [{ code: "KeyK" }, { code: "Numpad1" }],
    skill5: [{ code: "KeyJ" }, { code: "Numpad4" }],
    interact: [{ code: "KeyE" }],
    potion: [{ code: "KeyQ" }],
    release: [{ code: "KeyR" }],
    map: [{ code: "KeyC" }],
    talents: [{ code: "KeyH" }],
    chat: [{ code: "Enter" }],
    settings: [{ code: "Escape" }],
  },
  gamepad: {
    moveUp: [
      { kind: "axis", index: 1, direction: -1 },
      { kind: "button", index: 12 },
    ],
    moveDown: [
      { kind: "axis", index: 1, direction: 1 },
      { kind: "button", index: 13 },
    ],
    moveLeft: [
      { kind: "axis", index: 0, direction: -1 },
      { kind: "button", index: 14 },
    ],
    moveRight: [
      { kind: "axis", index: 0, direction: 1 },
      { kind: "button", index: 15 },
    ],
    skill1: [{ kind: "button", index: 0 }],
    skill2: [{ kind: "button", index: 2 }],
    skill3: [{ kind: "button", index: 3 }],
    skill4: [{ kind: "button", index: 4 }],
    skill5: [{ kind: "button", index: 7 }],
    interact: [{ kind: "button", index: 1 }],
    potion: [{ kind: "button", index: 6 }],
    release: [{ kind: "button", index: 10 }],
    map: [{ kind: "button", index: 8 }],
    talents: [{ kind: "button", index: 5 }],
    chat: [{ kind: "button", index: 11 }],
    settings: [{ kind: "button", index: 9 }],
  },
};

function cloneDefaults(): InputSettings {
  return {
    controllerLayout: DEFAULT_INPUT_SETTINGS.controllerLayout,
    keyboard: Object.fromEntries(
      CONTROL_IDS.map((id) => [
        id,
        DEFAULT_INPUT_SETTINGS.keyboard[id].map((binding) => ({ ...binding })),
      ]),
    ) as InputSettings["keyboard"],
    gamepad: Object.fromEntries(
      CONTROL_IDS.map((id) => [
        id,
        DEFAULT_INPUT_SETTINGS.gamepad[id].map((binding) => ({ ...binding })),
      ]),
    ) as InputSettings["gamepad"],
  };
}

function isControllerLayout(value: unknown): value is ControllerLayout {
  return value === "xbox" || value === "playstation" || value === "switch" || value === "generic";
}

function validKeyboardBindings(value: unknown): KeyboardBinding[] | null {
  if (!Array.isArray(value)) return null;
  const bindings = value.filter(
    (binding): binding is KeyboardBinding =>
      typeof binding === "object" &&
      binding !== null &&
      "code" in binding &&
      typeof binding.code === "string" &&
      binding.code.length > 0 &&
      binding.code.length <= 32,
  );
  return bindings.length > 0 ? bindings.slice(0, 2) : null;
}

function validGamepadBindings(value: unknown): GamepadBinding[] | null {
  if (!Array.isArray(value)) return null;
  const bindings = value.filter((binding): binding is GamepadBinding => {
    if (typeof binding !== "object" || binding === null || !("kind" in binding)) return false;
    if (
      !("index" in binding) ||
      !Number.isInteger(binding.index) ||
      binding.index < 0 ||
      binding.index > 31
    )
      return false;
    if (binding.kind === "button") return true;
    return (
      binding.kind === "axis" &&
      "direction" in binding &&
      (binding.direction === -1 || binding.direction === 1)
    );
  });
  return bindings.length > 0 ? bindings.slice(0, 2) : null;
}

function loadSettings(): InputSettings {
  const fallback = cloneDefaults();
  if (typeof localStorage === "undefined") return fallback;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as
      | (Partial<InputSettings> & { version?: number })
      | null;
    if (!parsed) return fallback;
    for (const id of CONTROL_IDS) {
      fallback.keyboard[id] = validKeyboardBindings(parsed.keyboard?.[id]) ?? fallback.keyboard[id];
      fallback.gamepad[id] = validGamepadBindings(parsed.gamepad?.[id]) ?? fallback.gamepad[id];
    }
    if (isControllerLayout(parsed.controllerLayout))
      fallback.controllerLayout = parsed.controllerLayout;
    // Migrate only untouched legacy defaults. Explicit user remaps remain authoritative.
    if (parsed.version !== INPUT_BINDINGS_VERSION) {
      const legacy: Partial<Record<ControlId, readonly string[]>> = {
        skill1: ["Space", "Digit1"],
        skill2: ["Digit2", "KeyF"],
        skill3: ["Digit3"],
        skill4: ["Digit4"],
        skill5: ["Digit5"],
        map: ["KeyM"],
      };
      for (const id of ["skill1", "skill2", "skill3", "skill4", "skill5", "map"] as const) {
        const stored = parsed.keyboard?.[id]?.map((binding) => binding.code);
        const previous = legacy[id];
        if (stored && previous && stored.join("|") === previous.join("|")) {
          fallback.keyboard[id] = DEFAULT_INPUT_SETTINGS.keyboard[id].map((binding) => ({
            ...binding,
          }));
        }
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
}

let settings = loadSettings();

function commit(next: InputSettings): void {
  settings = next;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: INPUT_BINDINGS_VERSION, ...settings }),
    );
  } catch {
    // Storage can be unavailable or full; the current page still uses the remap.
  }
  for (const listener of listeners) listener();
}

export function getInputSettings(): InputSettings {
  return settings;
}

export function subscribeInputSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setControllerLayout(controllerLayout: ControllerLayout): void {
  commit({ ...settings, controllerLayout });
}

export function setKeyboardBinding(control: ControlId, binding: KeyboardBinding): void {
  const displaced = settings.keyboard[control].map((candidate) => ({ ...candidate }));
  const keyboard = Object.fromEntries(
    CONTROL_IDS.map((id) => {
      if (id === control) return [id, [{ ...binding }]];
      const remaining = settings.keyboard[id].filter(
        (candidate) => candidate.code !== binding.code,
      );
      return [id, remaining.length > 0 ? remaining : displaced];
    }),
  ) as InputSettings["keyboard"];
  commit({
    ...settings,
    keyboard,
  });
}

export function setGamepadBinding(control: ControlId, binding: GamepadBinding): void {
  const displaced = settings.gamepad[control].map((candidate) => ({ ...candidate }));
  const gamepad = Object.fromEntries(
    CONTROL_IDS.map((id) => {
      if (id === control) return [id, [{ ...binding }]];
      const remaining = settings.gamepad[id].filter(
        (candidate) =>
          candidate.kind !== binding.kind ||
          candidate.index !== binding.index ||
          (candidate.kind === "axis" &&
            binding.kind === "axis" &&
            candidate.direction !== binding.direction),
      );
      return [id, remaining.length > 0 ? remaining : displaced];
    }),
  ) as InputSettings["gamepad"];
  commit({
    ...settings,
    gamepad,
  });
}

export function resetInputBindings(device?: "keyboard" | "gamepad"): void {
  const defaults = cloneDefaults();
  commit({
    controllerLayout: settings.controllerLayout,
    keyboard: device === "gamepad" ? settings.keyboard : defaults.keyboard,
    gamepad: device === "keyboard" ? settings.gamepad : defaults.gamepad,
  });
}

export function keyboardControlForCode(code: string): ControlId | null {
  return (
    CONTROL_IDS.find((control) =>
      settings.keyboard[control].some((binding) => binding.code === code),
    ) ?? null
  );
}

export function keyboardBindingLabel(binding: KeyboardBinding): string {
  const { code } = binding;
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  if (code === "Space") return "Space";
  if (code === "Escape") return "Esc";
  if (code === "ArrowUp") return "↑";
  if (code === "ArrowDown") return "↓";
  if (code === "ArrowLeft") return "←";
  if (code === "ArrowRight") return "→";
  return code.replace(/(Left|Right)$/, "");
}

const BUTTON_LABELS: Record<ControllerLayout, readonly string[]> = {
  xbox: [
    "A",
    "B",
    "X",
    "Y",
    "LB",
    "RB",
    "LT",
    "RT",
    "View",
    "Menu",
    "LS",
    "RS",
    "D-pad ↑",
    "D-pad ↓",
    "D-pad ←",
    "D-pad →",
  ],
  playstation: [
    "Cross",
    "Circle",
    "Square",
    "Triangle",
    "L1",
    "R1",
    "L2",
    "R2",
    "Create",
    "Options",
    "L3",
    "R3",
    "D-pad ↑",
    "D-pad ↓",
    "D-pad ←",
    "D-pad →",
  ],
  switch: [
    "B",
    "A",
    "Y",
    "X",
    "L",
    "R",
    "ZL",
    "ZR",
    "−",
    "+",
    "L Stick",
    "R Stick",
    "D-pad ↑",
    "D-pad ↓",
    "D-pad ←",
    "D-pad →",
  ],
  generic: [
    "Button 1",
    "Button 2",
    "Button 3",
    "Button 4",
    "Button 5",
    "Button 6",
    "Button 7",
    "Button 8",
    "Button 9",
    "Button 10",
    "Button 11",
    "Button 12",
    "Button 13",
    "Button 14",
    "Button 15",
    "Button 16",
  ],
};

export function gamepadBindingLabel(binding: GamepadBinding, layout: ControllerLayout): string {
  if (binding.kind === "button")
    return BUTTON_LABELS[layout][binding.index] ?? `Button ${binding.index + 1}`;
  if (binding.index === 0) return binding.direction < 0 ? "Left stick ←" : "Left stick →";
  if (binding.index === 1) return binding.direction < 0 ? "Left stick ↑" : "Left stick ↓";
  return `Axis ${binding.index + 1} ${binding.direction < 0 ? "−" : "+"}`;
}

export function firstConnectedGamepad(): Gamepad | null {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return null;
  return (
    Array.from(navigator.getGamepads()).find(
      (gamepad): gamepad is Gamepad => gamepad?.connected === true,
    ) ?? null
  );
}

export function gamepadBindingPressed(binding: GamepadBinding, gamepad: Gamepad): boolean {
  if (binding.kind === "button") return (gamepad.buttons[binding.index]?.value ?? 0) > 0.55;
  return (gamepad.axes[binding.index] ?? 0) * binding.direction > GAMEPAD_AXIS_THRESHOLD;
}

export function gamepadControlPressed(control: ControlId, gamepad: Gamepad): boolean {
  return settings.gamepad[control].some((binding) => gamepadBindingPressed(binding, gamepad));
}

export function pressedGamepadBinding(gamepad: Gamepad): GamepadBinding | null {
  const button = gamepad.buttons.findIndex((candidate) => candidate.value > 0.55);
  if (button >= 0) return { kind: "button", index: button };
  const axis = gamepad.axes.findIndex((candidate) => Math.abs(candidate) > 0.7);
  if (axis < 0) return null;
  const value = gamepad.axes[axis];
  if (value === undefined) return null;
  return { kind: "axis", index: axis, direction: value < 0 ? -1 : 1 };
}
