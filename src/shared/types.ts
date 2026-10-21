export type Page = 'home' | 'gamepass' | 'store' | 'library' | 'cloud' | 'profile' | 'downloads' | 'settings';

export interface BackendCapabilities {
  commands: string[];
  account: boolean;
  profile?: boolean;
  gameActivity?: boolean;
  achievements?: boolean;
  library?: boolean;
  social?: boolean;
  login: boolean;
  externalAuth?: boolean;
  logout: boolean;
  download: boolean;
  streaming: boolean;
  streamingProgressJson?: boolean;
  streamingControls?: boolean;
  streamingBandwidthLimit?: boolean;
  packageSelection?: boolean;
  run: boolean;
  version?: string;
}

export interface AuthStatus {
  running: boolean;
  stored: boolean | null;
  username?: string;
  gamertag?: string;
  avatarDataUrl?: string;
  subscription?: GamePassSubscription;
  profile?: import('./xbox-profile.js').XboxSelfProfile;
  profileSource?: 'live' | 'cache';
  profileRefreshing?: boolean;
  profileError?: string;
  storeAccount?: import('./account-identities.js').StoreAccountIdentity;
  lastResult?: 'success' | 'failed';
  lastAction?: 'login' | 'logout';
  note: string;
}

export interface GamePassSubscription {
  status: 'active' | 'none' | 'unknown';
  productIds: string[];
  checkedAt: string;
}

export interface BackendStatus {
  available: boolean;
  source: 'external' | 'managed' | 'none';
  binaryPath?: string;
  commit?: string;
  upstreamCommit?: string;
  updateAvailable: boolean;
  checking: boolean;
  updating: boolean;
  externalRoot: string;
  capabilities: BackendCapabilities;
  prerequisites: { git: boolean; cargo: boolean; rustc: boolean; protoc: boolean };
  blockReason?: string;
  linuxRunPatch?: string;
  version?: string;
  delivery?: 'release' | 'local';
  releaseAvailable?: boolean;
  releaseVersion?: string;
  releaseState?: 'available' | 'unpublished' | 'error';
  releaseError?: string;
  phase?: string;
}

export interface RuntimeStatus {
  installed: boolean;
  checking: boolean;
  updating: boolean;
  runtimeRoot: string;
  name?: string;
  winePath?: string;
  commit?: string;
  upstreamCommit?: string;
  artifactName?: string;
  artifactExpiresAt?: string;
  artifactAvailable: boolean;
  // Owned xboks Engine release channel. Legacy field names remain for stored
  // snapshots and IPC compatibility; consumer downloads use slaveitgr/xboks.
  nexusAvailable?: boolean;
  nexusName?: string;
  nexusVersion?: string;
  nexusChecking?: boolean;
  nexusError?: string;
  releaseState?: 'available' | 'unpublished' | 'error';
  prerequisites: { gh: boolean; authenticated: boolean; tar: boolean; sha512sum: boolean };
  phase?: string;
  error?: string;
}

export interface GameLaunchTools {
  dualSenseCompatibility?: boolean;
  gameMode?: boolean;
  mangoHud: boolean;
  gamescope: boolean;
  gamescopeArgs: string;
  launchOptions: string;
}

export interface Game {
  id: string;
  title: string;
  path: string;
  storeId?: string;
  publisher?: string;
  installedVersion?: string;
  packageName?: string;
  executable?: string;
  winePath?: string; // Legacy saved field; ignored for launch. The runtime is global.
  launchArgs?: string;
  launchTools?: GameLaunchTools;
  locale?: string;
  coverDataUrl?: string;
  coverUrl?: string; // Store box art, preferred over the installation's small logo.
  heroUrl?: string; // Wide Store artwork for the game detail panel.
  installState: 'ready' | 'incomplete' | 'imported';
  installMessage?: string;
  vcRedistEncrypted?: boolean;
  antiCheat?: {
    provider: 'Easy Anti-Cheat';
    executable?: string;
    encryptedTarget: boolean;
  };
  addedAt: string;
}

