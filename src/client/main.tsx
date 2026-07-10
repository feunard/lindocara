import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initLocale } from "./i18n.js";
import { App } from "./ui/App.js";
import "./styles/app.css";
import "./style.css";

initLocale();

const root = document.querySelector("#root");
if (!root) throw new Error("index.html is missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
