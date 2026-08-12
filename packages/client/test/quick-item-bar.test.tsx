import { setLocale } from "@lindocara/client/i18n.js";
import { type GameHandle, useUiStore } from "@lindocara/client/store.js";
import { QuickItemBar } from "@lindocara/client/ui/hud/QuickItemBar.js";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithAlepha } from "alepha/react/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("QuickItemBar", () => {
  let stopAlepha: (() => Promise<void>) | null = null;

  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({
      self: {
        nick: "D-pad tester",
        level: 1,
        hp: 100,
        maxHp: 100,
        life: "alive",
        corpseDistance: null,
        class: "warrior",
        appearance: { body: "wayfarer", primaryColor: "moss" },
        equipment: { mainHand: "weathered_sword", offHand: "oak_shield" },
      },
      selfState: {
        xp: 0,
        xpToNext: 100,
        life: "alive",
        corpse: null,
        displacement: { seq: 0, x: 0, y: 0, z: 0 },
        inventory: { potions: 2, gold: 0, crystals: 0 },
        quest: { status: "available", progress: 0, target: 3 },
      },
      inventoryOpen: false,
      game: { useItem: vi.fn() } as unknown as GameHandle,
    });
  });

  afterEach(async () => {
    await stopAlepha?.();
    stopAlepha = null;
  });

  it("lays out three items and the inventory action without mapped-key labels", async () => {
    const { alepha } = await renderWithAlepha(<QuickItemBar />);
    stopAlepha = () => alepha.stop();

    const bar = document.querySelector(".quick-item-bar");
    expect(bar).toBeInTheDocument();
    expect(bar?.querySelector(".quick-item-bar__slot--left")).toBeInTheDocument();
    expect(bar?.querySelector(".quick-item-bar__slot--up")).toBeInTheDocument();
    expect(bar?.querySelector(".quick-item-bar__slot--right")).toBeInTheDocument();
    expect(bar?.querySelector(".quick-item-bar__slot--down")).toBeInTheDocument();
    expect(bar?.querySelectorAll(".quick-item-bar__key")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Inventory" }));
    expect(useUiStore.getState().inventoryOpen).toBe(true);
  });
});
