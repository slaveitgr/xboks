import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vitest';
import { AccountProfile } from './account-profile.js';
import { BackendDiagnostics, setBackendDiagnostics } from './backend-diagnostics.js';

const avatar = 'data:image/png;base64,iVBORw0KGgo=';
const result = (account = 'one@example.test') => JSON.stringify({ schema: 1, account, gamertag: 'ExampleGamer', gamerpicDataUrl: avatar });

it('lets a real synthetic profile child finish once despite repeated Refresh requests', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-profile-process-'));
  const binary = path.join(root, 'xodus-cli');
  const log = new BackendDiagnostics(root); setBackendDiagnostics(log);
  try {
    await fs.writeFile(binary, `#!/usr/bin/env node\nsetTimeout(()=>process.stdout.write(${JSON.stringify(result() + '\n')}),100);\n`, { mode: 0o700 });
    const profile = new AccountProfile(root, () => {}, value => value);
    await profile.select('one@example.test', binary, true);
    for (let i = 0; i < 4; i++) await profile.select('one@example.test', binary, true);
    await profile.settled();
    expect(profile.value?.gamertag).toBe('ExampleGamer');
    const records = (await log.read()).content.trim().split('\n').map(line => JSON.parse(line));
    const exits = records.filter(row => row.operation === 'profile' && row.event === 'exit');
    expect(exits).toHaveLength(1); expect(exits[0].code).toBe(0); expect(exits[0].signal).toBeUndefined();
    expect(JSON.stringify(records)).not.toContain('one@example.test');
  } finally { setBackendDiagnostics(undefined); await fs.rm(root, { recursive: true, force: true }); }
});

