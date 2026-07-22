import { setLocale, t } from "@lindocara/client/i18n.js";
import { EventPalette } from "@lindocara/editor/ui/editor/EventPalette.js";
import { presetEvent } from "@lindocara/engine/event-presets.js";
import { functionalEvent, type MapEvent } from "@lindocara/engine/map-events.js";
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
    events: [] as MapEvent[],
    selectedEventId: null,
    onSelectPreset: () => {},
    onSelectEventKind: () => {},
    onMarkerSpeciesChange: () => {},
    onMarkerRadiusChange: () => {},
    onHoverEvent: () => {},
    onSelectEvent: () => {},
  };
}

describe("EventPalette (D13/D14)", () => {
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
