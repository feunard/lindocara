import { setLocale, t } from "@lindocara/client/i18n.js";
import { CatalogueAssetPicker } from "@lindocara/editor/ui/editor/CatalogueAssetPicker.js";
import { EventPalette } from "@lindocara/editor/ui/editor/EventPalette.js";
import { CURATED_MONSTER_SPECIES } from "@lindocara/engine/game.js";
import {
  DEFAULT_GUARD_APPEARANCE_ASSET_ID,
  DEFAULT_NPC_MODEL_ASSET_ID,
  editorAsset,
  NPC_MODEL_ASSETS,
} from "@lindocara/engine/tiny-swords-catalog.js";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/** The decoration palette exposes every asset with editor placement metadata. Monster species stay
 * curated separately because they carry authoritative runtime behaviour, not just appearance. */
describe("editor asset catalogue", () => {
  it("searches the complete placeable catalogue, including assets outside the old allowlist", () => {
    setLocale("en");
    render(<CatalogueAssetPicker value={null} onSelectAsset={() => {}} />);

    // Buildings are the biggest category and sort last (D3 décor-first ordering), so — unlike
    // before — Archery is not on the unfiltered first page; search for it explicitly instead. Its
    // five recoloured variants are also disambiguated by pack/colour now (C3), so this matches by
    // accessible name substring rather than the old exact "Archery" text.
    fireEvent.change(screen.getByRole("searchbox", { name: "Search placeable assets" }), {
      target: { value: "archery" },
    });
    expect(screen.getAllByRole("button", { name: /archery/i }).length).toBeGreaterThan(0);

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

  it("offers every actor model to free NPCs, including native colours, workers and the Rogue thief", () => {
    setLocale("en");
    render(<CatalogueAssetPicker usage="character" value={null} onSelectAsset={() => {}} />);
    expect(NPC_MODEL_ASSETS).toHaveLength(93);

    const search = screen.getByRole("searchbox", { name: "Search placeable assets" });
    for (const query of ["warrior idle", "pawn idle pickaxe", "thief idle"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getAllByRole("button").some((button) => button.dataset.assetId)).toBe(true);
    }
  });

  it("shows every supported runtime species as a directly placeable monster", () => {
    setLocale("en");
    const onSelectEventKind = vi.fn();
    const onMarkerSpeciesChange = vi.fn();
    render(
      <EventPalette
        eventKind="monster"
        eventPreset="raw"
        teleporterEnabled
        markerSpecies="spear_goblin"
        markerRadius={96}
        npcGraphic={DEFAULT_NPC_MODEL_ASSET_ID}
        guardGraphic={DEFAULT_GUARD_APPEARANCE_ASSET_ID}
        events={[]}
        selectedEventId={null}
        onSelectPreset={() => {}}
        onSelectEventKind={onSelectEventKind}
        onMarkerSpeciesChange={onMarkerSpeciesChange}
        onMarkerRadiusChange={() => {}}
        onSelectNpcGraphic={() => {}}
        onSelectGuardGraphic={() => {}}
        onHoverEvent={() => {}}
        onSelectEvent={() => {}}
      />,
    );
    const catalogue = screen.getByTestId("monster-catalogue");
    const monsterButtons = within(catalogue).getAllByRole("button");
    expect(monsterButtons).toHaveLength(CURATED_MONSTER_SPECIES.length);
    for (const species of CURATED_MONSTER_SPECIES) {
      expect(
        within(catalogue).getByRole("button", { name: t(`monster.${species}`) }),
      ).toBeVisible();
    }

    fireEvent.click(within(catalogue).getByRole("button", { name: t("monster.pig_rider") }));
    expect(onMarkerSpeciesChange).toHaveBeenCalledWith("pig_rider");
    expect(onSelectEventKind).toHaveBeenCalledWith("monster");
  });
});
