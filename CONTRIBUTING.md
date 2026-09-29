# Contributing to Irwin

Thanks for considering a contribution. Please open an issue first for substantial changes so maintainers can agree on the problem and scope before implementation.

## Development environment

- Node.js 24
- pnpm 11.1.0
- A native development environment for the operating system you are working on
- Network access for package downloads and the MongoDB test binary

Clone the repository and prepare the development environment:

```sh
git clone https://github.com/piayru/irwin.git
cd irwin
pnpm install --frozen-lockfile
node node_modules/electron/install.js
pnpm tools:fetch
pnpm dev
```

`pnpm tools:fetch` downloads the pinned MongoDB Database Tools for the current platform and verifies the archive SHA-256 from `vendor/tools-manifest.json`.

## Before opening a pull request

Run the checks relevant to your change:

```sh
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` starts a disposable MongoDB 8.0.18 process and creates, changes, and removes data in its dedicated `workbench_test` database. Never point the test suite at a production URI. Do not include real connection strings, credentials, private keys, database exports, generated installers, or `.runtime` data in a contribution. The certificate and key under `tests/fixtures` are intentionally public test fixtures and must never be used for a live service.

Follow the existing TypeScript and formatting conventions. Keep changes focused, explain user-visible behavior and safety implications, and add or update documentation for changed workflows. For UI changes, include screenshots at the relevant window size and theme. Do not describe a platform as supported based only on a successful compile; native install and launch evidence belongs in the [compatibility matrix](docs/COMPATIBILITY.md).

The [testing guide](docs/TESTING.md) describes additional Electron scenarios and the optional transfer benchmark. Keep generated QA reports, screenshots, task plans, and local onboarding notes in ignored `.runtime/` storage. Only curated documentation images belong in `docs/images/`.

## README translations

`README.md` is the English reference. Separate translations are available in Traditional Chinese (`README.zh-TW.md`), Japanese (`README.ja.md`), Korean (`README.ko.md`), Spanish (`README.es.md`), and Portuguese (`README.pt.md`). Keep the language links, commands, versions, installation status, and safety limitations consistent across all six files. Translate explanatory text and link labels; leave filenames, commands, URLs, and existing heading fragments unchanged.

When changing shared README information, update the corresponding passages in every translation in the same pull request. Translation-only corrections can target one language. These translations cover the README; additional application languages and translations of other guides are separate contributions.

## Pull requests

Use the pull request template. A useful PR describes the problem, the approach, how the change was checked, and any remaining limitations. Keep each PR reviewable and link related issues when available.

## License

Irwin is distributed under the MIT License in [`LICENSE`](LICENSE). Contributions to this repository are submitted under that same license. Third-party components retain their own licenses; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
