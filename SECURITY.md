# Security policy

Irwin handles database credentials and can execute database writes and mongosh JavaScript. Treat security reports with care and do not post credentials, connection strings, private keys, production data, or an unpatched vulnerability in a public issue.

## Reporting a vulnerability

Email **[zxpiayru@gmail.com](mailto:zxpiayru@gmail.com)** to report a vulnerability privately to Wilbert Yang ([piayru](https://github.com/piayru)). Use the subject `Irwin security report` and keep technical details out of public issues.

GitHub's **Report a vulnerability** feature is an additional private channel when enabled for [piayru/irwin](https://github.com/piayru/irwin). If that button is unavailable, use the email address above.

Please include the affected Irwin version and platform, the impact, steps to reproduce with disposable data, and any proposed mitigation. Redact secrets and real customer data. Maintainers will acknowledge and coordinate a fix and disclosure timeline privately.

## Supported versions

Before the first stable release, security fixes are evaluated against the current development branch. After stable releases begin, this section and the GitHub Releases page will identify supported versions.

## Security design notes

The application architecture and its limits are documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). In particular, mongosh executes code with the privileges of the connected database account; process isolation is not a security boundary for untrusted scripts.
