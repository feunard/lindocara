import { setLocale } from "@lindocara/client/i18n.js";
import {
  localizedHarvestGain,
  localizedMissingMaterials,
  partyMaterialCostText,
} from "@lindocara/client/material-copy.js";
import { describe, expect, it } from "vitest";

describe("Peasant material copy", () => {
  it("localizes exact harvest gains above the Peasant", () => {
    setLocale("fr");
    expect(localizedHarvestGain({ stone: 1 })).toBe("+1 Pierre");
    expect(localizedHarvestGain({ wood: 2 })).toBe("+2 Bois");
    expect(localizedHarvestGain({ gold: 100 })).toBe("+100 Or");
    expect(localizedHarvestGain({ meat: 1 })).toBe("+1 Viande");
  });

  it("formats support costs and exact shortages", () => {
    setLocale("fr");
    expect(partyMaterialCostText({ wood: 1, stone: 1, meat: 1 })).toBe(
      "Bois 1 · Pierre 1 · Viande 1",
    );
    expect(localizedMissingMaterials({ wood: 1, stone: 1 })).toEqual({
      missing: "Bois 1, Pierre 1",
      count: 2,
    });
  });
});
