import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { Hud } from "../../src/client/ui/hud/Hud.js";

describe("Hud", () => {
  beforeEach(() => setLocale("en"));

  it("renders identity, bars, quest and inventory from the store", () => {
    useUiStore.setState({
      self: {
        nick: "Hero",
        level: 3,
        hp: 80,
        maxHp: 124,
        life: "alive",
        corpseDistance: null,
        class: "warrior",
        appearance: { body: "wayfarer", primaryColor: "azure" },
        equipment: { mainHand: "weathered_sword", offHand: "oak_shield" },
      },
      selfState: {
        xp: 40,
        xpToNext: 220,
        life: "alive" as const,
        corpse: null,
        inventory: { potions: 2, gold: 9, crystals: 1 },
        quest: { status: "active", progress: 1, target: 3 },
      },
    });
    render(<Hud />);
    expect(document.querySelector('[data-portrait-kind="unit"]')).toBeInTheDocument();
    expect(screen.getByText("Hero")).toBeInTheDocument();
    expect(screen.getByText("Level 3")).toBeInTheDocument();
    expect(screen.getByText("80/124")).toBeInTheDocument();
    expect(screen.getByText("40/220")).toBeInTheDocument();
    expect(
      screen.getByText("Gather heartwood, provisions, then sun-ore (1/3)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Heartroot tonic")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch character" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
    // FR toggle re-renders live
    setLocale("fr");
    expect(screen.getByText("Niveau 3")).toBeInTheDocument();
  });

  it("shows the class name and a heal bar for priests", () => {
    useUiStore.setState({
      self: {
        nick: "Mercy",
        level: 1,
        hp: 100,
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
        life: "alive" as const,
        corpse: null,
        inventory: { potions: 2, gold: 0, crystals: 0 },
        quest: { status: "available", progress: 0, target: 3 },
      },
      healCooldownUntil: performance.now() + 1000,
    });
    render(<Hud />);
    expect(screen.getByText("Priest")).toBeInTheDocument();
    expect(screen.getAllByText("Mend")).toHaveLength(2);
    expect(screen.getAllByRole("progressbar")).toHaveLength(3); // vit, spark, heal cooldown
  });

  it("makes a timed quest and locked skill requirements explicit", () => {
    useUiStore.setState({
      self: {
        nick: "Vanguard",
        level: 1,
        hp: 100,
        maxHp: 100,
        life: "alive",
        corpseDistance: null,
        class: "warrior",
        appearance: { body: "wayfarer", primaryColor: "azure" },
        equipment: { mainHand: "weathered_sword", offHand: "oak_shield" },
      },
      selfState: {
        xp: 0,
        xpToNext: 100,
        life: "alive" as const,
        corpse: null,
        inventory: { potions: 2, gold: 0, crystals: 0 },
        quest: {
          status: "active",
          progress: 0,
          target: 4,
          chapter: "ward_run",
          timerEndsAt: Date.now() + 15_000,
        },
      },
      game: null,
    });
    render(<Hud />);
    expect(screen.getByText(/WARD RUN: 1[45]s/)).toBeInTheDocument();
    expect(
      screen.getByText("A reliable close-range strike against the nearest enemy."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Unlocks at level 5").length).toBeGreaterThan(0);
  });

  it("never shows the heal bar for non-priests, even mid-cooldown", () => {
    useUiStore.setState({
      self: {
        nick: "Bruiser",
        level: 1,
        hp: 100,
        maxHp: 100,
        life: "alive",
        corpseDistance: null,
        class: "warrior",
        appearance: { body: "wayfarer", primaryColor: "azure" },
        equipment: { mainHand: "weathered_sword", offHand: "oak_shield" },
      },
      selfState: {
        xp: 0,
        xpToNext: 100,
        life: "alive" as const,
        corpse: null,
        inventory: { potions: 2, gold: 0, crystals: 0 },
        quest: { status: "available", progress: 0, target: 3 },
      },
      healCooldownUntil: performance.now() + 1000,
    });
    render(<Hud />);
    expect(screen.getByText("Warrior")).toBeInTheDocument();
    expect(screen.queryByText("Mend")).not.toBeInTheDocument();
    expect(screen.getAllByRole("progressbar")).toHaveLength(2); // vit, spark only
  });

  it("shows the authoritative class resource and same-zone party health", () => {
    useUiStore.setState({
      self: {
        id: "11111111-1111-4111-8111-111111111111",
        nick: "Mender",
        level: 4,
        hp: 88,
        maxHp: 124,
        life: "alive",
        corpseDistance: null,
        class: "priest",
        appearance: { body: "wayfarer", primaryColor: "azure" },
        equipment: { mainHand: "heartwood_staff", offHand: null },
      },
      selfState: {
        xp: 10,
        xpToNext: 220,
        life: "alive",
        corpse: null,
        resource: { kind: "mana", current: 45, max: 100 },
        inventory: { potions: 2, gold: 0, crystals: 0 },
        quest: { status: "available", progress: 0, target: 3 },
      },
      party: {
        id: "22222222-2222-4222-8222-222222222222",
        leaderId: "11111111-1111-4111-8111-111111111111",
        members: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            nick: "Ally",
            hp: 55,
            maxHp: 100,
            life: "alive",
          },
        ],
      },
    });
    render(<Hud />);
    expect(screen.getByText("Mana")).toBeInTheDocument();
    expect(screen.getByText("45/100")).toBeInTheDocument();
    expect(screen.getByText("Ally")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disband party" })).toBeInTheDocument();
  });
});
