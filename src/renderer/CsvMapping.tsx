import { Plus, Trash2 } from "lucide-react";
import type { CsvColumn } from "../shared/contracts";
import { useUi } from "./ui";
export function CsvMapping({
  value,
  onChange,
  direction,
}: {
  value: string;
  onChange(value: string): void;
  direction: string;
}) {
  const { t } = useUi();
  const columns: CsvColumn[] = JSON.parse(value);
  const set = (index: number, key: keyof CsvColumn, value: string) =>
    onChange(
      JSON.stringify(
        columns.map((c, i) => (i === index ? { ...c, [key]: value } : c)),
      ),
    );
  return (
    <div className="full">
      <div className="section-heading">
        <strong>{t("欄位對應", "Column mapping")}</strong>
        <button
          onClick={() =>
            onChange(
              JSON.stringify([
                ...columns,
                { source: "", target: "", type: "string", empty: "string" },
              ]),
            )
          }
        >
          <Plus size={13} />
          {t("新增欄位", "Add field")}
        </button>
      </div>
      {columns.length ? (
        <div className="mapping-table">
          <div className="mapping-row mapping-head">
            <span>CSV {t("欄位", "column")}</span>
            <span>{t("文件欄位路徑", "Document field path")}</span>
            <span>{t("資料型別", "Type")}</span>
            <span>{t("空白值", "Empty values")}</span>
            <span />
          </div>
          {columns.map((col, i) => (
            <div className="mapping-row" key={i}>
              <input
                aria-label={`CSV column ${i + 1}`}
                value={col.source}
                onChange={(e) => set(i, "source", e.target.value)}
              />
              <input
                aria-label={`Field path ${i + 1}`}
                value={col.target}
                placeholder={t("完整文件", "Whole document")}
                onChange={(e) => set(i, "target", e.target.value)}
              />
              <select
                aria-label={`Type ${i + 1}`}
                value={col.type}
                onChange={(e) => set(i, "type", e.target.value)}
              >
                {[
                  "string",
                  "int32",
                  "int64",
                  "double",
                  "decimal",
                  "boolean",
                  "date",
                  "objectId",
                  "json",
                ].map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
              <select
                aria-label={`Empty value ${i + 1}`}
                value={col.empty}
                onChange={(e) => set(i, "empty", e.target.value)}
              >
                <option value="string">{t("空字串", "Empty string")}</option>
                <option value="null">null</option>
                <option value="omit">{t("略過欄位", "Omit field")}</option>
              </select>
              <button
                className="icon"
                aria-label={`Remove column ${i + 1}`}
                onClick={() =>
                  onChange(JSON.stringify(columns.filter((_, n) => n !== i)))
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">
          {direction === "export"
            ? t(
                "預設將完整文件放入單一 JSON 欄位，保留所有欄位與型別；也可自訂要匯出的欄位。",
                "Export complete documents as a JSON column to preserve all fields and types, or add fields to customize.",
              )
            : t(
                "選擇 CSV 檔案後即可預覽並設定欄位。",
                "Choose a CSV file to preview and map its columns.",
              )}
        </p>
      )}
    </div>
  );
}
export function CsvPreview({
  preview,
}: {
  preview: { columns: string[]; rows: Record<string, string>[] };
}) {
  const { t } = useUi();
  return (
    <div className="full">
      <div className="section-heading">
        <strong>{t("資料預覽", "Data preview")}</strong>
        <span className="muted small">{t("最多 10 筆", "Up to 10 rows")}</span>
      </div>
      <div className="csv-preview">
        <table>
          <thead>
            <tr>
              {preview.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, i) => (
              <tr key={i}>
                {preview.columns.map((c) => (
                  <td key={c} title={row[c]}>
                    {String(row[c]).slice(0, 120)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
