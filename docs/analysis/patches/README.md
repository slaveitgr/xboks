# Wine-UWP research patches

The Wine source modifications in this directory's `*.patch` files are provided
under the **GNU Lesser General Public License, version 2.1 or, at your option,
any later version (LGPL-2.1-or-later)**. The complete version 2.1 license is in
[COPYING.LIB](COPYING.LIB). The repository's root MIT license does not relicense
these Wine modifications or the upstream code they modify.

Preserve the copyright and license notices already present in the patches and
affected source files. In particular, the MediaPlayer patch includes Wine
weak-reference helpers carrying **Copyright 2025 Zhiyi Zhang for CodeWeavers**
and their LGPL-2.1-or-later notice. The gaming-experience additions also declare
LGPL-2.1-or-later. These notices remain unchanged.

## Source provenance

The recorded experimental candidate uses:

- Wine revision `7298a818b79446bae153b8d5aa27235ab3703bf9`.
- The complete [designgears/wine-uwp overlay at
  `ac56cede08bbb99c5b88dd7b54e752f709cd6b47`](https://github.com/designgears/wine-uwp/tree/ac56cede08bbb99c5b88dd7b54e752f709cd6b47).
- The ten ordered patches listed in the
  [Xbox 2612 reproduction guide](../wine-uwp-client2612-reproduction.md).

The reproduction guide records application order, affected build targets,
independent probes and the boundary between tested results and unresolved
behavior. Individual investigation checkpoints retain the exact candidate
hashes and evidence references. These files are source changes for that pinned
experimental baseline, not a standalone runtime or a claim of general Windows
application compatibility.

No Microsoft application binaries, Windows component payloads, account stores,
prefixes, authentication logs or private account screenshots are included in
this patch directory. Any separately distributed runtime must retain the
applicable upstream notices and satisfy its corresponding-source requirements.
