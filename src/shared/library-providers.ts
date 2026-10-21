export const libraryProviders = [
  { id: 'steam', name: 'Steam', site: 'https://store.steampowered.com/about/', icon: 'SteamLogoMark' },
  { id: 'epic', name: 'Epic Games Store', site: 'https://store.epicgames.com/download', icon: 'EpicGamesStoreLogoMark' },
  { id: 'gog', name: 'GOG', site: 'https://www.gog.com/galaxy', icon: undefined },
  { id: 'ea', name: 'EA app', site: 'https://www.ea.com/ea-app', icon: undefined },
  { id: 'ubisoft', name: 'Ubisoft Connect', site: 'https://www.ubisoft.com/ubisoft-connect', icon: 'UbisoftLogoMark' },
  { id: 'battlenet', name: 'Battle.net', site: 'https://download.battle.net/', icon: undefined },
] as const;
export type LibraryProviderId = typeof libraryProviders[number]['id'];
export interface LibraryProviderStatus { id: LibraryProviderId; installed: boolean; }
export const xboxExtensions = [
  { id: 'ea', name: 'EA app' }, { id: 'ubisoft', name: 'Ubisoft Connect' },
  { id: 'battlenet', name: 'Battle.net' }, { id: 'riot', name: 'Riot Client' },
] as const;
