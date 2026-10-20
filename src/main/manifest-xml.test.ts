import { describe, expect, it } from 'vitest';
import { parsePackageXml } from './package-xml.js';
import { manifestAttr, manifestText } from './manifest-xml.js';

describe('parsed manifest lookup', () => {
  it('matches active names with case variations, namespaces, entities and either quote', () => {
    const root = parsePackageXml(`<Game xmlns:g="urn:test"><g:shellvisuals
      defaultdisplayname='No Man&apos;s &quot;Sky&quot; > Space'/><g:STOREID>9AAAAAAAAAAA</g:STOREID></Game>`);
    expect(manifestAttr(root, 'ShellVisuals', 'DefaultDisplayName')).toBe('No Man\'s "Sky" > Space');
    expect(manifestText(root, 'StoreId')).toBe('9AAAAAAAAAAA');
  });

  it('ignores declaration examples in comments and markup in CDATA', () => {
    const root = parsePackageXml(`<Game><!-- <!DOCTYPE Example> <!ENTITY example "ignored"> -->
      <Description><![CDATA[<StoreId>000000000000</StoreId>]]></Description></Game>`);
    expect(manifestText(root, 'StoreId')).toBeUndefined();
  });

  it('accepts XML whitespace before the closing tag delimiter', () => {
    const root = parsePackageXml('<Game>\n<StoreId>9AAAAAAAAAAA</StoreId \t>\n</Game \n>');
    expect(manifestText(root, 'StoreId')).toBe('9AAAAAAAAAAA');
  });

  it.each([
    '<!DOCTYPE Game [<!ENTITY x SYSTEM "file:///secret">]><Game>&x;</Game>',
    '<!DOCTYPE Game SYSTEM "https://example.invalid/no.xml"><Game/>',
    '<Game><!-- unfinished <StoreId>000000000000</StoreId></Game>',
    '<Game><!-- invalid -- comment --></Game>',
    '<Game><Identity Name="unfinished/></Game>',
  ])('rejects unsafe or malformed XML without regex fallback: %s', xml => {
    expect(() => parsePackageXml(xml)).toThrow();
  });
});
