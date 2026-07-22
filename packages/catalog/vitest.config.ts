import { defineConfig } from "vitest/config";

// The catalog validity test runs in plain Node (it reads generated files off disk).
export default defineConfig({
  test: {
    name: "catalog",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
