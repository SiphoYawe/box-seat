import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "./index.css";
import { App } from "./App.js";
import { useAppStore } from "./state/store.js";

// debug/e2e handle (read + drive the store from devtools or test scripts)
(window as unknown as { __boxseat: typeof useAppStore }).__boxseat = useAppStore;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
