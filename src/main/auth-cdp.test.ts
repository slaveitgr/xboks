import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { AuthCdp } from './auth-cdp';

function fixture(timeout?: number) {
  const input = new PassThrough(), output = new PassThrough();
  const failed = vi.fn(), event = vi.fn(), frames: any[] = [];
  input.on('data', bytes => frames.push(JSON.parse(String(bytes).slice(0, -1))));
  const cdp = new AuthCdp(input, output, event, failed, timeout);
  return { cdp, input, output, failed, event, frames };
}
describe('private Chrome pipe transport', () => {
  it('handles split UTF8 replies, multiple frames and target sessions', async () => {
    const f = fixture(); const value = f.cdp.call('Runtime.evaluate', {}, 'own-session');
    expect(f.frames[0]).toMatchObject({ sessionId: 'own-session' });
    const bytes = Buffer.from(JSON.stringify({ id: f.frames[0].id, result: { text: 'Přihlášení' } }) + '\0' + JSON.stringify({ method: 'Page.frameNavigated', sessionId: 'own-session', params: {} }) + '\0');
    for (const byte of bytes) f.output.write(Buffer.from([byte]));
    await expect(value).resolves.toEqual({ text: 'Přihlášení' }); expect(f.event).toHaveBeenCalledOnce(); f.cdp.close();
  });
  it('does not echo errors or protocol payloads', async () => {
    const f = fixture(); const value = f.cdp.call('Synthetic');
    const rejection = expect(value).rejects.toThrow('Browser sign-in command failed.');
    f.output.write(JSON.stringify({ id: f.frames[0].id, error: { message: 'synthetic-secret' } }) + '\0');
    await rejection; f.cdp.close();
  });
  it.each(['not-json\0', JSON.stringify(null) + '\0', 'x'.repeat(2 * 1024 * 1024 + 1)])('fails closed on malformed or oversized data', value => {
    const f = fixture(); f.output.write(value); expect(f.failed).toHaveBeenCalledOnce(); expect(f.event).not.toHaveBeenCalled();
  });
  it('rejects pending commands and future writes on disconnect', async () => {
    const f = fixture(); const value = f.cdp.call('Synthetic');
    const rejection = expect(value).rejects.toThrow('closed'); f.cdp.close(); await rejection;
    await expect(f.cdp.call('Synthetic')).rejects.toThrow('unavailable'); expect(f.failed).toHaveBeenCalledOnce();
  });
  it('bounds stalled commands', async () => {
    const f = fixture(5); await expect(f.cdp.call('Synthetic')).rejects.toThrow('did not respond'); f.cdp.close();
  });
});
