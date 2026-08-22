import { setLocale, t } from "@lindocara/client/i18n.js";
import { defaultEventPage } from "@lindocara/editor/game/editor-state.js";
import { EventDialog } from "@lindocara/editor/ui/editor/EventDialog.js";
import { type AdventureRegistry, EMPTY_REGISTRY } from "@lindocara/engine/adventure-state.js";
import { MONSTER_RESPAWN_MS } from "@lindocara/engine/game.js";
import { harvestPreset, harvestProfileFromPreset } from "@lindocara/engine/harvest-presets.js";
import type { HarvestProfile } from "@lindocara/engine/harvest.js";
import type { MapEvent } from "@lindocara/engine/map-events.js";
import {
  DEFAULT_GUARD_APPEARANCE_ASSET_ID,
  type EditorAssetId,
} from "@lindocara/engine/tiny-swords-catalog.js";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** A fresh single-page event to seed the dialog draft with, at the given ordinal/cell. */
function seedEvent(overrides: Partial<MapEvent> = {}): MapEvent {
  return {
    id: "ev-1",
    col: 3,
    row: 4,
    name: "",
    ordinal: 1,
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages: [defaultEventPage()],
    ...overrides,
  };
}

function renderDialog(event: MapEvent, registry: AdventureRegistry = EMPTY_REGISTRY) {
  const onCommit = vi.fn();
  const onDelete = vi.fn();
  const onCancel = vi.fn();
  const rendered = render(
    <EventDialog
      event={event}
      registry={registry}
      maps={[]}
      onCommit={onCommit}
      onDelete={onDelete}
      onCancel={onCancel}
      onOpenHelp={() => {}}
    />,
  );
  return { onCommit, onDelete, onCancel, unmount: rendered.unmount };
}

const RUNTIME_REGISTRY = {
  switches: [{ id: "0042", name: "Gate open" }],
  variables: [{ id: "0007", name: "Guard visits" }],
} satisfies AdventureRegistry;

