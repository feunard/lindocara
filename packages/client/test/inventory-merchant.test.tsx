import { setLocale } from "@lindocara/client/i18n.js";
import { quickItemsAtom } from "@lindocara/client/state/atoms.js";
import type { GameHandle } from "@lindocara/client/store.js";
import { useUiStore } from "@lindocara/client/store.js";
import { QuickItemBar } from "@lindocara/client/ui/hud/QuickItemBar.js";
import { InventoryOverlay } from "@lindocara/client/ui/InventoryOverlay.js";
import { MerchantOverlay } from "@lindocara/client/ui/MerchantOverlay.js";
import { emptyConsumables } from "@lindocara/engine/consumables.js";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithAlepha } from "alepha/react/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    returnToTitle: vi.fn(),
    attachMinimap: vi.fn(),
    attachWorldMap: vi.fn(),
  };
}

describe("merchant and inventory", () => {
  let alephaInstances: Array<{ stop(): Promise<void> }> = [];

  beforeEach(() => {
    setLocale("en");
    localStorage.removeItem("lindocara.quickItems");
    useUiStore.setState({
      inventoryOpen: false,
      merchantOpen: false,
      merchantOffers: [],
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

  afterEach(async () => {
    for (const alepha of alephaInstances) await alepha.stop();
    alephaInstances = [];
    localStorage.removeItem("lindocara.quickItems");
  });

  async function render(element: React.ReactElement) {
    const result = await renderWithAlepha(element);
    alephaInstances.push(result.alepha);
    return result;
  }

  it("assigns an owned item to any quick slot", async () => {
    useUiStore.setState({ inventoryOpen: true, game: gameHandle() });
    const view = await render(<InventoryOverlay />);

    expect(screen.getByLabelText("20 Sunmarks")).toBeInTheDocument();
    expect(screen.getByLabelText("5 Gloam shards")).toBeInTheDocument();
    expect(view.container.querySelector(".currency-amount__icon--gold")).not.toBeNull();
    expect(view.container.querySelector(".currency-amount__icon--crystal")).not.toBeNull();
    expect(view.container.querySelector(".item-icon--gold, .item-icon--crystal")).toBeNull();
    const manaCard = screen.getByText("Lumen phial").closest("article");
    if (!manaCard) throw new Error("mana card missing");
    await userEvent.click(within(manaCard).getByRole("button", { name: "3" }));
    expect(view.alepha.store.get(quickItemsAtom)[2]).toBe("mana_potion");
  });

  it("sends only the selected item id when buying", async () => {
    const game = gameHandle();
    useUiStore.setState({
      merchantOpen: true,
      merchantOffers: [{ item: "health_potion", remaining: 2 }],
      game,
    });
    const view = await render(<MerchantOverlay />);

    expect(screen.getByLabelText("20 Sunmarks")).toBeInTheDocument();
    expect(screen.getByLabelText("5 Gloam shards")).toBeInTheDocument();
    expect(view.container.querySelector(".currency-amount__icon--gold")).not.toBeNull();
    expect(view.container.querySelector(".currency-amount__icon--crystal")).not.toBeNull();
    expect(view.container.querySelector(".item-icon--gold, .item-icon--crystal")).toBeNull();
    const healthCard = screen.getByText("Heartroot tonic").closest("article");
    if (!healthCard) throw new Error("health card missing");
    await userEvent.click(within(healthCard).getByRole("button", { name: /8/ }));
    expect(game.buyItem).toHaveBeenCalledWith("health_potion");
    expect(healthCard).toHaveTextContent("Stock: 2");
  });

  it("disables a sold-out article", async () => {
    const game = gameHandle();
    useUiStore.setState({
      merchantOpen: true,
      merchantOffers: [{ item: "health_potion", remaining: 0 }],
      game,
    });
    await render(<MerchantOverlay />);

    const healthCard = screen.getByText("Heartroot tonic").closest("article");
    if (!healthCard) throw new Error("health card missing");
    expect(within(healthCard).getByRole("button", { name: /8/ })).toBeDisabled();
  });

  it("uses quick items and shows the authoritative inventory count", async () => {
    const game = gameHandle();
    useUiStore.setState({ game });
    await render(<QuickItemBar />);

    const health = screen.getByRole("button", { name: "Use Heartroot tonic" });
    expect(health).toHaveTextContent("×2");
    await userEvent.click(health);
    expect(game.useItem).toHaveBeenCalledWith("health_potion");
  });
});
