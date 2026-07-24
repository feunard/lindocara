import { PLACEABLE_EDITOR_ASSETS } from "@lindocara/engine/tiny-swords-catalog.js";

for (const a of PLACEABLE_EDITOR_ASSETS) {
  if (a.role === "world-resource" || a.role === "world-decoration") console.log(a.id);
}
