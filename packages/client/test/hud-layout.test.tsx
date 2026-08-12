import { setLocale } from "@lindocara/client/i18n.js";
import {
  beginHudLayoutEdit,
  cancelHudLayoutEdit,
  defaultHudLayout,
  getHudLayoutSnapshot,
  HUD_LAYOUT_STORAGE_KEY,
  reloadHudLayout,
  saveHudLayoutEdit,
  updateHudWidget,
} from "@lindocara/client/state/hud-layout.js";
import { HudLayoutEditor } from "@lindocara/client/ui/hud/HudLayoutEditor.js";
import { HudLayoutWidget } from "@lindocara/client/ui/hud/HudLayoutWidget.js";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("HUD layout editor", () => {
  beforeEach(() => {
    setLocale("en");
    localStorage.clear();
    reloadHudLayout();
  });

  afterEach(() => {
    cancelHudLayoutEdit();
  });

  it("keeps cancel transient and persists save as a versioned layout", () => {
    const original = getHudLayoutSnapshot().layout.hero;
    beginHudLayoutEdit();
    updateHudWidget("hero", { x: 0.42, y: 0.36, scale: 1.25 });
    cancelHudLayoutEdit();
    expect(getHudLayoutSnapshot().layout.hero).toEqual(original);
    expect(localStorage.getItem(HUD_LAYOUT_STORAGE_KEY)).toBeNull();

    beginHudLayoutEdit();
    updateHudWidget("hero", { x: 0.42, y: 0.36, scale: 1.25 });
    saveHudLayoutEdit();

    expect(getHudLayoutSnapshot()).toMatchObject({
      editing: false,
      layout: { hero: { x: 0.42, y: 0.36, scale: 1.25 } },
    });
    expect(JSON.parse(localStorage.getItem(HUD_LAYOUT_STORAGE_KEY) ?? "null")).toMatchObject({
      version: 1,
      widgets: { hero: { x: 0.42, y: 0.36, scale: 1.25 } },
    });

    reloadHudLayout();
    expect(getHudLayoutSnapshot().layout.hero).toEqual({ x: 0.42, y: 0.36, scale: 1.25 });
  });

  it("falls back widget-by-widget when persisted data is incomplete or corrupted", () => {
    const defaults = defaultHudLayout({ width: window.innerWidth, height: window.innerHeight });
    localStorage.setItem(
      HUD_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        widgets: {
          chat: { x: 0.7, y: 0.3, scale: 1.4 },
          minimap: { x: "bad", y: 0.2, scale: 1 },
        },
      }),
    );
    reloadHudLayout();

    expect(getHudLayoutSnapshot().layout.chat).toEqual({ x: 0.7, y: 0.3, scale: 1.4 });
    expect(getHudLayoutSnapshot().layout.minimap).toEqual(defaults.minimap);
    expect(getHudLayoutSnapshot().layout["quick-items"]).toEqual(defaults["quick-items"]);
    expect(getHudLayoutSnapshot().layout["peasant-resources"]).toEqual(
      defaults["peasant-resources"],
    );
    expect(defaults["peasant-resources"].x).toBeGreaterThan(0.75);
    expect(defaults["peasant-resources"].scale).toBeLessThan(1);
  });

  it("moves and resizes one widget without changing the others", () => {
    beginHudLayoutEdit();
    const skillBefore = getHudLayoutSnapshot().layout["skill-2"];
    render(
      <HudLayoutWidget id="hero">
        <div>Hero frame</div>
      </HudLayoutWidget>,
    );
    const before = getHudLayoutSnapshot().layout.hero;
    const move = screen.getByRole("button", { name: "Move Hero portrait" });
    move.setPointerCapture = vi.fn();
    move.releasePointerCapture = vi.fn();
    move.hasPointerCapture = vi.fn(() => true);

    fireEvent.pointerDown(move, { button: 0, pointerId: 4, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(move, { pointerId: 4, clientX: 180, clientY: 145 });
    fireEvent.pointerUp(move, { pointerId: 4, clientX: 180, clientY: 145 });
    fireEvent.keyDown(move, { key: "+" });

    const after = getHudLayoutSnapshot().layout.hero;
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeGreaterThan(before.y);
    expect(after.scale).toBeCloseTo(1.1);
    expect(getHudLayoutSnapshot().layout["skill-2"]).toEqual(skillBefore);
  });

  it("offers reset, cancel and save controls while editing", async () => {
    beginHudLayoutEdit();
    const view = render(<HudLayoutEditor />);
    expect(screen.getByRole("dialog", { name: "Interface editor" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Interface editor" })).toHaveAttribute(
      "data-text-surface",
      "information",
    );
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(getHudLayoutSnapshot().editing).toBe(false);

    beginHudLayoutEdit();
    view.rerender(<HudLayoutEditor />);
    updateHudWidget("xp", { x: 0.4, y: 0.8, scale: 1.2 });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(getHudLayoutSnapshot().editing).toBe(false);
    expect(localStorage.getItem(HUD_LAYOUT_STORAGE_KEY)).not.toBeNull();
  });
});
