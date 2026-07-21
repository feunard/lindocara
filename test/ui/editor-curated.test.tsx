import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import { CatalogueAssetPicker } from "../../src/client/ui/editor/CatalogueAssetPicker.js";
import { EventPalette } from "../../src/client/ui/editor/EventPalette.js";
import { CURATED_MONSTER_SPECIES } from "../../src/shared/game.js";
import { editorAsset } from "../../src/shared/tiny-swords-catalog.js";

/** The decoration palette exposes every asset with editor placement metadata. Monster species stay
 * curated separately because they carry authoritative runtime behaviour, not just appearance. */
describe("editor asset catalogue", () => {
  it("searches the complete placeable catalogue, including assets outside the old allowlist", () => {
    setLocale("en");
    render(<CatalogueAssetPicker value={null} onSelectAsset={() => {}} />);

    expect(screen.getAllByText("Archery").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search placeable assets" }), {
      target: { value: "tree2" },
    });
    expect(screen.getAllByRole("button", { name: /tree2/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText("Archery")).not.toBeInTheDocument();
  });

  it("resolves placeable assets through the same catalogue used by the renderer", () => {
    // Picker and stage share this source of truth, so choosing an asset cannot create a render hole.
    expect(editorAsset("resource.terrain-resources-wood-trees.tree2")).not.toBeNull();
    expect(editorAsset("decoration.terrain-decorations-bushes.bushe2")).not.toBeNull();
  });

  it("the monster event kind offers only the one curated species", () => {
    setLocale("en");
    render(
      <EventPalette
        eventKind="monster"
        pendingEventGraphic={null}
        markerSpecies="spear_goblin"
        markerRadius={96}
        onSelectEventKind={() => {}}
        onSelectEventGraphic={() => {}}
        onMarkerSpeciesChange={() => {}}
        onMarkerRadiusChange={() => {}}
      />,
    );
    const species = screen.getByLabelText("Species") as HTMLSelectElement;
    expect(species.options).toHaveLength(CURATED_MONSTER_SPECIES.length);
    expect(species.options).toHaveLength(1);
    expect(species.options[0]?.value).toBe("spear_goblin");
  });
});