describe("EventDialog", () => {
  beforeEach(() => {
    setLocale("en");
  });

  /** The page's fields live in three tabs now (conditions, appearance, actions), so a test reaches
   *  a control the way an author does: by opening the tab that holds it. */
  const openTab = async (user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> => {
    await user.click(screen.getByRole("tab", { name }));
  };

  it("lets every event hide its generated locator ring with an explicit explanation", async () => {
    const { onCommit } = renderDialog(seedEvent());
    const marker = screen.getByRole("checkbox", { name: t("editor.event.marker.visible") });

    expect(marker).toBeChecked();
    expect(screen.getByText(t("editor.event.marker.visible.hint"))).toBeVisible();
    await userEvent.click(marker);
    await userEvent.click(screen.getByRole("button", { name: t("editor.event.save") }));

    expect(onCommit.mock.calls[0]?.[0]).toMatchObject({ showMarker: false });
  });

  it("round-trips runtime-backed controls across two pages with explicit nulls", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderDialog(seedEvent(), RUNTIME_REGISTRY);

    // Header: name.
    await user.type(screen.getByRole("textbox", { name: t("editor.event.name") }), "Guard");

    // Page 1: named state condition; Player-touch trigger; front draw layer.
    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") }));
    expect(screen.getByRole("combobox", { name: t("editor.event.cond.switch") })).toHaveValue(
      "0042",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: t("editor.event.trigger") }),
      "player-touch",
    );
    await openTab(user, t("editor.event.appearance"));
    await user.click(screen.getByRole("checkbox", { name: t("editor.event.opt.onTop") }));
    await openTab(user, t("editor.event.conditions"));

    // Add page 2 (auto-selected) and author a different set of fields there.
    await user.click(screen.getByRole("button", { name: t("editor.event.page.add") }));
    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.variable") }));
    expect(screen.getByRole("combobox", { name: t("editor.event.cond.variable") })).toHaveValue(
      "0007",
    );
    const varMin = screen.getByRole("spinbutton", { name: t("editor.event.cond.variable.min") });
    await user.clear(varMin);
    await user.type(varMin, "5");
    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.selfSwitch") }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: t("editor.event.cond.selfSwitch") }),
      "B",
    );
    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));

    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0]?.[0] as MapEvent;
    expect(committed.name).toBe("Guard");
    expect(committed.pages).toHaveLength(2);

    // Page 1 got page-1 edits and nothing from page 2 (the mutation-proof: a save that wrote to the
    // wrong page index would cross these fields).
    const [p1, p2] = committed.pages;
    expect(p1?.condSwitchId).toBe("0042");
    expect(p1?.trigger).toBe("player-touch");
    expect(p1?.optOnTop).toBe(true);
    expect(p1?.condVariableId).toBeNull();
    expect(p1?.condVariableMin).toBeNull();
    expect(p1?.condSelfSwitch).toBeNull();

    // Page 2 got page-2 edits only.
    expect(p2?.condVariableId).toBe("0007");
    expect(p2?.condVariableMin).toBe(5);
    expect(p2?.condSelfSwitch).toBe("B");
    expect(p2?.condSwitchId).toBeNull();

    // Explicit nulls, never undefined — the wire parser rejects an absent condition field.
    expect(Object.hasOwn(p1 ?? {}, "condVariableId")).toBe(true);
    expect(p2?.condSwitchId === null).toBe(true);
  }, 15_000);

  it("hides non-runtime movement/options while preserving legacy page data", async () => {
    const page = {
      ...defaultEventPage(),
      moveType: "random" as const,
      moveSpeed: 1,
      moveFreq: 4,
      optMoveAnim: false,
      optStopAnim: true,
      optDirFix: true,
      optThrough: true,
    };
    const { onCommit } = renderDialog(seedEvent({ pages: [page] }));

    expect(screen.queryByRole("combobox", { name: t("editor.event.move.type") })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: t("editor.event.opt.through") })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: t("editor.event.save") }));

    const committed = onCommit.mock.calls[0]?.[0] as MapEvent;
    expect(committed.pages[0]).toMatchObject({
      moveType: "random",
      moveSpeed: 1,
      moveFreq: 4,
      optMoveAnim: false,
      optStopAnim: true,
      optDirFix: true,
      optThrough: true,
    });
  });

  it("authors event-touch, autorun and parallel pages as executable runtime triggers", async () => {
    for (const trigger of ["event-touch", "auto", "parallel"] as const) {
      const { onCommit, unmount } = renderDialog(
        seedEvent({ pages: [{ ...defaultEventPage(), trigger }] }),
      );

      expect(screen.queryByRole("alert")).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: t("editor.event.save") }));
      const committed = onCommit.mock.calls[0]?.[0] as MapEvent;
      expect(committed.pages[0]?.trigger).toBe(trigger);
      unmount();
    }
  });

  it("discards the draft on cancel", async () => {
    const user = userEvent.setup();
    const { onCommit, onCancel } = renderDialog(seedEvent());

    await user.type(screen.getByRole("textbox", { name: t("editor.event.name") }), "Throwaway");
    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") }));
    await user.click(screen.getByRole("button", { name: t("editor.event.cancel") }));

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("commits an empty name as the EV{ordinal} string", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderDialog(seedEvent({ ordinal: 5, name: "" }));

    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));

    expect(onCommit.mock.calls[0]?.[0].name).toBe("EV005");
  });

  it("keeps a refused save's error visible whichever page tab is open", async () => {
    // Tabs hide things, which is the risk they carry. Every field that can REFUSE a save is a
    // kind-specific one and lives outside the page's tabs; nothing inside conditions, appearance or
    // actions validates today. This pins that: move a validated field into a tab and this test says
    // so, instead of an author meeting a save button that does nothing.
    const user = userEvent.setup({ delay: null });
    const { onCommit } = renderDialog(
      seedEvent({
        kind: "guard",
        name: "Garde",
        species: null,
        patrolRadius: 96,
        pages: [{ ...defaultEventPage(), commands: [] }],
      }),
      RUNTIME_REGISTRY,
    );

    const radius = screen.getByRole("spinbutton", { name: t("editor.markers.radius") });
    fireEvent.change(radius, { target: { value: "9999" } });
    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(radius).toHaveAttribute("aria-invalid", "true");

    await openTab(user, t("editor.event.commands"));
    // The same node, still on screen and still refusing: the field is outside the tabs, so opening
    // another one cannot hide the reason a save was refused.
    expect(radius).toBeVisible();
    expect(radius).toHaveAttribute("aria-invalid", "true");
  });

  it("gives every section panel one fixed height, so changing tab never resizes the dialog", async () => {
    // The complaint this pins: each tab was a different height, so the dialog jumped on every tab
    // change and the footer's buttons moved out from under the pointer. The suite runs with
    // `css: false` and cannot measure a rendered box, so it asserts the rule the box comes from -
    // one height class, shared, and the panel scrolls rather than the dialog growing.
    const user = userEvent.setup();
    renderDialog(seedEvent());

    const heights = new Set<string>();
    for (const name of [
      t("editor.event.conditions"),
      t("editor.event.appearance"),
      t("editor.event.commands"),
    ]) {
      await openTab(user, name);
      const panel = screen.getByRole("tabpanel");
      const height = [...panel.classList].find((token) => token.startsWith("h-["));
      expect(height, `${name} has no fixed height`).toBeDefined();
      expect([...panel.classList]).toContain("overflow-y-auto");
      if (height) heights.add(height);
    }
    expect([...heights]).toHaveLength(1);
  });

  it("caps pages at MAX_PAGES_PER_EVENT and disables add there", async () => {
    const user = userEvent.setup();
    renderDialog(seedEvent());

    const add = screen.getByRole("button", { name: t("editor.event.page.add") });
    // From one page, seven adds reach the cap of eight. Scoped to the PAGE tablist: the page's
    // fields are a second tablist beside it now, and an unscoped query counts both.
    for (let i = 0; i < 7; i += 1) await user.click(add);
    const pages = screen.getByRole("tablist", { name: t("editor.event.pages.aria") });
    expect(within(pages).getAllByRole("tab")).toHaveLength(8);
    expect(add).toBeDisabled();
  });

  it("disables delete-page at a single page and removes the selected page otherwise", async () => {
    const user = userEvent.setup();
    const registry = {
      switches: [
        { id: "0001", name: "First phase" },
        { id: "0002", name: "Second phase" },
      ],
      variables: [],
    } satisfies AdventureRegistry;
    const { onCommit } = renderDialog(seedEvent(), registry);

    expect(screen.getByRole("button", { name: t("editor.event.page.delete") })).toBeDisabled();

    // Two pages, each tagged by a distinct named state, then delete page 1 (the mutation-proof: a
    // delete that removed the wrong index would leave the first phase instead of the second).
    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") }));

    await user.click(screen.getByRole("button", { name: t("editor.event.page.add") }));
    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: t("editor.event.cond.switch") }),
      "0002",
    );

    // Select page 1 and delete it.
    await user.click(screen.getByRole("tab", { name: t("editor.event.page.aria", { n: 1 }) }));
    await user.click(screen.getByRole("button", { name: t("editor.event.page.delete") }));
    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));

    const committed = onCommit.mock.calls[0]?.[0] as MapEvent;
    expect(committed.pages).toHaveLength(1);
    expect(committed.pages[0]?.condSwitchId).toBe("0002");
  });

  it("keeps global state conditions unavailable until they have an authored name", () => {
    renderDialog(seedEvent());

    expect(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: t("editor.event.cond.variable") })).toBeDisabled();
    expect(screen.queryByRole("textbox", { name: /state|counter/i })).not.toBeInTheDocument();
    expect(screen.getByText(t("editor.event.cond.switch.empty.hint"))).toBeVisible();
    expect(screen.getByText(t("editor.event.cond.variable.empty.hint"))).toBeVisible();
  });

  it("lets an author remove a legacy reference whose named value was deleted", () => {
    const page = { ...defaultEventPage(), condSwitchId: "0099" };
    const { onCommit } = renderDialog(seedEvent({ pages: [page] }));

    expect(screen.getByRole("combobox", { name: t("editor.event.cond.switch") })).toHaveValue(
      "0099",
    );
    fireEvent.click(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") }));
    fireEvent.click(screen.getByRole("button", { name: t("editor.event.save") }));

    const committed = onCommit.mock.calls[0]?.[0] as MapEvent;
    expect(committed.pages[0]?.condSwitchId).toBeNull();
  });

  it("clamps a negative variable-min threshold to zero on blur", () => {
    renderDialog(seedEvent(), RUNTIME_REGISTRY);

    fireEvent.click(screen.getByRole("checkbox", { name: t("editor.event.cond.variable") }));
    const varMin = screen.getByRole("spinbutton", { name: t("editor.event.cond.variable.min") });
    fireEvent.change(varMin, { target: { value: "-3" } });
    fireEvent.blur(varMin);

    expect(varMin).toHaveValue(0);
  });

  it("deletes the event through the confirm path", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderDialog(seedEvent());

    await user.click(screen.getByRole("button", { name: t("editor.event.delete") }));
    // The confirm dialog opens; its own destructive button fires onDelete.
    const confirm = screen
      .getByText(t("editor.event.delete.confirm.title"))
      .closest('[data-slot="dialog-content"]');
    if (!(confirm instanceof HTMLElement)) throw new Error("confirm dialog not found");
    await user.click(within(confirm).getByRole("button", { name: t("editor.event.delete") }));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("round-trips freely authored zero stats and a five-digit XP reward", async () => {
    // `delay: null` batches the clear+type keystrokes into one synchronous act() flush instead of
    // pacing them with real `setTimeout`s. Vitest runs multiple test files concurrently inside one
    // worker's single JS thread; a sibling file's synchronous work (e.g. a heavy render loop) can
    // starve those timers between two keystrokes of *this* interaction and strand the number input
    // at its post-clear value. This is CPU-contention, not shared state — see
    // .superpowers/sdd/pollution-fix-report.md.
    const user = userEvent.setup({ delay: null });
    const { onCommit } = renderDialog(
      seedEvent({ kind: "monster", species: "spear_goblin", patrolRadius: 96 }),
    );

    // A functional kind hides the whole scripted editor: no page tabs, no condition checkboxes.
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("button", { name: t("editor.event.cmd.insert") })).toBeEnabled();
    expect(
      screen.queryByRole("checkbox", { name: t("editor.event.cond.switch") }),
    ).not.toBeInTheDocument();

    // Every non-negative authored value is valid, including stationary/harmless tuning.
    expect(screen.getByRole("combobox", { name: t("editor.markers.species") })).toBeInTheDocument();
    const attackProfile = screen.getByRole("combobox", {
      name: t("editor.monster.attackProfile"),
    });
    expect(attackProfile).toHaveValue("natural");
    await user.selectOptions(attackProfile, "arrow");
    const radius = screen.getByRole("spinbutton", { name: t("editor.markers.radius") });
    await user.clear(radius);
    await user.type(radius, "0");
    fireEvent.change(screen.getByRole("spinbutton", { name: t("editor.monster.hp") }), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: t("editor.monster.damage") }), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: t("editor.monster.speed") }), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: t("editor.monster.xp") }), {
      target: { value: "10000" },
    });
    fireEvent.change(
      screen.getByRole("spinbutton", { name: t("editor.monster.weaknessPercent") }),
      { target: { value: "0" } },
    );
    const respawnDelay = screen.getByRole("spinbutton", {
      name: t("editor.monster.respawnDelay"),
    });
    expect(respawnDelay).toHaveValue(MONSTER_RESPAWN_MS / 1_000);
    fireEvent.change(respawnDelay, { target: { value: "75" } });
    await user.selectOptions(
      screen.getByRole("combobox", { name: t("editor.monster.respawnMode") }),
      "never",
    );
    expect(
      screen.queryByRole("spinbutton", { name: t("editor.monster.respawnDelay") }),
    ).not.toBeInTheDocument();
    await user.selectOptions(
      screen.getByRole("combobox", { name: t("editor.monster.pursuitMode") }),
      "relentless",
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: t("editor.monster.acceleration") }), {
      target: { value: "0.8" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: t("editor.monster.maxSpeed") }), {
      target: { value: "6" },
    });
    await user.click(screen.getByRole("checkbox", { name: t("editor.monster.oneHitKill") }));
    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));

    const committed = onCommit.mock.calls[0]?.[0] as MapEvent;
    expect(committed.kind).toBe("monster");
    expect(committed.species).toBe("spear_goblin");
    expect(committed.patrolRadius).toBe(0);
    expect(committed.monsterMaxHp).toBe(0);
    expect(committed.monsterDamage).toBe(0);
    expect(committed.monsterSpeed).toBe(0);
    expect(committed.monsterXp).toBe(10_000);
    expect(committed.monsterWeaknessPercent).toBe(0);
    expect(committed.monsterAttackProfile).toBe("arrow");
    expect(committed.monsterRespawnMode).toBe("never");
    expect(committed.monsterRespawnDelayMs).toBe(75_000);
    expect(committed.monsterPursuitMode).toBe("relentless");
    expect(committed.monsterAcceleration).toBe(0.8);
    expect(committed.monsterMaxSpeed).toBe(6);
    expect(committed.monsterOneHitKill).toBe(true);
    // A functional event stays single-page — the wire parser refuses extra pages.
    expect(committed.pages).toHaveLength(1);
  });

  it("rejects out-of-bounds monster stats and explains each limit below its field", async () => {
    const user = userEvent.setup({ delay: null });
    const { onCommit } = renderDialog(
      seedEvent({ kind: "monster", species: "spear_goblin", patrolRadius: 96 }),
    );
    const fields = {
      patrolRadius: screen.getByRole("spinbutton", { name: t("editor.markers.radius") }),
      respawnDelay: screen.getByRole("spinbutton", {
        name: t("editor.monster.respawnDelay"),
      }),
      maxHp: screen.getByRole("spinbutton", { name: t("editor.monster.hp") }),
      damage: screen.getByRole("spinbutton", { name: t("editor.monster.damage") }),
      speed: screen.getByRole("spinbutton", { name: t("editor.monster.speed") }),
      xp: screen.getByRole("spinbutton", { name: t("editor.monster.xp") }),
      weaknessPercent: screen.getByRole("spinbutton", {
        name: t("editor.monster.weaknessPercent"),
      }),
    };

    fireEvent.change(fields.patrolRadius, { target: { value: "769" } });
    fireEvent.change(fields.respawnDelay, { target: { value: "86401" } });
    fireEvent.change(fields.maxHp, { target: { value: "100001" } });
    fireEvent.change(fields.damage, { target: { value: "12.5" } });
    fireEvent.change(fields.speed, { target: { value: "301" } });
    fireEvent.change(fields.xp, { target: { value: "-1" } });
    fireEvent.change(fields.weaknessPercent, { target: { value: "401" } });
    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));

    expect(onCommit).not.toHaveBeenCalled();
    for (const input of Object.values(fields)) {
      expect(input).toHaveAttribute("aria-invalid", "true");
      const errorId = input.getAttribute("aria-describedby");
      expect(errorId).toBeTruthy();
      expect(document.getElementById(errorId ?? "")).toBeVisible();
    }
    expect(document.getElementById("monster-damage-error")).toHaveTextContent(
      t("editor.event.validation.integer", { min: 0, max: 1_000 }),
    );
    expect(document.getElementById("monster-respawn-delay-error")).toHaveTextContent(
      t("editor.event.validation.range", { min: 1, max: 86_400 }),
    );

    fireEvent.change(fields.damage, { target: { value: "12" } });
    expect(fields.damage).toHaveAttribute("aria-invalid", "false");
    expect(fields.damage).not.toHaveAttribute("aria-describedby");
  });

  it("applies the same field-level limits to free NPC and guard stats", async () => {
    const user = userEvent.setup({ delay: null });
    const npc = renderDialog(
      seedEvent({
        kind: "npc",
        species: null,
        patrolRadius: 96,
        pages: [{ ...defaultEventPage(), moveType: "random" }],
      }),
    );
    const npcRadius = screen.getByRole("spinbutton", { name: t("editor.markers.radius") });
    const npcHp = screen.getByRole("spinbutton", { name: t("editor.monster.hp") });
    const npcPower = screen.getByRole("spinbutton", { name: t("editor.npc.power") });
    fireEvent.change(npcRadius, { target: { value: "-1" } });
    fireEvent.change(npcHp, { target: { value: "100001" } });
    fireEvent.change(npcPower, { target: { value: "1001" } });
    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));

    expect(npc.onCommit).not.toHaveBeenCalled();
    expect(npcRadius).toHaveAccessibleDescription(
      t("editor.event.validation.range", { min: 0, max: 768 }),
    );
    expect(npcHp).toHaveAccessibleDescription(
      t("editor.event.validation.range", { min: 0, max: 100_000 }),
    );
    expect(npcPower).toHaveAccessibleDescription(
      t("editor.event.validation.range", { min: 0, max: 1_000 }),
    );

    npc.unmount();
    const guard = renderDialog(
      seedEvent({ kind: "guard", name: "Garde", species: null, patrolRadius: 96 }),
    );
    const guardRadius = screen.getByRole("spinbutton", { name: t("editor.markers.radius") });
    fireEvent.change(guardRadius, { target: { value: "769" } });
    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));

    expect(guard.onCommit).not.toHaveBeenCalled();
    expect(guardRadius).toHaveAccessibleDescription(
      t("editor.event.validation.range", { min: 0, max: 768 }),
    );
  });

  it("authors a guard dialogue and round-trips its authoritative patrol radius", async () => {
    const user = userEvent.setup({ delay: null });
    const { onCommit } = renderDialog(
      seedEvent({
        kind: "guard",
        name: "Garde",
        species: null,
        patrolRadius: 96,
        pages: [
          {
            ...defaultEventPage(),
            commands: [{ t: "say", name: "Garde", text: "En position." }],
          },
        ],
      }),
      RUNTIME_REGISTRY,
    );

    expect(screen.getByRole("tablist", { name: t("editor.event.pages.aria") })).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: t("editor.markers.species") }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(t("editor.event.kind.guard.hint"))).toBeVisible();
    // A guard has no appearance tab (its look is a kind-specific field), so its page is two tabs.
    await openTab(user, t("editor.event.commands"));
    await user.click(screen.getByRole("button", { name: "Garde: En position." }));
    const dialogue = screen.getByRole("textbox", { name: t("editor.event.cmd.field.text") });
    await user.clear(dialogue);
    await user.type(dialogue, "La route est sûre.");
    await openTab(user, t("editor.event.conditions"));
    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") }));

    const radius = screen.getByRole("spinbutton", { name: t("editor.markers.radius") });
    await user.clear(radius);
    await user.type(radius, "160");
    const guardVariant = screen
      .getAllByRole("button")
      .find((button) => button.dataset.assetId === DEFAULT_GUARD_APPEARANCE_ASSET_ID);
    expect(guardVariant).toBeDefined();
    if (guardVariant) await user.click(guardVariant);
    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));

    const committed = onCommit.mock.calls[0]?.[0] as MapEvent;
    expect(committed.kind).toBe("guard");
    expect(committed.species).toBeNull();
    expect(committed.patrolRadius).toBe(160);
    expect(committed.pages[0]?.graphicAssetId).toBe(DEFAULT_GUARD_APPEARANCE_ASSET_ID);
    expect(committed.pages[0]?.graphicTint).toBe(0xffffff);
    expect(committed.pages).toHaveLength(1);
    expect(committed.pages[0]?.condSwitchId).toBe("0042");
    expect(committed.pages[0]?.commands).toEqual([
      { t: "say", name: "Garde", text: "La route est sûre." },
    ]);
  });

  it("authors a free NPC's characteristics, patrol zone and walking routine", async () => {
    const user = userEvent.setup({ delay: null });
    const { onCommit } = renderDialog(
      seedEvent({
        kind: "npc",
        species: null,
        patrolRadius: 96,
        pages: [{ ...defaultEventPage(), moveType: "random" }],
      }),
      RUNTIME_REGISTRY,
    );

    expect(screen.getByRole("tablist", { name: t("editor.event.pages.aria") })).toBeInTheDocument();
    await openTab(user, t("editor.event.commands"));
    expect(screen.getByRole("button", { name: t("editor.event.cmd.insert") })).toBeEnabled();
    // Movement, the graphic and the walking routine are the appearance tab's; the NPC's stats are
    // kind-specific fields and stay outside the tabs entirely.
    await openTab(user, t("editor.event.appearance"));
    expect(screen.getByText(t("editor.event.kind.npc.hint"))).toBeVisible();
    fireEvent.change(screen.getByRole("spinbutton", { name: t("editor.markers.radius") }), {
      target: { value: "160" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: t("editor.monster.hp") }), {
      target: { value: "275" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: t("editor.npc.power") }), {
      target: { value: "24" },
    });
    await user.selectOptions(
      screen.getByRole("combobox", { name: t("editor.event.move.type") }),
      "custom",
    );
    const thiefAssetId = "enemy.enemy-pack-enemies-thief.thief-idle" as EditorAssetId;
    fireEvent.change(screen.getByRole("searchbox", { name: t("editor.palette.search") }), {
      target: { value: "thief idle" },
    });
    const thief = screen
      .getAllByRole("button")
      .find((button) => button.dataset.assetId === thiefAssetId);
    expect(thief).toBeDefined();
    if (thief) await user.click(thief);
    await user.click(screen.getByRole("button", { name: t("editor.event.routine.add") }));
    fireEvent.change(screen.getByRole("spinbutton", { name: t("editor.event.routine.offsetX") }), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: t("editor.event.routine.offsetY") }), {
      target: { value: "-1" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: t("editor.event.routine.wait") }), {
      target: { value: "1.5" },
    });
    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));

    const committed = onCommit.mock.calls[0]?.[0] as MapEvent;
    expect(committed).toMatchObject({
      kind: "npc",
      species: null,
      patrolRadius: 160,
      monsterMaxHp: 275,
      monsterDamage: 24,
    });
    expect(committed.pages[0]?.moveType).toBe("custom");
    expect(committed.pages[0]?.graphicAssetId).toBe(thiefAssetId);
    expect(committed.pages[0]?.graphicTint).toBe(0xffffff);
    expect(committed.pages[0]?.moveRoute).toEqual([{ offsetCol: 2, offsetRow: -1, waitMs: 1_500 }]);
  });

  it("shows only a label field for an entry event and round-trips the label", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderDialog(seedEvent({ kind: "entry", name: "" }));

    // No scripted editor for an anchor kind — just the header Name (label) field and a hint. The
    // command pane is kind-gated: an anchor event never shows the Insert palette.
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("button", { name: t("editor.event.cmd.insert") })).toBeNull();
    expect(screen.getByText(t("editor.event.kind.anchor.hint"))).toBeVisible();

    await user.type(screen.getByRole("textbox", { name: t("editor.event.name") }), "North gate");
    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));

    const committed = onCommit.mock.calls[0]?.[0] as MapEvent;
    expect(committed.kind).toBe("entry");
    expect(committed.name).toBe("North gate");
    expect(committed.pages).toHaveLength(1);
  });
});

