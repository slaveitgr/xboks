// Bounded manifest XML reader. No DTDs, external entities or processing instructions.
// This reads package identity/relationships, never proves account ownership.
export interface XmlNode { name: string; attributes: Record<string, string>; children: XmlNode[]; text: string }
function decode(text: string): string {
  return text.replace(/&[^;\s<]*;|&/g, entity => {
    const value = ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" } as Record<string, string>)[entity];
    if (value !== undefined) return value;
    if (!/^&#(?:x[0-9a-f]+|[0-9]+);$/i.test(entity)) throw Error('Unsupported XML entity.');
    const code = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) throw Error('Invalid XML character.');
    return String.fromCodePoint(code);
  });
}
export function parsePackageXml(xml: string): XmlNode {
  if (!xml || xml.length > 1_048_576 || xml.includes('\x00')) throw Error('Unsupported package manifest.');
  const container: XmlNode = { name: '', attributes: {}, children: [], text: '' }, stack = [container];
  let offset = 0, nodes = 0;
  const token = /<!--[^]*?-->|<\?xml\s[^]*?\?>|<!\[CDATA\[[^]*?\]\]>|<\/?[A-Za-z_](?:[^<>"']|"[^"<]*"|'[^'<]*')*>|[^<]+/gy;
  while (offset < xml.length) {
    token.lastIndex = offset;
    const found = token.exec(xml);
    if (!found) throw Error('Malformed package XML.');
    const part = found[0]; offset = token.lastIndex;
    const parent = stack[stack.length - 1];
    if (part.startsWith('<!--')) { if (part.slice(4, -3).includes('--')) throw Error('Invalid XML comment.'); continue; }
    if (part.startsWith('<?')) { if (container.children.length || stack.length !== 1) throw Error('Misplaced XML declaration.'); continue; }
    if (part.startsWith('<![CDATA[')) { parent.text += part.slice(9, -3); continue; }
    if (!part.startsWith('<')) { parent.text += decode(part); continue; }
    if (part.startsWith('</')) {
      const closing = part.match(/^<\/([A-Za-z_][\w.:-]*)\s*>$/);
      if (stack.length < 2 || closing?.[1] !== parent.name) throw Error('Mismatched package XML tag.');
      stack.pop(); continue;
    }
    const opening = part.match(/^<([A-Za-z_][\w.:-]*)([^]*?)(\/?)>$/);
    if (!opening || ++nodes > 4096 || stack.length > 32) throw Error('Package XML limit exceeded.');
    const attributes: Record<string, string> = Object.create(null);
    let remaining = opening[2];
    while (remaining.trim()) {
      const attribute = remaining.match(/^\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/);
      if (!attribute || Object.hasOwn(attributes, attribute[1])) throw Error('Invalid package XML attribute.');
      attributes[attribute[1]] = decode(attribute[2] ?? attribute[3]);
      remaining = remaining.slice(attribute[0].length);
    }
    const node = { name: opening[1], attributes, children: [], text: '' };
    parent.children.push(node);
    if (!opening[3]) stack.push(node);
  }
  if (stack.length !== 1 || container.children.length !== 1 || container.text.trim()) throw Error('Invalid package XML root.');
  return container.children[0];
}
export function children(node: XmlNode, name: string): XmlNode[] { return node.children.filter(child => child.name.split(':').at(-1) === name); }
export function single(node: XmlNode, name: string): XmlNode {
  const found = children(node, name);
  if (found.length !== 1) throw Error(`Package manifest requires one ${name}.`);
  return found[0];
}
