import { defineConfig, mergeConfig } from "vitest/config";
import uiConfig from "./vitest.ui.config.js";

/** Player-facing UI only. Creator dialogs, the Pixi editor stage and map preview have their own
 * coverage in `npm run test:ui` and remain part of the full repository check. */
const CREATOR_UI_TESTS = [
  "test/ui/adventure-settings-dialog.test.tsx",
  "test/ui/editor-bootstrap.test.tsx",
  "test/ui/editor-curated.test.tsx",
  "test/ui/editor-shell.test.tsx",
  "test/ui/event-command-editor.test.tsx",
  "test/ui/event-dialog.test.tsx",
  "test/ui/map-editor-stage.test.tsx",
  "test/ui/map-list-panel.test.tsx",
  "test/ui/map-preview.test.tsx",
  "test/ui/registry-dialog.test.tsx",
];

export default mergeConfig(
  uiConfig,
  defineConfig({
    test: {
      name: "lindocara-runtime-ui",
      exclude: ["**/node_modules/**", "**/dist/**", ...CREATOR_UI_TESTS],
    },
  }),
);
