import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { libraryProviders, type LibraryProviderStatus } from '../shared/library-providers.js';
const names: Record<string, RegExp> = {
  steam: /^Steam$/i, epic: /^Epic Games (?:Store|Launcher)$/i, gog: /^GOG (?:Galaxy|GALAXY)(?: 2\.0)?$/i,
  ea: /^EA(?: app| App| Desktop)?$/, ubisoft: /^Ubisoft Connect$/i, battlenet: /^Battle\.net$/i,
};
const known: Record<string, string[]> = { steam: ['steam.desktop','com.valvesoftware.Steam.desktop'] };
/** Inspect only desktop entry metadata, never tokens, cookies, Exec commands or arbitrary prefixes. */
export async function scanLibraryProviders(directories?: string[]): Promise<LibraryProviderStatus[]> {
  const home = os.homedir();
  const roots = directories ?? [
    path.join(process.env.XDG_DATA_HOME || path.join(home,'.local/share'),'applications'),
    ...((process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(value => path.isAbsolute(value)).map(value => path.join(value,'applications'))),
    path.join(home,'.local/share/flatpak/exports/share/applications'), '/var/lib/flatpak/exports/share/applications',
  ];
  const installed = new Set<string>();
  async function scan(directory: string, depth: number): Promise<void> {
    let entries; try { entries = await fs.readdir(directory,{withFileTypes:true}); } catch { return; }
    for (const entry of entries.slice(0,2000)) {
      const file = path.join(directory,entry.name);
      if (entry.isDirectory() && depth < 2) { await scan(file,depth+1); continue; }
      if (!entry.name.endsWith('.desktop')) continue;
      try {
        if ((await fs.stat(file)).size > 64_000) continue;
        const text = await fs.readFile(file,'utf8');
        const group = text.match(/^\[Desktop Entry\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
        if (!group || /^Hidden\s*=\s*true\s*$/mi.test(group) || !/^Type\s*=\s*Application\s*$/m.test(group)) continue;
        const name = group.match(/^Name\s*=\s*(.+)$/m)?.[1]?.trim();
        for (const provider of libraryProviders) if (known[provider.id]?.includes(entry.name) || (name && names[provider.id].test(name))) installed.add(provider.id);
      } catch { /* Optional launcher metadata; ignore malformed or inaccessible entries. */ }
    }
  }
  for (const root of new Set(roots)) await scan(root,0);
  return libraryProviders.map(provider => ({id:provider.id, installed:installed.has(provider.id)}));
}