describe("EventDialog harvest authoring", () => {
  beforeEach(() => setLocale("en"));

  function sheepEvent(): MapEvent {
    return seedEvent({
      kind: "harvestable",
      harvestProfile: harvestProfileFromPreset("sheep"),
      pages: [
        {
          ...defaultEventPage(),
          graphicAssetId: harvestPreset("sheep").intactAssetId,
        },
      ],
    });
  }

  it("previews sheep as meat and round-trips every per-instance override independently", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderDialog(sheepEvent());

    expect(screen.getByTestId("harvest-intact-preview")).toBeVisible();
    expect(screen.getByTestId("harvest-exhausted-preview")).toBeVisible();
    expect(screen.getByRole("combobox", { name: t("editor.harvest.resource") })).toHaveValue(
      "meat",
    );
    expect(screen.getByRole("combobox", { name: t("editor.harvest.tool") })).toHaveValue("knife");

    await user.selectOptions(
      screen.getByRole("combobox", { name: t("editor.harvest.resource") }),
      "gold",
    );
    expect(screen.getByRole("combobox", { name: t("editor.harvest.tool") })).toHaveValue("pickaxe");
    fireEvent.change(screen.getByRole("spinbutton", { name: t("editor.harvest.goldValue") }), {
      target: { value: "137" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: t("editor.harvest.hits") }), {
      target: { value: "6" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: t("editor.harvest.range") }), {
      target: { value: "111" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: t("editor.harvest.duration") }), {
      target: { value: "2222" },
    });
    await user.selectOptions(
      screen.getByRole("combobox", { name: t("editor.harvest.exhaustion") }),
      "fade",
    );
    const respawn = screen.getByRole("combobox", { name: t("editor.harvest.respawn") });
    await user.selectOptions(respawn, "permanent");
    expect(
      screen.queryByRole("spinbutton", { name: t("editor.harvest.respawnDelay") }),
    ).not.toBeInTheDocument();
    await user.selectOptions(respawn, "timed");
    fireEvent.change(screen.getByRole("spinbutton", { name: t("editor.harvest.respawnDelay") }), {
      target: { value: "91000" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: t("editor.harvest.fadeDuration") }), {
      target: { value: "777" },
    });

    const intactSection = screen
      .getByText(t("editor.harvest.appearance.intact"), { selector: "h3" })
      .closest("div");
    expect(intactSection).not.toBeNull();
    if (intactSection) {
      fireEvent.change(within(intactSection).getByRole("searchbox"), {
        target: { value: "Tree1" },
      });
      const tree = within(intactSection)
        .getAllByRole("button")
        .find((button) => button.dataset.assetId === "resource.terrain-resources-wood-trees.tree1");
      expect(tree).toBeDefined();
      if (tree) await user.click(tree);
    }
    const exhaustedSection = screen
      .getByText(t("editor.harvest.appearance.exhausted"), { selector: "h3" })
      .closest("div");
    expect(exhaustedSection).not.toBeNull();
    if (exhaustedSection) {
      fireEvent.change(within(exhaustedSection).getByRole("searchbox"), {
        target: { value: "Stump 1" },
      });
      const stump = within(exhaustedSection)
        .getAllByRole("button")
        .find(
          (button) => button.dataset.assetId === "resource.terrain-resources-wood-trees.stump-1",
        );
      expect(stump).toBeDefined();
      if (stump) await user.click(stump);
    }

    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0]?.[0] as MapEvent;
    const sheepProfile = harvestProfileFromPreset("sheep");
    if (!sheepProfile.collision) throw new Error("sheep collision fixture missing");
    const expectedProfile: HarvestProfile = {
      ...sheepProfile,
      resource: "gold",
      tool: "pickaxe",
      yieldAmount: 0,
      goldValue: 137,
      hitsRequired: 6,
      range: 111,
      harvestDurationMs: 2222,
      exhaustedAssetId: "resource.terrain-resources-wood-trees.stump-1",
      exhaustionBehavior: "fade",
      respawnDelayMs: 91_000,
      fadeDurationMs: 777,
      collision: {
        ...sheepProfile.collision,
        depleted: null,
      },
    };
    delete expectedProfile.yieldRange;
    expect(committed.harvestProfile).toEqual(expectedProfile);
    expect(committed.pages[0]?.graphicAssetId).toBe("resource.terrain-resources-wood-trees.tree1");
  }, 15_000);

  it("refuses a replacement configuration until an exhausted appearance is selected", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderDialog(sheepEvent());
    const exhaustion = screen.getByRole("combobox", { name: t("editor.harvest.exhaustion") });
    await user.selectOptions(exhaustion, "hide");
    await user.selectOptions(exhaustion, "replace");
    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(t("editor.harvest.validation.invalid"));
  });

  it("refuses an invisible intact resource", async () => {
    const user = userEvent.setup();
    const invisible = sheepEvent();
    invisible.pages = invisible.pages.map((page) => ({ ...page, graphicAssetId: null }));
    const { onCommit } = renderDialog(invisible);

    expect(screen.getByText(t("editor.harvest.appearance.missing"))).toBeVisible();
    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(t("editor.harvest.validation.invalid"));
  });
});

