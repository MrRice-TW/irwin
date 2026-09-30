# Changelog

User-visible changes are recorded here for each public release. Unreleased work is not a release commitment.

## 0.1.0 — 2026-09-30

- Added an in-app GitHub release check and update download flow for packaged Windows and Ubuntu builds; unsigned macOS builds link to the release page for manual installation.
- Added a quiet, once-per-launch update check for packaged builds. It is enabled by default, can be disabled in Preferences, and is skipped while offline.
- Added an opt-in AI assistant with configurable OpenAI-compatible, Anthropic, and Gemini services, bilingual query drafts, MongoDB Explain interpretation, and per-connection settings.
- Added context review, literal redaction, local-only schema sampling, encrypted API-key storage, cancelable requests, and validation before a generated draft can be applied.
- Added separate README translations in Traditional Chinese, Japanese, Korean, Spanish, and Portuguese alongside the English reference.
- Added human-readable Mongo shell BSON editing, including ObjectId and date constructors, plus line and column details for parse errors.
- Added ISODate and Date support in query editing and keyboard acceptance for prefix suggestions.
- Improved button tooltips on macOS with consistent pointer, keyboard, and screen-reader behavior.
- Fixed frozen table headers and cells shifting down a row, which could hide keyboard-selected cells behind the header.
- Fixed JSON array and JSONL imports failing in the compiled desktop application.
- Clear previous renderer build outputs so packaging does not include obsolete UI assets.
