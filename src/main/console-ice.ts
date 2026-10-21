import {isIP} from 'node:net';
import {cloudIceCandidates} from './cloud-account.js';
import type {ConsoleStreamIceCandidate} from '../shared/console-stream.js';

const MAX_CANDIDATES = 256;
const integer = (value: string, maximum: number) => /^\d{1,10}$/.test(value) && Number(value) >= 0 && Number(value) <= maximum;
const unicast = (bytes: number[]) => bytes[0] !== 0 && bytes[0] !== 10 && bytes[0] !== 127 && bytes[0] < 224
  && !(bytes[0] === 169 && bytes[1] === 254) && !(bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31)
  && !(bytes[0] === 192 && bytes[1] === 168) && !(bytes[0] === 100 && bytes[1] >= 64 && bytes[1] <= 127);

/** Decode only RFC 4380's 2001:0000::/32 layout, with network-byte-order XOR. */
export function consoleTeredoEndpoint(address: string): {address: string; port: number} | undefined {
  if (typeof address !== 'string' || address.length > 39 || !/^[a-f\d:]+$/i.test(address) || isIP(address) !== 6) return;
  const pieces = address.split('::'), left = pieces[0].split(':').filter(Boolean), right = pieces[1]?.split(':').filter(Boolean) ?? [];
  const words = (pieces.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]).map(value => parseInt(value, 16));
  if (words.length !== 8 || words[0] !== 0x2001 || words[1] !== 0) return;
  const server = [words[2] >>> 8, words[2] & 255, words[3] >>> 8, words[3] & 255];
  const client = [(words[6] >>> 8) ^ 255, (words[6] & 255) ^ 255, (words[7] >>> 8) ^ 255, (words[7] & 255) ^ 255];
  const port = words[5] ^ 0xffff;
  if (!unicast(server) || !unicast(client) || port === 0) return;
  return {address: client.join('.'), port};
}

interface CandidateFields {component: string; transport: string; address: string; port: string}
function fields(candidate: string): CandidateFields | undefined {
  const parts = candidate.trim().split(/\s+/);
  if (parts.length < 8 || parts.length > 64 || !/^(?:a=)?candidate:[a-z\d+/]{1,32}$/i.test(parts[0])
    || !integer(parts[1], 256) || Number(parts[1]) === 0 || !/^(udp|tcp)$/i.test(parts[2]) || !integer(parts[3], 0xffffffff)
    || !integer(parts[5], 65535) || Number(parts[5]) === 0 || parts[6].toLowerCase() !== 'typ' || !/^(host|srflx|prflx|relay)$/i.test(parts[7])) return;
  return {component: String(Number(parts[1])), transport: parts[2].toLowerCase(), address: parts[4].toLowerCase(), port: String(Number(parts[5]))};
}
const key = (candidate: ConsoleStreamIceCandidate, parsed: CandidateFields) => JSON.stringify([
  parsed.component, parsed.transport, parsed.address, parsed.port, candidate.sdpMid ?? null, candidate.sdpMLineIndex ?? null,
]);

/**
 * Preserve all bounded originals, then add low-priority direct IPv4 routes for
 * authenticated Home Teredo candidates. The Xbox-specific two-port strategy is
 * documented by Greenlight's pinned MIT desktop signaling implementation;
 * address decoding is independently implemented from RFC 4380 section 4.
 * No HTTP, DNS, operating-system route or interface change is performed here.
 */
export function consoleIceCandidates(value: unknown): ConsoleStreamIceCandidate[] {
  const original = cloudIceCandidates(value), result = [...original], known = new Set<string>();
  for (const candidate of original) {const parsed = fields(candidate.candidate); if (parsed) known.add(key(candidate, parsed));}
  for (const candidate of original) {
    if (result.length >= MAX_CANDIDATES) break;
    const parsed = fields(candidate.candidate);
    if (!parsed || parsed.transport !== 'udp' || parsed.component !== '1') continue;
    const endpoint = consoleTeredoEndpoint(parsed.address); if (!endpoint) continue;
    for (const port of [9002, endpoint.port]) {
      if (result.length >= MAX_CANDIDATES) break;
      const direct: ConsoleStreamIceCandidate = {
        ...candidate,
        candidate: `candidate:xboksteredo${result.length} 1 UDP 1 ${endpoint.address} ${port} typ host`,
      };
      const directFields = {component: '1', transport: 'udp', address: endpoint.address, port: String(port)}, identity = key(direct, directFields);
      if (!known.has(identity)) {known.add(identity); result.push(direct);}
    }
  }
  // Trickle ICE's end marker must remain after any newly discovered route.
  const end = original.findIndex(candidate => candidate.candidate === '');
  return end < 0 ? result : [...original.slice(0, end), ...result.slice(original.length), ...original.slice(end)];
}
