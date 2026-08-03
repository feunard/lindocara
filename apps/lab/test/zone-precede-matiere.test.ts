import { describe, expect, it } from "vitest";
import { ZONE_POLAIRE } from "../src/settings.js";
import { NORD_EMPRISE } from "../src/world/island.js";

describe("l'ambiance polaire précède la matière neige/glace", () => {
  // Deux marges codées en dur dans deux fichiers, par deux tasks différentes, sur le même rayon de
  // base `NORD.r` : `ZONE_POLAIRE.rayon` (settings.ts, Task 4) et `NORD_EMPRISE` (island.ts,
  // Task 2). Leur ORDRE relatif porte une intention que rien d'autre ne garantit : la zone
  // d'ambiance doit rester plus large que l'emprise de matière pour que la musique et la nappe
  // polaire s'installent PENDANT la traversée à la nage, avant que le pied touche la neige — sinon
  // le changement de nappe et le premier pas dans la neige arriveraient à la même image (voir le
  // commentaire de `ZONE_POLAIRE` dans `settings.ts`). Élargir `NORD.r`, ou l'amplitude de l'onde
  // qui gonfle le littoral effectif, pourrait rompre cette garantie EN SILENCE — aucun autre test
  // ne la couvre. Ce test importe les deux vrais symboles plutôt que de recopier 10.5/9.5, pour
  // rougir si la relation se rompt, pas seulement si une valeur change.
  it("ZONE_POLAIRE.rayon reste strictement plus large que NORD_EMPRISE", () => {
    expect(ZONE_POLAIRE.rayon).toBeGreaterThan(NORD_EMPRISE);
  });
});
