import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopGuideApi, Game, InstallRequest, LauncherApi, Settings } from '../shared/types.js';

// The launcher may be created lazily from Game Bar. Retain one trusted main
// request briefly while the snapshot loads and the dialog host mounts.
const xboxModeEntryLifetimeMs = 5000;
let pendingXboxModeEntryAt: number | undefined;
const xboxModeEntryListeners = new Set<() => void>();
ipcRenderer.on('xbox-mode-entry-requested', () => {
  if (!xboxModeEntryListeners.size) { pendingXboxModeEntryAt = performance.now(); return; }
  for (const callback of xboxModeEntryListeners) callback();
});

// Demo fixtures live in the main process (src/shared/demo-data.ts) and are
// served over these same IPC channels when XODUS_DEMO=1, so the sandboxed
// preload stays a thin passthrough. Store pages always use the live
// Microsoft Store catalog. No real credentials, tokens or account data.
const api: LauncherApi = {
  getWindowFullscreen: () => ipcRenderer.invoke('window-fullscreen-get'),
  setWindowFullscreen: enabled => ipcRenderer.invoke('window-fullscreen-set', enabled),
  onWindowFullscreenChanged: callback => {
    const listener = (_event: Electron.IpcRendererEvent, enabled: boolean) => callback(enabled);
    ipcRenderer.on('window-fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('window-fullscreen-changed', listener);
  },
  onXboxModeEntryRequested: callback => {
    xboxModeEntryListeners.add(callback);
    const requestedAt = pendingXboxModeEntryAt;
    pendingXboxModeEntryAt = undefined;
    if (requestedAt !== undefined) {
      const age = performance.now() - requestedAt;
      if (age >= 0 && age < xboxModeEntryLifetimeMs) callback();
    }
    return () => { xboxModeEntryListeners.delete(callback); };
  },
  getFullscreenExperience: () => ipcRenderer.invoke('fullscreen-experience-get'),
  setFullscreenExperience: enabled => ipcRenderer.invoke('fullscreen-experience-set', enabled),
  getXboxModeRestartStatus: () => ipcRenderer.invoke('xbox-mode-restart-status'),
  prepareXboxModeRestart: () => ipcRenderer.invoke('xbox-mode-restart-prepare'),
  restartIntoXboxMode: token => ipcRenderer.invoke('xbox-mode-restart', token),
  getBatteryStatus: () => ipcRenderer.invoke('battery-status'),
  requestVoiceCapture: () => ipcRenderer.invoke('voice-capture-request'),
  releaseVoiceCapture: () => ipcRenderer.invoke('voice-capture-release'),
  onVoiceCaptureStop: callback => {
    const listener = () => callback();
    ipcRenderer.on('voice-capture-stop', listener);
    return () => ipcRenderer.removeListener('voice-capture-stop', listener);
  },
  getGuideSystem: () => ipcRenderer.invoke('guide-system-get'),
  prepareGuidePower: action => ipcRenderer.invoke('guide-power-prepare', action),
  executeGuideSystem: (action, token) => ipcRenderer.invoke('guide-system-execute', action, token),
  openGuideSystemSettings: section => ipcRenderer.invoke('guide-system-settings', section),
  getXboxFriends: refresh => ipcRenderer.invoke('xbox-social-friends', refresh),
  getXboxChats: refresh => ipcRenderer.invoke('xbox-social-inbox', refresh),
  getXboxConversation: (peer, refresh) => ipcRenderer.invoke('xbox-social-conversation', peer, refresh),
  searchXboxPeople: query => ipcRenderer.invoke('xbox-social-search', query),
  sendXboxMessage: (peer, text) => ipcRenderer.invoke('xbox-social-send', peer, text),
  quitLauncher: () => ipcRenderer.invoke('quit-launcher'),
  refreshXboxProfile: () => ipcRenderer.invoke('xbox-profile-refresh'),
  openCloudGaming: () => ipcRenderer.invoke('cloud-gaming-open'),
  getCloudGamingState: () => ipcRenderer.invoke('cloud-gaming-state'),
  onCloudGamingState: callback => {
    const listener = (_event: Electron.IpcRendererEvent, state: import('../shared/cloud-gaming.js').CloudGamingState) => callback(state);
    ipcRenderer.on('cloud-gaming-state', listener);
    return () => ipcRenderer.removeListener('cloud-gaming-state', listener);
  },
  controlCloudGaming: command => ipcRenderer.invoke('cloud-gaming-control', command),
  setCloudGamingObscured: obscured => ipcRenderer.invoke('cloud-gaming-obscured', obscured),
  getLibraryProviders: () => ipcRenderer.invoke('library-providers'),
  getBatteryPercentage: () => ipcRenderer.invoke('battery-percentage'),
  openRemotePlay: () => ipcRenderer.invoke('remote-play-open'),
  getRemotePlayState: () => ipcRenderer.invoke('remote-play-state'),
  controlRemotePlay: command => ipcRenderer.invoke('remote-play-control', command),
  setRemotePlayObscured: obscured => ipcRenderer.invoke('remote-play-obscured', obscured),
  onRemotePlayState: callback => {
    const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]) => callback(state);
    ipcRenderer.on('remote-play-state', listener);
    return () => ipcRenderer.removeListener('remote-play-state', listener);
  },
  getGuideAudio: () => ipcRenderer.invoke('guide-audio-get'),
  setGuideAudio: patch => ipcRenderer.invoke('guide-audio-set', patch),
  getGuideMixer: () => ipcRenderer.invoke('guide-mixer-get'),
  controlGuideMixer: command => ipcRenderer.invoke('guide-mixer-control', command),
  getGuidePerformance: () => ipcRenderer.invoke('guide-performance-get'),
  getGuideGallery: () => ipcRenderer.invoke('guide-gallery-get'),
  openGuideCapture: id => ipcRenderer.invoke('guide-gallery-open', id),
  deleteGuideCapture: id => ipcRenderer.invoke('guide-gallery-delete', id),
  getSpotifyState: () => ipcRenderer.invoke('guide-spotify-get'),
  controlSpotify: command => ipcRenderer.invoke('guide-spotify-control', command),
  captureLauncher: () => ipcRenderer.invoke('guide-capture'),
  getSnapshot: () => ipcRenderer.invoke('get-snapshot'),
  refreshBackend: () => ipcRenderer.invoke('backend-refresh'),
  checkBackendUpdate: () => ipcRenderer.invoke('backend-check-update'),
  updateBackend: () => ipcRenderer.invoke('backend-update'),
  rebuildBackend: () => ipcRenderer.invoke('backend-rebuild'),
  refreshRuntime: () => ipcRenderer.invoke('runtime-refresh'),
  checkRuntimeUpdate: () => ipcRenderer.invoke('runtime-check-update'),
  checkNexusRuntime: () => ipcRenderer.invoke('runtime-check-nexus'),
  installRuntime: () => ipcRenderer.invoke('runtime-install'),
  installNexusRuntime: () => ipcRenderer.invoke('runtime-install-nexus'),
  rollbackRuntimePreview: () => ipcRenderer.invoke('runtime-rollback-preview'),
  refreshAccount: () => ipcRenderer.invoke('account-refresh'),
  checkKeyring: () => ipcRenderer.invoke('keyring-check'),
  startKeyring: () => ipcRenderer.invoke('keyring-start'),
  checkLauncherUpdate: () => ipcRenderer.invoke('check-launcher-update'),
  installLauncherUpdate: () => ipcRenderer.invoke('install-launcher-update'),
  restartLauncher: () => ipcRenderer.invoke('restart-launcher'),
  rollbackLauncherUpdate: () => ipcRenderer.invoke('rollback-launcher-update'),
  checkGameUpdates: (id?: string) => ipcRenderer.invoke('check-game-updates', id),
  readDiagnosticLog: (id: string) => ipcRenderer.invoke('read-diagnostic-log', id),
  copyDiagnosticLog: (id: string) => ipcRenderer.invoke('copy-diagnostic-log', id),
  revealDiagnosticLog: (id: string) => ipcRenderer.invoke('reveal-diagnostic-log', id),
  readBackendDiagnosticLog: () => ipcRenderer.invoke('read-backend-diagnostic-log'),
  login: () => ipcRenderer.invoke('login'),
  logout: () => ipcRenderer.invoke('logout'),
  searchCatalog: (query: string, cursor?: string) => ipcRenderer.invoke('catalog-search', query, cursor),
  getFeaturedCatalog: () => ipcRenderer.invoke('catalog-featured'),
  getCatalogDetails: (productId: string) => ipcRenderer.invoke('catalog-details', productId),
  getAccountLibrary: (kind, cursor, refresh) => ipcRenderer.invoke('account-library', kind, cursor, refresh),
  startInstall: (request: InstallRequest) => ipcRenderer.invoke('start-install', request),
  getInstallPlan: (productId: string) => ipcRenderer.invoke('install-plan', productId),
  getGameContent: id => ipcRenderer.invoke('game-content', id),
  installGameContent: (id, productId) => ipcRenderer.invoke('install-game-content', id, productId),
  updateInstalledGame: (id: string) => ipcRenderer.invoke('update-installed-game', id),
  getDownloadCancelOptions: (id: string) => ipcRenderer.invoke('download-cancel-options', id),
  cancelDownload: (id: string, mode?: 'keep' | 'delete-files') => ipcRenderer.invoke('cancel-download', id, mode),
  pauseDownload: (id: string) => ipcRenderer.invoke('pause-download', id),
  resumeDownload: (id: string) => ipcRenderer.invoke('resume-download', id),
  removeDownload: (id: string) => ipcRenderer.invoke('remove-download', id),
  clearFinishedDownloads: () => ipcRenderer.invoke('clear-finished-downloads'),
  importGame: (path?: string) => ipcRenderer.invoke('import-game', path),
  updateGame: (id: string, patch: Partial<Pick<Game, 'title' | 'executable' | 'launchArgs' | 'locale' | 'launchTools'>>) => ipcRenderer.invoke('update-game', id, patch),
  getGameLocales: (id: string) => ipcRenderer.invoke('game-locales', id),
  removeGame: (id: string, mode: 'library' | 'delete-files') => ipcRenderer.invoke('remove-game', id, mode),
  getGameLaunchOptions: (id: string) => ipcRenderer.invoke('game-launch-options', id),
  getGameDetails: (id: string) => ipcRenderer.invoke('game-details', id),
  getGameActivity: (id: string, refresh?: boolean) => ipcRenderer.invoke('game-activity', id, refresh),
  getGameAchievements: (id: string, refresh?: boolean) => ipcRenderer.invoke('game-achievements', id, refresh),
  launchGame: (id: string) => ipcRenderer.invoke('launch-game', id),
  createGameShortcut: (id, destination) => ipcRenderer.invoke('create-game-shortcut', id, destination),
  addToSteam: id => ipcRenderer.invoke('add-to-steam', id),
  installGameVcRuntime: (id: string) => ipcRenderer.invoke('install-game-vc-runtime', id),
  cancelGame: () => ipcRenderer.invoke('cancel-game'),
  updateSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('update-settings', patch),
  chooseDirectory: (defaultPath?: string) => ipcRenderer.invoke('choose-directory', defaultPath),
  chooseFile: (defaultPath?: string) => ipcRenderer.invoke('choose-file', defaultPath),
  openPath: (target: string) => ipcRenderer.invoke('open-path', target),
  onSnapshot: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) => callback(value);
    ipcRenderer.on('snapshot', listener);
    return () => ipcRenderer.removeListener('snapshot', listener);
  },
  onOperationLog: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) => callback(value);
    ipcRenderer.on('operation-log', listener);
    return () => ipcRenderer.removeListener('operation-log', listener);
  },
  isDemoTour: () => process.env.XODUS_DEMO_TOUR === '1' && !process.env.XODUS_DEMO_CAPTURE_DIR,
};

contextBridge.exposeInMainWorld('launcher', api);

const desktopGuide: DesktopGuideApi = {
  toggle: () => ipcRenderer.invoke('desktop-guide-toggle'),
  close: () => ipcRenderer.invoke('desktop-guide-close'),
  requestXboxModeEntry: () => ipcRenderer.invoke('desktop-guide-xbox-mode-entry'),
  onInput: callback => {
    const actions = ['up', 'down', 'left', 'right', 'accept', 'back', 'previous', 'next'] as const;
    const listener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action === 'string' && actions.includes(action as typeof actions[number])) callback(action as typeof actions[number]);
    };
    ipcRenderer.on('desktop-guide-input', listener);
    return () => ipcRenderer.removeListener('desktop-guide-input', listener);
  },
  navigate: (page: string, gameId?: string) => ipcRenderer.invoke('desktop-guide-navigate', page, gameId),
  onNavigate: (callback: (value: { page: string; gameId?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: { page: string; gameId?: string }) => callback(value);
    ipcRenderer.on('desktop-guide-navigate', listener);
    return () => ipcRenderer.removeListener('desktop-guide-navigate', listener);
  },
};
contextBridge.exposeInMainWorld('desktopGuide', desktopGuide);
