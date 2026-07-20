import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Tooltip } from "radix-ui";

import "@fontsource-variable/mona-sans";
import "@fontsource/monaspace-neon/400.css";
import "@fontsource/monaspace-neon/400-italic.css";
import "@fontsource/monaspace-neon/700.css";
import App from "./App.js";
import "./fonts.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <Tooltip.Provider delayDuration={450} skipDelayDuration={120}>
      <App />
    </Tooltip.Provider>
  </StrictMode>,
);
