import { useState } from "react";
import {
  FolderOpen,
  ShieldCheck,
  PlugZap,
  Upload,
  Download,
  Copy,
} from "lucide-react";
import {
  defaultProfile,
  withEnvironment,
  type Profile,
  type Secrets,
} from "../shared/contracts";
import { Modal, Field, api, useUi, message } from "./ui";
import { diagnoseConnectionError } from "../shared/connection-diagnostics";
export default function ConnectionDialog({
  profile,
  close,
  saved,
  secure,
}: {
  profile?: Profile;
  close(): void;
  saved(profile: Profile, connectAfterSave: boolean): void;
  secure: boolean;
}) {
  const { t } = useUi();
  const [p, setP] = useState<Profile>(() =>
    profile ? structuredClone(profile) : defaultProfile(),
  );
  const [secrets, setSecrets] = useState<Secrets>({});
  const [tab, setTab] = useState("connection");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [unlockRequested, setUnlockRequested] = useState(false);
  const [unlockConfirmation, setUnlockConfirmation] = useState("");
  const [keys, setKeys] = useState(JSON.stringify(p.partitionKeys, null, 2));
  const [mode, setMode] = useState("uri");
  const [uriImport, setUriImport] = useState("");
  const [exportedUri, setExportedUri] = useState("");
  const [includePassword, setIncludePassword] = useState(false);
  const [uriStatus, setUriStatus] = useState("");
  const [uriOmissions, setUriOmissions] = useState<string[]>([]);
  const [hosts, setHosts] = useState(
    p.uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@]+@)?([^/?]+)/)?.[1] ||
      "127.0.0.1:27017",
  );
  const [srv, setSrv] = useState(p.uri.startsWith("mongodb+srv"));
  const set = (key: keyof Profile, value: any) =>
    setP((old) => ({ ...old, [key]: value }));
  const requiresUnlock =
    p.environment === "production" && !p.readOnly && unlockRequested;
  const invalidQueryTimeout =
    !Number.isInteger(p.queryTimeoutMS) ||
    p.queryTimeoutMS < 5000 ||
    p.queryTimeoutMS > 120000;
  const unlockValid =
    !requiresUnlock ||
    (p.name.trim().length > 0 && unlockConfirmation === p.name.trim());
  const setSsh = (key: string, value: any) =>
    setP((old) => ({ ...old, ssh: { ...old.ssh, [key]: value } }));
  const file = async (key: "caFile" | "certFile" | "privateKeyFile") => {
    const path = await api.request("files.choose", {
      kind: "open",
      title: key,
    });
    if (path) key === "privateKeyFile" ? setSsh(key, path) : set(key, path);
  };
  const normalized = () => {
    const result = { ...p, partitionKeys: JSON.parse(keys) };
    if (mode === "form")
      result.uri = `mongodb${srv ? "+srv" : ""}://${hosts}/${encodeURIComponent(p.database)}`;
    return result;
  };
  const parseUri = async () => {
    setUriStatus("");
    try {
      const result = await api.request("connections.parseUri", {
        uri: uriImport.trim(),
        name: p.name,
      });
      setP(result.profile);
      setSecrets(result.secrets);
      setKeys(JSON.stringify(result.profile.partitionKeys, null, 2));
      setHosts(
        result.profile.uri.match(
          /^mongodb(?:\+srv)?:\/\/(?:[^@]+@)?([^/?]+)/,
        )?.[1] || "127.0.0.1:27017",
      );
      setSrv(result.profile.uri.startsWith("mongodb+srv"));
      setMode("uri");
      setUriStatus(
        t(
          "URI 已解析，請確認欄位後儲存。",
          "URI parsed. Review the fields and save.",
        ),
      );
    } catch (e) {
      setUriStatus(message(e));
    }
  };
  const exportUri = async () => {
    if (!profile) return;
    setUriStatus("");
    try {
      const result = await api.request("connections.exportUri", {
        id: profile.id,
        includePassword,
      });
      setExportedUri(result.uri);
      setUriOmissions(result.omissions || []);
    } catch (e) {
      setUriStatus(message(e));
    }
  };
  const copyExportedUri = async () => {
    if (!exportedUri) return;
    await api.request("clipboard.write", { text: exportedUri });
    setUriStatus(t("URI 已複製到剪貼簿。", "URI copied to clipboard."));
  };
  const act = async (test: boolean, connectAfterSave = false) => {
    setBusy(true);
    setStatus("");
    try {
      const result = await api.request(
        test ? "connections.test" : "connections.save",
        { profile: normalized(), secrets },
      );
      if (test)
        setStatus(
          `✓ ${t("連線測試成功", "Connection verified")}${result.version && result.version !== "unknown" ? ` · ${result.version}` : ""}`,
        );
      else {
        saved(result.profile, connectAfterSave);
        close();
      }
    } catch (e) {
      const diagnostic = diagnoseConnectionError(message(e));
      setStatus(
        `${message(e)}\n${t(
          {
            network: "請檢查主機名稱、DNS、連接埠與網路路由。",
            tls: "請檢查 CA 憑證、用戶端憑證與伺服器主機名稱。",
            authentication: "請檢查帳號、密碼、authSource 與驗證機制。",
            authorization:
              "連線成功，但帳號沒有目標資料庫或 Collection 的權限。",
            timeout: "伺服器未及時回應，請檢查路由、防火牆與逾時設定。",
            unknown: "請檢查連線設定與伺服器紀錄。",
          }[diagnostic.kind],
          diagnostic.advice,
        )}`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      wide
      title={
        profile
          ? t("編輯連線", "Edit connection")
          : t("新增連線", "New connection")
      }
      close={close}
      footer={
        <>
          <span className="muted">
            {secure
              ? t(
                  "密碼由作業系統加密保護",
                  "Passwords protected by the operating system",
                )
              : t(
                  "密碼只保留於本次工作階段",
                  "Passwords kept for this session only",
                )}
          </span>
          <button
            disabled={busy || invalidQueryTimeout}
            onClick={() => void act(true)}
          >
            <PlugZap size={15} />
            {t("測試連線", "Test connection")}
          </button>
          <button
            disabled={busy || !unlockValid || invalidQueryTimeout}
            onClick={() => void act(false)}
          >
            {t("儲存連線", "Save connection")}
          </button>
          <button
            className="primary"
            disabled={busy || !unlockValid || invalidQueryTimeout}
            onClick={() => void act(false, true)}
          >
            <PlugZap size={15} />
            {t("儲存並連線", "Save & connect")}
          </button>
        </>
      }
    >
      <div className="dialog-tabs">
        {[
          ["connection", "連線", "Connection"],
          ["auth", "驗證", "Authentication"],
          ["tls", "TLS 憑證", "TLS"],
          ["ssh", "SSH 通道", "SSH tunnel"],
          ["advanced", "進階設定", "Advanced"],
        ].map(([id, zh, en]) => (
          <button
            key={id}
            aria-pressed={tab === id}
            className={tab === id ? "active" : ""}
            disabled={busy}
            onClick={() => setTab(id)}
          >
            {t(zh, en)}
          </button>
        ))}
      </div>
      {tab === "connection" && (
        <div className="form-grid">
          <Field label={t("名稱", "Name")}>
            <input
              name="connection-name"
              autoComplete="off"
              value={p.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field label={t("群組", "Group")}>
            <input
              name="connection-group"
              autoComplete="off"
              value={p.group}
              onChange={(e) => set("group", e.target.value)}
              placeholder={t("例如：開發環境", "e.g. Development")}
            />
          </Field>
          <div
            className={`connection-safety-summary full${p.environment === "production" && !p.readOnly ? " writable-production" : ""}`}
            role="status"
          >
            <span className={`environment-badge ${p.environment}`}>
              {p.environment.toUpperCase()}
            </span>
            <strong>
              {p.readOnly
                ? t("唯讀連線", "Read-only connection")
                : t("允許寫入", "Writes allowed")}
            </strong>
            <span className="connection-safety-copy">
              {p.environment === "production" && !p.readOnly
                ? t(
                    "此 Production 連線可寫入；儲存前需在進階設定確認連線名稱。",
                    "This Production connection can write. Confirm its name in Advanced before saving.",
                  )
                : t(
                    "開啟前確認環境與權限；資料庫帳號仍決定最終存取權。",
                    "Review the environment and access before opening. Database roles remain the final authority.",
                  )}
            </span>
            <button onClick={() => setTab("advanced")}>
              {t("調整環境與權限", "Change environment and access")}
            </button>
          </div>
          <Field label={t("服務類型", "Provider")}>
            <select
              name="connection-provider"
              value={p.provider}
              onChange={(e) => set("provider", e.target.value)}
            >
              <option value="mongodb">MongoDB / Atlas</option>
              <option value="cosmos">Cosmos DB · MongoDB RU</option>
            </select>
          </Field>
          <Field label={t("預設資料庫", "Default database")}>
            <input
              name="connection-database"
              autoComplete="off"
              value={p.database}
              onChange={(e) => set("database", e.target.value)}
            />
          </Field>
          <div className="full segmented">
            <button
              className={mode === "uri" ? "active" : ""}
              onClick={() => setMode("uri")}
            >
              Connection URI
            </button>
            <button
              className={mode === "form" ? "active" : ""}
              onClick={() => setMode("form")}
            >
              {t("表單輸入", "Form fields")}
            </button>
          </div>
          {mode === "uri" ? (
            <Field full label="MongoDB URI">
              <textarea
                name="connection-uri"
                autoComplete="off"
                rows={4}
                value={p.uri}
                onChange={(e) => set("uri", e.target.value)}
                spellCheck={false}
              />
              <small>
                {t(
                  "支援 mongodb:// 與 mongodb+srv://。可直接貼上完整連線字串。",
                  "Supports mongodb:// and mongodb+srv://. Paste your full connection string here.",
                )}
              </small>
            </Field>
          ) : (
            <>
              <Field
                full
                label={t("主機（多節點以逗號分隔）", "Hosts (comma separated)")}
              >
                <input
                  name="connection-hosts"
                  autoComplete="off"
                  value={hosts}
                  onChange={(e) => setHosts(e.target.value)}
                />
              </Field>
              <label className="checkbox full">
                <input
                  name="connection-srv"
                  type="checkbox"
                  checked={srv}
                  onChange={(e) => setSrv(e.target.checked)}
                />
                DNS SRV
              </label>
            </>
          )}
          <div className="uri-tools full">
            <div className="section-heading">
              <strong>{t("URI 工具", "URI tools")}</strong>
              <span className="muted small">
                {t(
                  "可從 URI 填入表單，或匯出已儲存連線。",
                  "Import into this form or export the saved connection.",
                )}
              </span>
            </div>
            <Field full label={t("匯入 URI", "Import URI")}>
              <textarea
                rows={3}
                value={uriImport}
                onChange={(e) => setUriImport(e.target.value)}
                placeholder="mongodb://user:password@host:27017/database?authSource=admin"
                spellCheck={false}
              />
            </Field>
            <div className="toolbar">
              <button
                disabled={!uriImport.trim() || busy}
                onClick={() => void parseUri()}
              >
                <Upload size={14} />
                {t("解析 URI", "Parse URI")}
              </button>
              <button
                disabled={!profile || busy}
                onClick={() => void exportUri()}
              >
                <Download size={14} />
                {t("匯出已儲存 URI", "Export saved URI")}
              </button>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={includePassword}
                  onChange={(e) => setIncludePassword(e.target.checked)}
                />
                {t("包含密碼", "Include password")}
              </label>
            </div>
            {includePassword && (
              <div className="warning notice">
                {t(
                  "URI 會包含可直接使用的密碼；請只在安全通道傳送，使用後立即清除。",
                  "The URI will contain a usable password. Share it only through a secure channel and clear it after use.",
                )}
              </div>
            )}
            {exportedUri && (
              <div className="input-action">
                <input
                  readOnly
                  value={exportedUri}
                  aria-label={t("匯出的 URI", "Exported URI")}
                />
                <button
                  aria-label={t("複製 URI", "Copy URI")}
                  onClick={() => void copyExportedUri()}
                >
                  <Copy size={15} />
                </button>
              </div>
            )}
            {uriOmissions.length > 0 && (
              <div className="notice warning">
                {t(
                  `URI 無法包含以下設定，請在 Irwin 連線設定中保留：${uriOmissions.join("、")}`,
                  `This URI cannot include these settings; keep them in Irwin: ${uriOmissions.join(", ")}`,
                )}
              </div>
            )}
            {uriStatus && (
              <div className="notice" role="status">
                {uriStatus}
              </div>
            )}
          </div>
        </div>
      )}
      {tab === "auth" && (
        <div className="form-grid">
          <Field label={t("驗證方式", "Authentication method")}>
            <select
              value={p.authMechanism}
              onChange={(e) => set("authMechanism", e.target.value)}
            >
              <option value="DEFAULT">Auto / None</option>
              <option>SCRAM-SHA-256</option>
              <option>SCRAM-SHA-1</option>
              <option>MONGODB-X509</option>
            </select>
          </Field>
          <Field label="authSource">
            <input
              value={p.authSource}
              onChange={(e) => set("authSource", e.target.value)}
            />
          </Field>
          <Field label={t("使用者名稱", "Username")}>
            <input
              value={p.username}
              autoComplete="off"
              onChange={(e) => set("username", e.target.value)}
            />
          </Field>
          <Field
            label={t(
              "密碼（未修改則保留）",
              "Password (unchanged retains saved value)",
            )}
          >
            <input
              type="password"
              autoComplete="new-password"
              value={secrets.password ?? ""}
              placeholder={profile ? "••••••••" : ""}
              onChange={(e) =>
                setSecrets({ ...secrets, password: e.target.value })
              }
            />
          </Field>
          <div className="info full">
            <ShieldCheck size={18} />
            {t(
              "Ubuntu 沒有安全金鑰服務時，秘密只保留於本次工作階段。",
              "Without a secure key service on Ubuntu, secrets are kept for this session only.",
            )}
          </div>
        </div>
      )}
      {tab === "tls" && (
        <div className="form-grid">
          <label className="checkbox full">
            <input
              type="checkbox"
              checked={p.tls}
              onChange={(e) => set("tls", e.target.checked)}
            />
            {t(
              "使用 TLS（Atlas SRV 預設啟用）",
              "Use TLS (enabled by default for Atlas SRV)",
            )}
          </label>
          {(["caFile", "certFile"] as const).map((key) => (
            <Field
              full
              key={key}
              label={
                key === "caFile"
                  ? "CA certificate"
                  : "Client certificate / key PEM"
              }
            >
              <div className="input-action">
                <input
                  value={p[key]}
                  onChange={(e) => set(key, e.target.value)}
                />
                <button onClick={() => void file(key)}>
                  <FolderOpen size={16} />
                </button>
              </div>
            </Field>
          ))}
          <Field full label={t("憑證私鑰密語", "Certificate key password")}>
            <input
              type="password"
              value={secrets.certPassword ?? ""}
              onChange={(e) =>
                setSecrets({ ...secrets, certPassword: e.target.value })
              }
            />
          </Field>
          <p className="hint full">
            {t(
              "始終驗證憑證與主機名稱。",
              "Certificate and hostname verification remain enabled.",
            )}
          </p>
        </div>
      )}
      {tab === "ssh" && (
        <div className="form-grid">
          <label className="checkbox full">
            <input
              type="checkbox"
              checked={p.ssh.enabled}
              onChange={(e) => setSsh("enabled", e.target.checked)}
            />
            {t("啟用 SSH 單一目標轉發", "Enable SSH single-target forwarding")}
          </label>
          <Field label="SSH host">
            <input
              value={p.ssh.host}
              onChange={(e) => setSsh("host", e.target.value)}
            />
          </Field>
          <Field label="SSH port">
            <input
              type="number"
              value={p.ssh.port}
              onChange={(e) => setSsh("port", Number(e.target.value))}
            />
          </Field>
          <Field label="SSH username">
            <input
              value={p.ssh.username}
              onChange={(e) => setSsh("username", e.target.value)}
            />
          </Field>
          <Field label="SSH password">
            <input
              type="password"
              value={secrets.sshPassword ?? ""}
              onChange={(e) =>
                setSecrets({ ...secrets, sshPassword: e.target.value })
              }
            />
          </Field>
          <Field full label={t("SSH 私鑰檔", "SSH private key")}>
            <div className="input-action">
              <input
                value={p.ssh.privateKeyFile}
                onChange={(e) => setSsh("privateKeyFile", e.target.value)}
              />
              <button onClick={() => void file("privateKeyFile")}>
                <FolderOpen size={16} />
              </button>
            </div>
          </Field>
          <Field full label={t("私鑰密語", "Key passphrase")}>
            <input
              type="password"
              value={secrets.sshPassphrase ?? ""}
              onChange={(e) =>
                setSecrets({ ...secrets, sshPassphrase: e.target.value })
              }
            />
          </Field>
          <Field full label="Host SHA256 fingerprint (hex)">
            <input
              value={p.ssh.hostFingerprint}
              onChange={(e) => setSsh("hostFingerprint", e.target.value.trim())}
            />
            <small>
              {t(
                "首次測試會顯示指紋，向管理者核對後填入。",
                "The first test shows the fingerprint. Verify it with your administrator before saving.",
              )}
            </small>
          </Field>
        </div>
      )}
      {tab === "advanced" && (
        <div className="form-grid">
          <Field label={t("環境", "Environment")}>
            <select
              value={p.environment}
              onChange={(e) => {
                setP((old) =>
                  withEnvironment(
                    old,
                    e.target.value as Profile["environment"],
                  ),
                );
                setUnlockRequested(false);
                setUnlockConfirmation("");
              }}
            >
              <option value="development">Development</option>
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
          </Field>
          <label className="checkbox field">
            <input
              type="checkbox"
              checked={p.readOnly}
              onChange={(e) => {
                set("readOnly", e.target.checked);
                setUnlockRequested(!e.target.checked);
                setUnlockConfirmation("");
              }}
            />
            <span>
              {t("以唯讀模式開啟", "Open as read-only")}
              <small>
                {t(
                  "應用程式會封鎖 GUI 寫入、Shell 執行與匯入／還原；資料庫帳號仍必須使用唯讀角色。",
                  "The app blocks GUI writes, Shell execution, and import/restore. The database account must still use a read-only role.",
                )}
              </small>
            </span>
          </label>
          {p.environment === "production" && !p.readOnly && (
            <div className="warning notice full" role="status">
              {t(
                "此 Production 連線允許寫入。請同時確認資料庫帳號使用最低必要權限；應用程式設定不能取代資料庫權限。",
                "This Production connection allows writes. Use the least privileged database role; app settings cannot replace database permissions.",
              )}
            </div>
          )}
          {requiresUnlock && (
            <Field
              full
              label={t(
                "輸入連線名稱以解除 Production 唯讀",
                "Enter the connection name to disable Production read-only",
              )}
            >
              <input
                name="production-unlock-confirmation"
                autoComplete="off"
                value={unlockConfirmation}
                onChange={(e) => setUnlockConfirmation(e.target.value)}
              />
            </Field>
          )}
          <Field label="Replica set">
            <input
              value={p.replicaSet}
              onChange={(e) => set("replicaSet", e.target.value)}
            />
          </Field>
          <Field label={t("連線逾時（毫秒）", "Connection timeout (ms)")}>
            <input
              type="number"
              min={1000}
              max={120000}
              value={p.timeoutMS}
              onChange={(e) => set("timeoutMS", Number(e.target.value))}
            />
          </Field>
          <Field
            full
            label={t(
              "互動查詢逾時上限（秒）",
              "Interactive query timeout (seconds)",
            )}
          >
            <input
              name="query-timeout-seconds"
              type="number"
              min={5}
              max={120}
              step={1}
              value={p.queryTimeoutMS / 1000}
              aria-invalid={invalidQueryTimeout}
              onChange={(e) =>
                set("queryTimeoutMS", Number(e.target.value) * 1000)
              }
            />
            <div
              className="query-timeout-presets"
              aria-label={t("常用逾時設定", "Common timeouts")}
            >
              {[5, 15, 30, 60, 120].map((seconds) => (
                <button
                  key={seconds}
                  type="button"
                  aria-pressed={p.queryTimeoutMS === seconds * 1000}
                  onClick={() => set("queryTimeoutMS", seconds * 1000)}
                >
                  {seconds} s
                </button>
              ))}
            </div>
            {invalidQueryTimeout && (
              <small className="preference-error" role="alert">
                {t(
                  "請輸入 5 至 120 秒的整數。",
                  "Enter a whole number from 5 to 120 seconds.",
                )}
              </small>
            )}
            <small>
              {t(
                "適用於 Collection 查詢、Aggregation 與 Explain；不影響完整匯出或 Shell。",
                "Applies to Collection queries, Aggregation and Explain; full exports and Shell are unchanged.",
              )}
            </small>
          </Field>
          <Field label="Read preference">
            <select
              value={p.readPreference}
              onChange={(e) => set("readPreference", e.target.value)}
            >
              {[
                "primary",
                "primaryPreferred",
                "secondary",
                "secondaryPreferred",
                "nearest",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="Write concern">
            <select
              value={p.writeConcern}
              onChange={(e) => set("writeConcern", e.target.value)}
            >
              <option value="majority">majority</option>
              <option value="1">1</option>
            </select>
          </Field>
          <label className="checkbox full">
            <input
              type="checkbox"
              checked={p.directConnection}
              onChange={(e) => set("directConnection", e.target.checked)}
            />
            directConnection
          </label>
          <Field
            full
            label={t(
              "分區鍵映射（DB.Collection → 欄位路徑）",
              "Partition keys (DB.Collection → field path)",
            )}
          >
            <textarea
              rows={5}
              value={keys}
              onChange={(e) => setKeys(e.target.value)}
              placeholder={'{"mydb.orders":"tenantId"}'}
              spellCheck={false}
            />
            <small>
              {t(
                "Cosmos DB RU 寫入前必須設定。",
                "Required before writing to Cosmos DB RU.",
              )}
            </small>
          </Field>
        </div>
      )}
      {status && (
        <div
          className={status.startsWith("✓") ? "success notice" : "error notice"}
          role="status"
        >
          {status}
        </div>
      )}
    </Modal>
  );
}
