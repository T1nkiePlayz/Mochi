import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { bootAccessibility } from "./state/accessibility";
import "./styles/tokens.css";
import "./index.css";
import "./styles/bridge.css";
import "./styles/components.css";
// Feature stylesheets load last, in file-name order.
import.meta.glob("./styles/features/*.css", { eager: true });

async function start() {
  bootAccessibility();
  if (import.meta.env.DEV) (await import("./devMock")).installDevMock();
  render();
}

function render() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
