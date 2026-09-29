# Testing Irwin

Run commands from the repository root after completing the development setup in [CONTRIBUTING.md](../CONTRIBUTING.md). Tests use disposable MongoDB instances and isolated application profiles. Do not substitute real database URIs, credentials, or your normal application data directory.

## Automated regression suite

```sh
pnpm typecheck
pnpm test
pnpm build
```

Vitest runs `tests/**/*.test.ts`, including database integration, BSON and CSV round trips, JSON/JSONL parsing after desktop compilation, read-only enforcement, AI context redaction and output validation, connection safety, application state, and release tooling. MongoDB 8.0.18 test binaries are downloaded into the ignored `.runtime/mongodb/` cache when needed. Network access is required for the first download.

The certificates and private key in `tests/fixtures/` are intentionally public, localhost-only test fixtures. `scripts/create-test-certificates.py` regenerates them using Python's `cryptography` package; do not use them for any real service.

## Electron scenarios

Build first with `pnpm build`, then run the scenario relevant to your change on a native desktop with a graphical session. These are standalone Playwright Electron scripts, separate from `pnpm test`; run them sequentially to avoid clipboard and window-focus interference.

| Command                                | Coverage                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node tests/e2e/desktop.mjs`           | Connections, query/results workflow, export/import, mongosh cancellation and drafts, destructive-action confirmations, layout, preferences, and normal shutdown |
| `node tests/e2e/aggregation.mjs`       | Pipeline editing, stage preview, resizing, Explain display, export, and empty results                                                                           |
| `node tests/e2e/query-controls.mjs`    | Sort cycles, resizable query fields, formatting without execution, projection, and narrow-window layout                                                         |
| `node tests/e2e/initial-table-fit.mjs` | Legacy workspace state, initial column sizing, and sizing stability when querying again                                                                         |
| `node tests/e2e/table-workspace.mjs`   | Single-cell selection/copy, frozen-column alignment, long field names, nested fields, independent tabs, and remembered layout                                   |
| `node tests/e2e/saved-queries.mjs`     | Saving/editing, cross-connection application without execution, paging, restart persistence, and deletion confirmation                                          |
| `node tests/e2e/preferences.mjs`       | Live preview and cancel rollback, settings persistence, reset scope, notifications, query timeout, and compact layout                                           |
| `node tests/e2e/users-roles.mjs`       | Authentication, user/role changes, permission restrictions, read-only controls, redacted receipts, and both UI languages                                        |

The Windows packaging workflow runs the desktop scenario against its unpacked candidate using `WORKBENCH_EXECUTABLE`. For local source checks, leave that variable unset. Reports and screenshots are written only to ignored `.runtime/` storage. A nonzero exit indicates a failed scenario; review any `unverified` entries before recording acceptance, especially when the native clipboard is unavailable.

These scenarios do not validate every cloud service, AI provider, operating system, or installation path. Complete [native release acceptance](RELEASE_CHECKLIST.md) using the exact installer to be distributed.

## Optional transfer benchmark

`tests/performance/transfers.mjs` measures large transfers and UI responsiveness, then verifies document counts and a complete BSON digest after import. It uses its own MongoDB instance and application data directory. It is outside normal CI because its default one-million-document dataset produces a file larger than 5 GB and can take substantial time and disk space.

For a smaller local run, set `BENCHMARK_DOCS` explicitly. In PowerShell:

```powershell
$env:BENCHMARK_DOCS = '1000'
node tests/performance/transfers.mjs
Remove-Item Env:BENCHMARK_DOCS
```

On macOS or Linux:

```sh
BENCHMARK_DOCS=1000 node tests/performance/transfers.mjs
```

Results and datasets remain in `.runtime/benchmark-*/`. Keep them local; publish only deliberately reviewed, sanitized measurements when they explain a product change.
