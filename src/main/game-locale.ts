import { parsePackageXml } from './package-xml.js';
import { manifestAttribute, manifestElements, manifestText } from './manifest-xml.js';

export function manifestLocales(xml: string): string[] {
  const found = new Map<string, string>();
  for (const tag of manifestElements(xml ? parsePackageXml(xml) : undefined, 'Resource')) {
    const locale = manifestAttribute(tag, 'Language');
    if (locale && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)) found.set(locale.toLowerCase(), locale);
  }
  return [...found.values()];
}

export function manifestTitleId(xml: string): string | undefined {
  const value = manifestText(xml ? parsePackageXml(xml) : undefined, 'TitleId');
  return value && /^[0-9A-Fa-f]+$/.test(value) ? value : undefined;
}

export function supportedGameLocale(requested: string, locales: string[]): string | undefined {
  if (!requested.trim()) return undefined;
  const requestedLower = requested.trim().toLowerCase();
  
  // 1. Try exact match (cs-CZ == cs-CZ)
  const matched = locales.find((locale) => locale.toLowerCase() === requestedLower);
  if (matched) return matched;
  
  // 2. Try base language match (cs-CZ -> cs, if manifest only has "cs")
  const requestedBase = requestedLower.split('-')[0];
  const matchedBase = locales.find((locale) => {
    const localeBase = locale.toLowerCase().split('-')[0];
    return localeBase === requestedBase;
  });
  if (matchedBase) return matchedBase;
  
  // 3. No match found
  throw new Error(`The game manifest does not declare ${requested}. Available languages: ${locales.join(', ') || 'none'}.`);
}

export function gameLocaleEnvironment(source: NodeJS.ProcessEnv, locale?: string): NodeJS.ProcessEnv {
  if (!locale) return { ...source };
  const environment: NodeJS.ProcessEnv = { ...source, XODUS_PACKAGE_LOCALE: locale, WINEUSERLOCALE: locale };
  const match = locale.match(/^([A-Za-z]{2,3})-([A-Za-z]{2})$/);
  if (match) {
    const unix = `${match[1].toLowerCase()}_${match[2].toUpperCase()}.UTF-8`;
    environment.LANG = unix;
    environment.LC_ALL = unix;
    environment.LC_MESSAGES = unix;
    environment.LC_CTYPE = unix;
    environment.LC_TIME = unix;
    environment.LC_COLLATE = unix;
    environment.LC_MONETARY = unix;
    environment.LC_NUMERIC = unix;
    environment.LC_PAPER = unix;
    environment.LANGUAGE = `${match[1].toLowerCase()}_${match[2].toUpperCase()}:${match[1].toLowerCase()}`;
  }
  return environment;
}
