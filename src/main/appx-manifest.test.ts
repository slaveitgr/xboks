import {expect, it} from 'vitest';
import {parseAppxManifest} from './appx-manifest.js';

const FOUNDATION = 'http://schemas.microsoft.com/appx/manifest/foundation/windows10';
const UAP10 = 'http://schemas.microsoft.com/appx/manifest/uap/windows10/10';
const identity = '<Identity Name="Sample.Package" Publisher="CN=Sample Publisher" Version="1.2.3.4" ProcessorArchitecture="x64"/>';
function manifest(apps = '<Application Id="App" Executable="Game.exe"/>', extra = '', header = ''): string {
  return `<Package xmlns="${FOUNDATION}" xmlns:uap10="${UAP10}" ${header}>${identity}<Applications>${apps}</Applications>${extra}</Package>`;
}
const app = (attrs: string) => `<Application Id="App" Executable="Game.exe" ${attrs}/>`;
const readApp = (attrs: string) => parseAppxManifest(manifest(app(attrs))).applications[0];

it('reports a class-based UWP app and its actual framework requirements without claiming execution support', () => {
  const report = parseAppxManifest(manifest('<Application Id="App" Executable="Real Drive Simulator.exe" EntryPoint="Sample.Game.App"/>', `<Dependencies>
    <TargetDeviceFamily Name="Windows.Universal" MinVersion="10.0.17763.0" MaxVersionTested="10.0.22621.0"/>
    <PackageDependency Name="Microsoft.UI.Xaml.2.8" MinVersion="8.2208.12001.0" Publisher="CN=Microsoft Corporation"/>
    <PackageDependency Name="Microsoft.NET.Native.Framework.2.2" MinVersion="2.2.29512.0" Publisher="CN=Microsoft Corporation" ProcessorArchitecture="x64"/>
    <PackageDependency Name="Microsoft.NET.Native.Runtime.2.2" MinVersion="2.2.28604.0"/>
  </Dependencies>`));
  expect(report.identity).toEqual({name: 'Sample.Package', publisher: 'CN=Sample Publisher', version: '1.2.3.4', architecture: 'x64'});
  expect(report.applications).toEqual([{id: 'App', executable: 'Real Drive Simulator.exe', entryPoint: 'Sample.Game.App', runtimeBehavior: 'windowsApp', trustLevel: 'appContainer', activation: 'appcontainer-uwp', requiresRuntimeValidation: true}]);
  expect(report.frameworkDependencies).toEqual([
    {name: 'Microsoft.UI.Xaml.2.8', minVersion: '8.2208.12001.0', publisher: 'CN=Microsoft Corporation'},
    {name: 'Microsoft.NET.Native.Framework.2.2', minVersion: '2.2.29512.0', publisher: 'CN=Microsoft Corporation', processorArchitecture: 'x64'},
    {name: 'Microsoft.NET.Native.Runtime.2.2', minVersion: '2.2.28604.0'},
  ]);
  expect(report.targetDeviceFamilies).toEqual([{name: 'Windows.Universal', minVersion: '10.0.17763.0', maxVersionTested: '10.0.22621.0'}]);
  expect(report).toMatchObject({schema: 1, framework: false, resourcePackage: false, runtimeValidation: 'required', signatureValidation: 'not-performed'});
  expect(report).not.toHaveProperty('canInstall'); expect(report).not.toHaveProperty('runnable');
});
it.each([
  ['EntryPoint="Windows.FullTrustApplication"', 'packagedClassicApp', 'mediumIL', 'full-trust-win32'],
  ['EntryPoint="windows.fullTrustApplication"', 'packagedClassicApp', 'mediumIL', 'full-trust-win32'],
  ['EntryPoint="windows.partialTrustApplication"', 'packagedClassicApp', 'appContainer', 'appcontainer-win32'],
  ['uap10:RuntimeBehavior="packagedClassicApp" uap10:TrustLevel="mediumIL"', 'packagedClassicApp', 'mediumIL', 'full-trust-win32'],
  ['uap10:RuntimeBehavior="packagedClassicApp"', 'packagedClassicApp', 'appContainer', 'appcontainer-win32'],
  ['uap10:RuntimeBehavior="win32App" uap10:TrustLevel="mediumIL"', 'win32App', 'mediumIL', 'full-trust-win32'],
  ['EntryPoint="Example.App" uap10:RuntimeBehavior="windowsApp" uap10:TrustLevel="appContainer"', 'windowsApp', 'appContainer', 'appcontainer-uwp'],
])('classifies the declared activation combination %s without promoting it to runnable', (attrs, runtimeBehavior, trustLevel, activation) => {
  expect(readApp(attrs)).toMatchObject({runtimeBehavior, trustLevel, activation, requiresRuntimeValidation: true});
});

