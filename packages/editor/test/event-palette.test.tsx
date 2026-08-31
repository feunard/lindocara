import { setLocale, t } from "@lindocara/client/i18n.js";
import { EventPalette } from "@lindocara/editor/ui/editor/EventPalette.js";
import { presetEvent } from "@lindocara/engine/event-presets.js";
import {
  functionalEvent,
  MAX_EVENTS_PER_MAP,
  MAX_RUNTIME_EVENTS_PER_MAP,
  type MapEvent,
} from "@lindocara/engine/map-events.js";
import {
  DEFAULT_GUARD_APPEARANCE_ASSET_ID,
  DEFAULT_NPC_MODEL_ASSET_ID,
  GUARD_APPEARANCE_ASSETS,
  NPC_MODEL_ASSETS,
} from "@lindocara/engine/tiny-swords-catalog.js";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const MAP_ID = "11111111-1111-4111-8111-111111111111";

function events(): MapEvent[] {
  return [
    presetEvent({
      id: crypto.randomUUID(),
      col: 1,
      row: 1,
      ordinal: 1,
      preset: "teleporter",
      selfMapId: MAP_ID,
    }),
    functionalEvent({
      id: crypto.randomUUID(),
      col: 4,
      row: 2,
      ordinal: 2,
      kind: "entry",
      name: "Front gate",
    }),
  ];
}

function baseProps() {
  return {
    eventKind: "normal" as const,
    eventPreset: "raw" as const,
    teleporterEnabled: true,
    linkActive: false,
    linkPending: false,
    onSelectDoorLink: () => {},
    markerSpecies: "spear_goblin" as const,
    markerRadius: 96,
    npcGraphic: DEFAULT_NPC_MODEL_ASSET_ID,
    enemyGraphic: null,
    guardGraphic: DEFAULT_GUARD_APPEARANCE_ASSET_ID,
    events: [] as MapEvent[],
    selectedEventId: null,
    onSelectPreset: () => {},
    onSelectEventKind: () => {},
    onMarkerSpeciesChange: () => {},
    onMarkerRadiusChange: () => {},
    onSelectNpcGraphic: () => {},
    onSelectEnemyGraphic: () => {},
    onSelectGuardGraphic: () => {},
    onHoverEvent: () => {},
    onSelectEvent: () => {},
  };
}

