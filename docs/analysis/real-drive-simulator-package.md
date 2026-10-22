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

The package lists Microsoft.UI.Xaml 2.8, .NET Native 2.2 and VCLibs framework dependencies. Its `PackageDownloadUris` field is null. These observations do not prove that the Windows package cannot be obtained through another official delivery flow or that it will run under Wine; neither was tested.

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

The engine capability and install-plan guards remain unchanged. This change corrects the diagnosis; it does not add UWP/MSIX support. A future implementation needs a separate official package-delivery path, architecture selection, dependency handling, package activation/launch integration and real compatibility tests before enabling installation.

Validation covers the real product fixture, universal MSIXVC rejection, Desktop MSIXVC precedence and console-package separation, together with the existing catalog and install-plan suites. No account, game content, prefix or installation was modified.
