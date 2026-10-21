import { useEffect, useState } from 'react';

export type InterfaceLanguage = 'en' | 'el';
export type InterfaceLanguagePreference = 'system' | InterfaceLanguage;
const key = 'xboks.interface-language.v1';
const eventName = 'xboks-interface-language';

export function readInterfaceLanguage(): InterfaceLanguagePreference {
  try {
    const value = localStorage.getItem(key);
    return value === 'el' || value === 'en' ? value : 'system';
  } catch { return 'system'; }
}

export function resolveInterfaceLanguage(preference: InterfaceLanguagePreference, systemLanguage?: string): InterfaceLanguage {
  return preference === 'system' ? (systemLanguage?.toLowerCase().startsWith('el') ? 'el' : 'en') : preference;
}

/** Interface language is independent of the market and installed game locale. */
export function useReferenceLocale() {
  const [preference, updatePreference] = useState(readInterfaceLanguage);
  const [systemLanguage, setSystemLanguage] = useState(() => typeof navigator === 'undefined' ? 'en' : navigator.language);
  useEffect(() => {
    const refresh = (event: Event) => {
      const value = (event as CustomEvent<InterfaceLanguagePreference>).detail;
      updatePreference(value === 'system' || value === 'en' || value === 'el' ? value : readInterfaceLanguage());
    };
    const systemChanged = () => setSystemLanguage(navigator.language);
    window.addEventListener(eventName, refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('languagechange', systemChanged);
    return () => {
      window.removeEventListener(eventName, refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('languagechange', systemChanged);
    };
  }, []);
  const language = resolveInterfaceLanguage(preference, systemLanguage);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  return { language, preference, text: (en: string, el: string) => language === 'el' ? el : en,
    setPreference(value: InterfaceLanguagePreference) {
      updatePreference(value);
      try { localStorage.setItem(key, value); } catch { /* Session selection still applies. */ }
      window.dispatchEvent(new CustomEvent(eventName, { detail: value }));
    } };
}