it('distinguishes a packaged Win32 AppContainer from a UWP application', () => {
  const classic = readApp('uap10:RuntimeBehavior="packagedClassicApp" uap10:TrustLevel="appContainer"');
  const uwp = readApp('EntryPoint="Example.App" uap10:RuntimeBehavior="windowsApp" uap10:TrustLevel="appContainer"');
  expect(classic.activation).toBe('appcontainer-win32');
  expect(classic.activation).not.toBe(uwp.activation);
  expect(uwp.activation).toBe('appcontainer-uwp');
  expect(classic.requiresRuntimeValidation).toBe(true);
});
it('keeps Executable alone and incomplete trust declarations unknown', () => {
  expect(readApp('')).toEqual({id: 'App', executable: 'Game.exe', activation: 'unknown', requiresRuntimeValidation: true});
  expect(readApp('uap10:TrustLevel="mediumIL"')).toMatchObject({activation: 'unknown', trustLevel: 'mediumIL'});
});
it('resolves arbitrary namespace aliases and inherited scopes, preserving only direct Application declarations', () => {
  const xml = `<f:Package xmlns:f="${FOUNDATION}" xmlns:activation="${UAP10}">
    <f:Identity Name="Sample.Package" Publisher="CN=Sample &amp; Company" Version="1.0.0.0" ProcessorArchitecture="x64"/>
    <f:Applications><f:Application Id="Desktop" Executable="bin\\Game.exe" activation:RuntimeBehavior="packagedClassicApp" activation:TrustLevel="mediumIL"/></f:Applications>
    <f:Extensions><f:Application Id="Nested" Executable="Wrong.exe" EntryPoint="Windows.FullTrustApplication"/></f:Extensions>
  </f:Package>`;
  expect(parseAppxManifest(xml).applications).toEqual([{id: 'Desktop', executable: 'bin/Game.exe', runtimeBehavior: 'packagedClassicApp', trustLevel: 'mediumIL', activation: 'full-trust-win32', requiresRuntimeValidation: true}]);
  expect(parseAppxManifest(xml).identity.publisher).toBe('CN=Sample & Company');
});
it('does not treat familiar prefixes or foreign activation attributes as authority', () => {
  const xml = manifest(app('uap10:RuntimeBehavior="win32App" uap10:TrustLevel="mediumIL"')).replace(`xmlns:uap10="${UAP10}"`, 'xmlns:uap10="urn:foreign"');
  expect(parseAppxManifest(xml).applications[0]).toEqual({id: 'App', executable: 'Game.exe', activation: 'unknown', requiresRuntimeValidation: true});
  const redeclared = manifest(`<Application xmlns:uap10="urn:foreign" Id="App" Executable="Game.exe" uap10:RuntimeBehavior="win32App" uap10:TrustLevel="mediumIL"/>`);
  expect(parseAppxManifest(redeclared).applications[0].activation).toBe('unknown');
});
it.each([
  'EntryPoint="Windows.FullTrustApplication" uap10:RuntimeBehavior="windowsApp"',
  'EntryPoint="Windows.FullTrustApplication" uap10:TrustLevel="appContainer"',
  'EntryPoint="windows.partialTrustApplication" uap10:TrustLevel="mediumIL"',
  'EntryPoint="windows.partialTrustApplication" uap10:RuntimeBehavior="win32App"',
  'EntryPoint="Example.App" uap10:RuntimeBehavior="packagedClassicApp"',
  'EntryPoint="Example.App" uap10:TrustLevel="mediumIL"',
  'uap10:RuntimeBehavior="windowsApp"',
  'uap10:RuntimeBehavior="win32App"',
  'uap10:RuntimeBehavior="win32App" uap10:TrustLevel="appContainer"',
  'uap10:RuntimeBehavior="madeUp"',
  'uap10:TrustLevel="system"',
  'StartPage="index.html" EntryPoint="Example.App"',
])('rejects contradictory or invalid activation flags %s', attrs => {expect(() => readApp(attrs)).toThrow('APPX/MSIX manifest');});
it('recognizes the exact custom-core-activation exception but keeps that unusual UWP activation unknown', () => {
  const xml = manifest(app('EntryPoint="Example.App" uap10:TrustLevel="mediumIL"'), '<Capabilities><special:CustomCapability Name="Microsoft.coreAppActivation_8wekyb3d8bbwe"/></Capabilities>', 'xmlns:special="http://schemas.microsoft.com/appx/manifest/uap/windows10/4"');
  expect(parseAppxManifest(xml).applications[0]).toMatchObject({runtimeBehavior: 'windowsApp', trustLevel: 'mediumIL', activation: 'unknown'});
  expect(() => parseAppxManifest(xml.replace('http://schemas.microsoft.com/appx/manifest/uap/windows10/4', 'urn:foreign'))).toThrow();
});
it('handles resource/framework packages and absent optional dependency metadata without inventing architecture', () => {
  const report = parseAppxManifest(`<Package xmlns="${FOUNDATION}"><Identity Name="Sample.Resources" Publisher="CN=Example" Version="1.0.0.0" ResourceId="scale-200"/>
    <Properties><Framework>false</Framework><ResourcePackage>true</ResourcePackage></Properties><Dependencies><PackageDependency Name="Sample.Framework"/></Dependencies></Package>`);
  expect(report.identity).toEqual({name: 'Sample.Resources', publisher: 'CN=Example', version: '1.0.0.0', resourceId: 'scale-200'});
  expect(report.applications).toEqual([]); expect(report.framework).toBe(false); expect(report.resourcePackage).toBe(true);
  expect(report.frameworkDependencies).toEqual([{name: 'Sample.Framework'}]);
  expect(parseAppxManifest(manifest('', '<Properties><Framework>1</Framework><ResourcePackage>0</ResourcePackage></Properties>')).framework).toBe(true);
});
it.each(['x86', 'x64', 'arm', 'arm64', 'x86a64', 'neutral'])('retains declared architecture %s without claiming runtime compatibility', architecture => {
  const report = parseAppxManifest(manifest().replace('ProcessorArchitecture="x64"', `ProcessorArchitecture="${architecture}"`));
  expect(report.identity.architecture).toBe(architecture); expect(report.runtimeValidation).toBe('required');
});
it('can inspect the official legacy Windows8 foundation without mistaking it for a Win32 executable', () => {
  const xml = manifest(app('EntryPoint="Sample.App"')).replace(FOUNDATION, 'http://schemas.microsoft.com/appx/2010/manifest');
  expect(parseAppxManifest(xml).applications[0].activation).toBe('appcontainer-uwp');
});
it.each(['../Game.exe', 'bin\\..\\Game.exe', './Game.exe', 'C:\\Game.exe', '/Game.exe', '\\\\server\\share\\Game.exe', 'Game.exe:stream', 'bin//Game.exe', 'Game.exe ', 'bin.\\Game.exe', ' Game.exe', 'Game.dll', 'Bad?.exe'])('rejects unsafe or non-executable package-relative path %s', value => {
  expect(() => parseAppxManifest(manifest(`<Application Id="App" Executable="${value}"/>`))).toThrow();
});
it.each([
  manifest().replace(identity, identity + identity),
  manifest(app('') + '<Application Id="app" Executable="Other.exe"/>'),
  manifest(app('')).replace('Id="App"', 'Id="../App"'),
  manifest().replace(FOUNDATION, 'urn:foreign'),
  manifest().replace('<Application ', '<foreign:Application xmlns:foreign="urn:foreign" '),
  manifest().replace('<Applications>', '<Applications xmlns="">'),
  manifest().replace('<Identity ', '<foreign:Identity xmlns:foreign="urn:foreign" '),
  manifest(app('uap10:RuntimeBehavior="packagedClassicApp" alias:RuntimeBehavior="packagedClassicApp"'), '', `xmlns:alias="${UAP10}"`),
  manifest(app('unknown:RuntimeBehavior="win32App"')),
  manifest().replace('Version="1.2.3.4"', 'Version="65536.0.0.0"'),
  manifest().replace('Version="1.2.3.4"', 'Version="1.2.3"'),
  manifest().replace('ProcessorArchitecture="x64"', 'ProcessorArchitecture="riscv64"'),
  manifest('', '<Dependencies><PackageDependency Name="Example.Framework"/><PackageDependency Name="Example.Framework"/></Dependencies>'),
  manifest('', '<Dependencies><TargetDeviceFamily Name="Windows.Universal" MinVersion="10.0.0.0"/></Dependencies>'),
  manifest('', '<Properties><Framework>true</Framework><Framework>false</Framework></Properties>'),
])('rejects ambiguous or malformed package structure %#', xml => {expect(() => parseAppxManifest(xml)).toThrow();});
it.each([
  '<!DOCTYPE Package [<!ENTITY external SYSTEM "file:///etc/passwd">]>' + manifest(),
  manifest().replace('CN=Sample Publisher', '&external;'),
  '<!--' + manifest(),
  manifest().repeat(2),
  manifest().replace('<Applications>', '<Applications>' + '<Ignored>'.repeat(35)),
  ' '.repeat(1_048_577),
])('retains existing bounded XML rejection without filesystem or external-entity resolution %#', xml => {expect(() => parseAppxManifest(xml)).toThrow();});
