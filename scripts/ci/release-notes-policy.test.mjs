import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { releaseNotesRef, assertApprovedReleaseNotes } from './release-notes-policy.mjs';
const commit = 'a'.repeat(40), notes = '# Release\n\nReviewed notes.\n';
const approval = { notesSha256: createHash('sha256').update(notes).digest('hex') };
test('digest-approved notes use promotion metadata for every component without rebuilding', () => {
  for (const kind of ['launcher', 'backend', 'runtime']) {
    assert.equal(releaseNotesRef(kind, commit, approval), 'HEAD');
    assert.doesNotThrow(() => assertApprovedReleaseNotes(notes, approval));
  }
});
test('older approvals retain their original notes source', () => {
  for (const kind of ['launcher', 'backend']) assert.equal(releaseNotesRef(kind, commit, {}), commit);
  assert.equal(releaseNotesRef('runtime', commit, {}), 'HEAD');
  assert.doesNotThrow(() => assertApprovedReleaseNotes(notes, {}));
});
test('edited, empty or malformed approved text fails closed', () => {
  assert.throws(() => assertApprovedReleaseNotes(`${notes}Extra text.`, approval));
  for (const value of ['', '   ', undefined]) assert.throws(() => assertApprovedReleaseNotes(value, approval));
  for (const digest of [null, false, 1, '', 'g'.repeat(64), 'a'.repeat(63)]) {
    assert.throws(() => releaseNotesRef('launcher', commit, { notesSha256: digest }));
    assert.throws(() => assertApprovedReleaseNotes(notes, { notesSha256: digest }));
  }
});
test('invalid component or candidate selection is rejected', () => {
  assert.throws(() => releaseNotesRef('other', commit, approval));
  assert.throws(() => releaseNotesRef('launcher', 'main', approval));
});
