import { constants, promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Game, GameContentItem, GameContentPlan } from '../shared/types.js';
import { children, parsePackageXml, single, type XmlNode } from './package-xml.js';

const productId = /^[A-Z0-9]{12}$/;
const contentId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const markerName = '.xboks-content-complete.json';
const legacyMarkerName = '.nexus-content-complete.json';
interface Manifest {
  storeId: string; name: string; publisher: string; version: string;
  related: string[]; allowed: string[]; dependency?: string;
}
export interface ContentPackage { productId: string; contentId: string; family: string; downloadBytes?: number }
type Access = Record<string, 'owned' | 'gamepass'>;
type RecordValue = Record<string, any>;

async function boundedFile(file: string): Promise<string> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 1_048_576) throw Error('Package metadata is too large or not a file.');
    const bytes = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > stat.size) throw Error('Package metadata changed while reading.');
    return bytes.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
}
async function manifestFile(directory: string, filename: string): Promise<string> {
  const matches = (await fs.readdir(directory)).filter(name => name.toLowerCase() === filename.toLowerCase());
  if (matches.length !== 1) throw Error(`Missing or ambiguous ${filename}.`);
  return boundedFile(path.join(directory, matches[0]));
}
export function contentManifest(xml: string): Manifest {
  const root = parsePackageXml(xml);
  if (root.name.split(':').at(-1) !== 'Game') throw Error('Expected a Microsoft Game manifest.');
  const identity = single(root, 'Identity').attributes;
  const id = single(root, 'StoreId').text.trim();
  if (!productId.test(id) || !identity.Name || !identity.Publisher || !/^\d+\.\d+\.\d+\.\d+$/.test(identity.Version ?? '')
    || identity.Version.split('.').some(value => Number(value) > 65535)) throw Error('Invalid package identity.');
  const ids = (section: string, tag: string) => {
    const sections = children(root, section);
    if (sections.length > 1) throw Error('Ambiguous product relationships.');
    const result = sections.flatMap(node => children(node, tag).map(row => row.text.trim()));
    if (result.length > 128 || result.some(id => !productId.test(id))) throw Error('Invalid related product list.');
    return [...new Set(result)];
  };
  const registration = children(root, 'DesktopRegistration');
  if (registration.length > 1) throw Error('Ambiguous desktop registration.');
  const dependencies = registration.flatMap(node => children(node, 'MainPackageDependency'));
  if (dependencies.length > 1) throw Error('Ambiguous main package dependency.');
  return { storeId: id, name: identity.Name, publisher: identity.Publisher, version: identity.Version,
    related: ids('RelatedProducts', 'RelatedProduct'), allowed: ids('AllowedProducts', 'AllowedProduct'), dependency: dependencies[0]?.attributes.Name };
}
async function baseManifest(game: Game): Promise<Manifest> {
  const base = contentManifest(await manifestFile(game.path, 'MicrosoftGame.config'));
  if (base.storeId !== game.storeId) throw Error('The installed game Store ID changed. Reimport the game.');
  return base;
}
function packages(product: RecordValue): RecordValue[] {
  return (Array.isArray(product.DisplaySkuAvailabilities) ? product.DisplaySkuAvailabilities : [])
    .filter((row: RecordValue) => row?.Sku?.Properties?.IsTrial === false)
    .flatMap((row: RecordValue) => Array.isArray(row.Sku.Properties.Packages) ? row.Sku.Properties.Packages : [])
    .filter((pkg: RecordValue) => pkg && pkg.PackageFormat === 'MSIXVC' && Array.isArray(pkg.Architectures) && pkg.Architectures.includes('x64')
      && Array.isArray(pkg.PlatformDependencies) && pkg.PlatformDependencies.some((dep: RecordValue) => dep?.PlatformName === 'Windows.Desktop'));
}
export function contentOffers(base: Manifest, catalog: unknown, access: Access): { items: GameContentItem[]; packages: ContentPackage[] } {
  const products = (catalog as RecordValue)?.Products;
  if (!Array.isArray(products) || products.length > 256) throw Error('Invalid content catalog.');
  const byId = new Map<string, RecordValue>();
  for (const product of products) {
    if (!product || typeof product.ProductId !== 'string' || !productId.test(product.ProductId) || byId.has(product.ProductId)) throw Error('Ambiguous content catalog.');
    byId.set(product.ProductId, product);
  }
  const baseProduct = byId.get(base.storeId);
  const families = new Set(baseProduct ? packages(baseProduct).map(pkg => pkg.PackageFamilyName).filter(name => typeof name === 'string' && name.startsWith(base.name + '_')) : []);
  const selected: ContentPackage[] = [];
  const items = base.related.filter(id => id !== base.storeId).map((id): GameContentItem => {
    const product = byId.get(id);
    const title = product?.LocalizedProperties?.find((row: RecordValue) => typeof row?.ProductTitle === 'string')?.ProductTitle?.slice(0, 300) || id;
    const licensed = access[id];
    if (!licensed) return { productId: id, title, status: 'unlicensed', note: 'No active account license was verified.' };
    const candidates = product?.ProductType === 'Durable' ? packages(product).filter(pkg => families.has(pkg.MainPackageFamilyNameForDlc)
      && contentId.test(pkg.ContentId) && typeof pkg.PackageFamilyName === 'string' && /^[A-Za-z0-9._-]+$/.test(pkg.PackageFamilyName)) : [];
    const unique = new Map(candidates.map(pkg => [pkg.ContentId.toLowerCase(), pkg]));
    if (unique.size !== 1 || new Set(candidates.map(pkg => pkg.PackageFamilyName)).size !== 1) return { productId: id, title, access: licensed, status: 'unsupported', note: 'No unambiguous related PC MSIXVC content package was verified.' };
    const pkg = [...unique.values()][0];
    const downloadBytes = Number.isSafeInteger(pkg.MaxDownloadSizeInBytes) && pkg.MaxDownloadSizeInBytes > 0 ? pkg.MaxDownloadSizeInBytes : undefined;
    selected.push({ productId: id, contentId: pkg.ContentId.toLowerCase(), family: pkg.PackageFamilyName, downloadBytes });
    return { productId: id, title, access: licensed, status: 'available', downloadBytes, note: 'Install-time licensing is checked again by xboks Engine.' };
  });
  return { items, packages: selected };
}

