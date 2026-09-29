# Irwin

[English](README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português](README.pt.md)

**A MongoDB desktop workspace for Windows, Ubuntu, and macOS.** Irwin is an MIT-licensed open-source project. Platform support remains in preview until the native installation checks in the [compatibility matrix](docs/COMPATIBILITY.md) are complete.

This English README is the reference for translations. The application currently offers English and Traditional Chinese; other guides are currently written in English or Traditional Chinese.

![Irwin workspace](docs/images/irwin-workspace.png)

## Platform status

| Platform                        | Current evidence                                                                                                                                                          | Status                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Windows 11 x64                  | A local unsigned candidate passes packaged desktop smoke. Clean-machine installation, first-download prompts, upgrade, and uninstall remain pending.                      | Preview                       |
| Ubuntu 24.04 x64                | Debian packaging is configured. Native Ubuntu Desktop install and launch have not been validated.                                                                         | Pending maintainer validation |
| Ubuntu 22.04 x64                | Targeted by the Linux build, but not validated on a native desktop.                                                                                                       | Not yet supported             |
| macOS 14+ Intel / Apple Silicon | The maintainer reports DMG installation and launch on an M3 MacBook Air. The exact macOS version and DMG identity, remaining workflows, and Intel acceptance are pending. | Partial native acceptance     |

Public installer downloads will be linked from GitHub Releases when a release is published. Irwin does not require installation through an application store. Preview installers will have no paid publisher signing or Apple notarization; the [installation guide](docs/INSTALLATION.md) explains checksum verification and expected first-launch prompts. The paths produced by local packaging commands are build outputs, not download links.

For version 0.1.0, the configured installer names are `Irwin-0.1.0-win-x64.exe`, `Irwin-0.1.0-linux-x64.deb`, `Irwin-0.1.0-mac-x64.dmg`, and `Irwin-0.1.0-mac-arm64.dmg`. These names describe build outputs; they are not published downloads.

## Features

- Manage MongoDB connections and explore collections in Table, Tree, and JSON views.
- Query and edit BSON-aware documents; use an isolated mongosh session per tab.
- Connect your own cloud or local LLM for query drafts and MongoDB Explain interpretation, with opt-in connections and context review. AI drafts never execute automatically; you review, apply, and run them yourself.
- Import and export JSON, JSONL, CSV, and BSON with progress, cancellation, and explicit safeguards for destructive operations.
- Keep connection profiles and preferences in local SQLite storage. Saved secrets use the operating system encryption backend; if secure storage is unavailable, secrets are kept for the current session only.

See the [user guide](docs/USER_GUIDE.md) for workflows and limitations.

## Install Irwin

See the [installation guide](docs/INSTALLATION.md) for Windows, Ubuntu, and macOS instructions. Public installers are not available yet; platform status and pending native checks are listed in the [compatibility matrix](docs/COMPATIBILITY.md).

## Build from source

Prerequisites: Node.js 24, pnpm 11.1.0, and a native Windows, Linux, or macOS development environment. Build installers on the operating system they target. The configured targets are Windows x64, Ubuntu/Debian x64, and macOS 14+ x64/arm64.

```sh
git clone https://github.com/piayru/irwin.git
cd irwin
pnpm install --frozen-lockfile
node node_modules/electron/install.js
pnpm tools:fetch
pnpm dev
```

`pnpm tools:fetch` downloads MongoDB Database Tools for the current platform and verifies the archive against the SHA-256 value in `vendor/tools-manifest.json`.

macOS packaging creates both Intel and Apple Silicon DMGs, so stage both tool bundles first with `pnpm tools:fetch mac-x64` and `pnpm tools:fetch mac-arm64`. The packaging preflight checks both architectures.

Irwin is distributed as a desktop application, not as an npm package. The package metadata keeps npm publishing disabled as a safeguard; the source repository is licensed by the root `LICENSE` file.

## Checks and packaging

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm package --publish never
pnpm release:verify
```

`pnpm test` starts disposable MongoDB 8.0.18 test processes and writes to dedicated test databases. Never point test URIs at production. Integration tests need network access to obtain the MongoDB test binary. Desktop and installer acceptance still requires the native manual checks in [the release checklist](docs/RELEASE_CHECKLIST.md); CI checks do not replace those checks.

## Project documentation

- [Documentation index](docs/README.md)
- [Install Irwin](docs/INSTALLATION.md)
- [Compatibility and validation status](docs/COMPATIBILITY.md)
- [Architecture and security boundaries](docs/ARCHITECTURE.md)
- [Release and platform acceptance checklist](docs/RELEASE_CHECKLIST.md)
- [Testing guide](docs/TESTING.md)
- [Local data and credential storage](docs/USER_GUIDE.md#連線)
- [Contributing](CONTRIBUTING.md)
- [Security reporting](SECURITY.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Changelog](CHANGELOG.md)

Irwin is an independent project and is not an official MongoDB product. MongoDB, mongosh, and MongoDB Database Tools remain subject to their respective names and licenses.
