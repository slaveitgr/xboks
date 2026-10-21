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
  const profileIndex = lock.patches.findIndex(patch => patch.file === 'xodus-account-profile.patch');
  const socialIndex = lock.patches.findIndex(patch => patch.file === 'xodus-social.patch');
  assert.ok(profileIndex >= 0 && detailsIndex > profileIndex && socialIndex >= 0);
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

test('encrypted resume retains complete ciphertext pages and launch errors identify incomplete images (#248)', async () => {
  const lock = JSON.parse(await fs.readFile('assets/backend-source.lock.json', 'utf8'));
  const resumeIndex = lock.patches.findIndex(p => p.file === 'xodus-encrypted-resume.patch');
  const launchIndex = lock.patches.findIndex(p => p.file === 'xodus-launch-image-errors.patch');
  assert.ok(resumeIndex >= 0 && launchIndex > resumeIndex);
  const resume = await fs.readFile('assets/xodus-encrypted-resume.patch', 'utf8');
  for (const name of ['streaming_resume_completed_encrypted_image_preserves_ciphertext_tail',
    'streaming_resume_repairs_old_encrypted_tail_with_actual_range_download',
    'streaming_repair_selection_preserves_unchanged_files_and_only_targets_current_package',
    'streaming_encrypted_download_and_partial_resume_keep_exact_ciphertext_for_launch_decryption',
    'streaming_plain_output_remains_unpadded_and_short_ciphertext_returns_error']) assert.ok(resume.includes(name), name);
  assert.ok(resume.includes('content.stored_length()?'));
  assert.ok(resume.includes('offset = content.length / page_size * page_size;'));
  const launch = await fs.readFile('assets/xodus-launch-image-errors.patch', 'utf8');
  for (const name of ['launch_image_preflight_rejects_incomplete_ciphertext_with_file_and_size_without_writing',
    'launch_image_preflight_accepts_valid_plain_and_padded_images_without_changes',
    'launch_images_keep_owned_descriptors_with_inheritance_enabled']) assert.ok(launch.includes(name), name);
  assert.match(launch, /^-\s*\.unwrap\(\);$/m);
  assert.match(launch, /^\+\s*Err\(error\) => \{/m);
  assert.doesNotMatch(resume + launch, /diff --git a\/.*(?:tokens\/|login\.rs|license\.rs|package_plan\.rs)/);
});

test('first wallet creation is explicit, native-prompt only and preserves existing collections', async () => {
  const lock = JSON.parse(await fs.readFile('assets/backend-source.lock.json', 'utf8'));
  const index = lock.patches.findIndex(p => p.file === 'xodus-keyring-create.patch');
  assert.ok(index > lock.patches.findIndex(p => p.file === 'xodus-keyring-persistence.patch'));
  const patch = await fs.readFile('assets/xodus-keyring-create.patch', 'utf8');
  for (const text of ['KeyringCreate', 'CreateCollection', 'if !collections.is_empty()', 'current_owner != owner',
    'keyring_create_never_replaces_existing_collections_or_creates_from_unlock',
    'keyring_create_native_prompt_rechecks_default_and_lock_state',
    'keyring_create_cancel_timeout_and_foreign_completion_are_bounded']) assert.ok(patch.includes(text),text);
  assert.doesNotMatch(patch, /^\+.*(?:GetSecret|SearchItems|SetSecret|SetAlias|ensure_device_credentials\(|https:\/\/)/m);
  const build = await fs.readFile('scripts/build-backend.mjs','utf8');
  assert.ok(build.includes("'keyring_create_', '--', '--test-threads=1'"));
  assert.ok(build.includes("'keyring-create'"));
});

test('wallet unlock is explicit, account-free and private-bus tested', async () => {
  const lock = JSON.parse(await fs.readFile('assets/backend-source.lock.json', 'utf8'));
  assert.ok(lock.patches.some(p => p.file === 'xodus-keyring-unlock.patch'));
  const patch = await fs.readFile('assets/xodus-keyring-unlock.patch', 'utf8');
  for (const text of ['KeyringUnlock', 'keyring_unlock_private_bus_metadata_never_activates_or_reads_items',
    'keyring_unlock_private_bus_ignores_completion_from_another_owner', 'keyring_unlock_private_bus_cancellation_and_timeout_dismiss_the_prompt',
    'keyring_unlock_private_bus_prompt_connection_completion_and_lock_recheck', 'connection.remove_match(token)',
    'keyring_unlock_prompt_never_tags_unrelated_or_unparented_windows',
    'keyring_unlock_prompt_uses_only_the_verified_parent_app', 'keyring_unlock_prompt_reaper_id_requires_the_actual_launch_argument']) assert.ok(patch.includes(text),text);
  assert.doesNotMatch(patch, /^\+.*(?:GetSecret|SearchItems|CreateCollection|SetSecret|ensure_device_credentials\(|https:\/\/)/m);
  const build = await fs.readFile('scripts/build-backend.mjs', 'utf8');
  assert.ok(build.includes("'keyring_unlock_', '--', '--test-threads=1'"));
  assert.ok((await fs.readFile('.github/workflows/backend.yml','utf8')).includes('dbus-daemon'));
});

test('session keyring shutdown is limited to its verified xboks-owned provider and has no credential API', async () => {
  const lock = JSON.parse(await fs.readFile('assets/backend-source.lock.json', 'utf8'));
  assert.ok(lock.patches.some(p => p.file === 'xodus-keyring-session-stop.patch'));
  const patch = await fs.readFile('assets/xodus-keyring-session-stop.patch', 'utf8');
  for (const text of ['KeyringSessionStop', 'GetConnectionUnixProcessID', 'GetConnectionUnixUser',
    'xboks-keyring-', '/MainApplication', 'org.qtproject.Qt.QCoreApplication',
    'keyring_session_stop_private_bus_never_quits_a_replacement_owner',
    'keyring_session_stop_private_bus_rejects_foreign_pid_uid_and_cgroup',
    'keyring_session_stop_private_bus_bounds_unresponsive_and_nonexiting_providers',
    'keyring_session_stop_rejects_unmanaged_process_before_connecting_to_user_bus']) assert.ok(patch.includes(text), text);
  assert.doesNotMatch(patch, /^\+.*(?:GetSecret|SearchItems|CreateCollection|SetSecret|closeAllWallets|ensure_device_credentials\(|https:\/\/)/m);
  const build = await fs.readFile('scripts/build-backend.mjs', 'utf8');
  assert.ok(build.includes("'keyring_session_', '--', '--test-threads=1'"));
  assert.ok(build.includes("'keyring-session-stop'"));
});

test('optional KWallet persistence uses own watched session without locking or stopping other providers', async () => {
  const lock=JSON.parse(await fs.readFile('assets/backend-source.lock.json','utf8'));
  assert.ok(lock.patches.some(p=>p.file==='xodus-keyring-persistence.patch'));
  const patch=await fs.readFile('assets/xodus-keyring-persistence.patch','utf8');
  for(const name of ['genuine_ksecret','prompt_is_disabled','openAsync','message.set_no_reply(true)',
    'keyring_persistence_private_bus_foreign_and_absent_provider_are_untouched',
    'keyring_persistence_private_bus_no_creation_unlock_or_extra_authorization',
    'keyring_persistence_private_bus_replacement_or_lock_race_releases_only_own_handle',
    'keyring_persistence_private_bus_timeout_denial_and_foreign_signal_never_sync']) assert.ok(patch.includes(name),name);
  assert.doesNotMatch(patch,/^\+.*(?:"GetSecret"|"SearchItems"|"Unlock"|"Lock"|"quit"|"CreateCollection"|"pamOpen"|closeAllWallets|FDO_APPID)/m);
  const build=await fs.readFile('scripts/build-backend.mjs','utf8');
  assert.ok(build.includes("'keyring_persistence_', '--', '--test-threads=1'"));
});
