import { createHash } from 'node:crypto';

function notesDigest(approval) {
  const digest = approval?.notesSha256;
  if (digest !== undefined && (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)))
    throw Error('Invalid approved release notes checksum');
  return digest;
}

export function releaseNotesRef(kind, candidateCommit, approval) {
  if (!['launcher', 'backend', 'runtime'].includes(kind) || !/^[a-f0-9]{40}$/.test(candidateCommit ?? ''))
    throw Error('Invalid release notes selection');
  // New approvals bind reviewed text in the promotion commit independently of
  // the original artifact. Older approvals retain their existing note source.
  return notesDigest(approval) || kind === 'runtime' ? 'HEAD' : candidateCommit;
}

export function assertApprovedReleaseNotes(notes, approval) {
  const digest = notesDigest(approval);
  if (typeof notes !== 'string' || !notes.trim()) throw Error('Release notes are empty');
  if (digest && createHash('sha256').update(notes).digest('hex') !== digest)
    throw Error('Release notes differ from the approved text');
}
