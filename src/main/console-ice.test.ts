import {expect, it} from 'vitest';
import {consoleIceCandidates, consoleTeredoEndpoint} from './console-ice';
const TEREDO = '2001:0000:4136:e378:8000:63bf:3fff:fdd2';
const candidate = (address = TEREDO, overrides: {component?: number; transport?: string; port?: number; tail?: string} = {}) => ({
  candidate: `a=candidate:1 ${overrides.component ?? 1} ${overrides.transport ?? 'UDP'} 2113937151 ${address} ${overrides.port ?? 9002} typ host${overrides.tail ?? ''}`,
  sdpMid: '0', sdpMLineIndex: 0,
});

it.each([TEREDO, '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:0:4136:e378::63bf:3fff:fdd2', TEREDO.toUpperCase()])('decodes verified Teredo address notation %s using network-order inverted client and port bits', address => {
  expect(consoleTeredoEndpoint(address)).toEqual({address: '192.0.2.45', port: 40000});
});
it.each([{encoded: 'fffe', port: 1}, {encoded: '0000', port: 65535}])('decodes UDP endpoint boundary $port without signed or byte-order truncation', ({encoded, port}) => {
  expect(consoleTeredoEndpoint(`2001:0:4136:e378:8000:${encoded}:3fff:fdd2`)).toEqual({address: '192.0.2.45', port});
});
it.each(['2001:db8:4136:e378:8000:63bf:3fff:fdd2', '2002:0:4136:e378:8000:63bf:3fff:fdd2', '2001:0:4136:e378:8000:63bf:3fff',
  '2001:0:4136:e378:8000:63bf:3fff:fdd2:0000', '2001::4136::fdd2', '2001:0:4136:e378:8000:63bf:3fff:gggg',
  `${TEREDO}%eth0`, `[${TEREDO}]`, `${TEREDO}/128`, `https://${TEREDO}`, '::ffff:192.0.2.45', '192.0.2.45'])('does not reinterpret other or malformed addresses as Teredo: %s', address => {
  expect(consoleTeredoEndpoint(address)).toBeUndefined();
});
it.each([
  '2001:0:4136:e378:8000:ffff:3fff:fdd2', // Encoded UDP port zero.
  '2001:0:4136:e378:8000:63bf:80ff:fffe', // Loopback client.
  '2001:0:4136:e378:8000:63bf:ffff:fffe', // Unspecified network.
  '2001:0:4136:e378:8000:63bf:1fff:fffe', // Multicast client.
  '2001:0:4136:e378:8000:63bf:f5ff:fffe', // Private 10/8 client.
  '2001:0:4136:e378:8000:63bf:3f57:fefe', // Private 192.168 client.
  '2001:0:4136:e378:8000:63bf:5601:fefe', // Link-local client.
  '2001:0:4136:e378:8000:63bf:9bbf:fffe', // Shared-address client.
  '2001::8000:63bf:3fff:fdd2', // Unspecified server.
])('does not synthesize unusable mapped endpoints: %s', address => {
  expect(consoleTeredoEndpoint(address)).toBeUndefined();
});
it('preserves all original priorities, order and media fields while appending the two documented IPv4 alternatives', () => {
  const original = [candidate('192.168.1.20'), candidate(), {candidate: 'a=end-of-candidates', sdpMid: '0', sdpMLineIndex: 0}];
  const result = consoleIceCandidates(original);
  expect(result.slice(0, 2)).toEqual(original.slice(0, 2));
  expect(result.at(-1)).toEqual({...original[2], candidate: ''});
  expect(result.slice(2, 4)).toEqual([
    {candidate: 'candidate:xboksteredo3 1 UDP 1 192.0.2.45 9002 typ host', sdpMid: '0', sdpMLineIndex: 0},
    {candidate: 'candidate:xboksteredo4 1 UDP 1 192.0.2.45 40000 typ host', sdpMid: '0', sdpMLineIndex: 0},
  ]);
  expect(original[2].candidate).toBe('a=end-of-candidates');
});
it('does not derive routes from non-UDP, another component, malformed ICE fields or unrelated IPv6', () => {
  const original = [candidate(TEREDO, {transport: 'TCP', tail: ' tcptype passive'}), candidate(TEREDO, {component: 2}), candidate('2001:db8::1'),
    {candidate: `candidate:x 1 UDP -1 ${TEREDO} 9002 typ host`}, {candidate: `candidate:x 1 UDP 1 ${TEREDO} 0 typ host`}];
  expect(consoleIceCandidates(original)).toEqual(original);
});
it('deduplicates synthesized endpoints against existing IPv4 routes and duplicate Teredo candidates without discarding originals', () => {
  const direct = candidate('192.0.2.45'), original = [direct, candidate(), candidate()];
  const result = consoleIceCandidates(original); expect(result.slice(0, 3)).toEqual(original); expect(result).toHaveLength(4);
  expect(result[3].candidate).toContain('192.0.2.45 40000 typ host');
});
it('does not collapse candidates from another media section or m-line', () => {
  const result = consoleIceCandidates([candidate(), {...candidate(), sdpMid: '1', sdpMLineIndex: 1}]);
  expect(result).toHaveLength(6); expect(result.filter(row => row.sdpMid === '1')).toHaveLength(3);
});
it('deduplicates the fixed and mapped port when both are 9002', () => {
  const result = consoleIceCandidates([candidate('2001:0:4136:e378:8000:dcd5:3fff:fdd2')]); expect(result).toHaveLength(2);
  expect(result[1].candidate).toContain('192.0.2.45 9002 typ host');
});
it('bounds total output while preserving every bounded original', () => {
  const full = Array.from({length: 256}, () => candidate()); expect(consoleIceCandidates(full)).toEqual(full);
  const nearlyFull = full.slice(1), result = consoleIceCandidates(nearlyFull); expect(result).toHaveLength(256); expect(result.slice(0, 255)).toEqual(nearlyFull);
});
it.each([
  {value: [{candidate: 'candidate:x 1 UDP 1 2001::1 9002 typ host\r\nm=video'}]}, {value: [{candidate: 'https://attacker.invalid'}]},
  {value: Array.from({length: 257}, () => candidate())}, {value: [{...candidate(), sdpMLineIndex: -1}]},
])('rejects unsafe or unbounded candidate collections before deriving routes', ({value}) => {
  expect(() => consoleIceCandidates(value)).toThrow();
});
