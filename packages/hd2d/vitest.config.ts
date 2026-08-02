import { defineConfig } from "vitest/config";

// Node, pas jsdom : three construit géométries, matériaux et couleurs hors navigateur, et c'est
// tout ce que ces tests touchent. Ce qui a besoin d'un canvas (couverture nuageuse, halos) ou d'un
// contexte WebGL (pipeline) n'est pas testé ici — il se vérifie en capture.
export default defineConfig({
  test: {
    name: "hd2d",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
