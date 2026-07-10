import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App.js";
import "./styles/app.css";
// The legacy DOM app keeps running everything React has not yet taken over.
// Tasks 4-8 move surfaces out of it one by one; Task 8 deletes it.
import "./main.js";

const root = document.querySelector("#root");
if (!root) throw new Error("index.html is missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
