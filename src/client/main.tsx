import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyTinySwordsTheme } from "./game/tiny-swords-assets.js";
import { currentLocale } from "./i18n.js";
import { App } from "./ui/App.js";
import "./styles/app.css";

document.documentElement.lang = currentLocale();
applyTinySwordsTheme();

const root = document.querySelector("#root");
if (!root) throw new Error("index.html is missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