it('coalesces repeated same-account refreshes instead of killing the in-flight profile', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-profile-refresh-'));
  let finish!: (text: string) => void, reads = 0, aborts = 0;
  try {
    const profile = new AccountProfile(root, () => {}, value => value, async (_binary, signal) => {
      reads++; signal.addEventListener('abort', () => { aborts++; });
      return new Promise(resolve => { finish = resolve; });
    });
    await profile.select('one@example.test', '/backend', true);
    for (let i = 0; i < 4; i++) await profile.select('one@example.test', '/backend', true);
    expect(aborts).toBe(0); expect(reads).toBe(1);
    finish(result()); await profile.settled(); expect(profile.value?.gamertag).toBe('ExampleGamer');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('cancels an obsolete backend request and ignores its late result on a silent backend switch', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-profile-backend-'));
  const jobs: { binary: string; signal: AbortSignal; finish: (text: string) => void }[] = [];
  try {
    const profile = new AccountProfile(root, () => {}, value => value, async (binary, signal) => new Promise(resolve => { jobs.push({ binary, signal, finish: resolve }); }));
    await profile.select('one@example.test', '/old'); const old = profile.settled();
    await profile.select('one@example.test', '/new', false);
    expect(jobs).toHaveLength(2); expect(jobs[0].signal.aborted).toBe(true);
    jobs[0].finish(result()); await old; expect(profile.value).toBeUndefined();
    jobs[1].finish(result()); await profile.settled(); expect(profile.value?.gamertag).toBe('ExampleGamer');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it('loads a genuine profile result, reuses only its account cache offline, and clears on logout', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-profile-'));
  try {
    const profile = new AccountProfile(root, () => {}, value => value, async () => result());
    await profile.select('one@example.test', '/fake/backend'); await profile.settled();
    expect(profile.value).toEqual({ gamertag: 'ExampleGamer', avatarDataUrl: avatar, checkedAt: expect.any(String) });
    const file = path.join(root, 'xbox-profile.json');
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(file, 'utf8')).not.toContain('one@example.test');
    const offline = new AccountProfile(root, () => {}, value => value, async () => { throw Error('offline'); });
    await offline.select('one@example.test', '/fake/backend'); await offline.settled();
    expect(offline.value?.gamertag).toBe('ExampleGamer');
    await offline.select(undefined); expect(offline.value).toBeUndefined();
    await expect(fs.stat(file)).rejects.toThrow();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('publishes and privately caches only actual provider details and their successful fetch time', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-profile-details-'));
  const now = Date.parse('2026-10-21T12:00:00Z');
  try {
    const details = { gamerscore: 0, bio: 'A genuine\nprovider biography', location: 'Example location', realName: 'Example Name',
      modernGamertag: 'Example', uniqueModernGamertag: 'Example#1234', modernGamertagSuffix: '1234', tenureLevel: 7, accountTier: 'Gold' };
    const profile = new AccountProfile(root, () => {}, value => value, async () => JSON.stringify({ ...JSON.parse(result()), ...details,
      accessToken: 'synthetic-private-token', followers: 999 }), () => now);
    await profile.select('one@example.test', '/fake/backend'); await profile.settled();
    expect(profile.value).toMatchObject({ ...details, checkedAt: new Date(now).toISOString() });
    expect(profile.matchesAccount('one@example.test')).toBe(true);
    for (const account of [undefined, '', ' ', 'two@example.test', 'ONE@example.test']) expect(profile.matchesAccount(account)).toBe(false);
    expect(profile.source).toBe('live'); expect(profile.refreshing).toBe(false); expect(profile.error).toBeUndefined();
    expect(profile.value?.subscription).toBeUndefined();
    const cache = await fs.readFile(path.join(root, 'xbox-profile.json'), 'utf8');
    expect(cache).not.toMatch(/synthetic-private-token|one@example.test|followers/);
    const offline = new AccountProfile(root, () => {}, value => value, async () => { throw Error('private backend text'); }, () => now + 60_000);
    await offline.select('one@example.test', '/fake/backend'); await offline.settled();
    expect(offline.value).toMatchObject({ ...details, checkedAt: new Date(now).toISOString() });
    expect(offline.source).toBe('cache'); expect(offline.error).toBe('Xbox profile is temporarily unavailable.');
    await offline.select('two@example.test');
    expect(offline.value).toBeUndefined(); expect(offline.source).toBeUndefined(); expect(offline.error).toBeUndefined();
    expect(offline.matchesAccount('one@example.test')).toBe(false); expect(offline.matchesAccount('two@example.test')).toBe(true);
    await offline.select(undefined); expect(offline.matchesAccount('two@example.test')).toBe(false); expect(offline.matchesAccount(undefined)).toBe(false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('shares explicit refreshes, reports their lifetime and preserves stale same-account data after failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-profile-status-'));
  let now = Date.parse('2026-10-21T12:00:00Z'), reads = 0, changes = 0;
  let finish!: (text: string) => void, fail!: (error: Error) => void;
  try {
    const profile = new AccountProfile(root, () => { changes++; }, value => value, async () => {
      reads++; return new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    }, () => now);
    await profile.select('one@example.test', '/fake/backend');
    expect(profile.refreshing).toBe(true); expect(changes).toBeGreaterThan(0);
    finish(JSON.stringify({ ...JSON.parse(result()), gamerscore: 123 })); await profile.settled();
    const checkedAt = profile.value?.checkedAt;
    await profile.select('one@example.test', '/fake/backend'); expect(reads).toBe(1);
    now += 60_000; const before = changes;
    await profile.select('one@example.test', '/fake/backend', true);
    await profile.select('one@example.test', '/fake/backend', true);
    expect(reads).toBe(2); expect(profile.refreshing).toBe(true); expect(changes).toBeGreaterThan(before);
    fail(Error('synthetic private provider payload')); await profile.settled();
    expect(profile.refreshing).toBe(false); expect(profile.source).toBe('cache');
    expect(profile.value).toMatchObject({ gamerscore: 123, checkedAt });
    expect(profile.error).toBe('Xbox profile is temporarily unavailable.');
    expect(profile.error).not.toContain('private');
    await profile.select(undefined); expect(profile.error).toBeUndefined(); expect(profile.source).toBeUndefined();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('keeps old cache data compatible without inventing an age, score or subscription', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-profile-old-cache-'));
  try {
    const profile = new AccountProfile(root, () => {}, value => value, async () => result());
    await profile.select('one@example.test', '/fake/backend'); await profile.settled();
    const file = path.join(root, 'xbox-profile.json'), cached = JSON.parse(await fs.readFile(file, 'utf8'));
    delete cached.checkedAt;
    await fs.writeFile(file, JSON.stringify({ ...cached, gamerscore: 'invalid', bio: 'bad\0value', subscription: { status: 'active', productIds: [] } }));
    const offline = new AccountProfile(root, () => {}, value => value);
    await offline.select('one@example.test');
    expect(offline.value).toMatchObject({ gamertag: 'ExampleGamer' }); expect(offline.source).toBe('cache');
    for (const field of ['checkedAt', 'gamerscore', 'bio', 'subscription'] as const) expect(offline.value?.[field]).toBeUndefined();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('removes old optional details when a later valid provider response no longer returns them', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-profile-redacted-'));
  let rich = true;
  try {
    const profile = new AccountProfile(root, () => {}, value => value, async () => JSON.stringify({ ...JSON.parse(result()),
      ...(rich ? { gamerscore: 123, bio: 'Previous biography', location: 'Previous place' } : {}) }));
    await profile.select('one@example.test', '/fake/backend'); await profile.settled();
    expect(profile.value?.bio).toBe('Previous biography');
    rich = false;
    await profile.select('one@example.test', '/fake/backend', true); await profile.settled();
    expect(profile.value?.gamertag).toBe('ExampleGamer'); expect(profile.source).toBe('live');
    for (const field of ['bio', 'location', 'gamerscore'] as const) expect(profile.value?.[field]).toBeUndefined();
    expect(await fs.readFile(path.join(root, 'xbox-profile.json'), 'utf8')).not.toMatch(/Previous biography|Previous place|gamerscore/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('discards late requests after account changes and never shows another account cache', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-profile-race-'));
  try {
    let finish!: (value: string) => void;
    const profile = new AccountProfile(root, () => {}, value => value, async () => new Promise(resolve => { finish = resolve; }));
    await profile.select('one@example.test', '/fake/backend');
    const old = profile.settled();
    await profile.select('two@example.test');
    finish(result()); await old;
    expect(profile.value).toBeUndefined();
    const wrong = new AccountProfile(root, () => {}, value => value, async () => result());
    await wrong.select('two@example.test', '/fake/backend'); await wrong.settled();
    expect(wrong.value).toBeUndefined();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('keeps email/default fallback with old backends or malformed profile responses', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-profile-fallback-'));
  try {
    let called = false;
    const old = new AccountProfile(root, () => {}, value => value, async () => { called = true; return result(); });
    await old.select('one@example.test'); expect(called).toBe(false);
    for (const output of ['bad json', JSON.stringify({ schema: 1, account: 'one@example.test', gamertag: '\nbad' })]) {
      const profile = new AccountProfile(root, () => {}, value => value, async () => output);
      await profile.select('one@example.test', '/fake/backend'); await profile.settled();
      expect(profile.value).toBeUndefined();
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('retains a fresh subscription only for the matching account and removes it on sign-out', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-membership-'));
  try {
    const subscription = { status: 'active', productIds: ['CFQ7TTC0KGQ8'], checkedAt: new Date().toISOString() };
    const profile = new AccountProfile(root, () => {}, value => value, async () => JSON.stringify({ ...JSON.parse(result()), subscription }));
    await profile.select('one@example.test', '/fake/backend'); await profile.settled();
    expect(profile.value?.subscription).toEqual(subscription);
    const offline = new AccountProfile(root, () => {}, value => value);
    await offline.select('one@example.test');
    expect(offline.value?.subscription).toEqual(subscription);
    await offline.select('two@example.test'); expect(offline.value?.subscription).toBeUndefined();
    await profile.select(undefined); expect(profile.value?.subscription).toBeUndefined();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
