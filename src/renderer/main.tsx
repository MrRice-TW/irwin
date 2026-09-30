import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { TooltipLayer } from "./TooltipLayer";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <TooltipLayer />
  </React.StrictMode>,
);