describe("EventPalette (D13/D14)", () => {
  it("offers the door-link tool and says which of its two clicks is next", () => {
    setLocale("en");
    const onSelectDoorLink = vi.fn();
    const { rerender } = render(
      <EventPalette {...baseProps()} onSelectDoorLink={onSelectDoorLink} />,
    );
    const link = within(screen.getByTestId("event-door-link"));
    fireEvent.click(link.getByRole("button", { name: t("editor.event.preset.doorLink") }));
    expect(onSelectDoorLink).toHaveBeenCalled();
    // Inactive: no step text competing with the rest of the palette.
    expect(screen.queryByText(t("editor.event.preset.doorLink.step1"))).toBeNull();

    rerender(<EventPalette {...baseProps()} linkActive />);
    expect(screen.getByText(t("editor.event.preset.doorLink.step1"))).toBeVisible();

    rerender(<EventPalette {...baseProps()} linkActive linkPending />);
    expect(screen.getByText(t("editor.event.preset.doorLink.step2"))).toBeVisible();
  });

  it("gates the door link on a saved map, like the teleporter preset it mints twice", () => {
    setLocale("en");
    render(<EventPalette {...baseProps()} teleporterEnabled={false} />);
    const link = within(screen.getByTestId("event-door-link"));
    expect(link.getByRole("button", { name: t("editor.event.preset.doorLink") })).toBeDisabled();
  });

  it("keeps large actor catalogues closed until requested and then shows every free NPC model", () => {
    setLocale("en");
    const onSelectNpcGraphic = vi.fn();
    render(<EventPalette {...baseProps()} onSelectNpcGraphic={onSelectNpcGraphic} />);
    const catalogue = screen.getByTestId("npc-catalogue");
    expect(catalogue).not.toHaveAttribute("open");
    expect(screen.getByTestId("monster-catalogue")).not.toHaveAttribute("open");
    expect(screen.getByTestId("enemy-catalogue")).not.toHaveAttribute("open");
    fireEvent.click(within(catalogue).getByText(t("editor.event.kind.npc")));
    expect(catalogue).toHaveAttribute("open");
    const actorButtons = within(catalogue)
      .getAllByRole("button")
      .filter((button) => button.dataset.assetId);
    expect(actorButtons).toHaveLength(NPC_MODEL_ASSETS.length);
    const peasant = actorButtons.find((button) => button.dataset.assetId?.includes("pawn-idle"));
    expect(peasant).toBeDefined();
    if (peasant) fireEvent.click(peasant);
    expect(onSelectNpcGraphic).toHaveBeenCalledWith(expect.stringContaining("pawn-idle"));
  });

  it("offers presets and no inline graphic catalogue", () => {
    setLocale("en");
    render(<EventPalette {...baseProps()} />);
    expect(screen.getByTestId("event-presets")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("editor.event.preset.teleporter") })).toBeEnabled();
    expect(screen.getByRole("button", { name: t("editor.event.preset.checkpoint") })).toBeEnabled();
    // The graphic picker (D13) is gone from the sidebar.
    expect(screen.queryByTestId("catalogue-picker")).toBeNull();
  });

  it("disables the teleporter preset when no map is open", () => {
    setLocale("en");
    render(<EventPalette {...baseProps()} teleporterEnabled={false} />);
    expect(
      screen.getByRole("button", { name: t("editor.event.preset.teleporter") }),
    ).toBeDisabled();
  });

  it("places a preset via its button", () => {
    setLocale("en");
    const onSelectPreset = vi.fn();
    render(<EventPalette {...baseProps()} onSelectPreset={onSelectPreset} />);
    fireEvent.click(screen.getByRole("button", { name: t("editor.event.preset.sign") }));
    expect(onSelectPreset).toHaveBeenCalledWith("sign");
  });

  it("keeps the sea guardian available after one special monster was already placed", () => {
    setLocale("en");
    const onSelectEventKind = vi.fn();
    const { rerender } = render(
      <EventPalette {...baseProps()} onSelectEventKind={onSelectEventKind} />,
    );
    const catalogue = screen.getByTestId("special-monster-catalogue");
    fireEvent.click(within(catalogue).getByText(t("editor.event.specialMonsters.heading")));
    const button = within(catalogue).getByRole("button", {
      name: t("editor.event.specialMonster.seaGuardian"),
    });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onSelectEventKind).toHaveBeenCalledWith("sea-guardian");

    const guardian = functionalEvent({
      id: crypto.randomUUID(),
      col: 1,
      row: 1,
      ordinal: 1,
      kind: "sea-guardian",
    });
    rerender(
      <EventPalette {...baseProps()} events={[guardian]} onSelectEventKind={onSelectEventKind} />,
    );
    expect(
      within(screen.getByTestId("special-monster-catalogue")).getByRole("button", {
        name: t("editor.event.specialMonster.seaGuardian"),
      }),
    ).toBeEnabled();
  });

  it("does not expose harvestable resources as event kinds", () => {
    setLocale("en");
    render(<EventPalette {...baseProps()} />);
    expect(screen.queryByTestId("harvest-presets")).toBeNull();
    expect(screen.queryByRole("button", { name: t("editor.event.kind.harvestable") })).toBeNull();
  });

  it("offers allied guards with a radius but without monster species", () => {
    setLocale("en");
    const onSelectEventKind = vi.fn();
    const onMarkerRadiusChange = vi.fn();
    render(
      <EventPalette
        {...baseProps()}
        eventKind="guard"
        onSelectEventKind={onSelectEventKind}
        onMarkerRadiusChange={onMarkerRadiusChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: t("editor.event.kind.guard") }));
    expect(onSelectEventKind).toHaveBeenCalledWith("guard");
    expect(
      screen.queryByRole("combobox", { name: t("editor.markers.species") }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: t("editor.markers.radius") }), {
      target: { value: "160" },
    });
    expect(onMarkerRadiusChange).toHaveBeenCalledWith(160);
    expect(
      within(screen.getByTestId("guard-appearance-catalogue")).getByText(
        t("editor.event.kind.guard"),
      ),
    ).toBeVisible();
    fireEvent.click(
      within(screen.getByTestId("guard-appearance-catalogue")).getByText(
        t("editor.event.kind.guard"),
      ),
    );
    expect(
      within(screen.getByTestId("guard-appearance-catalogue"))
        .getAllByRole("button")
        .filter((button) => button.dataset.assetId),
    ).toHaveLength(GUARD_APPEARANCE_ASSETS.length);
  });

  it("offers free NPC models directly in the palette with an editable movement radius", () => {
    setLocale("en");
    const onSelectEventKind = vi.fn();
    const onSelectNpcGraphic = vi.fn();
    render(
      <EventPalette
        {...baseProps()}
        eventKind="npc"
        onSelectEventKind={onSelectEventKind}
        onSelectNpcGraphic={onSelectNpcGraphic}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: t("editor.event.kind.npc") }));
    expect(onSelectEventKind).toHaveBeenCalledWith("npc");
    expect(screen.getByRole("spinbutton", { name: t("editor.markers.radius") })).toHaveValue(96);
    expect(
      screen.queryByRole("combobox", { name: t("editor.markers.species") }),
    ).not.toBeInTheDocument();
    const catalogue = screen.getByTestId("npc-catalogue");
    fireEvent.click(within(catalogue).getByText(t("editor.event.kind.npc")));
    fireEvent.change(within(catalogue).getByRole("searchbox"), {
      target: { value: "thief idle" },
    });
    const thief = within(catalogue)
      .getAllByRole("button")
      .find((button) => button.dataset.assetId?.includes("thief-idle"));
    expect(thief).toBeDefined();
    if (thief) fireEvent.click(thief);
    expect(onSelectNpcGraphic).toHaveBeenCalledWith(expect.stringContaining("thief-idle"));
  });

  it("offers every creature and character model in a separate enemy catalogue", () => {
    setLocale("en");
    const onSelectEnemyGraphic = vi.fn();
    const onSelectEventKind = vi.fn();
    render(
      <EventPalette
        {...baseProps()}
        onSelectEnemyGraphic={onSelectEnemyGraphic}
        onSelectEventKind={onSelectEventKind}
      />,
    );

    const catalogue = screen.getByTestId("enemy-catalogue");
    fireEvent.click(within(catalogue).getByText(t("editor.event.enemies.heading")));
    expect(within(catalogue).getByText(t("editor.event.enemies.description"))).toBeVisible();
    const actors = within(catalogue)
      .getAllByRole("button")
      .filter((button) => button.dataset.assetId);
    expect(actors).toHaveLength(NPC_MODEL_ASSETS.length);
    const bear = actors.find((button) => button.dataset.assetId?.includes("bear-idle"));
    expect(bear).toBeDefined();
    if (bear) fireEvent.click(bear);
    expect(onSelectEnemyGraphic).toHaveBeenCalledWith(expect.stringContaining("bear-idle"));
    expect(onSelectEventKind).toHaveBeenCalledWith("monster");
  });

  it("lists the map's events and highlights on hover, selects on click", () => {
    setLocale("en");
    const list = events();
    const onHoverEvent = vi.fn();
    const onSelectEvent = vi.fn();
    render(
      <EventPalette
        {...baseProps()}
        events={list}
        onHoverEvent={onHoverEvent}
        onSelectEvent={onSelectEvent}
      />,
    );
    const listEl = screen.getByTestId("event-list");
    const rows = within(listEl).getAllByRole("button");
    expect(rows).toHaveLength(2);
    // The named entry shows its name; the teleporter shows its kind label.
    expect(within(listEl).getByText("Front gate")).toBeInTheDocument();

    const firstRow = rows[0];
    if (!firstRow) throw new Error("missing row");
    fireEvent.mouseEnter(firstRow);
    expect(onHoverEvent).toHaveBeenCalledWith(list[0]?.id);
    fireEvent.mouseLeave(listEl);
    expect(onHoverEvent).toHaveBeenLastCalledWith(null);
    fireEvent.click(firstRow);
    expect(onSelectEvent).toHaveBeenCalledWith(list[0]?.id);
  });

  it("shows the total and active-entity safety budgets", () => {
    setLocale("en");
    render(<EventPalette {...baseProps()} events={events()} />);

    const budget = screen.getByTestId("event-budget");
    expect(budget).toHaveTextContent(`Events 2/${MAX_EVENTS_PER_MAP}`);
    expect(budget).toHaveTextContent(`Active entities 1/${MAX_RUNTIME_EVENTS_PER_MAP}`);
  });

  it("explains and disables actor placement at the active-entity limit", () => {
    setLocale("en");
    const full = Array.from({ length: MAX_RUNTIME_EVENTS_PER_MAP }, (_, index) =>
      presetEvent({
        id: crypto.randomUUID(),
        col: index % 20,
        row: Math.floor(index / 20),
        ordinal: index + 1,
        preset: "raw",
        selfMapId: MAP_ID,
      }),
    );
    render(<EventPalette {...baseProps()} events={full} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      `${MAX_RUNTIME_EVENTS_PER_MAP}-active-entity safety limit`,
    );
    // Every kind this palette still offers (presets, npc, guard, monsters, sea-guardian) is a
    // runtime kind now that spawn is retired, so there is no longer a placement button that stays
    // enabled past the runtime cap to assert against here — `editor-state.test.ts` still covers a
    // non-runtime kind (`entry`) surviving the same cap at the pure state-mutation level.
    expect(screen.getByRole("button", { name: t("editor.event.kind.npc") })).toBeDisabled();
  });

  it("shows an empty-state hint with no events", () => {
    setLocale("en");
    render(<EventPalette {...baseProps()} />);
    expect(screen.getByText(t("editor.event.list.empty"))).toBeInTheDocument();
    expect(screen.queryByTestId("event-list")).toBeNull();
  });
});
