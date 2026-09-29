# Third-party notices

Irwin's own source code is licensed under the MIT License. Third-party packages and tools retain their own licenses; this file does not relicense those materials.

The installer includes a generated inventory of every resolved production dependency, its license identifier, and license or notice text. The generator copies text shipped by the installed package. For a small set of packages that omit a separate license file, [`vendor/license-evidence/manifest.json`](vendor/license-evidence/manifest.json) pins the exact hash and source of a package README or an upstream license file. The inventory records that extra provenance, and the copied texts are stored in the installer's `resources/third-party-licenses` directory. Regenerate them with `pnpm release:licenses` after installing from the frozen lockfile. Investigate every package still listed in `license-review.txt` before publishing; this tooling is not legal advice.

The dependency overrides in [`pnpm-workspace.yaml`](pnpm-workspace.yaml) keep ExcelJS's ZIP reader on `unzipper@0.12.5`, which no longer needs the legacy `binary`, `buffers`, or `chainsaw` packages. XLSX export and read-back are covered by regression tests. The optional `os-dns-native` addon is excluded from devtools-connect on every target: its native build was already disabled, and mongosh continues to use the MongoDB driver's DNS resolver, including SRV/TXT connections. This removes `ipv6-normalize` without replacing mongosh. The production-license acceptance test rejects any installed dependency whose license identity or notice text remains unresolved.

| Component                               | Resolved version | Declared license |
| --------------------------------------- | ---------------- | ---------------- |
| `@babel/parser`                         | 8.0.4            | MIT              |
| `@monaco-editor/react`                  | 4.7.0            | MIT              |
| `@mongosh/service-provider-node-driver` | 5.2.0            | Apache-2.0       |
| `@mongosh/shell-api`                    | 5.5.0            | Apache-2.0       |
| `@mongosh/shell-evaluator`              | 5.5.0            | Apache-2.0       |
| `@tanstack/react-virtual`               | 3.14.11          | MIT              |
| `bson`                                  | 7.3.2            | Apache-2.0       |
| `csv-parse`                             | 7.0.2            | MIT              |
| `csv-stringify`                         | 6.8.3            | MIT              |
| `exceljs`                               | 4.4.0            | MIT              |
| `lucide-react`                          | 1.43.0           | ISC              |
| `monaco-editor`                         | 0.56.0           | MIT              |
| `mongodb`                               | 7.6.0            | Apache-2.0       |
| `mongodb-connection-string-url`         | 7.0.2            | Apache-2.0       |
| `react`                                 | 19.2.8           | MIT              |
| `react-dom`                             | 19.2.8           | MIT              |
| `ssh2`                                  | 1.17.0           | MIT              |
| `stream-json`                           | 3.7.0            | BSD-3-Clause     |
| `zod`                                   | 4.5.4            | MIT              |

## Bundled runtime and Database Tools

- Electron and Chromium are included in desktop packages. Preserve Electron's `LICENSE.electron.txt` and Chromium's `LICENSES.chromium.html` from the packaged runtime.
- MongoDB Database Tools 100.18.0 are downloaded from the URLs and SHA-256-pinned in [`vendor/tools-manifest.json`](vendor/tools-manifest.json). The downloaded platform bundles include MongoDB license and third-party notice files; the package step copies those files beside the executables. The project MIT license does not apply to Database Tools.
- Run `pnpm release:licenses` before packaging. It walks the frozen production dependency tree and places per-package license and notice files with the generated inventory in the application resources.
