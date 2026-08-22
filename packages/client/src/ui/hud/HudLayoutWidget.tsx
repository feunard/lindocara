import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import type { CSSProperties, ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { useRef } from "react";

import { t, useLocale } from "../../i18n.js";
import {
  type HudWidgetId,
  type HudWidgetPlacement,
  hudWidgetScaleLimits,
  updateHudWidget,
} from "../../state/hud-layout.js";
import { useHudLayout } from "./useHudLayout.js";

const WIDGET_LABELS: Readonly<Record<HudWidgetId, MessageKey>> = {
  hero: "hud.layout.widget.hero",
  chat: "hud.layout.widget.chat",
  "quick-items": "hud.layout.widget.quick_items",
  "peasant-resources": "hud.layout.widget.peasant_resources",
  "skill-2": "settings.controls.skill_2",
  "skill-3": "settings.controls.skill_3",
  "skill-4": "settings.controls.skill_4",
  "skill-5": "settings.controls.skill_5",
  xp: "hud.layout.widget.xp",
  minimap: "hud.layout.widget.minimap",
};

type Gesture =
  | {
      kind: "move";
      pointerId: number;
      startX: number;
      startY: number;
      placement: HudWidgetPlacement;
      width: number;
      height: number;
    }
  | {
      kind: "resize";
      pointerId: number;
      centerX: number;
      centerY: number;
      startDistance: number;
      placement: HudWidgetPlacement;
      width: number;
      height: number;
    };

function viewport(): { width: number; height: number } {
  return {
    width: Math.max(320, window.innerWidth),
    height: Math.max(480, window.innerHeight),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampToViewport(
  placement: HudWidgetPlacement,
  width: number,
  height: number,
): HudWidgetPlacement {
  const screen = viewport();
  const halfWidth = Math.min(0.49, (width * placement.scale) / (2 * screen.width));
  const halfHeight = Math.min(0.49, (height * placement.scale) / (2 * screen.height));
  return {
    ...placement,
    x: clamp(placement.x, Math.max(0.01, halfWidth), Math.min(0.99, 1 - halfWidth)),
    y: clamp(placement.y, Math.max(0.01, halfHeight), Math.min(0.99, 1 - halfHeight)),
  };
}

function capturePointer(element: HTMLElement, pointerId: number): void {
  if (typeof element.setPointerCapture === "function") element.setPointerCapture(pointerId);
}

function releasePointer(element: HTMLElement, pointerId: number): void {
  if (
    typeof element.releasePointerCapture === "function" &&
    (typeof element.hasPointerCapture !== "function" || element.hasPointerCapture(pointerId))
  ) {
    element.releasePointerCapture(pointerId);
  }
}

export function HudLayoutWidget({ id, children }: { id: HudWidgetId; children: ReactNode }) {
  useLocale();
  const { editing, layout } = useHudLayout();
  const placement = layout[id];
  const widgetRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const label = t(WIDGET_LABELS[id]);
  const style = {
    left: `${placement.x * 100}vw`,
    top: `${placement.y * 100}vh`,
    "--hud-widget-scale": placement.scale,
  } as CSSProperties;

  function dimensions(): { width: number; height: number } {
    const element = widgetRef.current;
    return {
      width: Math.max(1, element?.offsetWidth ?? 1),
      height: Math.max(1, element?.offsetHeight ?? 1),
    };
  }

  function startMove(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (!editing || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const size = dimensions();
    gestureRef.current = {
      kind: "move",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      placement,
      ...size,
    };
    capturePointer(event.currentTarget, event.pointerId);
  }

  function startResize(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (!editing || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = widgetRef.current?.getBoundingClientRect();
    const centerX = rect ? rect.left + rect.width / 2 : event.clientX;
    const centerY = rect ? rect.top + rect.height / 2 : event.clientY;
    const size = dimensions();
    gestureRef.current = {
      kind: "resize",
      pointerId: event.pointerId,
      centerX,
      centerY,
      startDistance: Math.max(1, Math.hypot(event.clientX - centerX, event.clientY - centerY)),
      placement,
      ...size,
    };
    capturePointer(event.currentTarget, event.pointerId);
  }

  function moveGesture(event: ReactPointerEvent<HTMLElement>): void {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    const screen = viewport();
    if (gesture.kind === "move") {
      updateHudWidget(
        id,
        clampToViewport(
          {
            ...gesture.placement,
            x: gesture.placement.x + (event.clientX - gesture.startX) / screen.width,
            y: gesture.placement.y + (event.clientY - gesture.startY) / screen.height,
          },
          gesture.width,
          gesture.height,
        ),
      );
      return;
    }
    const distance = Math.hypot(event.clientX - gesture.centerX, event.clientY - gesture.centerY);
    const limits = hudWidgetScaleLimits(id);
    const scale = clamp(
      gesture.placement.scale * (distance / gesture.startDistance),
      limits.min,
      limits.max,
    );
    updateHudWidget(
      id,
      clampToViewport({ ...gesture.placement, scale }, gesture.width, gesture.height),
    );
  }

  function endGesture(event: ReactPointerEvent<HTMLElement>): void {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    releasePointer(event.currentTarget, event.pointerId);
  }

  function handleKeyboard(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (!editing) return;
    const moveStep = event.shiftKey ? 0.03 : 0.01;
    const scaleStep = event.shiftKey ? 0.2 : 0.1;
    let next = placement;
    switch (event.key) {
      case "ArrowLeft":
        next = { ...placement, x: placement.x - moveStep };
        break;
      case "ArrowRight":
        next = { ...placement, x: placement.x + moveStep };
        break;
      case "ArrowUp":
        next = { ...placement, y: placement.y - moveStep };
        break;
      case "ArrowDown":
        next = { ...placement, y: placement.y + moveStep };
        break;
      case "+":
      case "=":
        next = { ...placement, scale: placement.scale + scaleStep };
        break;
      case "-":
      case "_":
        next = { ...placement, scale: placement.scale - scaleStep };
        break;
      default:
        return;
    }
    event.preventDefault();
    const size = dimensions();
    updateHudWidget(id, clampToViewport(next, size.width, size.height));
  }

  return (
    <div
      ref={widgetRef}
      className={`hud-layout-widget hud-layout-widget--${id}`}
      data-hud-widget={id}
      data-hud-editing={editing || undefined}
      style={style}
    >
      <div
        className="hud-layout-widget__content"
        aria-hidden={editing || undefined}
        inert={editing || undefined}
      >
        {children}
      </div>
      {editing && (
        <>
          <button
            type="button"
            className="hud-layout-widget__move"
            aria-label={t("hud.layout.move", { widget: label })}
            onKeyDown={handleKeyboard}
            onPointerDown={startMove}
            onPointerMove={moveGesture}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
          >
            <span>{label}</span>
          </button>
          <button
            type="button"
            className="hud-layout-widget__resize"
            aria-label={t("hud.layout.resize", { widget: label })}
            onPointerDown={startResize}
            onPointerMove={moveGesture}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
          />
        </>
      )}
    </div>
  );
}
