import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import { CatalogueAssetPicker } from "../../src/client/ui/editor/CatalogueAssetPicker.js";
import { EventPalette } from "../../src/client/ui/editor/EventPalette.js";
import { CURATED_MONSTER_SPECIES } from "../../src/shared/game.js";
import { editorAsset } from "../../src/shared/tiny-swords-catalog.js";

/**
 * UX wave #13: the palette OFFERS only the curated allowlist (one bush, one tree, the wood bridges),
 * and the monster tool only the curated species — but a stored map that references any other asset
 * still RENDERS, because the allowlist gates authoring, not rendering.
 */
describe("editor curated catalogue", () => {
  it("the decoration picker offers the curated assets and hides the rest of the catalogue", () => {
    setLocale("en");
    render(<CatalogueAssetPicker value={null} onSelectAsset={() => {}} />);
    // Curated: the one tree and the one bush.
    expect(screen.getByText("tree3")).toBeInTheDocument();
    expect(screen.getByText("bushe1")).toBeInTheDocument();
    // Hidden: other trees, bushes and every building.
    expect(screen.queryByText("tree2")).not.toBeInTheDocument();
    expect(screen.queryByText("bushe2")).not.toBeInTheDocument();
    expect(screen.queryByText("castle")).not.toBeInTheDocument();
  });

  it("still resolves a NON-curated asset for rendering (authoring gate, not a render gate)", () => {
    // A map authored before the allowlist may reference tree2; the renderer must still find its
    // definition or the map would draw with holes.
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
