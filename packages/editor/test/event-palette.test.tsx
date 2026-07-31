import { setLocale, t } from "@lindocara/client/i18n.js";
import { EventPalette } from "@lindocara/editor/ui/editor/EventPalette.js";
import { presetEvent } from "@lindocara/engine/event-presets.js";
import { functionalEvent, type MapEvent } from "@lindocara/engine/map-events.js";
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
  it("shows every free NPC model before the NPC placement mode is selected", () => {
    setLocale("en");
    const onSelectNpcGraphic = vi.fn();
    render(<EventPalette {...baseProps()} onSelectNpcGraphic={onSelectNpcGraphic} />);
    const catalogue = screen.getByTestId("npc-catalogue");
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

  it("shows an empty-state hint with no events", () => {
    setLocale("en");
    render(<EventPalette {...baseProps()} />);
    expect(screen.getByText(t("editor.event.list.empty"))).toBeInTheDocument();
    expect(screen.queryByTestId("event-list")).toBeNull();
  });
});
