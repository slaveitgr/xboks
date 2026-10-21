import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { backendSourceArchiveArgs } from '../backend-source-archive.mjs';

test('self-profile details are pinned, allowlisted and keep membership and authentication separate', async () => {
  const lock = JSON.parse(await fs.readFile('assets/backend-source.lock.json', 'utf8'));
  const detailsIndex = lock.patches.findIndex(patch => patch.file === 'xodus-profile-details.patch');
  const socialIndex = lock.patches.findIndex(patch => patch.file === 'xodus-social.patch');
  assert.ok(socialIndex >= 0 && detailsIndex > socialIndex);
  const patch = await fs.readFile('assets/xodus-profile-details.patch', 'utf8');
  assert.equal((patch.match(/^diff --git /gm) ?? []).length, 1);
  assert.match(patch, /^diff --git a\/crates\/xodus-cli\/src\/commands\/profile\.rs b\/crates\/xodus-cli\/src\/commands\/profile\.rs$/m);
  for (const text of ['profile_details_only_exposes_bounded_provider_fields_including_actual_zero_score',
    'profile_details_missing_or_malformed_optional_data_never_invents_values', 'optional_profile_text',
    'Gamerscore,Bio,Location', 'text.parse::<u32>()', 'settings.len() <= 64']) assert.ok(patch.includes(text), text);
  assert.doesNotMatch(patch, /^\+.*(?:tokens\.(?:get_|set_|save_|remove_)|request_xsts_token|exchange_user_token|\.delete_credential\()/m);
  assert.doesNotMatch(patch, /^\+.*result\["subscription"\]\s*=/m);
});

test('auth response consistency and coherent credential persistence are pinned and account-free tested', async () => {
  const lock = JSON.parse(await fs.readFile('assets/backend-source.lock.json', 'utf8'));
  assert.ok(lock.patches.some(p => p.file === 'xodus-auth-consistency.patch'));
  const patch = await fs.readFile('assets/xodus-auth-consistency.patch', 'utf8');
  for (const expected of ['impl TryFrom<soap::RequestSecurityTokenResponse>', 'save_user_session',
    'credential_login_session_failed_write_preserves_previous_session_and_empty_set_is_refused',
    'credential_login_session_readback_failure_never_exposes_mixed_account_and_token',
    'credential_token_response_valid_compact_delegation_and_legacy_remain_supported',
    'credential_invalid_device_proof_returns_an_error_before_any_request']) assert.ok(patch.includes(expected), expected);
  assert.doesNotMatch(patch, /^\+.*(?:verify_and_decrypt_envelope|\.scope_policy\(|\.hosting_app\()/m);
});

test('metadata recovery, consumer-independent timeout and empty-file updates are pinned and tested', async () => {
  const lock = JSON.parse(await fs.readFile('assets/backend-source.lock.json', 'utf8'));
  assert.ok(lock.patches.some(p => p.file === 'xodus-metadata-recovery.patch'));
  const patch = await fs.readFile('assets/xodus-metadata-recovery.patch', 'utf8');
  for (const expected of ['streaming_metadata_empty_reconnects_stop_after_retry_limit',
    'streaming_metadata_header_and_body_waits_have_deadlines',
    'streaming_http_disk_or_consumer_delay_is_not_network_idle_time',
    'streaming_updated_file_is_trimmed_even_when_its_expected_length_is_zero_or_complete',
    'streaming_metadata_failure_returns_error_without_panic_or_touching_existing_game']) assert.ok(patch.includes(expected), expected);
  const build = await fs.readFile('scripts/build-backend.mjs', 'utf8');
  assert.ok(build.includes("'-p', 'msixvc', 'streaming::tests'"));
});

test('ticket diagnostics preserve requests, signature verification and non-retryable refusals', async () => {
  const lock = JSON.parse(await fs.readFile('assets/backend-source.lock.json', 'utf8'));
  assert.ok(lock.patches.some(p => p.file === 'xodus-ticket-diagnostics.patch'));
  const patch = await fs.readFile('assets/xodus-ticket-diagnostics.patch', 'utf8');
  for (const text of ['NEXUS_TICKET_DIAGNOSTIC_V1', 'ticket-response-signature', 'ticket-response-parse', 'ticket-interaction-required',
    'ticket_diagnostic_classifies_without_disclosing_error_payloads', 'ticket_fault_classification_and_provider_codes_are_strictly_bounded',
    'matches!(self, Self::Timeout | Self::Connect | Self::Network)']) assert.ok(patch.includes(text), text);
  assert.doesNotMatch(patch, /diff --git a\/.*(?:tokens\/|login\.rs|rst\/|streaming\.rs|package_plan\.rs)/);
  assert.doesNotMatch(patch, /^[+-].*(?:verify_and_decrypt_envelope|scope_policy|hosting_app|\.send\(\)|\.save_|\.remove_)/m);
  const build = await fs.readFile('scripts/build-backend.mjs', 'utf8');
  assert.ok(build.includes("'-p', 'xodus', 'ticket_diagnostic_'"));
});

test('bandwidth limit is pinned, aggregate, live controllable and does not change authentication', async () => {
  const lock = JSON.parse(await fs.readFile('assets/backend-source.lock.json', 'utf8'));
  assert.ok(lock.patches.some(p => p.file === 'xodus-download-bandwidth.patch'));
  const patch = await fs.readFile('assets/xodus-download-bandwidth.patch', 'utf8');
  for (const expected of ['download_limit_kib', 'set-download-limit', 'OnceLock', 'streaming_bandwidth_is_aggregate_across_parallel_streams',
    'streaming_bandwidth_limited_http_metadata_and_parallel_ranges_keep_bytes_and_do_not_timeout',
    'streaming_bandwidth_update_and_unlimited_wake_active_waiters', 'streaming_bandwidth_cancellation_leaves_no_reserved_delay']) assert.ok(patch.includes(expected), expected);
  assert.doesNotMatch(patch, /diff --git a\/.*(?:tokens\/|login\.rs|session\.rs|package_plan\.rs)/);
  const build = await fs.readFile('scripts/build-backend.mjs', 'utf8');
  assert.match(build, /'streaming_bandwidth_', '--', '--ignored', '--test-threads=1'/);
  assert.ok(build.includes("'--download-limit-kib'"));
  const main = await fs.readFile('src/main/index.ts', 'utf8');
  assert.match(main, /if \(isBandwidthOnlyPatch\(patch\)\) \{ emitSnapshot\(\); return settings; \}/);
  assert.ok(main.indexOf('if (isBandwidthOnlyPatch(patch))') < main.indexOf('backend.setExternalRoot(settings.externalXodusRoot)'));
});

test('cached metadata handoff cannot park the aggregate download limiter', async () => {
  const lock = JSON.parse(await fs.readFile('assets/backend-source.lock.json', 'utf8'));
  assert.ok(lock.patches.some(p => p.file === 'xodus-streaming-handoff.patch'));
  const patch = await fs.readFile('assets/xodus-streaming-handoff.patch', 'utf8');
  assert.ok(patch.includes('if self.cached_len >= target_end'));
  assert.ok(patch.includes('streaming_bandwidth_cached_prefix_handoff_does_not_park_the_limiter'));
  assert.ok(patch.includes('timeout(Duration::from_secs(2), range.next())'));
  assert.doesNotMatch(patch, /diff --git a\/.*(?:tokens\/|login\.rs|license\.rs|package_plan\.rs)/);
  const build = await fs.readFile('scripts/build-backend.mjs', 'utf8');
  assert.match(build, /'streaming_bandwidth_', '--', '--ignored', '--test-threads=1'/);
});

test('backend source and ordered patch hashes are locked', async () => {
  const lock = JSON.parse(await fs.readFile('assets/backend-source.lock.json', 'utf8'));
  assert.equal(lock.schema, 1);
  assert.match(lock.commit, /^[a-f0-9]{40}$/);
  assert.match(lock.cargoLockSha256, /^[a-f0-9]{64}$/);
  assert.match(lock.version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.patches.length, new Set(lock.patches.map(p => p.file)).size);
  for (const patch of lock.patches) {
    assert.match(patch.file, /^xodus-[a-z-]+\.patch$/);
    assert.equal(createHash('sha256').update(await fs.readFile(`assets/${patch.file}`)).digest('hex'), patch.sha256);
  }
});

test('backend workflow shell parses and resolves the locked toolchain', async () => {
  const require = createRequire(import.meta.url);
  const yaml = require('js-yaml');
  const workflow = yaml.load(await fs.readFile('.github/workflows/backend.yml', 'utf8'));
  const steps = workflow.jobs.build.steps;
  for (const step of steps) if (step.run) execFileSync('bash', ['-n', '-c', step.run], { stdio: 'pipe' });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'backend-workflow-test-'));
  try {
    const env = path.join(root, 'env');
    execFileSync('bash', ['-c', steps.find(step => step.name === 'Read pinned Rust version').run], { env: { ...process.env, GITHUB_ENV: env } });
    const lock = JSON.parse(await fs.readFile('assets/backend-source.lock.json', 'utf8'));
    assert.equal(await fs.readFile(env, 'utf8'), `BACKEND_RUST=${lock.rust}\n`);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('backend build runs account-free credential persistence regressions', async () => {
  const build = await fs.readFile('scripts/build-backend.mjs', 'utf8');
  assert.match(build, /command\('cargo', \['test', '--locked', \.\.\.offline, \.\.\.features, '-p', 'xodus', 'credential_'\]\)/);
  const lock = JSON.parse(await fs.readFile('assets/backend-source.lock.json', 'utf8'));
  assert.ok(lock.patches.some(patch => patch.file === 'xodus-keyring-credentials.patch'));
  assert.ok(lock.patches.some(patch => patch.file === 'xodus-keyring-encoding.patch'));
  assert.ok(lock.patches.findIndex(p => p.file === 'xodus-auth-consistency.patch') <
    lock.patches.findIndex(p => p.file === 'xodus-keyring-encoding.patch'));
});

test('GNOME textual keyring regression uses only in-memory synthetic data', { skip: process.platform !== 'linux' }, () => {
  execFileSync('python3', ['scripts/keyring-textual-roundtrip.test.py'], { stdio: 'pipe' });
});

test('session recovery is pinned and does not replace interactive login or raw token reads', async () => {
  const lock = JSON.parse(await fs.readFile('assets/backend-source.lock.json', 'utf8'));
  assert.ok(lock.patches.some(patch => patch.file === 'xodus-session-recovery.patch'));
  const patch = await fs.readFile('assets/xodus-session-recovery.patch', 'utf8');
  for (const expected of ['session-user-expired', 'ticket-timeout', 'refresh_existing_device_credentials', 'try_lock_exclusive',
    'credential_session_valid_signin_has_no_renewal', 'ticket_real_transport_timeout_and_http_refusal_classification']) assert.ok(patch.includes(expected));
  assert.doesNotMatch(patch, /diff --git a\/.*(?:login\.rs|tokens\/manager\.rs|webview_stdio\.rs)/);
});

test('delegation-compact store tickets are converted only for Store and licensing requests', async () => {
  const lock = JSON.parse(await fs.readFile('assets/backend-source.lock.json', 'utf8'));
  assert.ok(lock.patches.some(patch => patch.file === 'xodus-store-ticket.patch'));
  const patch = await fs.readFile('assets/xodus-store-ticket.patch', 'utf8');
  for (const expected of ['pub fn store_ticket', 'store_ticket_accepts_compact_and_delegation_compact_forms',
    'store_license_accepts_delegation_compact_user_tickets']) assert.ok(patch.includes(expected), expected);
  assert.doesNotMatch(patch, /diff --git a\/.*(?:tokens\/|login\.rs)/);
  assert.doesNotMatch(patch, /^-.*"d=\{\}"/m);
  assert.ok(patch.includes('Token::try_from(response).map_err(|_| FAIL)?'));
  assert.ok(lock.patches.findIndex(p => p.file === 'xodus-auth-consistency.patch') <
    lock.patches.findIndex(p => p.file === 'xodus-store-ticket.patch'));
});

test('content-license parsing is pinned, regression-tested and does not change authentication or streaming', async () => {
  const lock = JSON.parse(await fs.readFile('assets/backend-source.lock.json', 'utf8'));
  assert.ok(lock.patches.some(patch => patch.file === 'xodus-content-response.patch'));
  const patch = await fs.readFile('assets/xodus-content-response.patch', 'utf8');
  for (const expected of ['content-license request', 'content_license_request_contract_is_unchanged',
    'content_license_success_preserves_existing_first_key', 'content_license_status_precedes_body',
    'content_license_malformed_keys_are_errors_not_panics', 'NEXUS_CONTENT_LICENSE_DIAGNOSTIC_V1']) assert.ok(patch.includes(expected), expected);
  assert.doesNotMatch(patch, /diff --git a\/.*(?:tokens\/|login\.rs|streaming\.rs|package_plan\.rs)/);
  const build = await fs.readFile('scripts/build-backend.mjs', 'utf8');
  assert.match(build, /command\('cargo', \['test', '--locked', \.\.\.offline, \.\.\.features, '-p', 'xodus', 'content_license_'\]\)/);
});

test('streaming recovery keeps verified ranges and checkpoints without touching authentication', async () => {
  const lock = JSON.parse(await fs.readFile('assets/backend-source.lock.json', 'utf8'));
  assert.ok(lock.patches.some(patch => patch.file === 'xodus-streaming-recovery.patch'));
  const patch = await fs.readFile('assets/xodus-streaming-recovery.patch', 'utf8');
  for (const text of ['NEXUS_TRANSFER_DIAGNOSTIC_V1', 'transfer-http', 'transfer-range',
    'streaming_resume_terminal_http_error_checkpoints_only_written_pages_then_restarts_exactly',
    'streaming_http_production_timeout_tolerates_a_six_second_slow_response',
    'streaming_failure_cancels_and_settles_parallel_workers_without_completing_failed_jobs',
    'streaming_failure_preserves_existing_game_and_dlc_files_and_completed_marker']) assert.ok(patch.includes(text), text);
  assert.doesNotMatch(patch, /diff --git a\/.*(?:tokens\/|licensing\/|license\.rs|login\.rs|package_plan\.rs)/);
  const build = await fs.readFile('scripts/build-backend.mjs', 'utf8');
  assert.match(build, /command\('cargo', \['test', '--locked', \.\.\.offline, \.\.\.features, '-p', 'msixvc', 'streaming_'\]\)/);
});

test('corresponding-source archive preserves nested target source directories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'backend-source-archive-'));
  try {
    const entries = ['source/.git/config', 'source/target/debug/binary', 'source/vendor/cc/src/target/apple.rs',
      'source/vendor/dependency/.git/reference', 'source/vendor/other/source/target/parser.rs',
      'source/vendor/other/source/.git/reference', 'source/crates/xodus/src/lib.rs', 'recipe/scripts/build-backend.mjs'];
    for (const name of entries) {
      await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await fs.writeFile(path.join(root, name), 'synthetic source');
    }
    const archive = path.join(root, 'source.tar.xz');
    execFileSync('tar', backendSourceArchiveArgs(archive, root));
    const listing = execFileSync('tar', ['-tJf', archive], { encoding: 'utf8' }).split('\n');
    for (const name of entries.slice(2)) assert.ok(listing.includes(name), `Missing ${name}`);
    for (const name of entries.slice(0, 2)) assert.ok(!listing.includes(name), `Unexpected ${name}`);
    const build = await fs.readFile('scripts/build-backend.mjs', 'utf8');
    assert.match(build, /command\('tar', backendSourceArchiveArgs\(/);
    assert.match(build, /copyFile\(path.join\(root, 'scripts\/backend-source-archive.mjs'\)/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
