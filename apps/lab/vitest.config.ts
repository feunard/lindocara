import { defineConfig } from "vitest/config";

// `island.ts` est pur — pas de DOM, pas de `three` — c'est tout ce qu'il touche, et c'est
// justement pour ça qu'il est testable ici sans navigateur : c'est lui qui remontera dans
// `@lindocara/engine` en S2 comme génération autoritative, partagée avec la prédiction du client.
// `terrain-query.ts` a déjà fait ce chemin (Task 11), et `hero-state.ts`/`hero-step.ts`/
// `locomotion.ts` aussi (Task 12) : leurs tests vivent désormais dans
// `packages/engine/test/hd2d/`, pas ici.
export default defineConfig({
  test: {
    name: "lab",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
