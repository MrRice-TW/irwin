# Changelog

User-visible changes are recorded here for each public release. Unreleased work is not a release commitment.

## Unreleased

- Added an opt-in AI assistant with configurable OpenAI-compatible, Anthropic, and Gemini services, bilingual query drafts, MongoDB Explain interpretation, and per-connection settings.
- Added context review, literal redaction, local-only schema sampling, encrypted API-key storage, cancelable requests, and validation before a generated draft can be applied.
- Added separate README translations in Traditional Chinese, Japanese, Korean, Spanish, and Portuguese alongside the English reference.
- Fixed frozen table headers and cells shifting down a row, which could hide keyboard-selected cells behind the header.
- Fixed JSON array and JSONL imports failing in the compiled desktop application.
- Clear previous renderer build outputs so packaging does not include obsolete UI assets.
