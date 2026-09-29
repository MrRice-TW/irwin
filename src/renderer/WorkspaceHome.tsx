import {
  Database,
  Plus,
  Pencil,
  PlugZap,
  LoaderCircle,
  ChevronRight,
  Terminal,
  Trash2,
  ShieldCheck,
  Search,
} from "lucide-react";
import type { Profile } from "../shared/contracts";
import { useUi } from "./ui";

export default function WorkspaceHome({
  profiles,
  connected,
  connecting,
  secure,
  create,
  edit,
  remove,
  connect,
}: {
  profiles: Profile[];
  connected: string[];
  connecting: string[];
  secure: boolean | undefined;
  create(): void;
  edit(profile: Profile): void;
  remove(profile: Profile): void;
  connect(profile: Profile): void;
}) {
  const { t } = useUi();
  return (
    <section className="workspace-home" aria-labelledby="home-heading">
      <header className="home-heading">
        <div>
          <h1 id="home-heading">
            {t("從連線開始，專注於資料。", "Connect to your data.")}
          </h1>
          <p>
            {t(
              "探索文件、編寫查詢，讓每一次操作都有清楚的脈絡。",
              "Explore documents and write queries with your database in context.",
            )}
          </p>
        </div>
        <button className="primary" onClick={create}>
          <Plus size={16} />
          {t("新增資料庫連線", "New database connection")}
        </button>
      </header>
      <div className="home-layout">
        <section
          className="home-connections"
          aria-labelledby="connections-heading"
        >
          <div className="home-section-heading">
            <h2 id="connections-heading">
              {t("你的連線", "Your connections")}
            </h2>
            <span>
              {profiles.length} {t("個已儲存", "saved")}
            </span>
          </div>
          {profiles.length ? (
            <>
              <p className="home-list-hint">
                {t(
                  "開啟連線後，從左側選擇資料庫與 Collection。",
                  "Open a connection, then choose a database and collection in the sidebar.",
                )}
              </p>
              <div className="home-connection-list">
                {profiles.map((profile) => {
                  const online = connected.includes(profile.id);
                  const busy = connecting.includes(profile.id);
                  return (
                    <div className="home-connection" key={profile.id}>
                      <div className="home-database-icon">
                        <Database size={20} />
                      </div>
                      <div className="home-connection-info">
                        <strong title={profile.name}>{profile.name}</strong>
                        <span>
                          {profile.provider === "cosmos"
                            ? "Cosmos DB RU"
                            : "MongoDB"}
                          <span aria-hidden="true"> / </span>
                          {profile.group || profile.database}
                        </span>
                        <span className={`environment-badge ${profile.environment}`}>
                          {profile.environment.toUpperCase()}
                        </span>
                        {profile.readOnly && (
                          <span className="read-only-badge">READ ONLY</span>
                        )}
                      </div>
                      <span
                        className={`connection-state ${online ? "is-online" : ""}`}
                      >
                        <i className={online ? "online-dot" : "offline-dot"} />
                        {busy
                          ? t("連線中…", "Connecting…")
                          : online
                            ? t("已連線", "Connected")
                            : t("未連線", "Disconnected")}
                      </span>
                      <button
                        className="icon"
                        aria-label={`${t("編輯", "Edit")} ${profile.name}`}
                        title={t("編輯連線", "Edit connection")}
                        onClick={() => edit(profile)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon danger-text"
                        aria-label={`${t("移除", "Remove")} ${profile.name}`}
                        title={t("移除連線設定", "Remove saved connection")}
                        onClick={() => remove(profile)}
                      >
                        <Trash2 size={15} />
                      </button>
                      <button disabled={busy} onClick={() => connect(profile)}>
                        {busy ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : online ? (
                          <ChevronRight size={14} />
                        ) : (
                          <PlugZap size={14} />
                        )}
                        {online ? t("瀏覽", "Browse") : t("連線", "Connect")}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="home-first-connection">
              <div className="connection-illustration" aria-hidden="true">
                <Database size={38} />
                <span />
                <Terminal size={26} />
              </div>
              <h3>
                {t(
                  "第一個資料庫，從這裡開始",
                  "A workspace for your first database",
                )}
              </h3>
              <p>
                {t(
                  "準備 MongoDB 連線 URI，或使用主機與驗證資訊。先測試連線，再儲存到工作區。",
                  "Use a MongoDB connection URI, or enter your host and authentication details. Test the connection before saving it.",
                )}
              </p>
              <div className="connection-example">
                <code>mongodb://localhost:27017</code>
                <span>{t("本機 URI 範例", "Local URI example")}</span>
              </div>
            </div>
          )}
          <div className="home-storage">
            <ShieldCheck size={16} />
            <p>
              {secure === undefined
                ? t(
                    "正在檢查系統安全儲存。",
                    "Checking system credential storage.",
                  )
                : secure
                ? t(
                    "連線設定儲存在本機，密碼由作業系統加密保護。",
                    "Connection settings stay on this device. Passwords use operating-system encryption.",
                  )
                : t(
                    "系統安全儲存不可用，密碼只保留於本次工作階段。",
                    "Secure storage is unavailable. Passwords are kept for this session only.",
                  )}
            </p>
          </div>
        </section>
        <aside
          className="home-guide"
          aria-label={t("工作流程指引", "Workflow guide")}
        >
          <h2>{t("開始工作", "Getting started")}</h2>
          <ol className="workflow-steps">
            <li>
              <strong>{t("連接資料庫", "Connect a database")}</strong>
              <p>
                {t(
                  "使用 URI 或表單設定，支援 TLS 與 SSH。",
                  "Use a URI or connection form, with TLS and SSH options.",
                )}
              </p>
            </li>
            <li>
              <strong>{t("選擇 Collection", "Choose a collection")}</strong>
              <p>
                {t(
                  "從左側展開資料庫，以 Table、Tree 或 JSON 檢視文件。",
                  "Expand a database in the sidebar. Inspect documents as Table, Tree, or JSON.",
                )}
              </p>
            </li>
            <li>
              <strong>{t("查詢與編輯", "Query and edit")}</strong>
              <p>
                {t(
                  "使用 Filter 篩選資料，或切換自由命令執行 mongosh。",
                  "Filter your documents, or switch to Free command to run mongosh.",
                )}
              </p>
            </li>
          </ol>
          <div className="home-shortcuts">
            <h3>{t("常用操作", "At your fingertips")}</h3>
            <div>
              <span>{t("執行查詢", "Run query")}</span>
              <kbd>F5</kbd>
            </div>
            <div>
              <span>{t("檢視文件 JSON", "Inspect document")}</span>
              <kbd>F3</kbd>
            </div>
            <div>
              <span>{t("複製欄位值", "Copy cell value")}</span>
              <kbd>Ctrl / ⌘ C</kbd>
            </div>
          </div>
          <p className="home-guide-note">
            <Search size={15} />
            {t(
              "已連線較多時，使用左側搜尋快速找到名稱或群組。",
              "When several connections are active, use sidebar search to find a name or group.",
            )}
          </p>
        </aside>
      </div>
    </section>
  );
}
