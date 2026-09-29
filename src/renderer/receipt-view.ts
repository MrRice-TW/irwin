import type { OperationReceipt } from "../shared/operation-safety";

type Copy = readonly [zh: string, en: string];

const actions: Record<string, Copy> = {
  import: ["匯入文件", "Import documents"],
  export: ["匯出資料", "Export data"],
  restore: ["還原備份", "Restore backup"],
  "aggregation.export": ["匯出 Aggregation 結果", "Export aggregation results"],
  "metadata.createCollection": ["建立 Collection", "Create collection"],
  "metadata.drop": ["刪除資料庫或 Collection", "Drop database or collection"],
  "metadata.createIndex": ["建立索引", "Create index"],
  "metadata.editIndex": ["重建索引", "Rebuild index"],
  "metadata.dropIndex": ["刪除索引", "Drop index"],
  "documents.update": ["修改欄位", "Update field"],
  "documents.insert": ["新增文件", "Insert document"],
  "documents.delete": ["刪除文件", "Delete document"],
  "documents.replace": ["取代文件", "Replace document"],
  "usersRoles.createUser": ["新增資料庫使用者", "Create database user"],
  "usersRoles.setPassword": ["重設使用者密碼", "Reset user password"],
  "usersRoles.grantRole": ["授予使用者角色", "Grant user role"],
  "usersRoles.revokeRole": ["撤銷使用者角色", "Revoke user role"],
  "usersRoles.dropUser": ["刪除資料庫使用者", "Delete database user"],
};
const statuses: Record<OperationReceipt["status"], Copy> = {
  completed: ["已完成", "Completed"],
  failed: ["失敗", "Failed"],
  cancelled: ["已取消", "Cancelled"],
  unknown: ["結果未知", "Outcome unknown"],
};
const modes: Record<string, Copy> = {
  single: ["單筆操作", "Single operation"],
  insert: ["只新增", "Insert only"],
  replace: ["整筆取代", "Replace whole document"],
  "drop-and-restore": ["刪除後還原", "Drop and restore"],
  recreate: ["重新建立", "Recreate"],
  json: ["JSON", "JSON"],
  jsonl: ["JSONL", "JSONL"],
  csv: ["CSV", "CSV"],
  bson: ["BSON", "BSON"],
};

export const receiptActionCopy = (action: string): Copy =>
  actions[action] || ["其他操作", "Other operation"];
export const receiptStatusCopy = (status: OperationReceipt["status"]): Copy =>
  statuses[status];
export const receiptModeCopy = (mode: string): Copy =>
  modes[mode] || ["自訂模式", "Custom mode"];

export type ReceiptFilters = {
  search?: string;
  status?: OperationReceipt["status"];
  environment?: OperationReceipt["environment"];
  fromDate?: string;
  toDate?: string;
};

export function filterReceipts(
  receipts: OperationReceipt[],
  filters: ReceiptFilters,
): OperationReceipt[] {
  const search = filters.search?.trim().toLocaleLowerCase() || "";
  const from = filters.fromDate
    ? new Date(`${filters.fromDate}T00:00:00`).getTime()
    : -Infinity;
  const to = filters.toDate
    ? new Date(`${filters.toDate}T00:00:00`).setDate(
        new Date(`${filters.toDate}T00:00:00`).getDate() + 1,
      )
    : Infinity;
  return receipts.filter((receipt) => {
    if (filters.status && receipt.status !== filters.status) return false;
    if (filters.environment && receipt.environment !== filters.environment)
      return false;
    const time = Date.parse(receipt.occurredAt);
    if (time < from || time >= to) return false;
    if (!search) return true;
    return [
      receipt.connectionName,
      receipt.namespace,
      receipt.action,
      ...receiptActionCopy(receipt.action),
      receipt.status,
      ...receiptStatusCopy(receipt.status),
      receipt.outputFile || "",
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(search);
  });
}
