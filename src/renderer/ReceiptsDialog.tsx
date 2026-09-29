import { useEffect, useMemo, useState } from "react";
import type { OperationReceipt } from "../shared/operation-safety";
import { api, message, Modal, useUi } from "./ui";
import {
  filterReceipts,
  receiptActionCopy,
  receiptModeCopy,
  receiptStatusCopy,
  type ReceiptFilters,
} from "./receipt-view";

export default function ReceiptsDialog({
  close,
  notify,
}: {
  close(): void;
  notify(text: string, error?: boolean): void;
}) {
  const { t, language } = useUi();
  const [receipts, setReceipts] = useState<OperationReceipt[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [filters, setFilters] = useState<ReceiptFilters>({});
  const [visibleCount, setVisibleCount] = useState(50);
  const filtered = useMemo(
    () => filterReceipts(receipts, filters),
    [receipts, filters],
  );
  const locale = language === "zh" ? "zh-TW" : "en-US";
  const number = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const setFilter = <K extends keyof ReceiptFilters>(
    key: K,
    value: ReceiptFilters[K],
  ) => {
    setFilters((old) => ({ ...old, [key]: value }));
    setVisibleCount(50);
  };
  const load = () =>
    api
      .request("operationReceipts.list", {})
      .then(setReceipts)
      .catch((cause) => setError(message(cause)));
  useEffect(() => {
    void load();
  }, []);
  const exportJson = async () => {
    try {
      const path: string | null = await api.request("files.choose", {
        kind: "save",
        title: t("匯出操作收據", "Export operation receipts"),
        defaultPath: "irwin-operation-receipts.json",
      });
      if (!path) return;
      setBusy(true);
      await api.request("reports.export", {
        path,
        content: JSON.stringify(
          { generatedAt: new Date().toISOString(), receipts },
          null,
          2,
        ),
      });
      notify(t("操作收據已匯出", "Operation receipts exported"));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    try {
      setBusy(true);
      await api.request("operationReceipts.clear", {});
      setReceipts([]);
      setConfirmClear(false);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      wide
      resizable
      title={t("操作收據", "Operation receipts")}
      close={close}
      footer={
        <>
          <button disabled={busy} onClick={() => void load()}>
            {t("重新整理", "Refresh")}
          </button>
          <button
            disabled={busy || !receipts.length}
            onClick={() => void exportJson()}
          >
            {t("匯出 JSON", "Export JSON")}
          </button>
          <button
            disabled={busy || !receipts.length}
            onClick={() => setConfirmClear(true)}
          >
            {t("清除本機收據", "Clear local receipts")}
          </button>
          <button onClick={close}>{t("關閉", "Close")}</button>
        </>
      }
    >
      <p className="muted">
        {t(
          "僅記錄此裝置上的操作結果，可刪除；這不是資料庫稽核日誌。",
          "Local, deletable operation outcomes. This is not a database audit log.",
        )}
      </p>
      {confirmClear && (
        <div
          className="receipt-clear-confirm"
          role="alertdialog"
          aria-label={t("確認清除本機收據", "Confirm clearing local receipts")}
        >
          <span>
            {t(
              "只會刪除此裝置的操作收據，不會更動 MongoDB 資料。",
              "This deletes local receipts only; MongoDB data is unchanged.",
            )}
          </span>
          <button disabled={busy} onClick={() => void clear()}>
            {t("確認清除", "Confirm clear")}
          </button>
          <button onClick={() => setConfirmClear(false)}>
            {t("取消", "Cancel")}
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="receipt-filters">
        <label>
          {t("搜尋連線或目標", "Search connection or target")}
          <input
            type="search"
            autoComplete="off"
            value={filters.search || ""}
            onChange={(event) => setFilter("search", event.target.value)}
          />
        </label>
        <label>
          {t("狀態", "Status")}
          <select
            aria-label={t("狀態", "Status")}
            value={filters.status || ""}
            onChange={(event) =>
              setFilter(
                "status",
                (event.target.value || undefined) as ReceiptFilters["status"],
              )
            }
          >
            <option value="">{t("所有狀態", "All statuses")}</option>
            {(["completed", "failed", "cancelled", "unknown"] as const).map(
              (status) => (
                <option key={status} value={status}>
                  {t(...receiptStatusCopy(status))}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          {t("環境", "Environment")}
          <select
            value={filters.environment || ""}
            onChange={(event) =>
              setFilter(
                "environment",
                (event.target.value ||
                  undefined) as ReceiptFilters["environment"],
              )
            }
          >
            <option value="">{t("所有環境", "All environments")}</option>
            <option value="development">Development</option>
            <option value="staging">Staging</option>
            <option value="production">Production</option>
          </select>
        </label>
        <label>
          {t("開始日期", "From date")}
          <input
            type="date"
            value={filters.fromDate || ""}
            onChange={(event) => setFilter("fromDate", event.target.value)}
          />
        </label>
        <label>
          {t("結束日期", "Through date")}
          <input
            type="date"
            value={filters.toDate || ""}
            onChange={(event) => setFilter("toDate", event.target.value)}
          />
        </label>
      </div>
      <p className="muted" role="status">
        {t(
          `顯示 ${number.format(Math.min(filtered.length, visibleCount))}／${number.format(filtered.length)} 筆符合條件的收據`,
          `Showing ${number.format(Math.min(filtered.length, visibleCount))} of ${number.format(filtered.length)} matching receipts`,
        )}
      </p>
      <div className="receipt-list">
        {!filtered.length && (
          <p className="muted">
            {receipts.length
              ? t("沒有符合條件的收據。", "No receipts match these filters.")
              : t("尚無操作收據。", "No operation receipts yet.")}
          </p>
        )}
        {filtered.slice(0, visibleCount).map((receipt) => (
          <article className="receipt-item" key={receipt.id}>
            <strong>
              {t(...receiptActionCopy(receipt.action))}
              <span className={`receipt-status ${receipt.status}`}>
                {t(...receiptStatusCopy(receipt.status))}
              </span>
            </strong>
            <span>
              {receipt.connectionName} ({receipt.environment}) /{" "}
              {receipt.namespace}
            </span>
            <small>
              {date.format(new Date(receipt.occurredAt))} ·{" "}
              {t(...receiptModeCopy(receipt.mode))} ·{" "}
              {receipt.scope === "database"
                ? t("資料庫", "Database")
                : receipt.scope === "collection"
                  ? t("集合", "Collection")
                  : t("檔案", "File")}
            </small>
            {(receipt.processed !== undefined ||
              receipt.failed !== undefined ||
              receipt.bytes !== undefined) && (
              <small>
                {[
                  receipt.processed === undefined
                    ? null
                    : `${t("已知成功", "Known successful")}: ${number.format(receipt.processed)}`,
                  receipt.failed === undefined
                    ? null
                    : `${t("已知失敗", "Known failed")}: ${number.format(receipt.failed)}`,
                  receipt.bytes === undefined
                    ? null
                    : `${number.format(receipt.bytes)} B`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            )}
            {receipt.outputFile && (
              <small>
                {t("檔名", "File")}: {receipt.outputFile}
              </small>
            )}
            {receipt.errorCode && <small>{receipt.errorCode}</small>}
          </article>
        ))}
        {filtered.length > visibleCount && (
          <button onClick={() => setVisibleCount((count) => count + 50)}>
            {t("顯示接下來 50 筆", "Show next 50")}
          </button>
        )}
      </div>
    </Modal>
  );
}
