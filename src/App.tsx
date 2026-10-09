import { Suspense, lazy, useEffect } from "react";
import { Gamepad2 } from "lucide-react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MochiIcon } from "./components/MochiIcon";
import { UpdateBanner } from "./components/UpdateBanner";
import { Sidebar } from "./components/layout/Sidebar";
import { Topbar } from "./components/layout/Topbar";
import { LibraryView } from "./views/LibraryView";
import { AppProvider, useApp } from "./state/AppContext";
import { BigPictureGate } from "./bigpicture/BigPictureGate";
import { ControllerRuntime } from "./controller/ControllerRuntime";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { AccessibilityProvider } from "./state/accessibility";
import { installAccessibilityEnhancer } from "./lib/dialogs";
import { Cloud } from "lucide-react";
import { OfflineBanner } from "./components/OfflineBanner";

// Dialogs only mount when opened, so their code (and the pickers/editors behind them) stays out of the entry chunk.
const AddGameModals = lazy(() => import("./components/AddGameModals").then((m) => ({ default: m.AddGameModals })));
const AuthModal = lazy(() => import("./components/AuthModal").then((m) => ({ default: m.AuthModal })));
const FirstLaunchSetup = lazy(() => import("./components/FirstLaunchSetup").then((m) => ({ default: m.FirstLaunchSetup })));
const GameEditor = lazy(() => import("./components/GameEditor").then((m) => ({ default: m.GameEditor })));
const TofuManager = lazy(() => import("./components/TofuManager").then((m) => ({ default: m.TofuManager })));
const ModBackground = lazy(() => import("./components/mods/ModBackground").then((m) => ({ default: m.ModBackground })));

// Everything except the library loads on demand so the launcher reaches an interactive library sooner.
const SettingsView = lazy(() => import("./views/SettingsView").then((m) => ({ default: m.SettingsView })));
const DiscoverView = lazy(() => import("./views/DiscoverView").then((m) => ({ default: m.DiscoverView })));
const DownloadsView = lazy(() => import("./views/DownloadsView").then((m) => ({ default: m.DownloadsView })));
const InstalledView = lazy(() => import("./views/InstalledView").then((m) => ({ default: m.InstalledView })));
const StatsView = lazy(() => import("./views/StatsView").then((m) => ({ default: m.StatsView })));

function ViewFallback() {
  return <div className="view-loading" role="status" aria-live="polite"><span className="view-loading-dot" /><span>Loading…</span></div>;
}

function CurrentView() {
  const { activeNav } = useApp();
  switch (activeNav) {
    case "Library": return <LibraryView />;
    case "Settings": return <SettingsView />;
    case "Discover": return <DiscoverView />;
    case "Downloads": return <DownloadsView />;
    case "Installed": return <InstalledView />;
    case "Stats": return <StatsView />;
    default: return <div className="empty-state"><div className="empty-icon"><MochiIcon name="gamepad" fallback={Gamepad2} size={23} /></div><h2>Not found.</h2></div>;
  }
}

function Footer() {
  const { cloud, account } = useApp();
  const label = cloud.syncState === "syncing" ? "Cloud sync syncing…" : cloud.syncState === "synced" ? "Cloud sync active" : cloud.syncState === "error" ? "Cloud sync error" : account.user && !cloud.cloudSyncEnabled ? "Cloud sync disabled" : "Cloud sync unavailable";
  return <footer><span>Mochi v{__APP_VERSION__} · Local-first by design</span><span><MochiIcon name="cloud" fallback={Cloud} size={13} /> {label}</span></footer>;
}

function SkipLink() {
  return <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); const main = document.getElementById("main-content"); main?.focus(); main?.scrollIntoView(); }}>Skip to content</a>;
}

function Shell() {
  const app = useApp();
  const { lib, credentials, account, themeEngine } = app;

  if (app.showFirstLaunchSetup) {
    return <Suspense fallback={<ViewFallback />}>
      <FirstLaunchSetup
        igdbClientId={credentials.igdbClientId} setIgdbClientId={credentials.setIgdbClientId}
        igdbClientSecret={credentials.igdbClientSecret} setIgdbClientSecret={credentials.setIgdbClientSecret}
        onSignIn={account.openSignIn} signedIn={Boolean(account.user)}
        credentialStatus={credentials.status} credentialStatusLoaded={credentials.loaded}
        themes={themeEngine.themes} theme={themeEngine.theme} setTheme={themeEngine.setTheme}
        nexusApiKey={credentials.nexusApiKey} setNexusApiKey={credentials.setNexusApiKey}
        steamGridDbKey={credentials.steamGridDbKey} setSteamGridDbKey={credentials.setSteamGridDbKey}
        saveCredential={credentials.save} credentialBusy={credentials.busy}
        onFinish={app.finishFirstLaunchSetup}
      />
      {account.showAuth && <AuthModal />}
    </Suspense>;
  }

  const { add } = app;
  const addOpen = add.showAddPiko || add.showCustomGame || add.flatpakPickerOpen || add.showImportPicker;
  const editing = lib.library.find((piko) => piko.id === app.editingGameId);
  return <div className="app-shell">
    <SkipLink />
    <Sidebar />
    <main className="main-content" id="main-content" tabIndex={-1}>
      <Topbar />
      <UpdateBanner />
      <div className="content">
        <OfflineBanner />
        <ErrorBoundary resetKey={app.activeNav}>
          <Suspense fallback={<ViewFallback />}><CurrentView /></Suspense>
        </ErrorBoundary>
        <Footer />
      </div>
    </main>
    <Suspense fallback={null}>
      <ModBackground />
      {addOpen && <AddGameModals />}
      {app.showTofuManager && lib.library.some((piko) => piko.id === lib.selectedPiko.id) && <TofuManager piko={lib.selectedPiko} selectedTofuId={lib.selectedTofu.id} runtimes={app.runtimes} onSelect={lib.setSelectedTofuId} onChange={(tofus) => lib.updateGame(lib.selectedPiko.id, { tofus })} onClose={() => app.setShowTofuManager(false)} />}
      {editing && <GameEditor game={editing} capabilities={app.platformCapabilities} onSave={(changes) => { lib.updateGame(editing.id, changes); app.setEditingGameId(""); }} onClose={() => app.setEditingGameId("")} />}
      {account.showAuth && <AuthModal />}
    </Suspense>
  </div>;
}

export default function App() {
  useEffect(() => installAccessibilityEnhancer(), []);
  return <AccessibilityProvider><AppProvider><ControllerRuntime /><BigPictureGate><Shell /></BigPictureGate><ShortcutsHelp /></AppProvider></AccessibilityProvider>;
}