describe("EventDialog condition pickers over the registry", () => {
  const registry = {
    switches: [
      { id: "0001", name: "Porte ouverte" },
      { id: "0002", name: "Pont abaissé" },
    ],
    variables: [{ id: "0007", name: "Or" }],
  };

  beforeEach(() => setLocale("en"));

  it("shows a Select over the registry switches (not free text) once it has entries", async () => {
    const user = userEvent.setup();
    renderDialog(seedEvent(), registry);

    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") }));
    // A combobox appears; the free-text input does NOT.
    const select = screen.getByRole("combobox", { name: t("editor.event.cond.switch") });
    expect(select.tagName).toBe("SELECT");
    expect(
      screen.queryByRole("textbox", { name: t("editor.event.cond.switch") }),
    ).not.toBeInTheDocument();
    // Only authored names are visible; storage identifiers stay an implementation detail.
    expect(within(select).getByRole("option", { name: "Porte ouverte" })).toBeDefined();
    expect(within(select).getByRole("option", { name: "Pont abaissé" })).toBeDefined();
    expect(select).not.toHaveTextContent("0001");
    expect(select).not.toHaveTextContent("0002");
    // No empty-registry hint.
    expect(screen.queryByText(t("editor.event.cond.switch.empty.hint"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("editor.event.cond.variable.empty.hint"))).not.toBeInTheDocument();
  });

  it("disables unnamed global conditions with guidance when the registry is empty", () => {
    renderDialog(seedEvent(), { switches: [], variables: [] });

    expect(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") })).toBeDisabled();
    expect(
      screen.queryByRole("combobox", { name: t("editor.event.cond.switch") }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(t("editor.event.cond.switch.empty.hint"))).toBeVisible();
    expect(screen.getByText(t("editor.event.cond.variable.empty.hint"))).toBeVisible();
  });

  it("writes the picked entry's ID, not its name, into the committed page", async () => {
    // Mutation proof (b): a picker that writes the option's NAME instead of its id fails here —
    // the committed condSwitchId would be "Pont abaissé", never "0002".
    const user = userEvent.setup();
    const { onCommit } = renderDialog(seedEvent(), registry);

    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") }));
    const select = screen.getByRole("combobox", { name: t("editor.event.cond.switch") });
    await user.selectOptions(select, "0002");
    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));

    const committed = onCommit.mock.calls[0]?.[0] as MapEvent;
    expect(committed.pages[0]?.condSwitchId).toBe("0002");
  });

  it("seeds the first registry entry when a condition is switched on", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderDialog(seedEvent(), registry);

    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.variable") }));
    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));

    const committed = onCommit.mock.calls[0]?.[0] as MapEvent;
    expect(committed.pages[0]?.condVariableId).toBe("0007");
  });
});
