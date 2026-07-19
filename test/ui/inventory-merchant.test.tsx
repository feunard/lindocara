import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import type { GameHandle } from "../../src/client/store.js";
import { useUiStore } from "../../src/client/store.js";
import { QuickItemBar } from "../../src/client/ui/hud/QuickItemBar.js";
import { InventoryOverlay } from "../../src/client/ui/InventoryOverlay.js";
import { MerchantOverlay } from "../../src/client/ui/MerchantOverlay.js";
import { emptyConsumables } from "../../src/shared/consumables.js";

function gameHandle(): GameHandle {
  return {
    attack: vi.fn(),
    interact: vi.fn(),
    usePotion: vi.fn(),
    useItem: vi.fn(),
    buyItem: vi.fn(),
    release: vi.fn(),
    castSkill: vi.fn(),
    sendChat: vi.fn(),
    switchCharacter: vi.fn(),
    logout: vi.fn(),
    attachMinimap: vi.fn(),
    attachWorldMap: vi.fn(),
  };
}

describe("merchant and inventory", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({
      inventoryOpen: false,
      merchantOpen: false,
      quickItems: ["health_potion", "mana_potion", "invisibility_potion"],
      game: null,
      self: {
        nick: "Mira",
        level: 4,
        hp: 70,
        maxHp: 100,
        life: "alive",
        corpseDistance: null,
        class: "priest",
        appearance: { body: "wayfarer", primaryColor: "azure" },
        equipment: { mainHand: "heartwood_staff", offHand: null },
      },
      selfState: {
        xp: 0,
        xpToNext: 100,
        life: "alive",
        corpse: null,
        serverNow: 1_000,
        consumableCooldownUntil: 0,
        inventory: {
          potions: 2,
          gold: 20,
          crystals: 5,
          consumables: { ...emptyConsumables(2), mana_potion: 1 },
        },
        quest: { status: "available", progress: 0, target: 3 },
      },
    });
  });

  it("assigns an owned item to any quick slot", async () => {
    useUiStore.setState({ inventoryOpen: true, game: gameHandle() });
    render(<InventoryOverlay />);

    const manaCard = screen.getByText("Lumen phial").closest("article");
    if (!manaCard) throw new Error("mana card missing");
    await userEvent.click(within(manaCard).getByRole("button", { name: "3" }));
    expect(useUiStore.getState().quickItems[2]).toBe("mana_potion");
  });

  it("sends only the selected item id when buying", async () => {
    const game = gameHandle();
    useUiStore.setState({ merchantOpen: true, game });
    render(<MerchantOverlay />);

    const healthCard = screen.getByText("Heartroot tonic").closest("article");
    if (!healthCard) throw new Error("health card missing");
    await userEvent.click(within(healthCard).getByRole("button", { name: /8/ }));
    expect(game.buyItem).toHaveBeenCalledWith("health_potion");
  });

  it("uses quick items and shows the authoritative inventory count", async () => {
    const game = gameHandle();
    useUiStore.setState({ game });
    render(<QuickItemBar />);

    const health = screen.getByRole("button", { name: "Use Heartroot tonic" });
    expect(health).toHaveTextContent("×2");
    await userEvent.click(health);
    expect(game.useItem).toHaveBeenCalledWith("health_potion");
  });
});
