import { defineConfig, mergeConfig } from "vitest/config";
import workerConfig from "./vitest.config.js";

/**
 * Runtime certification deliberately keeps the real workerd/D1/Durable Object harness from the
 * main suite. Only authoring, migration and paint-tool specifications are omitted; runtime map
 * consumers such as hero-world, map-world, adventure-state-runtime and event-run-runtime stay in.
 */
const AUTHORING_TESTS = [
  "test/adventure.test.ts",
  "test/adventure-draft.test.ts",
  "test/adventures.test.ts",
  "test/adventures-api.test.ts",
  "test/autotile.test.ts",
  "test/autotile-resolve.test.ts",
  "test/default-map-template.test.ts",
  "test/editor-state.test.ts",
  "test/map-events.test.ts",
  "test/map-layers.test.ts",
  "test/map-marker-event-migrate.test.ts",
  "test/map-marker-event-migrate-runtime.test.ts",
  "test/map-markers.test.ts",
  "test/map-migrate.test.ts",
  "test/map-naming.test.ts",
  "test/map-ownership-migrate.test.ts",
  "test/maps.test.ts",
  "test/maps-api.test.ts",
  "test/maps-layers.test.ts",
  "test/tile-brush.test.ts",
  "test/tile-elevation-brush.test.ts",
  "test/tile-fill-brush.test.ts",
  "test/tile-rect-brush.test.ts",
  "test/tile-stairs-brush.test.ts",
];

export default mergeConfig(
  workerConfig,
  defineConfig({
    test: {
      name: "lindocara-runtime",
      exclude: ["**/node_modules/**", "**/dist/**", ...AUTHORING_TESTS],
    },
  }),
);
