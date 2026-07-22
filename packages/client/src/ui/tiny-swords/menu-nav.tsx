/**
 * One focus model for the launch menus, driven equally by gamepad, keyboard and mouse.
 *
 * A `<MenuNav>` owns an ordered list of focusable items. The D-pad / left stick (or the arrow keys)
 * move focus along the nav's orientation; `A` / Enter activate the focused item; `B` / Escape run the
 * nav's `onBack`. The mouse mirrors it: hovering an item focuses it, clicking activates it. Every
 * launch screen is therefore fully playable with a controller — you can start a game without ever
 * touching the keyboard — while staying identical under keyboard and mouse.
 *
 * Gamepad reading reuses the renderer's `firstConnectedGamepad()` (the same pad the game reads), so
 * there is exactly one notion of "the pad" across menus and gameplay.
 */
import { firstConnectedGamepad } from "@lindocara/renderer/input-settings.js";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { menuAudio } from "../../game/menu-audio.js";

type Orientation = "vertical" | "horizontal";

interface MenuItem {
  id: string;
  order: number;
  activate: () => void;
  disabled: boolean;
}

interface MenuNavContextValue {
  focusedId: string | null;
  register: (item: MenuItem) => () => void;
  focus: (id: string) => void;
  activate: (id: string) => void;
}

const MenuNavContext = createContext<MenuNavContextValue | null>(null);

/** Standard-gamepad button/axis indices we care about. */
const BTN_A = 0;
const BTN_B = 1;
const DPAD = { up: 12, down: 13, left: 14, right: 15 } as const;
const AXIS_X = 0;
const AXIS_Y = 1;
const STICK_DEADZONE = 0.6;
/** Steps between repeats while a direction is held, in animation frames (~60fps → ~250ms then ~90ms). */
const REPEAT_FIRST = 15;
const REPEAT_NEXT = 5;

