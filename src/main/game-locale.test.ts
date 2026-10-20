import { describe, expect, it } from 'vitest';
import { gameLocaleEnvironment, manifestLocales, manifestTitleId, supportedGameLocale } from './game-locale.js';

describe('game locale', () => {
  it('ignores commented locale and title examples, including arrows and terminal escapes', () => {
    const xml = `<Game><!-- example -> \x1b[31m <TitleId>0000</TitleId><Resource Language="fr-FR"/> -->
      <TitleId>6BE4<!-- annotation -->1AB5</TitleId><Resources><Resource Language='en'/>
      <!-- <Resource Language="de-DE"/> --><Resource Language="cs-CZ"/></Resources></Game>`;
    expect(manifestTitleId(xml)).toBe('6BE41AB5');
    expect(manifestLocales(xml)).toEqual(['en', 'cs-CZ']);
    expect(manifestTitleId('<Game><!-- <TitleId>0000</TitleId> --></Game>')).toBeUndefined();
    expect(manifestLocales('<Game><![CDATA[<Resource Language="fr-FR"/>]]></Game>')).toEqual([]);
  });

  const xml = '<Resources><Resource Language="en"/><Resource Language="cs-CZ"/><Resource Language="cs-CZ"/></Resources>';

  it('reads declared languages without duplicates', () => {
    expect(manifestLocales(xml)).toEqual(['en', 'cs-CZ']);
    expect(supportedGameLocale('cs-cz', manifestLocales(xml))).toBe('cs-CZ');
    expect(() => supportedGameLocale('fr-FR', manifestLocales(xml))).toThrow('does not declare');
  });

  it('reads the title id used for the per-title config directory', () => {
    expect(manifestTitleId('<Game><Identity Name="Microsoft.Fairlightbasegame" /><TitleId>6BE41AB5</TitleId></Game>')).toBe('6BE41AB5');
    expect(manifestTitleId('<TitleId> 6BE41AB5 </TitleId>')).toBe('6BE41AB5');
    expect(manifestTitleId('<Game></Game>')).toBeUndefined();
  });

  it('matches base language when full locale is not available', () => {
    const locales = ['en', 'cs', 'de'];
    expect(supportedGameLocale('cs-CZ', locales)).toBe('cs');
    expect(supportedGameLocale('de-DE', locales)).toBe('de');
    expect(() => supportedGameLocale('fr-FR', locales)).toThrow('does not declare');
  });

  it('sets Windows and Unix locale only for the selected game', () => {
    const original = { LANG: 'en_US.UTF-8', LC_ALL: 'C.UTF-8' };
    const result = gameLocaleEnvironment(original, 'cs-CZ');
    expect(result).toMatchObject({
      XODUS_PACKAGE_LOCALE: 'cs-CZ',
      WINEUSERLOCALE: 'cs-CZ',
      LANG: 'cs_CZ.UTF-8',
      LC_ALL: 'cs_CZ.UTF-8',
      LC_MESSAGES: 'cs_CZ.UTF-8',
      LC_CTYPE: 'cs_CZ.UTF-8',
      LC_TIME: 'cs_CZ.UTF-8',
      LC_COLLATE: 'cs_CZ.UTF-8',
      LC_MONETARY: 'cs_CZ.UTF-8',
      LC_NUMERIC: 'cs_CZ.UTF-8',
      LC_PAPER: 'cs_CZ.UTF-8',
      LANGUAGE: 'cs_CZ:cs',
    });
    expect(original).toEqual({ LANG: 'en_US.UTF-8', LC_ALL: 'C.UTF-8' });
  });
});
