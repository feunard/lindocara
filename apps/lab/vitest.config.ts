import { defineConfig } from "vitest/config";

// `island.ts`/`terrain-query.ts` sont purs — pas de DOM, pas de `three` — c'est tout ce qu'ils
// touchent, et c'est justement pour ça qu'ils sont testables ici sans navigateur : ce sont eux qui
// remonteront dans `@lindocara/engine` en S2 comme collision autoritative, partagée avec la
// prédiction du client.
export default defineConfig({
  test: {
    name: "lab",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
