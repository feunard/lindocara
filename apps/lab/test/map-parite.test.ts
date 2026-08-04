import { readFileSync } from "node:fs";
import type { ColliderRect } from "@lindocara/engine/hd2d/collider-index.js";
import { decodeMap } from "@lindocara/engine/hd2d/map-data.js";
import { describe, expect, it } from "vitest";
import { SPAWN, WORLD } from "../src/settings.js";
import { generateIsland } from "../src/world/island.js";
import { decidePlacements } from "../src/world/props.js";

// Le contrôle de non-régression de tout ce chantier (Task 10) : si la carte livrée cesse de
// correspondre au générateur, le monde a changé sans que personne l'ait voulu. Le brief proposait
// de comparer `carte.materials` à `field.materialAt` (`HeightField`, la bande de RENDU —
// "lvl0"/"lvl1"/"lvl2" pour l'herbe), mais `MapData.materials` est typé `TerrainMaterial`
// (sable/herbe/neige/glace/glace-fine, voir `world/map-data.ts`) : ce n'est pas la même valeur, et
// `decodeMap` rejetterait de toute façon une carte qui contiendrait "lvl0". La comparaison
// pertinente est donc contre `query.kindAt` — la matière de RÈGLE que `mapToQuerySource` reconstruit
// et que le reste du jeu (friction, glace fine...) consulte réellement.
describe("la carte sérialisée", () => {
  it("décrit exactement le relief et les matières que le générateur produit", () => {
    const carte = decodeMap(
      readFileSync(new URL("../public/maps/ile.json", import.meta.url), "utf8"),
    );
    expect(carte).not.toBeNull();
    if (!carte) return;

    const { field, query } = generateIsland({ size: WORLD.size, seed: WORLD.seed });
    expect(carte.size).toBe(WORLD.size);
    expect(carte.levelHeight).toBe(WORLD.levelHeight);
    expect(carte.waterLevel).toBe(WORLD.waterLevel);

    for (let j = 0; j < carte.size; j++) {
      for (let i = 0; i < carte.size; i++) {
        const idx = j * carte.size + i;
        const h = field.levelAt(i, j);
        // `encodeMap` s'appuie sur `JSON.stringify`, qui sérialise `NaN`/`Infinity` en `null` — si
        // jamais le générateur produisait une hauteur cassée, elle deviendrait silencieusement de
        // l'eau dans la carte produite. `field.levelAt` ne peut aujourd'hui renvoyer que des entiers
        // 0/1/2 ou `null` (voir `island.ts`, `makeHeightmap`/`ILES.reliefs`), donc ce cas ne se
        // présente pas en pratique — mais l'assertion ci-dessous l'attraperait quand même : un `h`
        // fini et non nul comparé à un `null` stocké échouerait immédiatement.
        expect(carte.levels[idx]).toBe(h);
        if (h !== null) {
          const [x, z] = query.cellCenter(i, j);
          expect(carte.materials[idx]).toBe(query.kindAt(x, z));
        }
      }
    }
  });

  it("décrit exactement les colliders que `decidePlacements` produit", () => {
    // Recharge la carte LIVRÉE (pas une carte fraîchement régénérée) : sinon ce test compare le
    // générateur à lui-même et ne prouve rien — voir le commentaire du test précédent.
    const carte = decodeMap(
      readFileSync(new URL("../public/maps/ile.json", import.meta.url), "utf8"),
    );
    expect(carte).not.toBeNull();
    if (!carte) return;

    // Reconstruit la carte des colliders EXACTEMENT comme `scripts/build-map.ts` le fait au
    // moment de la génération : seuls les cinq premiers kinds de `decidePlacements` peuvent porter
    // un collider, plus le feu (s'il tombe dans la carte) et la source (toujours).
    const { field, query } = generateIsland({ size: WORLD.size, seed: WORLD.seed });
    const plan = decidePlacements(field, query, WORLD.seed + 7, SPAWN);
    const attendus: ColliderRect[] = [];
    for (const p of plan.placements) if (p.collider) attendus.push(p.collider);
    if (plan.fire.collider) attendus.push(plan.fire.collider);
    attendus.push(plan.spring.collider);

    // Le COMPTE d'abord : un message d'échec clair si un collider a disparu ou a été dupliqué,
    // avant même de regarder son contenu.
    expect(carte.colliders.length).toBe(attendus.length);
    // Puis le CONTENU, champ par champ (via l'égalité profonde de `toEqual`) : un collider présent
    // en nombre correct mais déplacé (mauvais x/z/w/h) doit aussi faire rougir ce test — c'est
    // précisément ce qu'un test qui ne vérifierait que `.length` laisserait passer. `encodeMap`/
    // `decodeMap` font un aller-retour JSON qui préserve la précision flottante complète (voir
    // `map-data.ts`), donc l'égalité attendue ici est bit à bit, pas approximative.
    expect(carte.colliders).toEqual(attendus);
  });
});