export interface GameLaunchOptions {
  cloudSaves: boolean;
  cloudReason?: string;
  vcInstall: boolean;
  vcReason?: string;
}

export interface DownloadTask {
  id: string;
  kind?: 'install' | 'update' | 'content';
  gameId?: string;
  title: string;
  productId: string;
  selectedContentId?: string;
  selectionMarket?: string;
  destination: string;
  status: 'queued' | 'running' | 'paused' | 'complete' | 'failed' | 'cancelled';
  canPause?: boolean;
  controlPending?: boolean;
  cancelling?: boolean;
  progress: number | null;
  downloadedBytes?: number;
  totalBytes?: number;
  transferRate?: string;
  coverUrl?: string; // Store box art for the queued product, for the queue list.
  phase: string;
  log: string[];
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
}

export interface DownloadCancelOptions { deleteFilesAllowed: boolean; reason?: string }

export interface GameOperation {
  id: string;
  gameId: string;
  title: string;
  kind?: 'launch' | 'prerequisite';
  status: 'preparing' | 'running' | 'stopping' | 'complete' | 'failed';
  phase: string;
  log: string[];
  logPath?: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export interface Settings {
  installRoot: string;
  market: string;
  parallelDownloads: number;
  downloadLimitMiB?: number;
  downloadNotifications?: boolean;
  /** Display preference only; downloadLimitMiB always remains MiB/s. */
  downloadSpeedUnit?: 'bits' | 'bytes';
  createDesktopShortcut?: boolean;
  launchOnLogin?: boolean;
  launchInBackground?: boolean;
  minimizeToTray?: boolean;
  winePath: string;
  externalXodusRoot: string;
  runtimeRoot: string;
  verboseLogs: boolean;
  firstRunCompleted?: boolean;
}

export interface LauncherUpdate {
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  checking: boolean;
  checkedAt?: string;
  updating?: boolean;
  progress?: number;
  phase?: string;
  error?: string;
  canInstall?: boolean;
  restartRequired?: boolean;
  canRollback?: boolean;
}

export interface GameUpdate {
  checking: boolean;
  available?: boolean;
  latestVersion?: string;
  checkedAt?: string;
  error?: string;
}

export interface DiagnosticLog { name: string; content: string; truncated: boolean }

export interface KeyringStatus {
  canCreate?: boolean;
  canUnlock?: boolean;
  state: 'ready' | 'locked' | 'stopped' | 'disabled' | 'missing' | 'needs-setup' | 'unavailable';
  gameMode: boolean;
  canStart: boolean;
  message: string;
}

export interface AppSnapshot {
  backend: BackendStatus;
  runtime: RuntimeStatus;
  games: Game[];
  downloads: DownloadTask[];
  settings: Settings;
  auth: AuthStatus;
  launcherUpdate?: LauncherUpdate;
  gameOperation?: GameOperation;
  gameUpdates?: Record<string, GameUpdate>;
  downloadProgressSupported?: boolean;
  desktopSettings?: DesktopSettingsStatus;
  /** Captured before Game Bar takes focus; never written to account/library data. */
  guideForeground?: import('./desktop-shell.js').DesktopForegroundApp;
  fullscreenExperience?: import('./fullscreen-experience.js').FullscreenExperienceStatus;
}

/** Desktop session facts, separate from the application window's fullscreen state. */
export interface DesktopSettingsStatus {
  canSetAutostart: boolean;
  autostartReason?: string;
  fullscreenExperience: boolean;
  fullscreenExperienceSource: 'environment' | 'gnome-extension' | 'none';
  sessionType?: string;
  desktop?: string;
  /** Unknown until attempted; a successful Tray construction does not prove shell visibility. */
  trayAvailable?: boolean;
  gameBarResident?: boolean;
  gameBarServiceEnabled?: boolean;
  /** Native joystick listener ownership; never a claim about a pressed button. */
  gameBarController?: {
    status: 'starting' | 'listening' | 'unavailable' | 'error' | 'stopped';
    devices: number;
    reason?: string;
    navigationSurface?: 'none' | 'guide' | 'switcher';
  };
}

export interface InstallRequest {
  productId: string;
  title: string;
  destination: string;
  selectedContentId?: string;
  selectionMarket?: string;
}

export interface InstallChoice {
  productId: string;
  contentId: string;
  title: string;
  platform: string;
  packageFormat: string;
  kind: string;
  supported: boolean;
}

export interface InstallPlan {
  schema: 1;
  rootProductId: string;
  market: string;
  status: 'ready' | 'choice' | 'unavailable';
  choices: InstallChoice[];
}

export interface GameContentItem {
  productId: string;
  title: string;
  access?: 'owned' | 'gamepass';
  status: 'installed' | 'available' | 'unlicensed' | 'unsupported';
  downloadBytes?: number;
  note: string;
}

export interface GameContentPlan {
  gameId: string;
  checkedAt: string;
  runtimeSupported?: boolean;
  items: GameContentItem[];
}

export interface CatalogProduct {
  handheldCompatibility?: import('./handheld-compatibility.js').HandheldCompatibility;
  productId: string;
  installProductId?: string;
  title: string;
  description: string;
  publisher?: string;
  posterUrl?: string;
  heroUrl?: string;
  storeUrl?: string;
  categories: string[];
  purchasePrice?: string;
  includedWith?: string;
  releaseDate?: string;
  averageRating?: number;
  installability: 'supported' | 'unsupported' | 'unknown';
  packageFormat?: string;
  supportNote: string;
}

/** Public catalog data only, never an ownership/installation decision. */
export interface GameStoreDetails {
  handheldCompatibility?: import('./handheld-compatibility.js').HandheldCompatibility;
  productId: string;
  title: string;
  description: string;
  publisher?: string;
  heroUrl?: string;
  categories: string[];
  screenshots: string[];
  releaseDate?: string;
}

export interface GameActivity {
  status: 'available' | 'unavailable' | 'unsupported' | 'signed-out' | 'error';
  minutesPlayed?: number;
  lastPlayed?: string;
  partial?: boolean;
}

export interface GameAchievement {
  id: string;
  name: string;
  description: string;
  state: 'unlocked' | 'in-progress' | 'locked';
  secret: boolean;
  revoked: boolean;
  gamerscore?: number;
  iconUrl?: string;
  unlockedAt?: string;
  progress?: number;
}

export interface GameAchievements {
  status: 'available' | 'unavailable' | 'unsupported' | 'signed-out' | 'error';
  items?: GameAchievement[];
  partial?: boolean;
}

export interface CatalogSearchResult {
  query: string;
  market: string;
  products: CatalogProduct[];
  cursor?: string;
  hasMore: boolean;
  fetchedAt: string;
  source: 'Microsoft Store';
}

export interface AccountLibraryPage {
  kind: 'all' | 'owned' | 'gamepass';
  products: (CatalogProduct & { access: 'owned' | 'gamepass' })[];
  accessByProductId: Record<string, 'owned' | 'gamepass'>;
  cursor?: string;
  checkedAt: string;
  skippedEntitlements?: number;
}

export type GuideAudio = { available: true; volume: number; muted: boolean } | { available: false; reason: string };

export interface DesktopGuideApi {
  toggle(): Promise<void>;
  close(): Promise<void>;
  navigate(page: string, gameId?: string): Promise<void>;
  requestXboxModeEntry(): Promise<void>;
  onNavigate(callback: (value: { page: string; gameId?: string }) => void): () => void;
  onInput(callback: (action: import('./desktop-shell.js').GuideInputAction) => void): () => void;
}

export interface LauncherApi {
  getWindowFullscreen(): Promise<boolean>;
  setWindowFullscreen(enabled: boolean): Promise<boolean>;
  onWindowFullscreenChanged(callback: (enabled: boolean) => void): () => void;
  onXboxModeEntryRequested(callback: () => void): () => void;
  getFullscreenExperience(): Promise<import('./fullscreen-experience.js').FullscreenExperienceStatus>;
  setFullscreenExperience(enabled: boolean): Promise<import('./fullscreen-experience.js').FullscreenExperienceStatus>;
  getXboxModeRestartStatus(): Promise<import('./fullscreen-experience.js').XboxModeRestartStatus>;
  prepareXboxModeRestart(): Promise<import('./guide-system.js').GuidePowerConfirmation>;
  restartIntoXboxMode(token: string): Promise<void>;
  getBatteryStatus(): Promise<import('./fullscreen-experience.js').BatteryPowerStatus>;
  requestVoiceCapture(): Promise<void>;
  releaseVoiceCapture(): Promise<void>;
  onVoiceCaptureStop(callback: () => void): () => void;
  getGuideSystem(): Promise<import('./guide-system.js').GuideSystemState>;
  prepareGuidePower(action: import('./guide-system.js').GuidePowerAction): Promise<import('./guide-system.js').GuidePowerConfirmation>;
  executeGuideSystem(action: import('./guide-system.js').GuideSystemAction, confirmationToken?: string): Promise<import('./guide-system.js').GuideSystemActionResult>;
  openGuideSystemSettings(section: import('./guide-system.js').GuideSystemSettingsSection): Promise<void>;
  getXboxFriends(refresh?: boolean): Promise<import('./xbox-social.js').XboxSocialResult>;
  getXboxChats(refresh?: boolean): Promise<import('./xbox-social.js').XboxSocialResult>;
  getXboxConversation(peerXuid: string, refresh?: boolean): Promise<import('./xbox-social.js').XboxSocialResult>;
  searchXboxPeople(query: string): Promise<import('./xbox-social.js').XboxSocialResult>;
  sendXboxMessage(peerXuid: string, text: string): Promise<import('./xbox-social.js').XboxSocialResult>;
  quitLauncher(): Promise<void>;
  refreshXboxProfile(): Promise<void>;
  openCloudGaming(): Promise<void>;
  getCloudGamingState(): Promise<import('./cloud-gaming.js').CloudGamingState>;
  onCloudGamingState(callback: (state: import('./cloud-gaming.js').CloudGamingState) => void): () => void;
  controlCloudGaming(command: import('./cloud-gaming.js').CloudGamingCommand): Promise<import('./cloud-gaming.js').CloudGamingState>;
  setCloudGamingObscured(obscured: boolean): Promise<void>;
  openRemotePlay(): Promise<void>;
  getRemotePlayState(): Promise<import('./remote-play.js').RemotePlayState>;
  onRemotePlayState(callback: (state: import('./remote-play.js').RemotePlayState) => void): () => void;
  controlRemotePlay(command: import('./remote-play.js').RemotePlayCommand): Promise<import('./remote-play.js').RemotePlayState>;
  setRemotePlayObscured(obscured: boolean): Promise<void>;
  getBatteryPercentage(): Promise<number | null>;
  getLibraryProviders(): Promise<import('./library-providers.js').LibraryProviderStatus[]>;
  getGuideAudio(): Promise<GuideAudio>;
  setGuideAudio(patch: { volume?: number; muted?: boolean }): Promise<GuideAudio>;
  getGuideMixer(): Promise<import('./guide-mixer.js').GuideMixerState>;
  controlGuideMixer(command: import('./guide-mixer.js').GuideMixerCommand): Promise<import('./guide-mixer.js').GuideMixerState>;
  getGuidePerformance(): Promise<import('./guide-widgets.js').GuidePerformance>;
  getGuideGallery(): Promise<import('./guide-widgets.js').GuideGallery>;
  openGuideCapture(id: string): Promise<void>;
  deleteGuideCapture(id: string): Promise<void>;
  getSpotifyState(): Promise<import('./spotify.js').SpotifyState>;
  controlSpotify(command: import('./spotify.js').SpotifyCommand): Promise<import('./spotify.js').SpotifyState>;
  captureLauncher(): Promise<string>;
  getSnapshot(): Promise<AppSnapshot>;
  refreshBackend(): Promise<BackendStatus>;
  checkBackendUpdate(): Promise<BackendStatus>;
  updateBackend(): Promise<void>;
  rebuildBackend(): Promise<void>;
  refreshRuntime(): Promise<RuntimeStatus>;
  checkRuntimeUpdate(): Promise<RuntimeStatus>;
  checkNexusRuntime(): Promise<RuntimeStatus>;
  installRuntime(): Promise<void>;
  installNexusRuntime(): Promise<void>;
  rollbackRuntimePreview(): Promise<void>;
  refreshAccount(): Promise<AuthStatus>;
  checkKeyring(): Promise<KeyringStatus>;
  startKeyring(): Promise<KeyringStatus>;
  createKeyringCollection(): Promise<KeyringStatus>;
  onKeyringStatus(callback: (status: KeyringStatus) => void): () => void;
  checkLauncherUpdate(): Promise<LauncherUpdate | undefined>;
  installLauncherUpdate(): Promise<void>;
  restartLauncher(): Promise<void>;
  rollbackLauncherUpdate(): Promise<void>;
  checkGameUpdates(id?: string): Promise<void>;
  readDiagnosticLog(operationId: string): Promise<DiagnosticLog>;
  copyDiagnosticLog(operationId: string): Promise<void>;
  revealDiagnosticLog(operationId: string): Promise<void>;
  readBackendDiagnosticLog(): Promise<DiagnosticLog>;
  login(): Promise<void>;
  logout(): Promise<void>;
  searchCatalog(query: string, cursor?: string): Promise<CatalogSearchResult>;
  getFeaturedCatalog(): Promise<CatalogSearchResult>;
  getStoreCollection(collection: 'all-pc' | 'toppaid' | 'addons', cursor?: string): Promise<CatalogSearchResult>;
  getCatalogDetails(productId: string): Promise<GameStoreDetails | undefined>;
  getAccountLibrary(kind: AccountLibraryPage['kind'], cursor?: string, refresh?: boolean): Promise<AccountLibraryPage>;
  startInstall(request: InstallRequest): Promise<string>;
  getInstallPlan(productId: string): Promise<InstallPlan>;
  getGameContent(id: string): Promise<GameContentPlan>;
  installGameContent(id: string, productId: string): Promise<string>;
  updateInstalledGame(id: string): Promise<string>;
  getDownloadCancelOptions(id: string): Promise<DownloadCancelOptions>;
  cancelDownload(id: string, mode?: 'keep' | 'delete-files'): Promise<void>;
  pauseDownload(id: string): Promise<void>;
  resumeDownload(id: string): Promise<void>;
  removeDownload(id: string): Promise<void>;
  clearFinishedDownloads(): Promise<void>;
  importGame(path?: string): Promise<Game | null>;
  updateGame(id: string, patch: Partial<Pick<Game, 'title' | 'executable' | 'launchArgs' | 'locale' | 'launchTools'>>): Promise<Game>;
  getGameLocales(id: string): Promise<string[]>;
  removeGame(id: string, mode: 'library' | 'delete-files'): Promise<void>;
  getGameLaunchOptions(id: string): Promise<GameLaunchOptions>;
  getGameDetails(id: string): Promise<GameStoreDetails | undefined>;
  getGameActivity(id: string, refresh?: boolean): Promise<GameActivity>;
  getGameAchievements(id: string, refresh?: boolean): Promise<GameAchievements>;
  launchGame(id: string): Promise<void>;
  createGameShortcut(id: string, destination: 'desktop' | 'applications'): Promise<string>;
  addToSteam(id?: string): Promise<string>;
  installGameVcRuntime(id: string): Promise<void>;
  cancelGame(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  chooseDirectory(defaultPath?: string): Promise<string | null>;
  chooseFile(defaultPath?: string): Promise<string | null>;
  openPath(path: string): Promise<void>;
  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void;
  onOperationLog(callback: (entry: { scope: string; line: string }) => void): () => void;
  isDemoTour(): boolean;
}
