# Irwin

[English](README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português](README.pt.md)

**適用於 Windows、Ubuntu 與 macOS 的 MongoDB 桌面工作區。** Irwin 是採用 MIT 授權的開源專案。各平台仍處於預覽階段，須完成[相容性矩陣](docs/COMPATIBILITY.md)中的原生安裝驗收，才能列為正式支援。

翻譯以[英文 README](README.md)為準。應用程式目前提供英文與繁體中文介面；其他指南目前以英文或繁體中文撰寫。

![Irwin 工作區](docs/images/irwin-workspace.png)

## 平台狀態

| 平台                            | 現有驗證                                                                                                          | 狀態         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------ |
| Windows 11 x64                  | 本機未簽章候選版本通過封裝後的桌面基本功能測試。乾淨環境安裝、首次下載提示、升級與解除安裝仍待驗證。              | 預覽版       |
| Ubuntu 24.04 x64                | 已設定 Debian 套件建置，尚未驗證原生 Ubuntu Desktop 的安裝與啟動。                                                | 待維護者驗證 |
| Ubuntu 22.04 x64                | 列為 Linux 建置目標，但尚未在原生桌面驗證。                                                                       | 尚未正式支援 |
| macOS 14+ Intel / Apple Silicon | 維護者已回報在 M3 MacBook Air 上從 DMG 安裝並啟動。確切 macOS 版本、DMG 身分、其他操作流程與 Intel 驗收仍待補齊。 | 部分原生驗收 |

發行版本發布後，會透過 GitHub Releases 提供公開安裝包下載；不需透過應用程式商店安裝。預覽版安裝包不提供付費的發行者簽章或 Apple 公證。[安裝指南](docs/INSTALLATION.md)說明校驗碼驗證與首次啟動時可能出現的系統提示。本機封裝指令產生的路徑是建置輸出，不是下載連結。

0.1.0 版設定的安裝包名稱為 `Irwin-0.1.0-win-x64.exe`、`Irwin-0.1.0-linux-x64.deb`、`Irwin-0.1.0-mac-x64.dmg` 與 `Irwin-0.1.0-mac-arm64.dmg`。這些名稱僅代表建置輸出，目前尚未發布下載。

## 功能

- 管理 MongoDB 連線，並以 Table、Tree、JSON 檢視集合。
- 查詢與編輯保留 BSON 型別的文件；每個分頁使用獨立的 mongosh 工作階段。
- 連接自己的雲端或本機 LLM，產生查詢草稿與解讀 MongoDB Explain。每個資料庫連線須自行啟用，並可檢視送出的脈絡。AI 草稿不會自動執行；由使用者檢查、套用後親自執行。
- 匯入及匯出 JSON、JSONL、CSV、BSON，提供進度、取消功能，以及破壞性操作的明確保護措施。
- 連線設定與偏好設定儲存在本機 SQLite。已儲存的機密資訊使用作業系統加密機制；若安全儲存不可用，機密資訊只保留於本次工作階段。

操作流程與限制請見[使用指南](docs/USER_GUIDE.md)。

## 安裝 Irwin

Windows、Ubuntu 與 macOS 的安裝方式請見[安裝指南](docs/INSTALLATION.md)。目前尚未提供公開安裝包；平台狀態與待完成的原生驗收列於[相容性矩陣](docs/COMPATIBILITY.md)。

## 從原始碼建置

需要 Node.js 24、pnpm 11.1.0，以及原生 Windows、Linux 或 macOS 開發環境。請在安裝包所對應的作業系統上建置。設定的目標為 Windows x64、Ubuntu/Debian x64，以及 macOS 14+ x64/arm64。

```sh
git clone https://github.com/piayru/irwin.git
cd irwin
pnpm install --frozen-lockfile
node node_modules/electron/install.js
pnpm tools:fetch
pnpm dev
```

`pnpm tools:fetch` 會下載目前平台的 MongoDB Database Tools，並依 `vendor/tools-manifest.json` 中的 SHA-256 驗證壓縮檔。

macOS 封裝會產生 Intel 與 Apple Silicon 兩種 DMG，請先執行 `pnpm tools:fetch mac-x64` 與 `pnpm tools:fetch mac-arm64`，準備兩種架構的工具。封裝前置檢查會確認兩者皆已備妥。

Irwin 以桌面應用程式發行，不以 npm 套件發行。套件設定停用 npm 發布，以避免誤操作；原始碼依根目錄的 `LICENSE` 授權。

## 檢查與封裝

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm package --publish never
pnpm release:verify
```

`pnpm test` 會啟動可丟棄的 MongoDB 8.0.18 測試程序，並寫入專用測試資料庫。請勿將測試 URI 指向正式環境。整合測試需要網路以取得 MongoDB 測試執行檔。桌面與安裝包驗收仍須完成[發行檢查表](docs/RELEASE_CHECKLIST.md)中的原生人工檢查；CI 無法取代這些驗收。

## 專案文件

- [文件索引](docs/README.md)
- [安裝 Irwin](docs/INSTALLATION.md)
- [相容性與驗證狀態](docs/COMPATIBILITY.md)
- [架構與安全邊界](docs/ARCHITECTURE.md)
- [發行與平台驗收檢查表](docs/RELEASE_CHECKLIST.md)
- [測試指南](docs/TESTING.md)
- [本機資料與憑證儲存](docs/USER_GUIDE.md#連線)
- [參與貢獻](CONTRIBUTING.md)
- [私密漏洞回報](SECURITY.md)
- [第三方授權聲明](THIRD_PARTY_NOTICES.md)
- [版本變更紀錄](CHANGELOG.md)

Irwin 是獨立專案，並非 MongoDB 官方產品。MongoDB、mongosh 與 MongoDB Database Tools 的名稱及授權仍依各自規定。
