import type { XmlNode } from './package-xml.js';

// Match Windows manifest names with optional namespace prefixes. Only parsed
// elements are visited, never markup inside comments or CDATA text.
export function* manifestElements(node: XmlNode | undefined, name: string): Generator<XmlNode> {
  if (!node) return;
  if (node.name.split(':').at(-1)?.toLowerCase() === name.toLowerCase()) yield node;
  for (const child of node.children) yield* manifestElements(child, name);
}

export function manifestAttribute(node: XmlNode | undefined, name: string): string | undefined {
  return Object.entries(node?.attributes ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}

export function manifestAttr(root: XmlNode | undefined, element: string, attribute: string): string | undefined {
  return manifestAttribute(manifestElements(root, element).next().value, attribute);
}

export function manifestText(root: XmlNode | undefined, element: string): string | undefined {
  return manifestElements(root, element).next().value?.text.trim() || undefined;
}
