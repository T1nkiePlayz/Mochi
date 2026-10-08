import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./index.css";
import "./styles/bridge.css";
import "./styles/components.css";

async function start() {
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
