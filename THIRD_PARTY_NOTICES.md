# Third-party notices

XBOKS is an independently maintained Linux application. Project branding and
features do not replace the licenses or authorship of incorporated software.

## Launcher foundation

The launcher includes code derived from
[Xodus Nexus](https://github.com/domsvoboda/xodus-nexus), licensed under the MIT
license. The original copyright notice and complete permission text remain in
[LICENSE](LICENSE), together with the notice for XBOKS contributions.

## Engine and compatibility runtime

The Engine incorporates [Xodus](https://github.com/xodus-gaming/xodus) and
project-maintained patches. Its GPL-3.0 license and dependency notices remain
with the source and distributed Engine artifacts. The build recipe produces
matching corresponding-source archives, ordered patch checksums and manifests.

Wine, Proton, DXVK, compatibility libraries and their dependencies retain their
own licenses and copyright notices. Their locked sources, patches and packaging
recipes are recorded under `assets/` and `scripts/`. Runtime and optional Engine
companion packages include the relevant licenses and source material; the
launcher's MIT license does not relicense those components.

Private protocol names, saved-data compatibility keys and immutable source
identifiers may retain their historical spelling so that existing accounts,
licenses, saves and runtimes remain compatible.

## Other components and reference material

React, Electron, Lucide and other dependencies retain their respective licenses.
[OpenXbox](https://github.com/OpenXbox) projects are primary references for
implemented service contracts; incorporated code retains its applicable notice.

Store/catalog artwork, external service marks and locally supplied reference
fonts/icons remain subject to their respective owners' terms. Private extracted
Windows application packages and account diagnostics are not published as
project source. The XBOKS logo was supplied by the repository owner.

XBOKS is not affiliated with or endorsed by Microsoft or Xbox.

## Cloud offering login compatibility

The fixed optional country-hint mapping was obtained from
[Better xCloud](https://github.com/redphx/better-xcloud/tree/f8397043f6d2148d2345d508902a38c69cf1ee20),
revision `f8397043f6d2148d2345d508902a38c69cf1ee20`, under the MIT license.
The applicable copyright and permission text is retained in
[assets/licenses/better-xcloud.txt](assets/licenses/better-xcloud.txt).
XBOKS implements its own narrow login-header helper; it does not load the
userscript, its network interception layer, its UI, or its assets.

## Cloud WebRTC player

The renderer includes [xbox-xcloud-player 0.2.11](https://github.com/unknownskl/xbox-xcloud-player/tree/34775ed5c4bd85c54a3d50293cd6e1be67675e23), whose package metadata declares the MIT license and author Jim Kroon (UnknownSKL). The pinned package has no separate LICENSE file; its author/license declaration and MIT terms are retained in [assets/licenses/xbox-xcloud-player.txt](assets/licenses/xbox-xcloud-player.txt). XBOKS uses its media/data-channel transport with an application-owned input lifecycle and main-process signaling. The browser EventEmitter dependency retains its notice in [assets/licenses/events.txt](assets/licenses/events.txt).

[Greenlight](https://github.com/unknownskl/greenlight) and [XStreamingDesktop](https://github.com/Geocld/XStreamingDesktop) are MIT-licensed protocol references; their complete applications and user interfaces are not bundled in XBOKS. The cloud reference chapter records the inspected source revisions.

The Home streaming Teredo-to-IPv4 candidate strategy follows
[Greenlight's desktop signaling helper](https://github.com/unknownskl/greenlight/blob/ef852c3b90292def435c8c877feeb1aeaefd8a33/packages/desktop/main/helpers/xcloudapi.ts)
at revision `ef852c3b90292def435c8c877feeb1aeaefd8a33`. XBOKS independently
decodes the address format from RFC 4380 and adds bounded candidate validation
and deduplication. Greenlight's complete MIT notice is retained in
[assets/licenses/greenlight.txt](assets/licenses/greenlight.txt).
