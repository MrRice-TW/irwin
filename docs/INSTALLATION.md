# Install Irwin

Irwin is distributed through GitHub Releases using direct installer downloads, not application stores. No public downloads have been published yet. The names below describe configured build outputs; the Windows candidate and macOS/Ubuntu installers still need the native installation checks listed in the [compatibility matrix](COMPATIBILITY.md).

The Preview release policy is to ship without a paid publisher certificate or Apple notarization. Each release must state this clearly, include SHA-256 checksums, and identify the tested operating systems and architectures. Signing can be added later without moving distribution to a store. Download both the installer and its checksum from the project's own GitHub Release; a matching checksum confirms the file matches that release, but does not replace publisher verification.

## Check for and install updates

Click the version number at the bottom of Irwin's sidebar to check GitHub Releases. Packaged Windows and Ubuntu builds download a newer release in the background; Irwin waits for you to choose **Restart and install**. Installing a Linux `.deb` may open a system authentication prompt. Unsigned macOS builds can check for a release and open its download page, but must be updated by downloading the DMG and replacing Irwin in **Applications**. macOS in-app installation requires signed builds, which this Preview does not provide.

The first release that includes the updater cannot update installations that predate this feature. Install that release manually once; later Windows and Ubuntu releases can use in-app updates. Release metadata and the installer it references must be published together in the same public GitHub Release (`latest.yml` for Windows and `latest-linux.yml` for Ubuntu). A local build made with `--publish never` is for validation and does not publish update metadata. See the [release checklist](RELEASE_CHECKLIST.md) before publishing an update.

## Windows 11 x64

When a validated release is available, download `Irwin-<version>-win-x64.exe` and its checksum file from that release. Verify the checksum, then run the installer and follow its prompts. Unsigned Preview installers can display **Unknown publisher** and **Windows protected your PC**. If the file matches the trusted release and Windows offers the option, choose **More info → Run anyway** for this installer. Do not change system-wide protection settings. Smart App Control or an organization's policy may block unsigned applications without offering this option; use a machine permitted by that policy or ask its administrator.

See Microsoft's [SmartScreen guidance for application developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation) for unsigned applications and policy restrictions. Signing a future release does not guarantee that a new installer immediately has SmartScreen reputation.

To verify the checksum in PowerShell, compare this output with the value published beside the installer:

```powershell
Get-FileHash .\Irwin-<version>-win-x64.exe -Algorithm SHA256
```

Install a newer release over the existing version to upgrade. Uninstall from **Settings → Apps → Installed apps**. Removing the application does not automatically erase Irwin's local user-data directory; back up or remove that directory separately only if you intend to delete saved profiles and workspace data.

## Ubuntu 24.04 x64

When a validated release is available, download `Irwin-<version>-linux-x64.deb` and its checksum file. Verify the checksum, then install the local package:

```sh
sha256sum Irwin-<version>-linux-x64.deb
sudo apt install ./Irwin-<version>-linux-x64.deb
```

Launch Irwin from the desktop application menu. Install a newer `.deb` the same way to upgrade. To uninstall the application while keeping its user data, run `sudo apt remove irwin`.

## macOS 14 or later

Choose `Irwin-<version>-mac-arm64.dmg` for Apple Silicon or `Irwin-<version>-mac-x64.dmg` for Intel. Verify the published SHA-256 value, open the DMG, and drag Irwin into **Applications**. Eject the mounted installer when copying finishes.

Preview builds have no Developer ID publisher identity or notarization. macOS may report that the developer cannot be verified or that Apple cannot check the app. After attempting to open the copied app, if you trust the matching GitHub Release, go to **System Settings → Privacy & Security → Open Anyway**, then confirm **Open**. This creates an exception for this app. The option can be unavailable on a managed Mac. Follow Apple's [instructions for opening downloaded apps](https://support.apple.com/en-us/102445); do not disable Gatekeeper or remove quarantine attributes globally. An alert that the app contains malware or is damaged is not the expected unidentified-developer prompt: stop and report it rather than bypassing that alert.

To verify a checksum in Terminal:

```sh
shasum -a 256 Irwin-<version>-mac-arm64.dmg
```

Install a new DMG over the existing app to upgrade. To uninstall, quit Irwin and remove it from **Applications**. Application data is stored separately in the macOS user-data directory, so deleting the app does not necessarily erase saved profiles or workspace data.

