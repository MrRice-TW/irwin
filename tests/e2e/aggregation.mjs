import { _electron as electron, expect } from "@playwright/test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { resolve } from "node:path";
import { mkdir, readFile } from "node:fs/promises";

await mkdir(".runtime/screenshots", { recursive: true });

const server = await MongoMemoryServer.create({
  binary: { version: "8.0.18", downloadDir: ".runtime/mongodb" },
});
const client = new MongoClient(server.getUri());
await client.connect();
const collection = client.db("exploration_smoke").collection("people");
await collection.insertMany([
  { name: "Ada", team: "Research" },
  { name: "Grace", team: "Engineering" },
  { name: "Alan", team: "Research" },
]);
const env = {
  ...process.env,
  WORKBENCH_USER_DATA: resolve(`.runtime/exploration-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: [".", "--disable-gpu"], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await page.getByRole("button", { name: "新增資料庫連線" }).click();
  await page.getByLabel("名稱", { exact: true }).fill("Exploration local");
  await page
    .getByLabel("預設資料庫", { exact: true })
    .fill("exploration_smoke");
  await page.getByLabel("MongoDB URI", { exact: false }).fill(server.getUri());
  await page.getByRole("button", { name: "儲存連線" }).click();
  await page
    .locator(".app-header")
    .getByRole("button", { name: "連線", exact: true })
    .click();
  await page
    .locator(".connection-picker")
    .getByRole("button", { name: "Exploration local" })
    .click();
  await page
    .locator(".db-row")
    .getByRole("button", { name: "exploration_smoke", exact: true })
    .click();
  await page
    .locator(".collection-row")
    .getByRole("button", { name: "people", exact: true })
    .click();
  await page
    .locator(".collection-row")
    .getByRole("button", { name: "Collection 選單" })
    .click();
  await page.getByRole("button", { name: "開啟 Aggregation" }).click();
  await expect(page.locator(".aggregation-workspace")).toBeVisible();
  await page.getByLabel("階段範本").selectOption("$match");
  await page.getByRole("button", { name: "新增階段" }).click();
  await page
    .locator(".aggregation-stage textarea")
    .first()
    .fill('{ "$match": { "team": "Research" } }');
  await page
    .locator(".aggregation-stage")
    .first()
    .getByRole("button", { name: "預覽至此" })
    .click();
  await expect(page.locator(".aggregation-result-count")).toContainText("2");
  await page.getByLabel("階段範本").selectOption("$group");
  await page.getByRole("button", { name: "新增階段" }).click();
  await page
    .locator(".aggregation-stage textarea")
    .nth(1)
    .fill('{ "$group": { "_id": "$team", "count": { "$sum": 1 } } }');
  await page.getByRole("button", { name: "單階段檢視" }).click();
  await expect(page.locator(".aggregation-stage")).toHaveCount(1);
  await page.getByRole("button", { name: "下一階段" }).click();
  await expect(page.locator(".aggregation-stage textarea")).toHaveValue(
    '{ "$group": { "_id": "$team", "count": { "$sum": 1 } } }',
  );
  await page.getByLabel("編輯區高度").focus();
  await page.keyboard.press("End");
  await expect(page.getByLabel("編輯區高度")).toHaveValue("65");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1024, 768),
  );
  await expect(page.locator(".aggregation-stage textarea")).toBeVisible();
  expect(
    await page
      .locator(".aggregation-results")
      .evaluate((element) => element.clientHeight),
  ).toBeGreaterThan(180);
  await page.screenshot({
    path: ".runtime/screenshots/uiux-aggregation-compact.png",
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1480, 960),
  );
  await page.getByRole("button", { name: "顯示全部階段" }).click();
  await expect(page.locator(".aggregation-stage")).toHaveCount(2);
  await page.getByLabel("階段範本").selectOption("$limit");
  await page.getByRole("button", { name: "新增階段" }).click();
  await page
    .locator(".aggregation-stage textarea")
    .nth(2)
    .fill('{ "$limit": 10 }');
  await page.getByRole("button", { name: "執行 Pipeline" }).click();
  await expect(page.locator(".aggregation-result-count")).toContainText("1");
  await expect(page.locator(".aggregation-workspace")).toContainText(
    "唯讀結果",
  );
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await expect(page.locator(".aggregation-workspace")).toContainText(
    "Research",
  );
  await page
    .getByRole("button", { name: "儲存 Pipeline", exact: true })
    .click();
  await page.locator('input[name="saved-pipeline-name"]').fill("Team count");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "儲存", exact: true })
    .click();
  await page
    .locator(".aggregation-stage")
    .last()
    .getByRole("button", { name: "刪除" })
    .click();
  await page.locator(".aggregation-library summary").click();
  await page
    .getByLabel("已儲存 Pipeline")
    .selectOption({ label: "Team count" });
  await page.getByRole("button", { name: "套用 Pipeline" }).click();
  await expect(page.locator(".aggregation-stage")).toHaveCount(3);
  await expect(page.locator(".aggregation-result-count")).toContainText(
    "尚未執行目前 Pipeline",
  );
  const exportPath = resolve(`.runtime/aggregation-export-${Date.now()}.jsonl`);
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, exportPath);
  await page.getByRole("button", { name: "匯出完整結果 JSONL" }).click();
  await expect
    .poll(async () => {
      try {
        return (await readFile(exportPath, "utf8")).trim().split("\n").length;
      } catch {
        return 0;
      }
    })
    .toBe(1);
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() =>
            window.workbench.request("operationReceipts.list", {}),
          )
        ).length,
    )
    .toBe(1);
  await page.getByRole("button", { name: "任務", exact: true }).click();
  await page.getByRole("button", { name: "操作收據" }).click();
  await expect(page.getByRole("dialog")).toContainText("匯出 Aggregation 結果");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "關閉" })
    .last()
    .click();
  await page
    .locator(".aggregation-stage textarea")
    .first()
    .fill('{ "$match": { "team": "Unknown" } }');
  await page.getByRole("button", { name: "執行 Pipeline" }).click();
  await expect(page.locator(".aggregation-result-count")).toContainText(
    "已載入 0 筆",
  );
  await expect(page.locator(".result-empty")).toContainText(
    "沒有符合條件的文件",
  );
  expect(await collection.countDocuments()).toBe(3);
  process.stdout.write("Aggregation visual workflow passed\n");
} finally {
  await app?.close();
  await client.close();
  await server.stop();
}
