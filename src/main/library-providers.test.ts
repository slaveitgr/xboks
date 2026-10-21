import { expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanLibraryProviders } from './library-providers';
it('detects registered native, Flatpak and nested Wine desktop entries without interpreting Exec', async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'xboks-providers-'));
 try {
  await fs.mkdir(path.join(root,'wine'));
  await fs.writeFile(path.join(root,'com.valvesoftware.Steam.desktop'),'[Desktop Entry]\nType=Application\nName=Steam\nExec=DO_NOT_EXECUTE\n');
  await fs.writeFile(path.join(root,'wine','epic.desktop'),'[Desktop Entry]\nType=Application\nName=Epic Games Launcher\nExec=DO_NOT_EXECUTE\n');
  await fs.writeFile(path.join(root,'hidden.desktop'),'[Desktop Entry]\nType=Application\nName=EA app\nHidden=true\n');
  await fs.writeFile(path.join(root,'heroic.desktop'),'[Desktop Entry]\nType=Application\nName=Heroic Games Launcher\n');
  const result = await scanLibraryProviders([root]);
  expect(result.filter(value=>value.installed).map(value=>value.id)).toEqual(['steam','epic']);
  expect(result).toHaveLength(6);
 } finally { await fs.rm(root,{recursive:true,force:true}); }
});
it('does not infer authentication or installed providers from unrelated action sections or missing directories', async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'xboks-providers-'));
 try {
  await fs.writeFile(path.join(root,'other.desktop'),'[Desktop Entry]\nType=Application\nName=Unrelated\n[Desktop Action launch]\nName=Battle.net\n');
  await fs.writeFile(path.join(root,'gog.desktop'),'[Desktop Entry]\nType=Link\nName=GOG Galaxy\n');
  expect((await scanLibraryProviders([root,path.join(root,'missing')])).every(value=>!value.installed)).toBe(true);
 } finally { await fs.rm(root,{recursive:true,force:true}); }
});
