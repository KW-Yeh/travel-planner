// Global styles load before any component so screen-level CSS modules can override them.
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing from index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
