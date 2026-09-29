# Compatibility and validation status

Last reviewed: 2026-09-29. A configured build target is not a promise of native desktop support. The maintainer will complete the manual acceptance checklist before changing a platform to **Validated**.

## Desktop operating systems

| Platform / architecture         | Packaging target      | Native install and launch                                                                                                                                                                                                       | Current status                           |
| ------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Windows 11 x64                  | NSIS installer        | The local unsigned candidate passes package verification and 59 packaged desktop checks, with no unresolved installed dependency notices. Clean-machine install, first-download prompts, upgrade, and uninstall remain pending. | Preview candidate; native checks pending |
| Ubuntu 24.04 x64                | Debian package        | No native Ubuntu Desktop acceptance recorded. WSL or container checks do not count as desktop validation.                                                                                                                       | Pending maintainer validation            |
| Ubuntu 22.04 x64                | Debian package target | No native desktop acceptance recorded.                                                                                                                                                                                          | Not validated                            |
| macOS 14+ x64 (Intel)           | DMG target            | No DMG installation or native desktop acceptance recorded.                                                                                                                                                                      | Not validated                            |
| macOS 14+ arm64 (Apple Silicon) | DMG target            | Maintainer reports DMG installation and launch on an M3 MacBook Air; exact macOS version, DMG architecture/hash, Gatekeeper steps, and remaining workflows were not recorded.                                                   | Partial native acceptance                |

The configured package targets are Windows x64, Linux x64 `.deb`, and macOS x64/arm64 `.dmg`, distributed as direct GitHub downloads. Preview releases do not require paid signing or store enrollment. Linux packaging metadata alone does not establish compatibility with every Ubuntu release or desktop environment. macOS release readiness requires recording signature/notarization status and checking Gatekeeper behavior for the exact downloaded artifact, including the per-app launch exception when appropriate.

On 2026-09-29 the maintainer confirmed successful DMG installation and launch on an M3 MacBook Air (Apple Silicon). The exact macOS version, DMG filename and hash, running process architecture, and first-launch Gatekeeper steps were not provided. This records native DMG installation and launch on that hardware; it does not establish validation of both DMG architectures or the remaining database, upgrade, uninstall, and desktop workflows.

On 2026-09-29 a local Windows candidate passed package verification and all 59 packaged desktop checks, with no reported errors or unverified checks. The installer and bundled executable are unsigned. The automated suite at that build passed 234 tests across 58 files, including XLSX read-back, mongosh SRV/TXT resolution, production-license inventory, and normal GUI shutdown. These checks use disposable MongoDB data and do not establish clean-machine installation or downloaded-installer prompt behavior.

### Local candidate evidence

This candidate is retained locally and has not been published. It predates subsequent repository metadata, build-tool, UI, and source organization changes. Build a new candidate from the source to be released and record its Git commit and checksums before distributing it.

| Item              | Recorded value                                                                 |
| ----------------- | ------------------------------------------------------------------------------ |
| Date / build host | 2026-09-29; Windows x64, OS build `10.0.26200.0`                               |
| Installer         | `Irwin-0.1.0-win-x64.exe`; 251,715,485 bytes                                   |
| SHA-256           | `0098a31ea0928a7ac48a2bc50561f5b2a4fdc6ec4b2c38e0bb83f0bc348bcbd5`             |
| Runtime / tools   | Node 24.14.0; Electron 44.3.0; MongoDB Database Tools 100.18.0                 |
| Signing           | Installer and bundled executable: `NotSigned`                                  |
| Package checks    | No package verification diagnostics or unresolved installed dependency notices |
| Desktop checks    | 59 passed; no reported errors or unverified checks                             |

Installer commands, architecture selection, upgrades, and uninstall behavior are documented in the [installation guide](INSTALLATION.md). Public downloads are not currently published. Each target requires its native acceptance checks before release.

## MongoDB and service compatibility

| Service / feature     | Evidence and limits                                                                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MongoDB 8.0.18        | Local MongoDB integration and desktop tests recorded.                                                                                                                                                                                         |
| MongoDB 6.0 / 7.0     | Compatibility is a goal; full integration suite not run against these versions.                                                                                                                                                               |
| Atlas / `mongodb+srv` | URI and driver paths are implemented; no dedicated Atlas account acceptance recorded. Atlas user and role management is not provided by this application.                                                                                     |
| Replica set           | Single-node discovery and reconnect checked; cross-host elections not checked.                                                                                                                                                                |
| `mongos`              | Standard driver connection path; no real sharded cluster acceptance recorded.                                                                                                                                                                 |
| TLS / SSH             | Local checks cover trusted and invalid TLS cases, SSH passwords and encrypted keys, host-key fingerprints, and SSH plus TLS hostname validation. X.509 client certificate login is not fully validated.                                       |
| Cosmos DB for MongoDB | Provider, partition-key mapping, and documented capability restrictions are implemented; no live account acceptance recorded. User and role management uses Azure administration. BSON restore and SSH+TLS Database Tools paths are disabled. |

For detailed service constraints, see the [user guide](USER_GUIDE.md) and the [MongoDB compatibility references](https://www.mongodb.com/docs/database-tools/mongorestore/mongorestore-compatibility-and-installation/) and [Cosmos API support matrix](https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/feature-support-70).

## What counts as validation

Mark a desktop target **Validated** only after the maintainer records the native OS version and architecture, installer name and SHA-256, installation and first launch, core database workflow against disposable test data, upgrade behavior, uninstall behavior, and signing/Gatekeeper results where applicable. Use [the release checklist](RELEASE_CHECKLIST.md) and keep the evidence with the release.

Application-level tests and CI builds are useful checks, but do not replace installation and GUI acceptance on the target operating system.
