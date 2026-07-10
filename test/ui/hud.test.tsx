import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { Hud } from "../../src/client/ui/hud/Hud.js";

describe("Hud", () => {
  beforeEach(() => setLocale("en"));

  it("renders identity, bars, quest and inventory from the store", () => {
    useUiStore.setState({
      self: { nick: "Hero", level: 3, hp: 80, maxHp: 124, dead: false },
      selfState: {
        xp: 40,
        xpToNext: 220,
        inventory: { potions: 2, gold: 9, crystals: 1, weapon: "rusty_sword" },
        quest: { status: "active", progress: 1, target: 3 },
      },
    });
    render(<Hud />);
    expect(screen.getByText("Hero")).toBeInTheDocument();
    expect(screen.getByText("Level 3")).toBeInTheDocument();
    expect(screen.getByText("80/124")).toBeInTheDocument();
    expect(screen.getByText("40/220")).toBeInTheDocument();
    expect(screen.getByText("Quiet gloam creatures in the woods (1/3)")).toBeInTheDocument();
    expect(screen.getByText("Heartroot tonic")).toBeInTheDocument();
    // FR toggle re-renders live
    setLocale("fr");
    expect(screen.getByText("Niveau 3")).toBeInTheDocument();
  });
});
