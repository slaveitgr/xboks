// Exclude only checkout-local build metadata, never same-named dependency source.
export function backendSourceArchiveArgs(archive, work) {
  return ['--anchored', '--exclude=source/.git', '--exclude=source/target', '-cJf', archive, '-C', work, 'source', 'recipe'];
}
