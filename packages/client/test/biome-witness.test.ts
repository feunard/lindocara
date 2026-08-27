import { buildBiomeWitnessMap } from "@lindocara/client/dev/biome-witness-map.js";
import { compileAuthoredMap } from "@lindocara/engine/hd2d/authored-map.js";
import { LINDOCARA_STRUCTURE_ASSET_IDS } from "@lindocara/engine/tiny-swords-catalog.js";
import { describe, expect, it } from "vitest";

describe("biome visual witness", () => {
  it("keeps every generated material, relief direction and architectural collider together", () => {
    const authored = buildBiomeWitnessMap();
    const compiled = compileAuthoredMap(authored);
    const authoredMaterials = compiled.materials.filter(
      (_, index) => compiled.levels[index] !== null,
    );
    expect(new Set(authoredMaterials)).toEqual(new Set(["grotte", "montagne", "volcan", "lave"]));
    expect(compiled.levels).toContain(-1);
    expect(compiled.levels).toContain(2);
    expect(compiled.elements.map((element) => element.assetId)).toEqual(
      Object.values(LINDOCARA_STRUCTURE_ASSET_IDS),
    );
    expect(compiled.colliders).toHaveLength(4);
  });
});
