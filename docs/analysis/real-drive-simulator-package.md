# Real Drive Simulator package support

Real Drive Simulator (`9N4FM1CG341P`) is a Windows game. Its installation failure in XBOKS is a package-format limitation, not evidence that the product is console-only or an add-on.

## Official metadata

Checked anonymously on 2026-10-22, without signing in, downloading game content or acquiring a license:

- [Microsoft Store product](https://apps.microsoft.com/detail/9n4fm1cg341p?hl=en-US&gl=GR).
- [Microsoft DisplayCatalog, Greek market](https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=9N4FM1CG341P&market=GR&languages=en-US).
- [Microsoft DisplayCatalog, US market](https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=9N4FM1CG341P&market=US&languages=en-US).

Both catalog responses returned HTTP 200 and the following package fields:

| Field | Value |
| --- | --- |
| `ProductType` | `Game` |
| Publisher | Coton Studio |
| Package identity | `CotonStudio.RealDriveSimulator` |
| Package family | `CotonStudio.RealDriveSimulator_krfr0nem5wa2m` |
| `PackageFormat` | `MsixBundle` |
| `PlatformDependencies[].PlatformName` | `Windows.Universal` |
| `Architectures` | `x86`, `x64`, `arm64` |
| Maximum download size | 21,993,732 bytes |
| Maximum installed size | 30,580,736 bytes |
| `BundledSkus` | Empty |

The retail SKU (`0010`) and trial SKU (`0011`) reference the same package. Retail availability explicitly includes `Windows.Desktop` in `Conditions.ClientConditions.AllowedPlatforms`. This differs from the package's `Windows.Universal` dependency. A universal app bundle is not a Store edition bundle that can be followed to a separate MSIXVC game.

The package lists Microsoft.UI.Xaml 2.8, .NET Native 2.2 and VCLibs framework dependencies. Its `PackageDownloadUris` field is null. The separate investigation below obtained the actual bundle through Microsoft's FE3 service; it did not install or execute the game.

The regression fixture at `src/main/__fixtures__/real-drive-simulator.catalog.json` preserves selected, unchanged public fields from the GR response. Full-response SHA-256 values from this check:

- GR: `619cece1a507336fcb91f5e4260b7f7eebb2c8766604322339fea0cc9dda10eb`.
- US: `0d880eac94a0d8e5a9afd986aebc910d5eeabe8393bf80a063b64053a8b2a375`.

## Current engine boundary and corrected diagnosis

The bundled engine's public, read-only command:

```sh
assets/social-backend/xboks-engine resolve-package 9N4FM1CG341P --json --market GR
```

returned one `Game` choice with `platform: "Windows.Universal"`, `packageFormat: "MSIXBUNDLE"`, `supported: false`, and overall `status: "unavailable"`. The native package selector and `src/main/install-plan.ts` accept only `Windows.Desktop` MSIXVC choices as supported. Changing a catalog flag would not implement an app-bundle installer or its framework/runtime requirements.

Previously, `src/main/catalog.ts` collected only `Windows.Desktop` packages. It ignored this universal package and fell through to the generic “may be an add-on or console-only product” diagnostic. The catalog now preserves the actual universal format and explains that UWP/MSIX app installation and launch are unsupported. A `Windows.Universal` MSIXVC entry also receives an explicit unsupported platform diagnosis; its format alone does not enable installation. An independently verified `Windows.Desktop` MSIXVC package still takes precedence.

The engine capability and install-plan guards remain unchanged. This change corrects the diagnosis; it does not add UWP/MSIX support. A future implementation needs to integrate the verified delivery path below, architecture selection, dependency handling, package activation/launch integration and real compatibility tests before enabling installation.

Validation covers the real product fixture, universal MSIXVC rejection, Desktop MSIXVC precedence and console-package separation, together with the existing catalog and install-plan suites. No account, game content, prefix or installation was modified.

## Actual package inspection

The subsequent static investigation downloaded the unchanged, clear MSIX bundle into ignored local research storage. It used no account token, license acquisition or game execution. The downloaded bundle's SHA-256 matches `Properties.Packages[].Hash` from Microsoft's HTTPS DisplayCatalog response; its SHA-1 and byte count also match FE3 metadata.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Official neutral MSIX bundle | 21,993,732 | `67e7682bf1b5dcb677200b307e62e33610c72d22a0e9d48481beb53f2b94c533` |
| Unchanged x64 package inside the bundle | 7,568,924 | `bab9d000469771f3064baea40f995cf78ac7c05b7cd5cc36f1c0ef65e64e2200` |
| x64 application executable | 18,944 | `a0a7c97369af63dfff02979fb5e761c67b0aead4959e24e659698173523fffe3` |
| x64 application DLL | 18,023,424 | `fc11f920c790d97c9fd2e18515ffcf6be54ee12c8ee20389262a1167c18eb150` |

The outer bundle contains x86, x64 and ARM64 application packages, plus scale-100/125/150 resource packages. The x64 package contains 35 ZIP members, totaling 19,970,804 uncompressed bytes. Its `AppxBlockMap.xml` hashes validate for all 31 listed files and 329 blocks. The package contains a publisher signature and Microsoft Marketplace certificate chain. OpenSSL verifies its PKCS#7 signature mathematically with certificate-chain verification disabled; its generic chain validator rejects an unhandled Microsoft critical extension. This is not a completed Windows AppX trust/registration verification.

The x64 manifest establishes the activation model:

- Foundation namespace: `http://schemas.microsoft.com/appx/manifest/foundation/windows10`.
- Application ID: `App`; executable: `Real Drive Simulator.exe`; entry point: `Real_Drive_Simulator.App`.
- No full-trust entry point, `runFullTrust` capability or explicit `RuntimeBehavior`/`TrustLevel` attributes.
- Target family `Windows.Universal`, minimum Windows version `10.0.17763.0`, maximum tested `10.0.22621.0`.
- Microsoft.UI.Xaml 2.8, Microsoft.NET.Native.Framework/Runtime 2.2 and both VCLibs framework dependencies.
- Build metadata identifies the .NET Native `ilc.exe` optimizing toolchain. XAML metadata includes `Windows.UI.Xaml.Application` and page/control types.
- In-process WinRT class registrations include `Microsoft.Web.WebView2.Core` and Vungle SDK classes. The package contains WebView2 loader/Core binaries; this does not establish which content or features execute at runtime.

Microsoft documents a class entry point other than the two reserved full/partial-trust entries as UWP `windowsApp` activation. See [Application activation attributes](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-f-application) and [Microsoft's packaged-process explanation](https://devblogs.microsoft.com/insidemsix/types-of-packaged-applications/). This package is a genuine UWP/.NET Native application, rather than a packaged full-trust Win32 game.

Both inspected PE images target AMD64 and set `DllCharacteristics=0x9160`, including the `0x1000` AppContainer flag defined in Microsoft's [PE format specification](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format). The executable imports the application's DLL and `RHBinder__ShimExeMain`. The DLL imports `SharedLibrary.dll`, `mrt100_app.dll` and WinRT APIs including `RoGetActivationFactory`. Consequently, finding an `.exe` in the archive is insufficient evidence that direct Wine/Proton execution will support its activation, framework or UI requirements. No such execution was attempted in this static investigation.

## Verified official delivery path

The current engine's `packagespc/GetBasePackage` path is separate from standard Store app delivery. Microsoft's own [WinGet downloader](https://github.com/microsoft/winget-cli/blob/c1705493e948d1fac7354dbd2802cab0390b40db/src/AppInstallerCommonCore/MSStoreDownload.cpp) uses a product's `WuCategoryId` with the [Microsoft SFS client](https://github.com/microsoft/sfs-client/blob/e7050f1505917c92cca01a43afedbd11d3975cf7/client/src/details/SFSClientImpl.cpp). For this product, the anonymous `storeapps.api.cdp.microsoft.com` latest-version request returned HTTP 404. WinGet explicitly treats that SFS response as an unsupported package download, rather than proof that the product has no Windows package.

The FE3 route did work with an empty anonymous user ticket:

1. HTTPS `GetCookie` to `fe3.delivery.mp.microsoft.com/ClientWebService/client.asmx`: HTTP 200.
2. HTTPS `SyncUpdates`, restricted to the product's public `WuCategoryId`: HTTP 200, with the product bundle and framework metadata.
3. HTTPS `GetExtendedUpdateInfo2` on the same service's `/secured` endpoint, requesting only `FileUrl` for the returned update identity: HTTP 200.
4. Download the exact returned `.msixbundle` from Microsoft's `tlu.dl.delivery.mp.microsoft.com` CDN, then verify its size, catalog SHA-256 and FE3 digest before inspecting it.

FE3 returned an HTTP content URL. The investigation used that provider URL unchanged and anchored the downloaded bytes to the SHA-256 obtained through verified HTTPS; it did not disable TLS certificate verification. The Microsoft Update endpoint required the Microsoft Root Certificate Authority 2011, fetched from Microsoft's HTTPS PKI site and supplied only to this research process. No system trust store was changed.

The general message flow is specified by Microsoft's [MS-WUSP SyncUpdates documentation](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-wusp/d955e0d0-c51f-4407-a701-995828fd1031) and [update synchronization example](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-wsusod/637559b5-81a4-4ad4-af60-fb5129aa7d4e). A [pinned StoreLib protocol implementation](https://github.com/query-store-links/storelib_rs/tree/bd86e51a0f288ed0bb9799a59c343483d473fddf) was consulted privately; it is GPLv3 and its code/templates were not copied into the application. The Microsoft WinGet and SFS sources above are MIT licensed.

This proves anonymous delivery of this exact clear bundle and a concrete way to build a separate standard-package resolver. It does not prove a Store license, offline entitlement, successful registration, framework compatibility, launch or gameplay. Signed CDN URLs, cookies, package binaries and extracted game files remain outside Git.

The smallest useful implementation is a bounded, read-only MSIX/AppX inspector that identifies bundle architecture, validates package paths/limits, parses the manifest by namespace and distinguishes full-trust Win32 from UWP activation. Standard-package downloading/staging can then be added as a separate capability. Real Drive Simulator still needs runtime activation, .NET Native/XAML and dependency support before its Install/Play actions can be enabled truthfully; changing its metadata classification or extracting its executable does not supply those capabilities.
