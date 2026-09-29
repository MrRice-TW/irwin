import { expect, test } from "vitest";
import type { OperationReceipt } from "../src/shared/operation-safety";
import {
  filterReceipts,
  receiptActionCopy,
  receiptStatusCopy,
} from "../src/renderer/receipt-view";

const receipt = (
  id: string,
  changes: Partial<OperationReceipt> = {},
): OperationReceipt => ({
  id,
  occurredAt: "2026-09-24T10:00:00.000Z",
  connectionName: "Production orders",
  environment: "production",
  namespace: "app.orders",
  action: "metadata.dropIndex",
  mode: "single",
  scope: "collection",
  status: "completed",
  reversible: false,
  ...changes,
});

test("receipt display names explain actions and uncertain outcomes", () => {
  expect(receiptActionCopy("metadata.dropIndex")).toEqual([
    "刪除索引",
    "Drop index",
  ]);
  expect(receiptStatusCopy("unknown")).toEqual(["結果未知", "Outcome unknown"]);
  expect(receiptActionCopy("future.command")).toEqual([
    "其他操作",
    "Other operation",
  ]);
});

test("user and role receipts use understandable account-management labels", () => {
  expect(receiptActionCopy("usersRoles.createUser")).toEqual([
    "新增資料庫使用者",
    "Create database user",
  ]);
  expect(receiptActionCopy("usersRoles.setPassword")).toEqual([
    "重設使用者密碼",
    "Reset user password",
  ]);
  expect(receiptActionCopy("usersRoles.grantRole")).toEqual([
    "授予使用者角色",
    "Grant user role",
  ]);
  expect(receiptActionCopy("usersRoles.revokeRole")).toEqual([
    "撤銷使用者角色",
    "Revoke user role",
  ]);
  expect(receiptActionCopy("usersRoles.dropUser")).toEqual([
    "刪除資料庫使用者",
    "Delete database user",
  ]);
});

test("receipt filters combine target, status, environment, and local dates", () => {
  const values = [
    receipt("one"),
    receipt("two", {
      status: "unknown",
      environment: "staging",
      namespace: "app.people",
      occurredAt: "2026-09-20T10:00:00.000Z",
    }),
  ];
  expect(
    filterReceipts(values, {
      search: "orders",
      status: "completed",
      environment: "production",
      fromDate: "2026-09-24",
      toDate: "2026-09-24",
    }).map((item) => item.id),
  ).toEqual(["one"]);
  expect(filterReceipts(values, { search: "missing" })).toEqual([]);
});
