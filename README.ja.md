# Irwin

[English](README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português](README.pt.md)

**Windows、Ubuntu、macOS 向けの MongoDB デスクトップワークスペース。** Irwin は MIT ライセンスのオープンソースプロジェクトです。[互換性一覧](docs/COMPATIBILITY.md)にある各 OS 上でのインストール検証が完了するまで、プラットフォーム対応はプレビュー扱いです。

翻訳の基準は[英語版 README](README.md)です。アプリの UI は現在、英語と繁体字中国語に対応しています。その他のガイドは英語または繁体字中国語で記載されています。

![Irwin ワークスペース](docs/images/irwin-workspace.png)

## プラットフォームの状況

| プラットフォーム                | 現在の検証状況                                                                                                                                                               | ステータス               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Windows 11 x64                  | ローカルの署名なし候補ビルドで、パッケージ化後の基本動作テストが成功しています。クリーン環境へのインストール、初回ダウンロード時の警告、更新、アンインストールは未検証です。 | プレビュー               |
| Ubuntu 24.04 x64                | Debian パッケージのビルド設定はありますが、実際の Ubuntu Desktop 上でのインストールと起動は未検証です。                                                                      | メンテナーによる検証待ち |
| Ubuntu 22.04 x64                | Linux ビルドの対象ですが、実際のデスクトップでは未検証です。                                                                                                                 | 正式サポート未提供       |
| macOS 14+ Intel / Apple Silicon | メンテナーから、M3 MacBook Air で DMG をインストールして起動できたとの報告があります。正確な macOS バージョン、DMG の識別情報、その他の操作、Intel での検証は未確認です。    | 一部の実機検証のみ完了   |

リリース公開後、GitHub Releases からインストーラーをダウンロードできるようになります。アプリストア経由のインストールは不要です。プレビュー版には有料の発行元署名や Apple の公証はありません。[インストールガイド](docs/INSTALLATION.md)でチェックサムの検証と初回起動時の警告について説明しています。ローカルのパッケージ作成コマンドが出力するパスはビルド成果物であり、ダウンロードリンクではありません。

バージョン 0.1.0 のインストーラー名は `Irwin-0.1.0-win-x64.exe`、`Irwin-0.1.0-linux-x64.deb`、`Irwin-0.1.0-mac-x64.dmg`、`Irwin-0.1.0-mac-arm64.dmg` に設定されています。これらはビルド成果物の名前であり、まだ公開されていません。

## 機能

- MongoDB の接続を管理し、Table、Tree、JSON ビューでコレクションを確認できます。
- BSON 型を保持したドキュメントの検索と編集、タブごとに独立した mongosh セッションを利用できます。
- 自分のクラウドまたはローカル LLM を接続し、クエリの下書き作成や MongoDB Explain の解説に利用できます。接続ごとに有効化し、送信するコンテキストを確認できます。AI の下書きは自動実行されず、ユーザーが確認、適用してから実行します。
- JSON、JSONL、CSV、BSON のインポートとエクスポートに対応し、進捗表示、キャンセル、破壊的操作への明示的な保護を備えています。
- 接続プロファイルと設定はローカルの SQLite に保存します。保存する秘密情報は OS の暗号化機能で保護し、安全な保存機能が利用できない場合は現在のセッション内だけで保持します。

操作手順と制限は[ユーザーガイド](docs/USER_GUIDE.md)を参照してください。

## Irwin のインストール

Windows、Ubuntu、macOS の手順は[インストールガイド](docs/INSTALLATION.md)を参照してください。公開インストーラーはまだありません。プラットフォームの状況と未完了の実機検証は[互換性一覧](docs/COMPATIBILITY.md)に記載しています。

## ソースからビルド

Node.js 24、pnpm 11.1.0、および Windows、Linux、macOS のネイティブ開発環境が必要です。インストーラーは対象の OS 上でビルドしてください。設定済みの対象は Windows x64、Ubuntu/Debian x64、macOS 14+ x64/arm64 です。

```sh
git clone https://github.com/piayru/irwin.git
cd irwin
pnpm install --frozen-lockfile
node node_modules/electron/install.js
pnpm tools:fetch
pnpm dev
```

`pnpm tools:fetch` は現在のプラットフォーム向け MongoDB Database Tools をダウンロードし、`vendor/tools-manifest.json` の SHA-256 値でアーカイブを検証します。

macOS では Intel と Apple Silicon の両方の DMG を作成するため、先に `pnpm tools:fetch mac-x64` と `pnpm tools:fetch mac-arm64` で両方のツールを準備してください。パッケージ作成前のチェックで両アーキテクチャを確認します。

Irwin は npm パッケージではなく、デスクトップアプリとして配布します。誤公開を防ぐため、パッケージ設定で npm への公開を無効にしています。ソースコードにはルートの `LICENSE` が適用されます。

## 検証とパッケージ作成

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm package --publish never
pnpm release:verify
```

`pnpm test` は使い捨ての MongoDB 8.0.18 テストプロセスを起動し、専用のテストデータベースに書き込みます。テスト URI を本番環境に向けないでください。統合テストには MongoDB のテスト用バイナリを取得するためのネットワーク接続が必要です。デスクトップとインストーラーの検証には、[リリースチェックリスト](docs/RELEASE_CHECKLIST.md)にある各 OS 上での手動確認が必要です。CI はこれらの確認を代替しません。

## プロジェクトのドキュメント

- [ドキュメント一覧](docs/README.md)
- [Irwin のインストール](docs/INSTALLATION.md)
- [互換性と検証状況](docs/COMPATIBILITY.md)
- [アーキテクチャとセキュリティ境界](docs/ARCHITECTURE.md)
- [リリースとプラットフォーム検証のチェックリスト](docs/RELEASE_CHECKLIST.md)
- [テストガイド](docs/TESTING.md)
- [ローカルデータと認証情報の保存](docs/USER_GUIDE.md#連線)
- [コントリビューション](CONTRIBUTING.md)
- [非公開の脆弱性報告](SECURITY.md)
- [サードパーティのライセンス通知](THIRD_PARTY_NOTICES.md)
- [変更履歴](CHANGELOG.md)

Irwin は独立したプロジェクトであり、MongoDB の公式製品ではありません。MongoDB、mongosh、MongoDB Database Tools の名称とライセンスは、それぞれの規定に従います。
