import { defineConfig } from "alepha/cli/config";
import { vendor } from "alepha/cli/vendor";

export default defineConfig({
  plugins: [
    vendor({
      packages: ["alepha"],
      remote: "file:///Users/nfo/git/alepha",
    }),
  ],
});
