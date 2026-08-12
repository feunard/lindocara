import { setLocale } from "@lindocara/client/i18n.js";
import { activePartyAtom } from "@lindocara/client/state/atoms.js";
import { type GameHandle, useUiStore } from "@lindocara/client/store.js";
import { Hud } from "@lindocara/client/ui/hud/Hud.js";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithAlepha } from "alepha/react/testing";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Hud", () => {
  let alephaInstances: Array<{ stop(): Promise<void> }> = [];

  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({ campBank: null });
  });

  afterEach(async () => {
    for (const alepha of alephaInstances) await alepha.stop();
    alephaInstances = [];
  });

  async function renderHud() {
    const result = await renderWithAlepha(<Hud />);
    alephaInstances.push(result.alepha);
    return result;
  }

  it("renders identity, bars and quest without the old inventory or party panels", async () => {
    useUiStore.setState({
      self: {
        nick: "Hero",
        level: 3,
        hp: 80,
        maxHp: 124,
        breath: { current: 7, max: 11 },
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
        displacement: { seq: 0, x: 0, y: 0, z: 0 },
        inventory: { potions: 2, gold: 9, crystals: 1 },
        quest: { status: "active", progress: 1, target: 3 },
      },
      attackCooldownUntil: performance.now() + 1_000,
    });
    await renderHud();
    expect(document.querySelector('[data-portrait-kind="unit"]')).toBeInTheDocument();
    expect(document.querySelector("#target-frame, .target-frame, [data-target-frame]")).toBeNull();
    expect(screen.getByText("Hero")).toBeInTheDocument();
    expect(screen.getByText("Level 3")).toBeInTheDocument();
    expect(screen.getByText("80/124")).toBeInTheDocument();
    expect(screen.getByText("Breath")).toBeInTheDocument();
    expect(screen.getByText("7/11")).toBeInTheDocument();
    expect(screen.getByText("40/220")).toBeInTheDocument();
    expect(
      document.querySelector('.action-dock__experience [data-variant="xp"]'),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-hud-widget="hero"]')).toBeInTheDocument();
    expect(document.querySelector('[data-hud-widget="quick-items"]')).toBeInTheDocument();
    expect(document.querySelector('[data-hud-widget="peasant-resources"]')).toBeInTheDocument();
    expect(document.querySelector('[data-hud-widget="xp"]')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-hud-widget^="skill-"]')).toHaveLength(4);
    expect(document.querySelector('#hud [data-variant="xp"]')).not.toBeInTheDocument();
    expect(
      screen.getByText("Gather heartwood, provisions, then sun-ore (1/3)"),
    ).toBeInTheDocument();
    expect(document.querySelector("#hud .inventory")).not.toBeInTheDocument();
    expect(document.querySelector("#hud .party")).not.toBeInTheDocument();
    expect(document.querySelector("#hud .combat")).not.toBeInTheDocument();
    expect(screen.queryByText("Strike")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch character" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
    // FR toggle re-renders live
    setLocale("fr");
    expect(screen.getByText("Niveau 3")).toBeInTheDocument();
  });

  it("shows authored quest progress without leaking the compiled quest into an authored party", async () => {
    useUiStore.setState({
      self: {
        nick: "Questkeeper",
        level: 3,
        hp: 100,
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
        life: "alive",
        corpse: null,
        displacement: { seq: 0, x: 0, y: 0, z: 0 },
        inventory: { potions: 2, gold: 9, crystals: 1 },
        quest: { status: "active", progress: 1, target: 3 },
        authoredQuests: [
          {
            id: "0001",
            title: "Clear the old road",
            description: "Defeat the prowling beasts.",
            journalSummary: "Make the road safe.",
            category: "main",
            region: "Old road",
            landmark: "Eastern gate",
            giverName: "Warden Mira",
            knownConsequence: "Travellers can return.",
            recommendedLevel: 3,
            scope: "party",
            repeatable: false,
            abandonable: true,
            completion: "turn-in",
            objectiveMode: "simultaneous",
            status: "active",
            objectives: [
              {
                id: "0001",
                label: "Defeat the beasts",
                progress: 2,
                target: 3,
                rule: {
                  id: "0001",
                  type: "manual",
                  label: "Defeat the beasts",
                  target: 3,
                  optional: false,
                  hidden: false,
                  stage: 0,
                },
              },
            ],
            rewards: { experience: 25, gold: 5, items: [], choices: [] },
          },
        ],
      },
    });

    const { alepha } = await renderHud();
    await act(async () => {
      alepha.store.set(activePartyAtom, {
        id: "party-1",
        name: "Road patrol",
        adventureId: "adventure-1",
        adventureTitle: "The old road",
        maxPlayers: 4,
        status: "open",
        hostAccountId: "account-1",
        colors: ["blue"],
        mine: true,
        myColor: "blue",
      });
    });

    expect(
      screen.queryByText("Gather heartwood, provisions, then sun-ore (1/3)"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Clear the old road")).toBeInTheDocument();
    expect(screen.getByText("Defeat the beasts: 2 / 3")).toBeInTheDocument();
  });

  it("shows the class name and a heal bar for priests", async () => {
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
        displacement: { seq: 0, x: 0, y: 0, z: 0 },
        inventory: { potions: 2, gold: 0, crystals: 0 },
        quest: { status: "available", progress: 0, target: 3 },
      },
      healCooldownUntil: performance.now() + 1000,
    });
    await renderHud();
    expect(screen.getByText("Priest")).toBeInTheDocument();
    expect(screen.getAllByText("Mend")).toHaveLength(2);
    expect(screen.getAllByRole("progressbar")).toHaveLength(3); // vit, spark, heal cooldown
  });

  it("makes a timed quest and locked skill requirements explicit", async () => {
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
        displacement: { seq: 0, x: 0, y: 0, z: 0 },
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
    await renderHud();
    expect(screen.getByText(/WARD RUN: 1[45]s/)).toBeInTheDocument();
    expect(
      screen.queryByText("A reliable close-range sweep in your facing direction."),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Unlocks at level 5").length).toBeGreaterThan(0);
  });

  it("never shows the heal bar for non-priests, even mid-cooldown", async () => {
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
        displacement: { seq: 0, x: 0, y: 0, z: 0 },
        inventory: { potions: 2, gold: 0, crystals: 0 },
        quest: { status: "available", progress: 0, target: 3 },
      },
      healCooldownUntil: performance.now() + 1000,
    });
    await renderHud();
    expect(screen.getByText("Warrior")).toBeInTheDocument();
    expect(screen.queryByText("Mend")).not.toBeInTheDocument();
    expect(screen.getAllByRole("progressbar")).toHaveLength(2); // vit, spark only
  });

  it("shows the authoritative class resource while keeping the party panel hidden", async () => {
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
        displacement: { seq: 0, x: 0, y: 0, z: 0 },
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
    await renderHud();
    expect(screen.getByText("MP")).toBeInTheDocument();
    expect(screen.getByText("45/100")).toBeInTheDocument();
    expect(screen.queryByText("Ally")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disband party" })).not.toBeInTheDocument();
  });

  it("renders the shared camp chest and sends amount-only transfer intent", async () => {
    const campGold = vi.fn();
    useUiStore.setState({
      self: {
        nick: "Camper",
        level: 4,
        hp: 100,
        maxHp: 124,
        life: "alive",
        corpseDistance: null,
        class: "warrior",
        appearance: { body: "wayfarer", primaryColor: "moss" },
        equipment: { mainHand: "weathered_sword", offHand: "oak_shield" },
      },
      selfState: {
        xp: 0,
        xpToNext: 220,
        life: "alive",
        corpse: null,
        displacement: { seq: 0, x: 0, y: 0, z: 0 },
        inventory: { potions: 0, gold: 90, crystals: 0 },
        quest: { status: "available", progress: 0, target: 3 },
      },
      campBank: { id: "camp-1", gold: 40 },
      game: { campGold } as unknown as GameHandle,
    });
    await renderHud();
    expect(screen.getByRole("dialog", { name: "Camp chest" })).toBeInTheDocument();
    expect(screen.getByText("Available to every hero in the party")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Gold amount" }), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));
    expect(campGold).toHaveBeenCalledWith("camp-1", "deposit", 25);
    fireEvent.click(screen.getByRole("button", { name: "Close chest" }));
    expect(useUiStore.getState().campBank).toBeNull();
  });
});
