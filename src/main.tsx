import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/layers.css";
import "./styles/fonts.generated.css";
import { bootAccessibility } from "./state/accessibility";
import { ensureLocale } from "./lib/i18n";
import { applyLauncherLanguage, normalizeLanguage } from "./lib/languages";
import { readJson, storageKeys } from "./lib/storage";
import "./styles/tokens.css";
import "./index.css";
import "./styles/bridge.css";
import "./styles/components.css";
import "./styles/layout.css";
// Feature stylesheets load last, in file-name order.
import.meta.glob("./styles/features/*.css", { eager: true });

async function start() {
  bootAccessibility();
  if (import.meta.env.DEV) (await import("./devMock")).installDevMock();
  // Load the persisted language's catalogue (and apply it) before the first render, so no frame
  // ever shows English fallbacks while the locale chunk is still in flight. "en" is a no-op.
  const language = normalizeLanguage(readJson<Record<string, unknown>>(storageKeys.settings, {}).language);
  await ensureLocale(language);
  applyLauncherLanguage(language);
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
