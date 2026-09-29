# 使用說明

2026-09-17 新增的查詢提示、表格進階操作、Schema／Explain／跨環境比較與傳輸範本，請見 [資料探索與工作區功能](EXPLORATION_GUIDE.md)。

## 連線

1. 按「新增資料庫連線」，輸入名稱、群組、預設 DB 與 URI。URI 模式保留查詢參數；表單模式可直接輸入主機與連接埠。
2. 在驗證、TLS、SSH 與進階頁設定登入、憑證路徑、Replica Set、讀寫偏好、逾時等。URI 的明確參數優先於對應的表單預設值。
3. 按「測試連線」後儲存。從左側展開連線、DB、Collection。權限不足以列舉 DB 時會嘗試顯示設定的預設 DB。

已儲存連線會顯示在側欄及首頁，尚未連線也可以編輯。首頁會區分已連線、未連線與連線中；按「連線」後再從側欄選取 Collection。使用「首頁」分頁返回連線列表不會關閉既有查詢分頁。側欄搜尋無結果時可按「清除搜尋」恢復；聚焦側欄分隔線後可用左右鍵調整寬度。

移除連線設定會先要求確認，移除的是本機設定及密碼，並關閉該連線分頁；不刪除資料庫中的資料。

### 使用者與角色

從連線的「⋯」選單開啟「使用者與角色」，可檢視此連線帳號能讀取到的使用者、角色、繼承角色與有效權限。每個使用者都會標示驗證資料庫；角色會另外標示其適用的資料庫。資料庫只回傳伺服器允許檢視的範圍，權限不足時會列出受限資料庫並停用異動。

本功能透過 MongoDB 自架部署的管理命令建立使用者、重設密碼、授予／撤銷單一角色及刪除使用者。需要伺服器端相應的 `viewUser`、`viewRole`、`createUser`、`changePassword`、`grantRole`、`revokeRole` 與 `dropUser` 權限；MongoDB 依命令及目標資料庫檢查實際授權。程式也會遵守連線的唯讀設定，並要求管理異動使用 TLS、SSH 隧道或本機 loopback 連線。請以最低必要權限建立管理連線。

新增使用者時必須指定驗證資料庫、密碼及至少一個資料庫角色。授予或撤銷角色只修改指定的單一角色，不會覆寫使用者的其他角色。刪除帳號前須輸入完整的 `驗證資料庫.使用者名稱`；目前連線正在使用的帳號不能從此連線刪除。新輸入的密碼只在操作期間保留於記憶體，不會寫入連線設定、操作收據或介面清單；密碼雜湊不會讀取或顯示。

