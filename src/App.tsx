import { Suspense, lazy } from "react";
import { Gamepad2 } from "lucide-react";
import { AddGameModals } from "./components/AddGameModals";
import { AuthModal } from "./components/AuthModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FirstLaunchSetup } from "./components/FirstLaunchSetup";
import { GameEditor } from "./components/GameEditor";
import { MochiIcon } from "./components/MochiIcon";
import { TofuManager } from "./components/TofuManager";
import { Sidebar } from "./components/layout/Sidebar";
import { Topbar } from "./components/layout/Topbar";
import { LibraryView } from "./views/LibraryView";
import { AppProvider, useApp } from "./state/AppContext";
import { Cloud } from "lucide-react";
import { OfflineBanner } from "./components/OfflineBanner";

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

function Shell() {
  const app = useApp();
  const { lib, credentials, account, themeEngine } = app;

  if (app.showFirstLaunchSetup) {
    return <>
      <FirstLaunchSetup
        igdbClientId={credentials.igdbClientId} setIgdbClientId={credentials.setIgdbClientId}
        igdbClientSecret={credentials.igdbClientSecret} setIgdbClientSecret={credentials.setIgdbClientSecret}
        onSignIn={account.openSignIn} signedIn={Boolean(account.user)}
        credentialStatus={credentials.status} credentialStatusLoaded={credentials.loaded}
        themes={themeEngine.themes} theme={themeEngine.theme} setTheme={themeEngine.setTheme}
        nexusApiKey={credentials.nexusApiKey} setNexusApiKey={credentials.setNexusApiKey}
        saveCredential={credentials.save} credentialBusy={credentials.busy}
        onFinish={app.finishFirstLaunchSetup}
      />
      {account.showAuth && <AuthModal />}
    </>;
  }

  const editing = lib.library.find((piko) => piko.id === app.editingGameId);
  return <div className="app-shell">
    <Sidebar />
    <main className="main-content">
      <Topbar />
      <div className="content">
        <OfflineBanner />
        <ErrorBoundary resetKey={app.activeNav}>
          <Suspense fallback={<ViewFallback />}><CurrentView /></Suspense>
        </ErrorBoundary>
        <Footer />
      </div>
    </main>
    <AddGameModals />
    {app.showTofuManager && lib.library.some((piko) => piko.id === lib.selectedPiko.id) && <TofuManager piko={lib.selectedPiko} selectedTofuId={lib.selectedTofu.id} runtimes={app.runtimes} onSelect={lib.setSelectedTofuId} onChange={(tofus) => lib.updateGame(lib.selectedPiko.id, { tofus })} onClose={() => app.setShowTofuManager(false)} />}
    {editing && <GameEditor game={editing} capabilities={app.platformCapabilities} onSave={(changes) => { lib.updateGame(editing.id, changes); app.setEditingGameId(""); }} onClose={() => app.setEditingGameId("")} />}
    {account.showAuth && <AuthModal />}
  </div>;
}

export default function App() {
  return <AppProvider><Shell /></AppProvider>;
}