export class GameContent {
  constructor(private dataRoot: string, private fetcher: typeof fetch = fetch) {}
  private directory(game: Game, id: string): string {
    if (!productId.test(id)) throw Error('Invalid content product ID.');
    const key = createHash('sha256').update(game.id + '\0' + path.resolve(game.path)).digest('hex').slice(0, 32);
    return path.join(this.dataRoot, 'content', key, id);
  }
  private async safeDirectory(game: Game, id: string, create = false): Promise<string> {
    const target = this.directory(game, id);
    // Managed content never writes into the base game. Reject symlink redirection
    // at every managed component, including persisted queue destinations.
    const relative = path.relative(this.dataRoot, target).split(path.sep);
    let current = await fs.realpath(this.dataRoot);
    for (const name of relative) {
      current = path.join(current, name);
      if (create) await fs.mkdir(current, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Managed content path is not a real directory.');
    }
    if (/[;\r\n]/.test(current)) throw Error('Content paths cannot contain semicolons or line breaks.');
    return current;
  }
  private async validate(game: Game, id: string, directory: string, family?: string): Promise<Manifest> {
    const base = await baseManifest(game);
    if (!base.related.includes(id)) throw Error('Content is not declared by this game.');
    const content = contentManifest(await manifestFile(directory, 'MicrosoftGame.config'));
    const appx = parsePackageXml(await manifestFile(directory, 'appxmanifest.xml'));
    const identity = single(appx, 'Identity').attributes;
    const dependency = single(single(appx, 'Dependencies'), 'MainPackageDependency').attributes;
    if (appx.name.split(':').at(-1) !== 'Package' || content.storeId !== id || content.publisher !== base.publisher || content.dependency !== base.name || !content.allowed.includes(base.storeId)
      || identity.Name !== content.name || identity.Publisher !== content.publisher || identity.Version !== content.version
      || dependency.Name !== base.name || (family && !family.startsWith(content.name + '_'))) throw Error('Downloaded content does not match the game/package identity.');
    const layouts = (await fs.readdir(directory)).filter(name => /^layout_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.xml$/i.test(name));
    if (layouts.length !== 1) throw Error('Missing or ambiguous content layout.');
    const layout = parsePackageXml(await boundedFile(path.join(directory, layouts[0])));
    if (layout.name !== 'Package') throw Error('Unsupported content layout.');
    const groups: XmlNode[] = [];
    function visit(node: XmlNode, depth: number) {
      if (depth > 16 || groups.length > 256) throw Error('Content layout limit exceeded.');
      if (node.name === 'FileGroup') groups.push(node);
      node.children.forEach(child => visit(child, depth + 1));
    }
    visit(layout, 0);
    if (!groups.length || groups.length > 256) throw Error('Content layout contains no supported file groups.');
    for (const group of groups) {
      const source = group.attributes.SourcePath, include = group.attributes.Include;
      const valid = (value: string | undefined) => value && !/^[/\\]/.test(value) && !/[:\x00-\x1f]/.test(value) && !value.split(/[/\\]/).includes('..');
      if (!valid(source) || !valid(include) || /[*?]/.test(source)) throw Error('Unsupported content layout path.');
      const parts = [...source.split(/[/\\]/), ...include.split(/[/\\]/)].filter(part => part && part !== '.');
      const pattern = parts.pop();
      if (!pattern || parts.some(part => /[*?]/.test(part))) throw Error('Unsupported content layout wildcard.');
      let folder = directory;
      for (const part of parts) {
        const matches = (await fs.readdir(folder)).filter(name => name.toLowerCase() === part.toLowerCase());
        if (matches.length !== 1) throw Error('Missing or ambiguous content payload directory.');
        folder = path.join(folder, matches[0]);
        if (!(await fs.lstat(folder)).isDirectory()) throw Error('Invalid content payload directory.');
      }
      const match = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.') + '$', 'i');
      const names = await fs.readdir(folder);
      if (names.length > 4096) throw Error('Content payload directory limit exceeded.');
      let found = false;
      for (const name of names.filter(name => match.test(name))) if ((await fs.lstat(path.join(folder, name))).isFile()) { found = true; break; }
      if (!found) throw Error('A file group declared by the content layout is missing.');
    }
    return content;
  }
  async plan(game: Game, readAccess: () => Promise<{ checkedAt: string; accessByProductId: Access }>, market = 'US'): Promise<{ plan: GameContentPlan; packages: ContentPackage[] }> {
    const base = await baseManifest(game);
    if (!base.related.length) return { plan: { gameId: game.id, checkedAt: new Date().toISOString(), items: [] }, packages: [] };
    const access = await readAccess();
    const catalog: RecordValue = { Products: [] };
    const ids = [...new Set([base.storeId, ...base.related])];
    for (let offset = 0; offset < ids.length; offset += 20) {
      const url = new URL('https://displaycatalog.mp.microsoft.com/v7.0/products');
      url.search = new URLSearchParams({ bigIds: ids.slice(offset, offset + 20).join(','), market: /^[A-Z]{2}$/.test(market.toUpperCase()) ? market.toUpperCase() : 'US', languages: 'en-us,neutral' }).toString();
      const response = await this.fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw Error('Microsoft content metadata could not be loaded.');
      if (!response.body) throw Error('Content metadata response is empty.');
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 8_000_000) throw Error('Content metadata response is too large.');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      const data = JSON.parse(text);
      if (!Array.isArray(data.Products) || data.Products.length > 20 || data.Products.some((p: RecordValue) => !ids.slice(offset, offset + 20).includes(p?.ProductId))) throw Error('Unexpected content metadata.');
      catalog.Products.push(...data.Products);
    }
    const offers = contentOffers(base, catalog, access.accessByProductId);
    const installed = new Set(await this.installedIds(game));
    for (const item of offers.items) if (installed.has(item.productId)) {
      item.status = 'installed'; item.note = item.access ? 'Installed. The runtime verifies the license when requested.' : 'Installed files retained, but no active account license was verified.';
    }
    return { plan: { gameId: game.id, checkedAt: access.checkedAt, items: offers.items }, packages: offers.packages };
  }
  async prepare(game: Game, pkg: ContentPackage): Promise<string> {
    const base = await baseManifest(game);
    if (!base.related.includes(pkg.productId) || !contentId.test(pkg.contentId)) throw Error('Invalid content installation.');
    const directory = await this.safeDirectory(game, pkg.productId, true);
    for (const name of [markerName, legacyMarkerName]) {
      await fs.unlink(path.join(directory, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    return directory;
  }
  async complete(game: Game, pkg: ContentPackage): Promise<void> {
    const directory = await this.safeDirectory(game, pkg.productId);
    const content = await this.validate(game, pkg.productId, directory, pkg.family);
    const temporary = path.join(directory, markerName + '.' + randomUUID() + '.tmp');
    await fs.writeFile(temporary, JSON.stringify({ schema: 1, productId: pkg.productId, contentId: pkg.contentId, parent: game.storeId, name: content.name, version: content.version }), { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, path.join(directory, markerName));
  }
  private async installedIds(game: Game): Promise<string[]> {
    const base = await baseManifest(game), installed: string[] = [];
    for (const id of base.related) {
      try {
        const directory = await this.safeDirectory(game, id);
        const markerText = await boundedFile(path.join(directory, markerName)).catch(error => {
          // Only an absent new marker permits a legacy read. Invalid or unsafe
          // new metadata must never promote an older installation to complete.
          if (error.code !== 'ENOENT') throw error;
          return boundedFile(path.join(directory, legacyMarkerName));
        });
        const marker = JSON.parse(markerText);
        if (marker.schema !== 1 || marker.parent !== base.storeId || marker.productId !== id || !contentId.test(marker.contentId)) continue;
        const content = await this.validate(game, id, directory);
        if (marker.name === content.name && marker.version === content.version) installed.push(id);
      } catch { /* Missing/incomplete content is never promoted to installed. */ }
    }
    return installed;
  }
  async roots(game: Game): Promise<string[]> {
    const roots: string[] = [];
    for (const id of await this.installedIds(game)) roots.push(await this.safeDirectory(game, id));
    // Runtime discovery is bounded and uses MAX_PATH. Fail explicitly, not by
    // silently omitting installed content or splitting a path into extra roots.
    if (roots.some(root => root.length + 2 >= 260) || roots.join(';').length > 16000) throw Error('Managed content paths exceed runtime discovery limits.');
    return roots;
  }
}