## Keep or remove local data

Irwin stores profiles, preferences, query history, and workspace state in `workbench.sqlite`. The default user-data directory is `%APPDATA%\Irwin` on Windows, `~/Library/Application Support/Irwin` on macOS, and `${XDG_CONFIG_HOME:-~/.config}/Irwin` on Ubuntu. Uninstalling the program is intended to leave this directory in place. Quit Irwin before backing it up or manually removing it; confirm that it contains no data you need before deleting it. Connection secrets are encrypted with the operating system's secure-storage service when available; on systems without that service, secrets stay in memory only until Irwin closes.

## Build from source

Use Node.js 24 and pnpm 11.1.0 on the native target operating system. Clone the repository, then install the pinned dependencies and Electron runtime:

```sh
git clone https://github.com/piayru/irwin.git
cd irwin
node --version
corepack enable
corepack prepare pnpm@11.1.0 --activate
pnpm --version
pnpm install --frozen-lockfile
node node_modules/electron/install.js
```

The version checks must report Node.js `v24.x.x` and pnpm `11.1.0`. If you use nvm, the repository's `.nvmrc` lets you prepare the required runtime with `nvm install` followed by `nvm use`. Do not continue a release build with a different Node.js or pnpm major version just because dependency installation only produced a warning.

On Windows or Ubuntu, fetch the matching Database Tools and build the native package:

```sh
pnpm tools:fetch
pnpm release:preflight
pnpm package --publish never
pnpm release:verify
```

macOS produces both Intel and Apple Silicon packages. Download and verify both Database Tools bundles before packaging:

```sh
pnpm tools:fetch mac-x64
pnpm tools:fetch mac-arm64
pnpm release:preflight
pnpm package --publish never
node scripts/verify-package.mjs --unpacked release/mac/Irwin.app
node scripts/verify-package.mjs --unpacked release/mac-arm64/Irwin.app
```

Successful packaging writes `release/Irwin-<version>-mac-arm64.dmg` and `release/Irwin-<version>-mac-x64.dmg`. The verification commands must both report `PASSED`; a generated DMG is not release-ready when verification reports diagnostics.

### macOS source-build troubleshooting

- `ERR_PNPM_IGNORED_BUILDS` naming `macos-export-certificate-and-key` means pnpm did not receive a valid build-policy decision. Irwin's current dependency policy intentionally skips this optional native build with `macos-export-certificate-and-key: false` in `pnpm-workspace.yaml`. Do not commit pnpm's temporary `set this to true or false` placeholder, and do not approve the native build merely to make installation continue.
- The certificate helper is part of the MongoDB shell's `system-ca` dependency and reads trusted CA certificates from the macOS Keychain. It is unrelated to application code signing or notarization. Because Irwin skips its native build, private-CA MongoDB deployments must explicitly select their CA certificate file in the connection settings instead of relying on automatic Keychain CA discovery. Check both the collection workspace and mongosh connection with that configuration.
- `TOOLS_MISSING` from `pnpm release:preflight` means one or both Database Tools bundles have not been staged. On macOS, fetch both `mac-x64` and `mac-arm64` even when the build host has only one of those architectures.
- electron-builder's message that macOS application code signing was skipped is expected for an unsigned Preview. It is not a successful signing or notarization result, and the resulting app still requires the documented Gatekeeper exception when downloaded.
- A `LICENSES_PENDING_REVIEW` package-verification result is a release blocker, not a build warning to ignore. Add pinned license evidence under `vendor/license-evidence`, regenerate the inventory, rebuild the package, and rerun both unpacked-app verification commands.

Local package output is unsigned unless the maintainer configures platform signing. A package build does not count as native installation validation. See the [compatibility matrix](COMPATIBILITY.md) and [release checklist](RELEASE_CHECKLIST.md) before distributing an installer.

For a public release with in-app updates, build each supported target with the configured GitHub publisher (`pnpm package --publish always`) from a maintainer environment with `GH_TOKEN` set. This uploads installers and updater metadata to GitHub Releases; it does not submit the app to a store. Keep the release public and ensure all platform installers and generated metadata refer to the same version. Do not use this command for local validation.

There is currently no published Homebrew tap, winget manifest, or hosted APT repository. The commands above install a downloaded `.deb` or build from source; do not use guessed package-manager names to install Irwin.
