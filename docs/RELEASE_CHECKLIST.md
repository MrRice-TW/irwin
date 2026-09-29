# First-release acceptance checklist

Use one copy of this record per target platform and release candidate. Do not mark a platform supported until its native checks pass. Use disposable MongoDB data only.

Before publishing any public release:

- [ ] Use GitHub Releases for direct downloads; no application-store submission is required. State that this Preview has no trusted publisher signing or Apple notarization, and provide checksums and platform test results.
- [ ] Follow [the installation guide](INSTALLATION.md); publish downloads only after the exact target passes its native acceptance checks.
- [ ] Confirm the repository has an active maintainer contact for conduct and security reports.
- [ ] Enable GitHub private vulnerability reporting or publish a monitored security contact in `SECURITY.md`.
- [ ] Confirm the private conduct contact in `CODE_OF_CONDUCT.md` is monitored and accessible from the repository documentation.
- [ ] Run `pnpm release:licenses`, review the generated full production dependency inventory and missing-license report, and confirm the files are inside the installer alongside the bundled-tool notices.
- [ ] Confirm `license-review.txt` reports no unresolved packages for each platform's production dependency tree. Do not publish a target while a package has missing license metadata or missing license/notice text.
- [ ] Confirm the release notes describe only validated platforms and link to artifacts that actually exist.

## Candidate identity

- Irwin version:
- Git commit:
- CI run or local build host:
- Test date:
- Operating system and exact version:
- Architecture:
- Installer filename and byte size:
- Installer SHA-256:
- Database Tools version:
- Signature / publisher / notarization / first-download OS prompt result (unsigned Preview is permitted):

## Shared desktop checks

- [ ] Install using the documented user-facing method.
- [ ] Launch from the normal application launcher without a development terminal.
- [ ] Confirm the app version and that the UI opens without a blank screen or startup error.
- [ ] Connect to a disposable local MongoDB instance and run a read query.
- [ ] Create or edit a disposable test document, verify the result, and remove test data.
- [ ] Export a small test collection and confirm the file can be read back.
- [ ] Configure one supported cloud provider and one local OpenAI-compatible service; verify the connection test reports chat and query-draft capability separately.
- [ ] With disposable MongoDB data, verify query drafting, clarification, approved same-database `$lookup`, value redaction, Explain citations, cancellation, and that applying a draft never executes it.
- [ ] With a disposable Cosmos DB for MongoDB connection, verify find drafting works and aggregation / Explain assistance stays unavailable.
- [ ] Quit normally, relaunch, and confirm expected local preferences persist.
- [ ] If an earlier installable candidate exists, upgrade from it and confirm user data is preserved; otherwise record this check as not applicable for the first release.
- [ ] Uninstall and record whether user data is retained or removed, matching the documented behavior.
- [ ] Attach sanitized screenshots and relevant logs; remove credentials, hostnames, and user data.

## Windows 11 x64

- [ ] Install the NSIS package on a clean user account or VM.
- [ ] Record the Authenticode publisher and signature status of the installer and installed executable. `NotSigned` is expected for an unsigned Preview; confirm the release notes agree.
- [ ] Download the exact candidate through a browser and verify checksum, SmartScreen prompts, and the documented per-installer launch flow. Record if device policy blocks it; do not disable protection globally.
- [ ] Launch from Start Menu and verify the expected application icon and shortcuts.
- [ ] If an earlier installable candidate exists, upgrade from it and check connection profiles and preferences; otherwise record not applicable for the first release.
- [ ] Uninstall and record app-data behavior.

## Ubuntu Desktop x64

- Ubuntu release and desktop session:
- [ ] Install the `.deb` using the documented package-manager command.
- [ ] Verify required system dependencies resolve without manual library copying.
- [ ] Launch from the desktop application menu, not only from a shell.
- [ ] Check application icon, windowing, clipboard, file dialogs, and secure credential storage behavior.
- [ ] If an earlier installable candidate exists, upgrade from it and check connection profiles and preferences; otherwise record not applicable for the first release.
- [ ] Uninstall and record app-data behavior.

## macOS 14+ Intel and Apple Silicon

- Mac model / architecture:
- [ ] Install the matching DMG build and move the app to Applications.
- [ ] Record code-signing identity and notarization status. The absence of Developer ID signing and notarization is allowed by the Preview policy; do not describe ad-hoc signing as a verified publisher.
- [ ] Download the matching DMG through a browser and verify its checksum and Gatekeeper behavior, including the documented per-app **Open Anyway** flow. A locally compiled app is not evidence for this downloaded-artifact check.
- [ ] Confirm the process runs at the expected native architecture.
- [ ] Check menu bar behavior, file dialogs, clipboard, and secure credential storage.
- [ ] If an earlier installable candidate exists, upgrade from it and check connection profiles and preferences; otherwise record not applicable for the first release.
- [ ] Uninstall and record app-data behavior.
- [ ] Before local multi-architecture packaging, run `pnpm tools:fetch mac-x64` and `pnpm tools:fetch mac-arm64`; preflight must report both architecture bundles.

## Decision

- [ ] Mark this exact OS version and architecture as validated in `docs/COMPATIBILITY.md`.
- [ ] Attach installer hash, signature evidence, test date, and sanitized results to the GitHub release.
- [ ] Leave the platform marked pending if any required check could not be completed.
