import {parsePackageXml, type XmlNode} from './package-xml.js';

const FOUNDATION = 'http://schemas.microsoft.com/appx/manifest/foundation/windows10';
const LEGACY_FOUNDATION = 'http://schemas.microsoft.com/appx/2010/manifest';
const UAP10 = 'http://schemas.microsoft.com/appx/manifest/uap/windows10/10';
const UAP4 = 'http://schemas.microsoft.com/appx/manifest/uap/windows10/4';
const XML = 'http://www.w3.org/XML/1998/namespace', XMLNS = 'http://www.w3.org/2000/xmlns/';
const ARCHITECTURES = ['x86', 'x64', 'arm', 'arm64', 'x86a64', 'neutral'] as const;
export type AppxArchitecture = typeof ARCHITECTURES[number];
export type AppxRuntimeBehavior = 'windowsApp' | 'packagedClassicApp' | 'win32App';
export type AppxTrustLevel = 'appContainer' | 'mediumIL';
export interface AppxApplicationReport {
  id: string;
  /** A checked package-relative path, with forward-slash separators. */
  executable?: string;
  entryPoint?: string;
  startPage?: string;
  runtimeBehavior?: AppxRuntimeBehavior;
  trustLevel?: AppxTrustLevel;
  activation: 'full-trust-win32' | 'appcontainer-win32' | 'appcontainer-uwp' | 'unknown';
  requiresRuntimeValidation: true;
}
export interface AppxManifestReport {
  schema: 1;
  manifestNamespace: string;
  identity: {name: string; publisher: string; version: string; architecture?: AppxArchitecture; resourceId?: string};
  framework: boolean;
  resourcePackage: boolean;
  applications: AppxApplicationReport[];
  frameworkDependencies: {name: string; minVersion?: string; publisher?: string; processorArchitecture?: AppxArchitecture}[];
  targetDeviceFamilies: {name: string; minVersion: string; maxVersionTested: string}[];
  runtimeValidation: 'required';
  signatureValidation: 'not-performed';
}
interface Node {local: string; uri: string; attributes: Map<string, string>; children: Node[]; text: string}
const invalid = (): never => {throw Error('Invalid or unsupported APPX/MSIX manifest.');};
const key = (uri: string, name: string) => `${uri}\0${name}`;
function qname(value: string): [string, string] {
  if (!/^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/.test(value)) return invalid();
  const parts = value.split(':'); return parts.length === 1 ? ['', parts[0]] : [parts[0], parts[1]];
}
function namespaces(node: XmlNode, inherited = new Map([['xml', XML]])): Node {
  const scope = new Map(inherited);
  for (const [name, value] of Object.entries(node.attributes)) {
    if (name !== 'xmlns' && !name.startsWith('xmlns:')) continue;
    const prefix = name === 'xmlns' ? '' : name.slice(6);
    if (prefix && !/^[A-Za-z_][\w.-]*$/.test(prefix) || prefix === 'xmlns' || value === XMLNS ||
        prefix === 'xml' && value !== XML || prefix !== 'xml' && value === XML || prefix && !value || value.length > 2048) return invalid();
    scope.set(prefix, value);
  }
  const [prefix, local] = qname(node.name);
  const uri = scope.get(prefix) ?? (prefix ? invalid() : '');
  const attributes = new Map<string, string>();
  for (const [name, value] of Object.entries(node.attributes)) {
    if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
    const [prefix, local] = qname(name), uri = prefix ? scope.get(prefix) ?? invalid() : '';
    const expanded = key(uri, local); if (attributes.has(expanded)) return invalid();
    attributes.set(expanded, value);
  }
  return {local, uri, attributes, text: node.text, children: node.children.map(child => namespaces(child, scope))};
}
function elements(parent: Node, local: string, uri: string): Node[] {
  const found = parent.children.filter(child => child.local === local);
  if (found.some(child => child.uri !== uri)) return invalid();
  return found;
}
function one(parent: Node, local: string, uri: string, required = false): Node | undefined {
  const found = elements(parent, local, uri); if (found.length > 1 || required && !found.length) return invalid();
  return found[0];
}
const attribute = (node: Node, name: string, uri = '') => node.attributes.get(key(uri, name));
function label(value: string | undefined, max = 256): string {
  if (!value || value !== value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) return invalid();
  return value;
}
function optional(value: string | undefined, max?: number): string | undefined {return value === undefined ? undefined : label(value, max);}
function version(value: string | undefined): string {
  if (!value || !/^\d{1,5}(?:\.\d{1,5}){3}$/.test(value) || value.split('.').some(part => Number(part) > 65535)) return invalid();
  return value;
}
function architecture(value: string | undefined): AppxArchitecture | undefined {
  if (value === undefined) return;
  if (!(ARCHITECTURES as readonly string[]).includes(value)) return invalid();
  return value as AppxArchitecture;
}
function packageName(value: string | undefined): string {
  const name = label(value, 50); if (!/^[A-Za-z0-9.-]{3,50}$/.test(name)) return invalid(); return name;
}
function bool(node: Node | undefined): boolean {
  if (!node) return false;
  if (node.children.length) return invalid();
  if (['true', '1'].includes(node.text.trim())) return true;
  if (['false', '0'].includes(node.text.trim())) return false;
  return invalid();
}
function executable(value: string | undefined): string | undefined {
  if (value === undefined) return;
  const name = label(value);
  if (!/\.exe$/i.test(name) || /[<>:"|?*]/.test(name) || /^[\\/]/.test(name)) return invalid();
  const parts = name.split(/[\\/]/);
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) return invalid();
  return parts.join('/');
}
function application(node: Node, coreActivation: boolean): AppxApplicationReport {
  const id = label(attribute(node, 'Id'), 64); if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return invalid();
  const exe = executable(attribute(node, 'Executable')), entryPoint = optional(attribute(node, 'EntryPoint'));
  const startPage = optional(attribute(node, 'StartPage'));
  const runtime = attribute(node, 'RuntimeBehavior', UAP10), trust = attribute(node, 'TrustLevel', UAP10);
  if (runtime !== undefined && !['windowsApp', 'packagedClassicApp', 'win32App'].includes(runtime) ||
      trust !== undefined && !['appContainer', 'mediumIL'].includes(trust)) return invalid();
  const marker = entryPoint?.toLowerCase();
  const reserved = marker === 'windows.fulltrustapplication' || marker === 'windows.partialtrustapplication';
  const impliedRuntime = entryPoint ? reserved ? 'packagedClassicApp' : 'windowsApp' : undefined;
  const impliedTrust = marker === 'windows.fulltrustapplication' ? 'mediumIL' : entryPoint ? 'appContainer' : undefined;
  if (impliedRuntime && runtime && runtime !== impliedRuntime || reserved && trust && trust !== impliedTrust ||
      startPage && (entryPoint || exe || runtime || trust)) return invalid();
  const runtimeBehavior = (runtime ?? impliedRuntime) as AppxRuntimeBehavior | undefined;
  const trustLevel = (trust ?? impliedTrust ?? (runtimeBehavior ? 'appContainer' : undefined)) as AppxTrustLevel | undefined;
  if (runtimeBehavior === 'windowsApp' && !entryPoint || runtimeBehavior === 'win32App' && trustLevel !== 'mediumIL' ||
      runtimeBehavior && !exe || runtimeBehavior === 'windowsApp' && trustLevel === 'mediumIL' && !coreActivation) return invalid();
  const activation = runtimeBehavior === 'windowsApp' && trustLevel === 'mediumIL' ? 'unknown'
    : runtimeBehavior && trustLevel === 'mediumIL' ? 'full-trust-win32'
    : runtimeBehavior === 'packagedClassicApp' && trustLevel === 'appContainer' ? 'appcontainer-win32'
    : runtimeBehavior === 'windowsApp' && trustLevel === 'appContainer' || startPage ? 'appcontainer-uwp' : 'unknown';
  return {id, ...(exe ? {executable: exe} : {}), ...(entryPoint ? {entryPoint} : {}), ...(startPage ? {startPage} : {}),
    ...(runtimeBehavior ? {runtimeBehavior} : {}), ...(trustLevel ? {trustLevel} : {}), activation, requiresRuntimeValidation: true};
}

/** Metadata only: no filesystem, network, registration or launch operations.
 * Official activation combinations: https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-f-application
 * Classification never establishes signature trust, dependencies or Wine support. */
export function parseAppxManifest(xml: string): AppxManifestReport {
  const root = namespaces(parsePackageXml(xml));
  if (root.local !== 'Package' || ![FOUNDATION, LEGACY_FOUNDATION].includes(root.uri)) return invalid();
  const uri = root.uri, identity = one(root, 'Identity', uri, true)!;
  const name = packageName(attribute(identity, 'Name')), publisher = label(attribute(identity, 'Publisher'), 8192);
  const resourceId = attribute(identity, 'ResourceId');
  if (resourceId !== undefined && (resourceId.length > 30 || resourceId && !/^[A-Za-z0-9.-]+$/.test(resourceId))) return invalid();
  const properties = one(root, 'Properties', uri), dependencies = one(root, 'Dependencies', uri), appList = one(root, 'Applications', uri);
  const capabilities = one(root, 'Capabilities', uri);
  const coreActivation = capabilities?.children.some(child => child.uri === UAP4 && child.local === 'CustomCapability' &&
    attribute(child, 'Name') === 'Microsoft.coreAppActivation_8wekyb3d8bbwe') ?? false;
  const applications = appList ? elements(appList, 'Application', uri).map(node => application(node, coreActivation)) : [];
  if (new Set(applications.map(app => app.id.toLowerCase())).size !== applications.length) return invalid();
  const frameworkDependencies = dependencies ? elements(dependencies, 'PackageDependency', uri).map(node => ({
    name: packageName(attribute(node, 'Name')),
    ...(attribute(node, 'MinVersion') === undefined ? {} : {minVersion: version(attribute(node, 'MinVersion'))}),
    ...(attribute(node, 'Publisher') === undefined ? {} : {publisher: label(attribute(node, 'Publisher'), 8192)}),
    ...(attribute(node, 'ProcessorArchitecture') === undefined ? {} : {processorArchitecture: architecture(attribute(node, 'ProcessorArchitecture'))}),
  })) : [];
  if (new Set(frameworkDependencies.map(dep => dep.name.toLowerCase())).size !== frameworkDependencies.length) return invalid();
  const targetDeviceFamilies = dependencies ? elements(dependencies, 'TargetDeviceFamily', uri).map(node => ({
    name: label(attribute(node, 'Name')), minVersion: version(attribute(node, 'MinVersion')), maxVersionTested: version(attribute(node, 'MaxVersionTested')),
  })) : [];
  if (new Set(targetDeviceFamilies.map(family => family.name.toLowerCase())).size !== targetDeviceFamilies.length) return invalid();
  return {schema: 1, manifestNamespace: uri,
    identity: {name, publisher, version: version(attribute(identity, 'Version')), ...(attribute(identity, 'ProcessorArchitecture') === undefined ? {} : {architecture: architecture(attribute(identity, 'ProcessorArchitecture'))}), ...(resourceId === undefined ? {} : {resourceId})},
    framework: properties ? bool(one(properties, 'Framework', uri)) : false,
    resourcePackage: properties ? bool(one(properties, 'ResourcePackage', uri)) : false,
    applications, frameworkDependencies, targetDeviceFamilies, runtimeValidation: 'required', signatureValidation: 'not-performed'};
}
