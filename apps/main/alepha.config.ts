import { defineConfig } from "alepha/cli/config";
import { platform } from "alepha/cli/platform";

export default defineConfig({
  plugins: [
    platform({
      environments: {
        production: { domain: "lindocara.alepha.dev", adapter: "cloudflare" },
      },
    }),
  ],
});
