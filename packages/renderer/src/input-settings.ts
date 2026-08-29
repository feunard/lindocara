export const CONTROL_IDS = [
  "moveUp",
  "moveDown",
  "moveLeft",
  "moveRight",
  "jump",
  "skill1",
  "skill2",
  "skill3",
  "skill4",
  "skill5",
  "interact",
  "potion",
  "item1",
  "item2",
  "item3",
  "release",
  "map",
  "talents",
  "inventory",
  "quests",
  "chat",
  "settings",
] as const;

export type ControlId = (typeof CONTROL_IDS)[number];
export type ControllerLayout = "xbox" | "playstation" | "switch" | "generic";
export type InputMode = "keyboard" | "gamepad";

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
const INPUT_BINDINGS_VERSION = 8;
const GAMEPAD_AXIS_THRESHOLD = 0.55;
const HERO_DIRECTION_CONTROLS = ["moveUp", "moveDown", "moveLeft", "moveRight"] as const;
const listeners = new Set<() => void>();
const modeListeners = new Set<() => void>();

export const DEFAULT_INPUT_SETTINGS: InputSettings = {
  controllerLayout: "xbox",
  keyboard: {
    moveUp: [{ code: "KeyW" }],
    moveDown: [{ code: "KeyS" }],
    moveLeft: [{ code: "KeyA" }],
    moveRight: [{ code: "KeyD" }],
    // The one control client-owned movement added (S3): high ground is reached by jumping now,
    // not by walking up it. Space was free — the legacy `skill1` binding that used to hold it was
    // migrated off in bindings version 3.
    jump: [{ code: "Space" }],
    // Logical skill order (basic to ultimate), with the requested numpad mirror.
    skill1: [{ code: "KeyO" }, { code: "Numpad5" }],
    skill2: [{ code: "KeyM" }, { code: "Numpad3" }],
    skill3: [{ code: "KeyL" }, { code: "Numpad2" }],
    skill4: [{ code: "KeyK" }, { code: "Numpad1" }],
    skill5: [{ code: "KeyJ" }, { code: "Numpad4" }],
    interact: [{ code: "KeyE" }],
    potion: [{ code: "KeyQ" }],
    item1: [{ code: "Digit1" }, { code: "ArrowLeft" }],
    item2: [{ code: "Digit2" }, { code: "ArrowUp" }],
    item3: [{ code: "Digit3" }, { code: "ArrowRight" }],
    release: [{ code: "KeyR" }],
    map: [{ code: "KeyC" }],
    talents: [{ code: "KeyH" }],
    inventory: [{ code: "KeyB" }, { code: "ArrowDown" }],
    quests: [{ code: "KeyN" }],
    chat: [{ code: "Enter" }],
    settings: [{ code: "Escape" }],
  },
  gamepad: {
    // The left stick is the only default movement control. The D-pad is reserved for remappable
    // shortcuts so pressing a quick item can never also move the hero.
    moveUp: [{ kind: "axis", index: 1, direction: -1 }],
    moveDown: [{ kind: "axis", index: 1, direction: 1 }],
    moveLeft: [{ kind: "axis", index: 0, direction: -1 }],
    moveRight: [{ kind: "axis", index: 0, direction: 1 }],
    // Standard button 0 is the physical south face button: Xbox A, PlayStation Cross, Switch B.
    jump: [{ kind: "button", index: 0 }],
    // Standard button 7 is the analogue right trigger on Xbox/PlayStation-compatible mappings.
    skill1: [{ kind: "button", index: 7 }],
    skill2: [{ kind: "button", index: 2 }],
    skill3: [{ kind: "button", index: 3 }],
    skill4: [{ kind: "button", index: 1 }],
    skill5: [{ kind: "button", index: 11 }],
    // The south face button is contextual: interaction consumes it in range, otherwise jump does.
    interact: [{ kind: "button", index: 0 }],
    potion: [{ kind: "button", index: 17 }],
    item1: [{ kind: "button", index: 14 }],
    item2: [{ kind: "button", index: 12 }],
    item3: [{ kind: "button", index: 15 }],
    // Start/Menu/Options is contextual: settings while alive, release while a body is down.
    release: [{ kind: "button", index: 9 }],
    map: [{ kind: "button", index: 8 }],
    talents: [{ kind: "button", index: 5 }],
    inventory: [{ kind: "button", index: 13 }],
    quests: [{ kind: "button", index: 18 }],
    chat: [{ kind: "button", index: 10 }],
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

function isGamepadBinding(value: unknown): value is GamepadBinding {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  const candidate = value as { kind: string; index: unknown; direction?: unknown };
  const index = candidate.index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 31) {
    return false;
  }
  if (candidate.kind === "button") return true;
  return (
    candidate.kind === "axis" &&
    candidate.direction !== undefined &&
    candidate.direction !== null &&
    typeof candidate.direction === "number" &&
    (candidate.direction === -1 || candidate.direction === 1)
  );
}

function validGamepadBindings(value: unknown): GamepadBinding[] | null {
  let bindings: unknown[] = [];
  if (Array.isArray(value)) bindings = value;
  else if (isGamepadBinding(value)) bindings = [value];
  else return null;
  const filtered = bindings.filter(isGamepadBinding);
  return filtered.length > 0 ? filtered.slice(0, 2) : null;
}

function sameGamepadBindings(
  left: readonly GamepadBinding[],
  right: readonly GamepadBinding[],
): boolean {
  return (
    left.length === right.length &&
    left.every((binding, index) => {
      const candidate = right[index];
      if (!candidate || binding.kind !== candidate.kind || binding.index !== candidate.index) {
        return false;
      }
      return (
        binding.kind !== "axis" ||
        (candidate.kind === "axis" && binding.direction === candidate.direction)
      );
    })
  );
}

function isDpadButton(binding: GamepadBinding): boolean {
  return binding.kind === "button" && binding.index >= 12 && binding.index <= 15;
}

function isArrowKey(binding: KeyboardBinding): boolean {
  return (
    binding.code === "ArrowUp" ||
    binding.code === "ArrowDown" ||
    binding.code === "ArrowLeft" ||
    binding.code === "ArrowRight"
  );
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
    for (const id of HERO_DIRECTION_CONTROLS) {
      const withoutArrows = fallback.keyboard[id].filter((binding) => !isArrowKey(binding));
      fallback.keyboard[id] =
        withoutArrows.length > 0
          ? withoutArrows
          : DEFAULT_INPUT_SETTINGS.keyboard[id].map((binding) => ({ ...binding }));
      const withoutDpad = fallback.gamepad[id].filter((binding) => !isDpadButton(binding));
      fallback.gamepad[id] =
        withoutDpad.length > 0
          ? withoutDpad
          : DEFAULT_INPUT_SETTINGS.gamepad[id].map((binding) => ({ ...binding }));
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
      const version4Keyboard = {
        moveUp: ["KeyW", "ArrowUp"],
        moveDown: ["KeyS", "ArrowDown"],
        moveLeft: ["KeyA", "ArrowLeft"],
        moveRight: ["KeyD", "ArrowRight"],
        item1: ["Digit1"],
        item2: ["Digit2"],
        item3: ["Digit3"],
        inventory: ["KeyB"],
      } as const satisfies Partial<Record<ControlId, readonly string[]>>;
      for (const id of [
        "moveUp",
        "moveDown",
        "moveLeft",
        "moveRight",
        "item1",
        "item2",
        "item3",
        "inventory",
      ] as const) {
        const stored = parsed.keyboard?.[id]?.map((binding) => binding.code);
        if (stored?.join("|") === version4Keyboard[id].join("|")) {
          fallback.keyboard[id] = DEFAULT_INPUT_SETTINGS.keyboard[id].map((binding) => ({
            ...binding,
          }));
        }
      }
      const legacyGamepad = {
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
        skill4: [{ kind: "button", index: 4 }],
        skill5: [{ kind: "button", index: 7 }],
        interact: [{ kind: "button", index: 1 }],
        item1: [{ kind: "button", index: 6 }],
        item2: [{ kind: "button", index: 10 }],
        item3: [{ kind: "button", index: 11 }],
        inventory: [{ kind: "button", index: 16 }],
        chat: [{ kind: "button", index: 11 }],
      } as const satisfies Partial<Record<ControlId, readonly GamepadBinding[]>>;
      for (const id of [
        "moveUp",
        "moveDown",
        "moveLeft",
        "moveRight",
        "skill1",
        "skill4",
        "skill5",
        "interact",
        "item1",
        "item2",
        "item3",
        "inventory",
        "chat",
      ] as const) {
        const stored = validGamepadBindings(parsed.gamepad?.[id]);
        const previous = legacyGamepad[id];
        if (stored && previous && sameGamepadBindings(stored, previous)) {
          fallback.gamepad[id] = DEFAULT_INPUT_SETTINGS.gamepad[id].map((binding) => ({
            ...binding,
          }));
        }
      }
      const storedInteract = validGamepadBindings(parsed.gamepad?.interact);
      if (storedInteract && sameGamepadBindings(storedInteract, [{ kind: "button", index: 4 }])) {
        fallback.gamepad.interact = DEFAULT_INPUT_SETTINGS.gamepad.interact.map((binding) => ({
          ...binding,
        }));
      }
      const storedRelease = validGamepadBindings(parsed.gamepad?.release);
      const storedSettings = validGamepadBindings(parsed.gamepad?.settings);
      const untouchedVersion5Defaults =
        storedRelease &&
        storedSettings &&
        sameGamepadBindings(storedRelease, [{ kind: "button", index: 10 }]) &&
        sameGamepadBindings(storedSettings, [{ kind: "button", index: 9 }]);
      const untouchedVersion6Defaults =
        parsed.version === 6 &&
        storedRelease &&
        storedSettings &&
        sameGamepadBindings(storedRelease, [{ kind: "button", index: 9 }]) &&
        sameGamepadBindings(storedSettings, [{ kind: "button", index: 10 }]);
      if (untouchedVersion5Defaults || untouchedVersion6Defaults) {
        fallback.gamepad.release = DEFAULT_INPUT_SETTINGS.gamepad.release.map((binding) => ({
          ...binding,
        }));
        fallback.gamepad.settings = DEFAULT_INPUT_SETTINGS.gamepad.settings.map((binding) => ({
          ...binding,
        }));
      }
      const storedSkill1 = validGamepadBindings(parsed.gamepad?.skill1);
      const storedChat = validGamepadBindings(parsed.gamepad?.chat);
      if (storedSkill1 && sameGamepadBindings(storedSkill1, [{ kind: "button", index: 6 }])) {
        fallback.gamepad.skill1 = DEFAULT_INPUT_SETTINGS.gamepad.skill1.map((binding) => ({
          ...binding,
        }));
      }
      if (storedChat && sameGamepadBindings(storedChat, [{ kind: "button", index: 7 }])) {
        fallback.gamepad.chat = DEFAULT_INPUT_SETTINGS.gamepad.chat.map((binding) => ({
          ...binding,
        }));
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
}

let settings = loadSettings();
let inputMode: InputMode = "keyboard";

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

export function getInputMode(): InputMode {
  return inputMode;
}

export function subscribeInputSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeInputMode(listener: () => void): () => void {
  modeListeners.add(listener);
  return () => modeListeners.delete(listener);
}

export function setInputMode(mode: InputMode): void {
  if (inputMode === mode) return;
  inputMode = mode;
  for (const listener of modeListeners) listener();
}

export function setControllerLayout(controllerLayout: ControllerLayout): void {
  commit({ ...settings, controllerLayout });
}

export function setKeyboardBinding(control: ControlId, binding: KeyboardBinding): boolean {
  if (HERO_DIRECTION_CONTROLS.includes(control as (typeof HERO_DIRECTION_CONTROLS)[number])) {
    if (isArrowKey(binding)) return false;
  }
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
  return true;
}

export function setGamepadBinding(control: ControlId, binding: GamepadBinding): boolean {
  if (HERO_DIRECTION_CONTROLS.includes(control as (typeof HERO_DIRECTION_CONTROLS)[number])) {
    if (isDpadButton(binding)) return false;
  }
  const displaced = settings.gamepad[control].map((candidate) => ({ ...candidate }));
  const gamepad = Object.fromEntries(
    CONTROL_IDS.map((id) => {
      if (id === control) return [id, [{ ...binding }]];
      if (
        binding.kind === "button" &&
        binding.index === 0 &&
        ((control === "jump" && id === "interact") || (control === "interact" && id === "jump"))
      ) {
        return [id, settings.gamepad[id].map((candidate) => ({ ...candidate }))];
      }
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
  return true;
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
