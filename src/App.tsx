import { Suspense, lazy, memo, useEffect } from "react";
import { Gamepad2 } from "lucide-react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MochiIcon } from "./components/MochiIcon";
import { UpdateBanner } from "./components/UpdateBanner";
import { Sidebar } from "./components/layout/Sidebar";
import { Topbar } from "./components/layout/Topbar";
import { LibraryView } from "./views/LibraryView";
import { AppProvider, shallowEqual, useApp, useAppSelector } from "./state/AppContext";
import { BigPictureGate } from "./bigpicture/BigPictureGate";
import { ControllerRuntime } from "./controller/ControllerRuntime";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { GameSearch } from "./components/GameSearch";
import { CommandPalette } from "./components/CommandPalette";
import { AccessibilityProvider } from "./state/accessibility";
import { installAccessibilityEnhancer } from "./lib/dialogs";
import { installTruncationTitles } from "./lib/truncationTitles";
import { Cloud } from "lucide-react";
import { OfflineBanner } from "./components/OfflineBanner";
import { useTranslation } from "./lib/useTranslation";

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
const DealsView = lazy(() => import("./views/DealsView").then((m) => ({ default: m.DealsView })));
const StatsView = lazy(() => import("./views/StatsView").then((m) => ({ default: m.StatsView })));

function ViewFallback() {
  const t = useTranslation();
  return <div className="view-loading" role="status" aria-live="polite"><span className="view-loading-dot" /><span>{t("Loading…")}</span></div>;
}

function CurrentView() {
  const { activeNav } = useApp();
  const t = useTranslation();
  switch (activeNav) {
    case "Library": return <LibraryView />;
    case "Settings": return <SettingsView />;
    case "Discover": return <DiscoverView />;
    case "Downloads": return <DownloadsView />;
    case "Installed": return <InstalledView />;
    case "Stats": return <StatsView />;
    case "Deals": return <DealsView />;
    default: return <div className="empty-state"><div className="empty-icon"><MochiIcon name="gamepad" fallback={Gamepad2} size={23} /></div><h2>{t("Not found.")}</h2></div>;
  }
}

const Footer = memo(function Footer() {
  const t = useTranslation();
  const { syncState, cloudSyncEnabled, signedIn } = useAppSelector((app) => ({ syncState: app.cloud.syncState, cloudSyncEnabled: app.cloud.cloudSyncEnabled, signedIn: Boolean(app.account.user) }), shallowEqual);
  const label = syncState === "syncing" ? t("Cloud sync in progress…") : syncState === "retrying" ? t("Cloud sync retrying…") : syncState === "synced" ? t("Cloud sync active") : syncState === "empty" ? t("Cloud library empty") : syncState === "error" ? t("Cloud sync error") : signedIn && !cloudSyncEnabled ? t("Cloud sync disabled") : t("Cloud sync unavailable");
  return <footer><span>Mochi v{__APP_VERSION__} · {t("Local-first by design")}</span><span><MochiIcon name="cloud" fallback={Cloud} size={13} /> {label}</span></footer>;
});

function SkipLink() {
  const t = useTranslation();
  return <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); const main = document.getElementById("main-content"); main?.focus(); main?.scrollIntoView(); }}>{t("Skip to content")}</a>;
}

function Shell() {
  const app = useApp();
  const { lib, credentials, account, themeEngine } = app;

  if (app.showFirstLaunchSetup) {
    return <Suspense fallback={<ViewFallback />}>
      <FirstLaunchSetup
        igdbClientId={credentials.igdbClientId} setIgdbClientId={credentials.setIgdbClientId}
        igdbClientSecret={credentials.igdbClientSecret} setIgdbClientSecret={credentials.setIgdbClientSecret}
        onSignIn={account.openSignIn} user={account.user}
        language={app.behavior.language} setLanguage={(language) => app.setBehavior((current) => ({ ...current, language }))}
        onAddUser={() => { app.storage.setMultipleAccountProfiles(true); account.openSignIn(); }}
        credentialStatus={credentials.status} credentialStatusLoaded={credentials.loaded}
        themes={themeEngine.themes} theme={themeEngine.theme} setTheme={themeEngine.setTheme}
        nexusApiKey={credentials.nexusApiKey} setNexusApiKey={credentials.setNexusApiKey}
        steamGridDbKey={credentials.steamGridDbKey} setSteamGridDbKey={credentials.setSteamGridDbKey}
        saveCredential={credentials.save} credentialBusy={credentials.busy}
        cloudSyncEnabled={app.cloud.cloudSyncEnabled} cloudDataAccessAllowed={app.cloud.cloudDataAccessAllowed} cloudSettingsReady={app.cloud.cloudSettingsReady} cloudSyncState={app.cloud.syncState}
        cloudImportBusy={app.cloud.cloudDataBusy} cloudImportReady={app.storage.ready} cloudImportMessage={app.cloud.cloudDataMessage}
        onImportCloudData={app.cloud.importCloudLibrary}
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
  useEffect(() => installTruncationTitles(), []);
  return <AccessibilityProvider><AppProvider><ControllerRuntime /><BigPictureGate><Shell /></BigPictureGate><ShortcutsHelp /><GameSearch /><CommandPalette /></AppProvider></AccessibilityProvider>;
}
