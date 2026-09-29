import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import type { CsvColumn, TransferInput, Profile } from "../shared/contracts";
import { Modal, Field, useUi, api, message } from "./ui";
import { CsvMapping, CsvPreview } from "./CsvMapping";
import { requiredTransferConfirmation } from "../shared/operation-safety";
export default function TransferDialog({
  initial,
  close,
  started,
  readOnly: initialReadOnly = false,
}: {
  initial: Partial<TransferInput> & { connectionId: string; database: string };
  close(): void;
  started(id: string): void;
  readOnly?: boolean;
}) {
  const { t } = useUi();
  const [p, setP] = useState<TransferInput>({
    collection: "",
    direction: "export",
    format: "json",
    path: "",
    mode: "insert",
    filter: "{}",
    sort: "{}",
    projection: "{}",
    limit: 0,
    csvColumns: [],
    drop: false,
    confirmation: "",
    sourceVersion: "",
    ...initial,
  });
  const [mapping, setMapping] = useState(
    JSON.stringify(initial.csvColumns || [], null, 2),
  );
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [presets, setPresets] = useState<any[]>([]),
    [presetId, setPresetId] = useState(""),
    [presetName, setPresetName] = useState("");
  const selectedProfile = profiles.find(
    (profile) => profile.id === p.connectionId,
  );
  const readOnly = selectedProfile?.readOnly ?? initialReadOnly;
  const confirmationTarget = requiredTransferConfirmation(
    p,
    selectedProfile?.environment || "development",
  );
  const [preview, setPreview] = useState<any>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void Promise.all([
      api.request("transferPresets.list", {}),
      api.request("connections.list", {}),
    ])
      .then(([saved, profiles]) => {
        setPresets(saved);
        setProfiles(profiles);
      })
      .catch((e) => setError(message(e)));
  }, []);
  const savePreset = async () => {
    try {
      const saved = await api.request("transferPresets.save", {
        id: presetId || crypto.randomUUID(),
        name: presetName.trim(),
        input: { ...p, csvColumns: JSON.parse(mapping) },
      });
      setPresets((old) => [...old.filter((v) => v.id !== saved.id), saved]);
      setPresetId(saved.id);
      setError("");
    } catch (e) {
      setError(message(e));
    }
  };
  const set = (key: keyof TransferInput, value: any) =>
    setP((old) => ({
      ...old,
      [key]: value,
      ...([
        "database",
        "collection",
        "direction",
        "format",
        "mode",
        "drop",
      ].includes(key)
        ? { confirmation: "" }
        : {}),
    }));
  const choose = async () => {
    try {
      const directory = !p.collection && p.format !== "bson";
      const path = await api.request("files.choose", {
        kind: directory
          ? "directory"
          : p.direction === "export"
            ? "save"
            : "open",
        title: t("選擇資料檔案或目錄", "Choose transfer file or directory"),
        defaultPath:
          p.direction === "export"
            ? `${p.collection || p.database}.${p.format === "bson" ? "archive.gz" : p.format === "json" ? "jsonl" : "csv"}`
            : undefined,
      });
      if (path) {
        set("path", path);
        if (p.format === "csv" && p.direction === "import" && p.collection) {
          const result = await api.request("transferJobs.preview", { path });
          setPreview(result);
          const columns: CsvColumn[] =
            result.mapping ||
            result.columns.map((key: string) => ({
              source: key,
              target: key,
              type: "string",
              empty: "string",
            }));
          if (!JSON.parse(mapping).length)
            setMapping(JSON.stringify(columns, null, 2));
        }
      }
    } catch (e) {
      setError(message(e));
    }
  };
  const start = async () => {
    if (confirmationTarget && p.confirmation !== confirmationTarget) {
      setError(
        t(
          `請輸入 ${confirmationTarget} 確認目標。`,
          `Type ${confirmationTarget} to confirm the target.`,
        ),
      );
      return;
    }
    if (readOnly && p.direction === "import") {
      setError(
        t(
          "此連線已設為唯讀，無法執行匯入或還原。",
          "This connection is read-only; import and restore are blocked.",
        ),
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api.request("transferJobs.start", {
        ...p,
        csvColumns: JSON.parse(mapping),
      });
      started(result.jobId);
      close();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      wide
      title={t("匯入與匯出", "Import & export")}
      close={close}
      footer={
        <>
          <span className="muted">
            {selectedProfile?.name || p.connectionId} / {p.database}
            {p.collection ? `.${p.collection}` : " · ALL COLLECTIONS"} ·{" "}
            {p.format.toUpperCase()}
            {p.direction === "import" ? ` · ${p.mode}` : ""}
          </span>
          <button onClick={close}>{t("取消", "Cancel")}</button>
          <button
            className="primary"
            disabled={
              busy ||
              !p.path ||
              (readOnly && p.direction === "import") ||
              !!(confirmationTarget && p.confirmation !== confirmationTarget)
            }
            onClick={() => void start()}
          >
            {t("開始任務", "Start transfer")}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <details className="transfer-presets full">
          <summary>
            {t("傳輸範本", "Transfer presets")}
            <small>
              {t("選用或儲存常用設定", "Load or save frequently used settings")}
            </small>
          </summary>
          <div className="transfer-preset-fields">
            <Field label={t("傳輸範本", "Transfer preset")}>
              <select
                name="transfer-preset"
                aria-label={t("傳輸範本", "Transfer preset")}
                value={presetId}
                disabled={busy}
                onChange={(e) => {
                  const saved = presets.find((v) => v.id === e.target.value);
                  setPresetId(e.target.value);
                  setPresetName(saved?.name || "");
                  if (saved) {
                    setP({
                      ...saved.input,
                      path: "",
                      drop: false,
                      confirmation: "",
                    });
                    setMapping(JSON.stringify(saved.input.csvColumns, null, 2));
                    setPreview(undefined);
                    setError("");
                  }
                }}
              >
                <option value="">{t("自訂任務", "Custom transfer")}</option>
                {presets.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("範本名稱", "Preset name")}>
              <input
                name="transfer-preset-name"
                autoComplete="off"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
              />
            </Field>
            <button
              disabled={busy || !presetName.trim()}
              onClick={() => void savePreset()}
            >
              {t("儲存範本", "Save preset")}
            </button>
            <button
              disabled={busy || !presetId}
              onClick={() =>
                void api
                  .request("transferPresets.delete", { id: presetId })
                  .then(() => {
                    setPresets((old) => old.filter((v) => v.id !== presetId));
                    setPresetId("");
                    setPresetName("");
                  })
                  .catch((e) => setError(message(e)))
              }
            >
              {t("移除範本", "Remove preset")}
            </button>
            <small>
              {t(
                "範本保存目標、查詢與欄位映射；套用後需重新選擇路徑及確認覆蓋。",
                "Presets retain target, query and mapping. Choose a path and confirm overwrite again after loading.",
              )}
            </small>
          </div>
        </details>
        <h3 className="transfer-section full">
          {t("1. 確認目標", "1. Confirm target")}
        </h3>
        <Field full label={t("目標連線", "Connection")}>
          <select
            name="transfer-connection"
            value={p.connectionId}
            onChange={(e) =>
              setP((old) => ({
                ...old,
                connectionId: e.target.value,
                path: "",
                drop: false,
                confirmation: "",
              }))
            }
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </Field>
        {readOnly && (
          <div className="read-only-notice full" role="status">
            {t(
              "此連線為唯讀模式；可匯出，但無法匯入或還原。請同時使用資料庫端唯讀帳號。",
              "This connection is read-only. Export is available, while import and restore are blocked. Use a database-side read-only account as well.",
            )}
          </div>
        )}
        <div className="transfer-summary full">
          <strong>
            {p.direction === "export"
              ? t("即將匯出", "Ready to export")
              : t("即將匯入", "Ready to import")}
          </strong>
          <span>
            {selectedProfile?.name || p.connectionId} (
            {selectedProfile?.environment || "development"}) / {p.database}
            {p.collection ? `.${p.collection}` : " · ALL COLLECTIONS"}
            {` · ${p.format.toUpperCase()}`}
            {p.direction === "import" ? ` · ${p.mode}` : ""}
          </span>
          <small>
            {p.direction === "export"
              ? t(
                  "完整匯出會串流處理資料；取消後會保留部分檔案並標示為未完成。",
                  "Exports stream data. Cancelling leaves a partial file marked as incomplete.",
                )
              : t(
                  "取消不會回滾已寫入的文件；請先確認目標、模式與覆蓋範圍。",
                  "Cancelling does not roll back documents already written. Confirm the target, mode, and overwrite scope first.",
                )}
          </small>
          {p.direction === "import" && (
            <small>
              {t(
                "影響筆數：未知；可能部分成功；已寫入的資料不可由取消動作回滾。",
                "Affected rows: unknown. Partial success is possible. Cancellation cannot roll back completed writes.",
              )}
            </small>
          )}
        </div>
        <h3 className="transfer-section full">
          {t("2. 選擇內容與檔案", "2. Choose content and file")}
        </h3>
        <Field label={t("方向", "Direction")}>
          <select
            name="transfer-direction"
            value={p.direction}
            onChange={(e) => {
              set("direction", e.target.value);
              set("path", "");
            }}
          >
            <option value="export">{t("匯出", "Export")}</option>
            <option value="import" disabled={readOnly}>
              {t("匯入", "Import")}
            </option>
          </select>
        </Field>
        <Field label={t("格式", "Format")}>
          <select
            name="transfer-format"
            value={p.format}
            onChange={(e) => {
              set("format", e.target.value);
              set("path", "");
            }}
          >
            <option value="json">Extended JSON / JSONL</option>
            <option value="csv">CSV</option>
            <option value="bson">BSON archive (.gz)</option>
          </select>
        </Field>
        <Field label="Database">
          <input
            name="transfer-database"
            autoComplete="off"
            value={p.database}
            onChange={(e) => set("database", e.target.value)}
          />
        </Field>
        <Field
          label={t(
            "Collection（留空代表整個 DB）",
            "Collection (empty = entire DB)",
          )}
        >
          <input
            name="transfer-collection"
            autoComplete="off"
            value={p.collection}
            onChange={(e) => {
              set("collection", e.target.value);
              set("path", "");
            }}
          />
        </Field>
        <Field full label={t("檔案／目錄", "File / directory")}>
          <div className="input-action">
            <input
              name="transfer-path"
              readOnly
              value={p.path}
              placeholder={t("使用選擇器指定路徑", "Choose a path")}
            />
            <button
              aria-label={t("選擇檔案", "Choose file")}
              onClick={() => void choose()}
            >
              <FolderOpen size={16} />
            </button>
          </div>
        </Field>
        {p.direction === "import" && p.format !== "bson" && (
          <Field full label={t("遇到既有文件", "Existing documents")}>
            <select
              value={p.mode}
              onChange={(e) => set("mode", e.target.value)}
            >
              <option value="insert">
                {t(
                  "只新增；重複鍵記入失敗清單",
                  "Insert only; report duplicate keys",
                )}
              </option>
              <option value="replace">
                {t(
                  "依 _id／分區鍵取代整筆文件",
                  "Replace whole document by _id / partition key",
                )}
              </option>
            </select>
            {p.mode === "replace" && (
              <small className="warning">
                {t(
                  "匯入資料未包含的既有欄位會被移除。",
                  "Existing fields absent from imported documents will be removed.",
                )}
              </small>
            )}
          </Field>
        )}
        {p.format === "bson" && (
          <div className="info full">
            {t(
              "BSON 還原使用同版本／相容 FCV 的備份；Cosmos RU 未開放此路徑。",
              "Restore BSON to the same major version / compatible FCV. Cosmos RU is not enabled for this path.",
            )}
          </div>
        )}
        {p.format === "bson" && p.direction === "import" && (
          <>
            <label className="checkbox full">
              <input
                type="checkbox"
                checked={p.drop}
                onChange={(e) => set("drop", e.target.checked)}
              />
              {t(
                "還原前刪除目標 Collection",
                "Drop target collections before restore",
              )}
            </label>
          </>
        )}
        {confirmationTarget && (
          <Field
            full
            label={`${t("輸入完整目標確認", "Type full target to confirm")}: ${confirmationTarget}`}
          >
            <input
              name="transfer-confirmation"
              autoComplete="off"
              value={p.confirmation}
              onChange={(e) => set("confirmation", e.target.value)}
            />
          </Field>
        )}
        {p.format === "bson" && p.direction === "import" && (
          <Field
            full
            label={t(
              "外部備份的來源 MongoDB 版本",
              "Source MongoDB version for external backups",
            )}
          >
            <input
              value={p.sourceVersion}
              placeholder={t(
                "本工具的備份會自動讀取；外部備份例如 8.0.18",
                "Read automatically for this app’s backups; e.g. 8.0.18 for external archives",
              )}
              onChange={(e) => set("sourceVersion", e.target.value)}
            />
          </Field>
        )}
        {p.format === "csv" && (
          <CsvMapping
            value={mapping}
            onChange={setMapping}
            direction={p.direction}
          />
        )}
        {preview && <CsvPreview preview={preview} />}
        {p.direction === "export" && p.format !== "bson" && (
          <>
            <Field full label="Filter">
              <textarea
                name="transfer-filter"
                autoComplete="off"
                rows={2}
                value={p.filter}
                onChange={(e) => set("filter", e.target.value)}
              />
            </Field>
            <Field label="Sort">
              <input
                name="transfer-sort"
                autoComplete="off"
                value={p.sort}
                onChange={(e) => set("sort", e.target.value)}
              />
            </Field>
            <Field label="Projection">
              <input
                name="transfer-projection"
                autoComplete="off"
                value={p.projection}
                onChange={(e) => set("projection", e.target.value)}
              />
            </Field>
            <Field label="Limit (0 = all)">
              <input
                type="number"
                name="transfer-limit"
                min={0}
                value={p.limit}
                onChange={(e) => set("limit", Number(e.target.value))}
              />
            </Field>
          </>
        )}
      </div>
      {error && <div className="error notice">{error}</div>}
    </Modal>
  );
}
