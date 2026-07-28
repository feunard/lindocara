import { applyTinySwordsTheme } from "@lindocara/renderer/tiny-swords-assets.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { currentLocale } from "./i18n.js";
import { App } from "./ui/App.js";
import "./styles/app.css";

document.documentElement.lang = currentLocale();
applyTinySwordsTheme();

const root = document.querySelector("#root");
if (!root) throw new Error("index.html is missing #root");

// `?preview` takes over the whole page: the preview owns `#stage`, and mounting the app beside it
// would put the title screen over the canvas. The query is read inline and the module only imported
// when the route is actually asked for, so an ordinary dev boot mounts exactly as synchronously as
// it did before. `import.meta.env.DEV` keeps the étalon map and the harness out of production.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("preview")) {
  void import("./dev/preview-route.js").then((module) => {
    const request = module.previewRequest(window.location.search);
    if (request) return module.startPreviewRoute(request);
    return undefined;
  });
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
