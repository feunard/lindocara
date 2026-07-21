import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setLocale, t } from "../../src/client/i18n.js";
import { EditorPalette } from "../../src/client/ui/editor/EditorPalette.js";

/** `EditorPalette` requires all three body prop groups regardless of `mode` — only the
 *  mode-matching body is ever mounted, so the other two groups' values are never read. */
function fieldBody() {
  return {
    content: { kind: "block" as const, block: "grass" as const },
    terrainActive: true,
    fillActive: false,
    stairsActive: false,
    spawnActive: false,
    onPickContent: () => {},
    onSelectStairs: () => {},
    onSelectSpawn: () => {},
  };
}

function elementBody() {
  return {
    selectedAsset: null,
    elementCount: 0,
    onSelectAsset: () => {},
  };
}

function eventBody() {
  return {
    eventKind: "normal" as const,
    pendingEventGraphic: null,
    markerSpecies: "spear_goblin" as const,
    markerRadius: 96,
    onSelectEventKind: () => {},
    onSelectEventGraphic: () => {},
    onMarkerSpeciesChange: () => {},
    onMarkerRadiusChange: () => {},
  };
}

function fieldProps() {
  return { field: fieldBody(), element: elementBody(), event: eventBody() };
}

function elementProps() {
  return { field: fieldBody(), element: elementBody(), event: eventBody() };
}

function eventProps() {
  return { field: fieldBody(), element: elementBody(), event: eventBody() };
}

describe("mode-scoped palette", () => {
  it("shows terrain controls and no catalogue in field mode", () => {
    setLocale("en");
    render(<EditorPalette mode="field" {...fieldProps()} />);
    // Exact name, not a substring regex: the catalogue's own asset buttons legitimately carry
    // "grass" in their allowed-terrain caption (e.g. tree3, bushe1), which a loose /grass/i
    // match would also hit and turn this into a false negative once Element mode is rendered.
    expect(screen.getByRole("button", { name: t("editor.tool.grass") })).toBeInTheDocument();
    expect(screen.queryByTestId("catalogue-picker")).toBeNull();
  });

  it("shows the catalogue and the element counter in element mode", () => {
    setLocale("en");
    render(<EditorPalette mode="element" {...elementProps()} />);
    expect(screen.getByTestId("catalogue-picker")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("editor.tool.grass") })).toBeNull();
  });

  it("shows event kinds in event mode", () => {
    setLocale("en");
    render(<EditorPalette mode="event" {...eventProps()} />);
    expect(screen.getByTestId("event-kinds")).toBeInTheDocument();
  });
});