此頁使用自架 MongoDB 的管理命令。角色清單列出此連線可列舉的資料庫，以及使用者角色引用到的資料庫；若自訂角色位於不可列舉的空資料庫，且沒有使用者引用，可能不會出現在清單，因 MongoDB 的 [`rolesInfo`](https://www.mongodb.com/docs/manual/reference/command/rolesinfo/) 命令一次只列出單一資料庫範圍。自訂角色可以檢視，但新增與編輯需使用 MongoDB 管理端工作流程。Atlas 帳號需在 Atlas Database Access 管理；Cosmos DB for MongoDB 的使用者與角色需透過 Azure 管理端設定，目前不由此頁管理。

密碼欄位留白保留既有秘密；URI 內的密碼會拆出後加密，連線清單不回傳密碼。SSH 私鑰保留檔案路徑，私鑰密語加密保存。失去系統加密後端時，密碼只存在記憶體，關閉程式後需要重新輸入。

本機資料保存在作業系統提供的 Irwin user-data 目錄，SQLite 檔名為 `workbench.sqlite`。檔案內有連線設定、偏好、查詢歷史、Shell 草稿與其他工作區資料；有安全後端時，連線秘密以 Electron `safeStorage` 加密後保存。解除安裝應用程式不一定會移除此目錄。若要完整移除本機資料，先正常關閉 Irwin，再依作業系統的應用程式資料管理方式移除該 user-data 目錄；操作前請確認裡面沒有需要保留的資料。

預設路徑為 Windows `%APPDATA%\Irwin\workbench.sqlite`、macOS `~/Library/Application Support/Irwin/workbench.sqlite`、Ubuntu `${XDG_CONFIG_HOME:-~/.config}/Irwin/workbench.sqlite`。若設定了 `XDG_CONFIG_HOME`，Linux 資料夾會使用該路徑；開發及自動化測試也可覆寫 user-data 位置。備份或手動清除前請先正常關閉 Irwin。

SSH 第一次連線會回報主機公鑰 SHA-256 hex 指紋。請從已知可信管道比對後填入 SSH 設定。支援單一 MongoDB 主機或 mongos；不支援透過單一 tunnel 探索私有 Replica Set 多節點。GUI 與 Shell 保留原始 TLS 主機名驗證；SSH+TLS 的 BSON Tools 路徑停用，請用 JSON／CSV 或直接 TLS。

Cosmos RU 在進階設定提供 `DB.Collection` 到分區欄位路徑的對照，例如 `{"app.orders":"tenantId"}`。建立 Collection、特殊索引及 RU／TTL 能力設定由 Azure 管理。條件編輯依 API 7.0 能力表限制；無法確認伺服器版本時停用，其他命令的支援仍由服務判定。

## 偏好設定

右上角齒輪可開啟偏好設定。設定分為「外觀」、「編輯器」、「查詢與結果」、「資料與語言」及「AI 助理」五類；外觀與結果呈現可即時預覽，按「儲存設定」才寫入本機，按「取消」或關閉視窗會還原預覽。可重設目前分類或全部設定，分類重設不會改動其他分類。

- 外觀可固定使用淺／深主題，或依作業系統切換。使用「依照系統切換」時，可以指定系統為淺色時使用芒果暖色、經典藍或森林綠；系統為深色時使用 Irwin 深色主題。介面可縮放至 100%、110% 或 125%，與編輯器字級分開控制。
- 編輯器將介面字體與 JSON／Shell 等寬字體分開設定，並提供編輯器字體大小、JSON 行距與內距、Tab 空格數。字體及數值錯誤會顯示在欄位下方，無效值不能儲存。
- 查詢與結果可停用新開 Collection 時的自動查詢、調整資料表列密度、長文字截斷或換行、特殊 BSON 型別標籤的顯示方式，以及 JSON／文件檢視器的初始展開層數。初始展開層數 0 會展開全部內容；1 至 4 會逐層折疊更深的物件，仍可用編輯器折疊控制手動調整。背景任務通知可選擇僅失敗、完成與失敗，或關閉；任務取消不發通知。
- 資料與語言可調整語言、日期時間時區與格式，以及 Table／Tree 的 BSON 型別顏色。
- AI 助理可設定 OpenAI 相容服務（包含 Ollama／vLLM）、Anthropic Messages API 或 Gemini API，並選擇全域預設模型。模型金鑰使用作業系統安全儲存；系統沒有可用後端時只保留到 Irwin 關閉。每條資料庫連線的 AI 預設關閉，可在助理側欄逐一啟用或指定覆寫模型。
- 遠端模型的資料傳送同意需在偏好設定啟用一次，並可隨時撤回。自訂端點預設要求 HTTPS；localhost 可用 HTTP。內網 HTTP 需明確開啟，因 API 金鑰與查詢脈絡會以未加密方式傳輸。使用前可在助理側欄檢視本次上下文；文件樣本不會送給模型，提問文字則會依原文傳送。

這些偏好套用於整個工作區。每個分頁自己的檢視方式、查詢區與資料區的排列，以及 BATCH 筆數會繼續由該分頁保存。預設值保留原有行為：開啟 Collection 時自動查詢、舒適列高、長文字截斷、JSON 全部展開。

每個連線的「進階設定」可設定互動查詢逾時上限，範圍為 5 至 120 秒，預設 30 秒。此上限套用於 Collection 查詢、Aggregation 與 Explain；完整匯出、Shell 與連線逾時各自使用原有設定。

## 查詢與 Shell

Collection 查詢工具列的 AI 圖示可用繁體中文或英文描述查詢需求；助理會先在資訊不足時追問，再提供 find 草稿。Aggregation 工作區可要求唯讀 aggregation 草稿；若明確選取同一資料庫中的另一個 Collection，助理才可使用 `$lookup`。Cosmos DB 首版僅提供 find 草稿，不提供 aggregation 草稿或 Explain 判讀。

草稿會顯示使用欄位、假設，以及目前查詢／pipeline 和新草稿的並列內容。按「套用到編輯器」只會更新編輯內容，不會執行查詢。Aggregation 草稿套用前會通過應用程式既有的唯讀 pipeline 驗證。無法解析或驗證失敗的模型輸出不能套用。

Explain 對話只解讀使用者已執行的 MongoDB Explain，不會由模型重跑查詢。模型的數字敘述會檢查是否與計畫中的 metric 一致；每項判讀及建議都需引用存在的 metric 或 stage，效能建議會標示仍需用 Explain 驗證。模型服務與資料庫環境仍需在上市前完成實機品質驗收。

Collection 分頁可輸入 Extended JSON Filter、Sort 與 Projection。查詢不設總筆數 LIMIT；右下角 BATCH 控制每批載入筆數，透過前後批次可逐批檢視全部符合條件的文件。預設每批 100 筆，畫面最多保留最近 1,000 筆或約 24 MB 的結果，較早批次可重新載入；完整匯出使用串流。

查詢區工具列的版面按鈕可在上下堆疊與左右並排間切換；左側「連線工作區」可收合以擴大資料區。自由命令模式可反白部分 Shell 程式後按「執行選取內容」，一般「執行」仍會執行整份程式。JSON 檢視器與文件視窗可用每個物件／陣列左側的摺疊控制收合內容。Filter／Sort／Projection 欄位按 Tab 會插入偏好設定指定數量的空格，Ctrl+Tab 可取消一層縮排；Monaco 編輯器也支援 Ctrl+Tab 取消縮排。

- 點擊 Table 欄名依序切換「升冪 → 降冪 → 不排序」，每次都會重新查詢。SORT 標題旁的清除圖示可直接清空全部排序條件並查詢；取消後 F5 仍維持不排序。不排序表示交由 MongoDB 回傳，並不保證固定文件順序。
- 每次新開啟 Collection 依首批結果自動縮小短欄位；後續查詢沿用該分頁的欄寬。不同文件的欄位順序、排序與暫時投影不會讓既有欄位重新排列，新出現的根欄位追加在後方。
- 拖曳 FILTER／SORT、SORT／PROJECTION 之間的邊界可調整寬度，拖曳輸入框右下角可調整高度。欄寬比例隨工作區保存。
- 每個查詢欄的 `{}` 圖示或 Shift+Alt+F 可格式化；展開圖示會開啟自動格式化、可拖曳大小及最大化的編輯器。支援 `{_id:-1}` 這類 Mongo 文件語法與 Canonical Extended JSON。語法錯誤會提示並保留原文，格式化不會執行 JS 或資料庫操作。
- Filter／Sort／Projection 中按 Enter（包含 Ctrl/Cmd+Enter）會換行；使用 F5 或畫面上的「執行」按鈕查詢。F5 在這三個輸入欄位中也有效。
- 展開編輯器按「套用」更新條件，再按 F5 或「執行」按鈕查詢。Tab 插入偏好設定指定數量的空格，Ctrl+Tab 取消縮排。

Table／Tree／JSON 共用同一批結果，不會因切換而重跑。JSON 每頁 100 筆，Tree 每頁 20 份文件且延遲展開。左側 Collection 的 Shell 按鈕會建立獨立分頁。

```js
let threshold = 10;
db.orders.find({ total: { $gt: threshold } }).limit(10);
```

Shell 執行選取內容，沒有選取時執行整份程式。支援變數、迴圈、async/await、原生 mongosh API。各分頁有各自的程序與變數。Shell 結果一律唯讀；要修改文件，請開啟 Collection 的普通查詢。

「停止」會取消 cursor 或終止並重建 Shell 程序，因此 Shell 變數會重設。已送出的寫入可能已經生效，取消不會回滾。

## 文件

- 點選 cell 後按 Ctrl+C，macOS 使用 Cmd+C。字串複製原文，特殊 BSON／物件／陣列複製 Extended JSON。
- 雙擊 scalar cell，在原型別下修改；Enter 送出、Esc 取消，失焦不自動儲存。物件與陣列開啟 JSON 編輯器。
- `_id`、分區鍵、含點號／特殊運算符的欄名無法直接修改。投影缺少識別鍵、計算型投影與 Shell 結果唯讀。
- 更新包含識別鍵、原值、存在性及 BSON 型別條件；出現衝突、驗證器拒絕或未知寫入結果時會顯示錯誤。先重新查詢確認狀態，再決定是否重新編輯。
- 「新增文件」（Add document）接受 Extended JSON，省略 `_id` 時由 Driver 產生；Cosmos 文件必須帶入設定的分區鍵。

索引管理可查看、建立、刪除一般索引，MongoDB 可設定 Unique／TTL。Explain 顯示 queryPlanner。刪除 DB／Collection 需要輸入完整名稱。

## 匯入與匯出

結果工具列的 CSV／Excel 匯出只包含目前已載入的結果。要輸出完整資料，使用左側 Collection 選單的匯出，並在傳輸對話框確認 Filter／Sort／Projection／Limit。DB 功能表可匯出全部 Collection，每個 Collection 一份檔案，另附 manifest。JSON 文件以 Canonical Extended JSON 保留 ObjectId、Int64、Decimal128、Binary、Date 等型別。

CSV 可指定欄位、型別、空值規則並預覽前 10 筆。未指定映射時，匯出單一 `document` 欄位，存整份 Extended JSON；旁邊的 `.mapping.json` 讓再次匯入時自動還原型別。一般外部 CSV 預設字串，請在開始前調整映射。解析格式錯誤會停止任務；可辨識的單筆型別／重複鍵錯誤會記入錯誤報告，其餘文件繼續。

JSON／CSV 預設只新增。選擇「取代整筆」會以 `_id`／分區鍵比對，移除匯入文件沒有包含的既有欄位。每批最多 100 筆或 8 MB，收到不明確的批次寫入結果時停止，避免盲目重試。

BSON 使用 gzip archive，還原預設保留已有 Collection。只有勾選覆蓋且輸入名稱確認才會傳入 `--drop`。本工具備份附 `.metadata.json`，會检查 Database Tools、來源／目標主版本及 namespace；外部 archive 沒有 metadata 時必須填來源 MongoDB 版本。同主版本規則採保守限制，版本遷移請用 Extended JSON。BSON 不套用查詢 Filter／Projection。

任務面板顯示成功／失敗筆數、資料量、狀態與檔案路徑。取消後已寫入文件保留；未完成輸出使用 `.partial`，不能視為完成備份。重新執行匯出請選新檔名，或先自行確認並移除上一個 `.partial`。第一版沒有斷點續傳。