export function MenuNav({
  orientation = "vertical",
  onBack,
  children,
  className,
  "aria-label": ariaLabel,
}: {
  orientation?: Orientation;
  onBack?: () => void;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  const items = useRef<MenuItem[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedRef = useRef<string | null>(null);
  focusedRef.current = focusedId;

  // Cursor-move sound: on every focus change except the initial auto-focus (null → first item),
  // so keyboard, gamepad and mouse-hover all click the same way. The initial landing is silent.
  const prevFocused = useRef<string | null>(null);
  useEffect(() => {
    if (focusedId && prevFocused.current !== null && focusedId !== prevFocused.current) {
      menuAudio.playHover();
    }
    prevFocused.current = focusedId;
  }, [focusedId]);

  const ordered = useCallback(
    () => [...items.current].filter((i) => !i.disabled).sort((a, b) => a.order - b.order),
    [],
  );

  const focus = useCallback((id: string) => {
    if (items.current.some((i) => i.id === id && !i.disabled)) setFocusedId(id);
  }, []);

  const register = useCallback(
    (item: MenuItem) => {
      items.current.push(item);
      setFocusedId((current) => current ?? (item.disabled ? current : item.id));
      return () => {
        items.current = items.current.filter((i) => i.id !== item.id);
        setFocusedId((current) => (current === item.id ? (ordered()[0]?.id ?? null) : current));
      };
    },
    [ordered],
  );

  const activate = useCallback((id: string) => {
    const item = items.current.find((i) => i.id === id && !i.disabled);
    if (!item) return;
    menuAudio.playConfirm();
    item.activate();
  }, []);

  // Back sound + the nav's onBack, run together for Escape / B / any explicit back.
  const triggerBack = useCallback(() => {
    if (!onBack) return;
    menuAudio.playBack();
    onBack();
  }, [onBack]);

  const move = useCallback(
    (delta: 1 | -1) => {
      const list = ordered();
      if (list.length === 0) return;
      const currentIndex = list.findIndex((i) => i.id === focusedRef.current);
      const next = currentIndex < 0 ? 0 : (currentIndex + delta + list.length) % list.length;
      const target = list[next];
      if (target) setFocusedId(target.id);
    },
    [ordered],
  );

  // Keyboard.
  useEffect(() => {
    const prev = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
    const nextKey = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === prev) {
        event.preventDefault();
        move(-1);
      } else if (event.key === nextKey) {
        event.preventDefault();
        move(1);
      } else if (event.key === "Enter" || event.key === " ") {
        if (focusedRef.current) {
          event.preventDefault();
          activate(focusedRef.current);
        }
      } else if (event.key === "Escape") {
        if (onBack) {
          event.preventDefault();
          triggerBack();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [orientation, move, activate, onBack, triggerBack]);

  // Gamepad. One press = one step; holding repeats after a delay. B triggers onBack.
  useEffect(() => {
    let raf = 0;
    let heldDir: 1 | -1 | 0 = 0;
    let repeatIn = 0;
    let prevA = false;
    let prevB = false;
    const axis = orientation === "vertical" ? AXIS_Y : AXIS_X;
    const negBtn = orientation === "vertical" ? DPAD.up : DPAD.left;
    const posBtn = orientation === "vertical" ? DPAD.down : DPAD.right;

    const poll = () => {
      const pad = firstConnectedGamepad();
      if (pad) {
        const neg =
          pad.buttons[negBtn]?.pressed === true || (pad.axes[axis] ?? 0) < -STICK_DEADZONE;
        const pos = pad.buttons[posBtn]?.pressed === true || (pad.axes[axis] ?? 0) > STICK_DEADZONE;
        const dir: 1 | -1 | 0 = pos ? 1 : neg ? -1 : 0;
        if (dir !== 0 && dir !== heldDir) {
          move(dir);
          heldDir = dir;
          repeatIn = REPEAT_FIRST;
        } else if (dir !== 0 && dir === heldDir) {
          repeatIn -= 1;
          if (repeatIn <= 0) {
            move(dir);
            repeatIn = REPEAT_NEXT;
          }
        } else if (dir === 0) {
          heldDir = 0;
        }
        const a = pad.buttons[BTN_A]?.pressed === true;
        if (a && !prevA && focusedRef.current) activate(focusedRef.current);
        prevA = a;
        const b = pad.buttons[BTN_B]?.pressed === true;
        if (b && !prevB) triggerBack();
        prevB = b;
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [orientation, move, activate, triggerBack]);

  const value = useMemo<MenuNavContextValue>(
    () => ({ focusedId, register, focus, activate }),
    [focusedId, register, focus, activate],
  );

  return (
    <MenuNavContext.Provider value={value}>
      <nav className={className} aria-label={ariaLabel}>
        {children}
      </nav>
    </MenuNavContext.Provider>
  );
}

/**
 * Register a focusable menu item. Returns whether it is focused plus the props to spread on the
 * element (mouse hover focuses, click activates, and the focused item scrolls into view + takes DOM
 * focus so screen readers and `:focus-visible` follow the pad).
 */
export function useMenuItem(options: {
  onActivate: () => void;
  order: number;
  disabled?: boolean;
}) {
  const ctx = useContext(MenuNavContext);
  if (!ctx) throw new Error("useMenuItem must be used inside <MenuNav>");
  const id = useId();
  const activateRef = useRef(options.onActivate);
  activateRef.current = options.onActivate;
  const disabled = options.disabled === true;
  const ref = useRef<HTMLButtonElement | null>(null);

  // Depend on the *stable* register callback, never the whole context object: `ctx` is a fresh
  // object on every focus change (it carries focusedId), so keying this effect on `ctx` would
  // unregister + re-register every item on each move, and the cleanup would snap focus back to the
  // first item — the D-pad/arrow keys and hover-to-focus would never stick. register/focus/activate
  // are all stable, so the registration lives exactly as long as the item does.
  const { register } = ctx;
  useEffect(
    () => register({ id, order: options.order, disabled, activate: () => activateRef.current() }),
    [register, id, options.order, disabled],
  );

  const focused = ctx.focusedId === id;
  useLayoutEffect(() => {
    if (focused && ref.current) {
      // jsdom has no scrollIntoView; guard so the focus model stays testable.
      ref.current.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      ref.current.focus({ preventScroll: true });
    }
  }, [focused]);

  return {
    focused,
    ref,
    itemProps: {
      "data-focused": focused ? "" : undefined,
      onMouseEnter: () => !disabled && ctx.focus(id),
      onClick: () => !disabled && ctx.activate(id),
      tabIndex: focused ? 0 : -1,
    },
  };
}
