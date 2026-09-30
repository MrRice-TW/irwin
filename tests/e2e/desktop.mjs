import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Long, ObjectId } from "mongodb";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { closeElectronWindowNormally } from "./helpers/close-electron.mjs";
import {
  prepareClipboardCheck,
  copiedText,
} from "./helpers/clipboard-check.mjs";
await mkdir(".runtime/screenshots", { recursive: true });
const server = await MongoMemoryServer.create({
  binary: { version: "8.0.18", downloadDir: ".runtime/mongodb" },
});
const client = new MongoClient(server.getUri());
await client.connect();
await client
  .db("workbench_demo")
  .collection("people")
  .insertMany([
    {
      name: "Ada Lovelace",
      team: "Research",
      score: 98,
      active: true,
      large: Long.fromString("9007199254740993"),
      description:
        "This is a deliberately long table value used to verify selected-cell preview styling without covering adjacent columns.",
    },
    { name: "Grace Hopper", team: "Engineering", score: 95, active: true },
    { name: "Alan Turing", team: "Research", score: 99, active: false },
  ]);
await client
  .db("workbench_demo")
  .collection("layout_docs")
  .insertMany(
    Array.from({ length: 125 }, (_, index) => ({
      type: index % 8 === 0 ? "filterList" : "test",
      kind: "async",
      description:
        "A deliberately long description keeps its initial column at the normal default width.",
    })),
  );
let app;
const errors = [];
const checks = [];
const unverified = [];
const ignoredMonacoDiagnostics = ["ICodeLensCache", "treeViewsDndService"];
try {
  const env = {
    ...process.env,
    WORKBENCH_USER_DATA: resolve(`.runtime/desktop-${Date.now()}`),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    ...(process.env.WORKBENCH_EXECUTABLE
      ? { executablePath: process.env.WORKBENCH_EXECUTABLE }
      : {}),
    args: [...(process.env.WORKBENCH_EXECUTABLE ? [] : ["."]), "--disable-gpu"],
    env,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  const preferencesDialog = () =>
    page.locator("dialog.preferences-modal[open]");
  const openPreferences = async () => {
    const label =
      (await page.locator("html").getAttribute("lang")) === "en"
        ? "Preferences"
        : "偏好設定";
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(preferencesDialog()).toBeVisible();
  };
  const setTheme = async (theme) => {
    await openPreferences();
    await preferencesDialog()
      .locator('[data-preference-section="appearance"]')
      .click();
    await preferencesDialog()
      .locator(".preferences-content select")
      .first()
      .selectOption(theme);
    const saveLabel =
      (await page.locator("html").getAttribute("lang")) === "en"
        ? "Save settings"
        : "儲存設定";
    await preferencesDialog()
      .getByRole("button", { name: saveLabel, exact: true })
      .click();
    await expect(preferencesDialog()).toHaveCount(0);
  };
  const nativeClipboard = await prepareClipboardCheck(app);
  if (!nativeClipboard)
    unverified.push(
      "OS clipboard round-trip unavailable on this desktop; copy payload verified at the Electron API boundary only.",
    );
  page.on("pageerror", (e) => {
    if (!ignoredMonacoDiagnostics.some((text) => e.message.includes(text)))
      errors.push(e.message);
  });
  await expect(
    page.getByRole("button", { name: "新增資料庫連線", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  expect(await page.title()).toBe("Irwin");
  await expect(page.locator(".brand strong")).toHaveText("Irwin");
  const brandImage = page.locator('.brand img[alt="Irwin"]');
  await expect(brandImage).toBeVisible();
  await expect(brandImage).toHaveAttribute("width", "36");
  await expect(brandImage).toHaveAttribute("height", "36");
  await page.screenshot({ path: ".runtime/screenshots/welcome.png" });
  checks.push("desktop welcome");
  await page
    .getByRole("button", { name: "新增資料庫連線", exact: true })
    .click();
  await expect(page.getByLabel("名稱", { exact: true })).toHaveAttribute(
    "name",
    "connection-name",
  );
  await expect(page.getByLabel("群組", { exact: true })).toHaveAttribute(
    "name",
    "connection-group",
  );
  await expect(
    page.getByLabel("MongoDB URI", { exact: false }),
  ).toHaveAttribute("name", "connection-uri");
  await expect(
    page.getByLabel("MongoDB URI", { exact: false }),
  ).toHaveAttribute("autocomplete", "off");
  await page.getByLabel("名稱", { exact: true }).fill("Local Development");
  await page.getByLabel("群組", { exact: true }).fill("DEVELOPMENT");
  await page.getByLabel("預設資料庫", { exact: true }).fill("workbench_demo");
  await page.getByLabel("MongoDB URI", { exact: false }).fill(server.getUri());
  await page.getByRole("button", { name: "進階設定" }).click();
  const environmentSelect = page.locator(
    'select:has(option[value="production"])',
  );
  await environmentSelect.selectOption("production");
  await expect(
    page.getByRole("checkbox", { name: /以唯讀模式開啟/ }),
  ).toBeChecked();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "連線", exact: true })
    .click();
  await expect(page.locator(".connection-safety-summary")).toContainText(
    "PRODUCTION",
  );
  await expect(page.locator(".connection-safety-summary")).toContainText(
    "唯讀連線",
  );
  await page.getByRole("button", { name: "進階設定" }).click();
  await environmentSelect.selectOption("development");
  await page.getByRole("checkbox", { name: /以唯讀模式開啟/ }).uncheck();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "連線", exact: true })
    .click();
  checks.push("Production environment enables read-only by default");
  await page.getByRole("button", { name: "測試連線", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "連線測試成功" }),
  ).toBeVisible({ timeout: 30000 });
  checks.push("connection test");
  await page.screenshot({ path: ".runtime/screenshots/connection.png" });
  await page.getByRole("button", { name: "儲存連線", exact: true }).click();
  await expect(
    page
      .locator(".connection-tree")
      .getByRole("button", { name: "Local Development", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".sidebar-empty")).toContainText(
    "尚未連線任何資料庫",
  );
  checks.push("saved connection stays out of the active workspace");
  await expect(page.locator("dialog")).toHaveCount(0);
  await page
    .locator(".app-header")
    .getByRole("button", { name: "連線", exact: true })
    .click();
  await page
    .locator(".connection-picker")
    .getByRole("button", { name: "Local Development" })
    .click();
  await expect(
    page
      .locator(".connection-tree")
      .getByRole("button", { name: "Local Development", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".environment-badge.development").first(),
  ).toHaveCSS("background-color", "rgb(45, 67, 40)");
  checks.push("connected database visible in workspace");
  await page
    .locator(".db-row")
    .getByRole("button", { name: "workbench_demo", exact: true })
    .click();
  await page
    .locator(".collection-row")
    .getByRole("button", { name: "people", exact: true })
    .click();
  for (const label of ["偏好設定"]) {
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toHaveAttribute("aria-label", label);
  }
  await expect(
    page.getByRole("button", { name: "切換語言", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "刪除文件", exact: true }),
  ).toHaveAttribute("aria-label", "刪除文件");
  await expect(
    page.getByRole("button", { name: "Collection 選單", exact: true }).first(),
  ).toHaveAttribute("aria-label", "Collection 選單");
  checks.push("icon controls expose explicit accessible names");
  const queryActions = page.locator(".query-actions");
  for (const label of ["自由命令", "執行", "停止"]) {
    const button = queryActions.getByRole("button", {
      name: label,
      exact: true,
    });
    await expect(button).toHaveAttribute("aria-label", label);
    await expect(button).toHaveAttribute("title", label);
    if (label === "執行") await expect(button).toHaveText("執行");
    await expect(button.locator("svg")).toBeVisible();
  }
  const runIcon = queryActions
    .getByRole("button", { name: "執行", exact: true })
    .locator("svg");
  const runIconStyle = await runIcon.evaluate((svg) => {
    const path = svg.querySelector("path");
    const svgStyle = getComputedStyle(svg);
    const pathStyle = path ? getComputedStyle(path) : null;
    return {
      width: svgStyle.width,
      height: svgStyle.height,
      display: svgStyle.display,
      visibility: svgStyle.visibility,
      opacity: svgStyle.opacity,
      stroke: pathStyle?.stroke ?? "",
    };
  });
  expect(runIconStyle.width).not.toBe("0px");
  expect(runIconStyle.height).not.toBe("0px");
  expect(runIconStyle.display).not.toBe("none");
  expect(runIconStyle.visibility).toBe("visible");
  expect(runIconStyle.opacity).not.toBe("0");
  expect(runIconStyle.stroke).not.toBe("transparent");
  expect(runIconStyle.stroke).not.toBe("none");
  checks.push("run icon has visible stroke");
  const countButton = queryActions.getByRole("button", {
    name: "計算筆數",
    exact: true,
  });
  await expect(countButton).toHaveAttribute("title", "計算符合條件的文件數");
  await page.getByRole("button", { name: "執行", exact: true }).click();
  await expect(
    page.locator(".grid-cell").filter({ hasText: /^Ada Lovelace$/ }),
  ).toBeVisible({ timeout: 30000 });
  const optionsButton = page.getByRole("button", { name: "查詢選項" });
  await optionsButton.click();
  await expect(optionsButton).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByLabel("SORT", { exact: true })).toHaveCount(0);
  await optionsButton.click();
  await expect(page.getByLabel("SORT", { exact: true })).toBeVisible();
  const normalResultHeight = await page
    .locator(".results-wrapper")
    .evaluate((element) => element.clientHeight);
  await page.getByRole("button", { name: "專注結果" }).click();
  await expect(page.locator(".query-bar")).toHaveCount(0);
  await expect(page.locator(".results-wrapper")).toBeVisible();
  expect(
    await page
      .locator(".results-wrapper")
      .evaluate((element) => element.clientHeight),
  ).toBeGreaterThan(normalResultHeight + 50);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1024, 768),
  );
  await expect(page.locator(".results-wrapper")).toBeVisible();
  expect(
    await page
      .locator(".results-wrapper")
      .evaluate((element) => element.clientHeight),
  ).toBeGreaterThan(250);
  await page.screenshot({
    path: ".runtime/screenshots/uiux-focus-compact.png",
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1480, 960),
  );
  await page.getByRole("button", { name: "返回查詢" }).click();
  await expect(page.getByLabel("FILTER", { exact: true })).toHaveValue("{}");
  checks.push("query options and focused result layout preserve inputs");
  await expect(
    page.getByRole("button", { name: "欄位設定", exact: true }),
  ).toBeVisible();
  const addDocumentButton = page.getByRole("button", {
    name: "新增文件",
    exact: true,
  });
  await expect(addDocumentButton).toHaveText("");
  await expect(addDocumentButton.locator("svg")).toBeVisible();
  const nameHeading = page
    .locator(".grid-heading")
    .filter({ hasText: /^name(?: [↑↓])?$/ })
    .first();
  const descriptionHeading = page
    .locator(".grid-heading")
    .filter({ hasText: /^description$/ })
    .first();
  const initialNameWidth = await nameHeading.evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  await nameHeading.getByRole("button", { name: "依欄位排序 name" }).focus();
  await page.keyboard.press("Alt+ArrowRight");
  const headingOrder = await page
    .locator(".grid-heading-label")
    .allTextContents();
  expect(headingOrder.indexOf("name")).toBeGreaterThan(
    headingOrder.indexOf("team"),
  );
  await nameHeading.getByRole("button", { name: "依欄位排序 name" }).focus();
  await page.keyboard.press("Alt+ArrowLeft");
  const nameWidthBeforeKeys = await nameHeading.evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  await nameHeading.getByRole("separator", { name: "調整欄寬 name" }).focus();
  await page.keyboard.press("ArrowRight");
  expect(
    await nameHeading.evaluate((el) => el.getBoundingClientRect().width),
  ).toBeGreaterThan(nameWidthBeforeKeys);
  await page.keyboard.press("ArrowLeft");
  checks.push("keyboard column reorder and resize");
  expect(initialNameWidth).toBeLessThan(220);
  expect(
    await descriptionHeading.evaluate((el) => el.getBoundingClientRect().width),
  ).toBeGreaterThanOrEqual(219);
  checks.push("initial compact table columns");
  await page.getByRole("button", { name: "欄位設定", exact: true }).click();
  const descriptionColumnOption = page
    .locator(".table-column-menu label")
    .filter({ hasText: /^description$/ })
    .locator("input");
  await descriptionColumnOption.uncheck();
  await expect(
    page.locator(".grid-heading").filter({ hasText: /^description$/ }),
  ).toHaveCount(0);
  await descriptionColumnOption.check();
  await expect(descriptionHeading).toBeVisible();
  await page.getByRole("button", { name: "欄位設定", exact: true }).click();
  checks.push("hide and restore table columns");
  await page
    .getByRole("button", { name: "依欄位排序 name", exact: true })
    .click();
  await expect(page.locator(".grid-row").nth(1)).toContainText("Alan Turing");
  const alanNameCell = page
    .locator(".grid-cell")
    .filter({ hasText: /^Alan Turing$/ })
    .first();
  await alanNameCell.click();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".grid-cell.selected-cell")).toHaveText("Research");
  checks.push("table sort and keyboard navigation");
  expect(
    await page
      .locator(".table-scroll")
      .evaluate((el) => getComputedStyle(el).overflowY),
  ).toBe("scroll");
  const tableLayout = await page.locator(".table-scroll").evaluate((el) => {
    const wrapper = el.closest(".results-wrapper");
    const view = el.parentElement;
    return {
      clientHeight: el.clientHeight,
      viewHeight: view?.getBoundingClientRect().height ?? 0,
      wrapperHeight: wrapper?.getBoundingClientRect().height ?? 0,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    };
  });
  expect(tableLayout.clientHeight).toBeGreaterThan(0);
  expect(tableLayout.viewHeight).toBeGreaterThanOrEqual(
    tableLayout.wrapperHeight - 2,
  );
  expect(tableLayout.scrollWidth).toBeGreaterThanOrEqual(
    tableLayout.clientWidth,
  );
  checks.push("table scrollbar and compact layout");
  const historyBeforeF5 = await page.evaluate(() =>
    window.workbench.request("history.list", {}),
  );
  await page.keyboard.press("F5");
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() =>
            window.workbench.request("history.list", {}),
          )
        ).length,
    )
    .toBeGreaterThan(historyBeforeF5.length);
  await expect(
    page.getByRole("button", { name: "執行", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  expect(
    await nameHeading.evaluate((el) => el.getBoundingClientRect().width),
  ).toBe(initialNameWidth);
  checks.push("F5 query");
  const idHeading = page
    .locator(".grid-heading")
    .filter({ hasText: /^_id$/ })
    .first();
  const resizer = idHeading.locator(".column-resizer");
  await expect(resizer).toHaveCSS("cursor", "col-resize");
  const resizerBox = await resizer.boundingBox();
  expect(resizerBox?.width ?? 0).toBeGreaterThan(0);
  const headingBox = await idHeading.boundingBox();
  if (!headingBox) throw new Error("Column heading is not interactable");
  await page.mouse.move(
    headingBox.x + 32,
    headingBox.y + headingBox.height / 2,
  );
  const resizeMarkerColor = await resizer.evaluate(
    (el) => getComputedStyle(el, "::after").backgroundColor,
  );
  expect(resizeMarkerColor).toBe("rgba(0, 0, 0, 0)");
  const beforeIdWidth = await idHeading.evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  const dragBox = await resizer.boundingBox();
  if (!dragBox) throw new Error("Column resizer is not interactable");
  await page.mouse.move(
    dragBox.x + dragBox.width / 2,
    dragBox.y + dragBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    dragBox.x + dragBox.width / 2 + 80,
    dragBox.y + dragBox.height / 2,
  );
  await page.mouse.up();
  await expect
    .poll(async () =>
      idHeading.evaluate((el) => el.getBoundingClientRect().width),
    )
    .toBeGreaterThan(beforeIdWidth + 40);
  checks.push("Excel-style column resize");
  await page.locator(".table-scroll").evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const longCell = page
    .locator(".grid-cell")
    .filter({ hasText: "deliberately long table value" })
    .first();
  await longCell.click();
  await expect(longCell.locator(".cell-preview")).toBeVisible();
  const previewStyle = await longCell
    .locator(".cell-preview")
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        backgroundColor: style.backgroundColor,
        maxWidth: style.maxWidth,
        whiteSpace: style.whiteSpace,
      };
    });
  expect(previewStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(previewStyle.maxWidth).not.toBe("none");
  expect(previewStyle.whiteSpace).toBe("normal");
  checks.push("selected long-cell preview");
  const shortCell = page
    .locator(".grid-cell")
    .filter({ hasText: /^Research$/ })
    .first();
  await shortCell.click();
  const shortPreviewStyle = await shortCell
    .locator(".cell-preview")
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return { position: style.position, boxShadow: style.boxShadow };
    });
  expect(shortPreviewStyle.position).toBe("static");
  expect(shortPreviewStyle.boxShadow).toBe("none");
  checks.push("short-cell selection stays inline");
  const historyBeforeBatch = await page.evaluate(() =>
    window.workbench.request("history.list", {}),
  );
  await page.locator(".batch-control").locator("select").selectOption("25");
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() =>
            window.workbench.request("history.list", {}),
          )
        ).length,
    )
    .toBeGreaterThan(historyBeforeBatch.length);
  await expect(
    page.getByRole("button", { name: "執行", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  checks.push("batch auto query");
  await expect(
    page.getByRole("button", { name: "第一頁", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "最後一頁", exact: true }),
  ).toBeVisible();
  const pageActions = page.locator(".page-actions");
  await expect(
    pageActions.getByRole("button", { name: "上一批", exact: true }),
  ).toBeVisible();
  await expect(
    pageActions.getByRole("button", { name: "下一批", exact: true }),
  ).toBeVisible();
  expect(
    await pageActions
      .locator("button")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.textContent?.trim()),
      ),
  ).toEqual(["|←", "←", "→", "→|"]);
  expect(
    await page.locator(".result-footer .batch-control").evaluate((el) => ({
      previous: el.previousElementSibling?.className,
      beforePrevious:
        el.previousElementSibling?.previousElementSibling?.className,
    })),
  ).toEqual({ previous: "page-range", beforePrevious: "page-actions" });
  await countButton.click();
  await expect(page.locator(".count-result")).toHaveText("3");
  checks.push("query count");
  checks.push("first and last page controls");
  checks.push("collection query");
  await page.getByRole("button", { name: "首頁", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "你的連線", exact: true }),
  ).toBeVisible();
  await page
    .locator(".workspace-tab")
    .getByRole("button", {
      name: "people · Local Development / workbench_demo",
      exact: true,
    })
    .click();
  await expect(
    page.locator(".grid-cell").filter({ hasText: /^Ada Lovelace$/ }),
  ).toBeVisible();
  checks.push("home navigation preserves open query results");
  await page
    .getByLabel("FILTER", { exact: true })
    .fill('{"name":"no-match-ux-test"}');
  await expect(
    page.locator(".result-state-notice.stale-results"),
  ).toBeVisible();
  await page.getByRole("button", { name: "執行", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "沒有符合條件的文件" }),
  ).toBeVisible();
  await page.getByLabel("FILTER", { exact: true }).fill("{}");
  await page.getByRole("button", { name: "執行", exact: true }).click();
  await expect(
    page.locator(".grid-cell").filter({ hasText: /^Ada Lovelace$/ }),
  ).toBeVisible();
  checks.push("stale and zero-result query states are distinct");
  await expect(page.getByRole("grid", { name: "查詢結果" })).toBeVisible();
  expect(
    await page
      .getByRole("grid", { name: "查詢結果" })
      .getAttribute("aria-colcount"),
  ).not.toBeNull();
  const filterSeparator = page.locator(".query-column-resizer").first();
  await expect(filterSeparator).toHaveAttribute("aria-valuemin", "1");
  await expect(filterSeparator).toHaveAttribute("aria-valuemax", "99");
  await expect(filterSeparator).toHaveAttribute("aria-valuenow", /\d+/);
  checks.push("query result grid and query resizers expose accessible ranges");
  const assistantTrigger = page
    .locator(".workspace-panel.visible .collection-panel")
    .getByRole("button", { name: "AI 助理", exact: true });
  await assistantTrigger.click();
  const assistant = page.getByRole("dialog", { name: "AI 助理" });
  await expect(assistant).toBeVisible();
  await expect(assistant).toHaveAttribute("data-ai-focus-trap", "true");
  await assistant
    .getByRole("button", { name: "設定模型", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  await expect(
    assistant.getByRole("button", { name: "關閉", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Control+p");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(assistant).toBeVisible();
  await assistant
    .getByRole("button", { name: "設定模型", exact: true })
    .click();
  await expect(
    preferencesDialog().locator(".preferences-content"),
  ).toHaveAttribute("data-section", "ai");
  await preferencesDialog()
    .locator('[name="ai-provider-name"]')
    .fill("Smoke local model");
  await preferencesDialog()
    .locator('[name="ai-provider-model"]')
    .fill("qa-model");
  await preferencesDialog()
    .getByRole("button", { name: "儲存模型", exact: true })
    .click();
  await expect(preferencesDialog().getByRole("status")).toContainText(
    "模型服務已儲存",
  );
  const smokeProviderId = await preferencesDialog()
    .locator('[name="ai-configured-provider"] option')
    .filter({ hasText: "Smoke local model" })
    .getAttribute("value");
  await preferencesDialog()
    .locator('[name="ai-default-provider"]')
    .selectOption(smokeProviderId);
  await preferencesDialog()
    .getByRole("button", { name: "儲存設定", exact: true })
    .click();
  await expect(preferencesDialog()).toHaveCount(0);
  await expect(assistant.locator(".ai-assistant-setup select")).toContainText(
    "Smoke local model",
  );
  await expect(
    assistant.getByRole("button", { name: "為此連線啟用" }),
  ).toBeEnabled();
  await assistant
    .getByRole("button", { name: "管理模型", exact: true })
    .click();
  await expect(
    preferencesDialog().locator(".preferences-content"),
  ).toHaveAttribute("data-section", "ai");
  await preferencesDialog()
    .locator('[name="ai-configured-provider"]')
    .selectOption(smokeProviderId);
  await preferencesDialog()
    .getByRole("button", { name: "刪除", exact: true })
    .click();
  const deleteProviderDialog = page.getByRole("dialog", {
    name: "刪除模型服務？",
  });
  await expect(deleteProviderDialog).toBeVisible();
  await deleteProviderDialog
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(deleteProviderDialog).toHaveCount(0);
  await expect(
    preferencesDialog().locator('[name="ai-configured-provider"]'),
  ).toContainText("Smoke local model");
  await preferencesDialog()
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(preferencesDialog()).toHaveCount(0);
  await assistant.getByRole("button", { name: "關閉", exact: true }).click();
  await expect(assistant).toHaveCount(0);
  await expect(assistantTrigger).toBeFocused();
  checks.push(
    "AI settings navigation, refresh, deletion confirmation and focus restoration",
  );

  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setContentSize(1000, 650);
    window.webContents.setZoomFactor(1.25);
  });
  const narrowLayout = await page.evaluate(() => {
    const pane = document
      .querySelector(".results-pane")
      .getBoundingClientRect();
    const footer = document
      .querySelector(".result-footer")
      .getBoundingClientRect();
    const toolbar = document
      .querySelector(".result-toolbar")
      .getBoundingClientRect();
    const controls = [
      ...document.querySelectorAll(
        ".result-toolbar button, .result-footer button, .result-footer select",
      ),
    ];
    return {
      pane: {
        left: pane.left,
        right: pane.right,
        top: pane.top,
        bottom: pane.bottom,
      },
      footer: { left: footer.left, right: footer.right, bottom: footer.bottom },
      toolbar: { left: toolbar.left, right: toolbar.right },
      overflow: controls
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < pane.left - 1 || rect.right > pane.right + 1;
        })
        .map((element) => element.outerHTML),
    };
  });
  expect(narrowLayout.overflow).toEqual([]);
  expect(narrowLayout.footer.bottom).toBeLessThanOrEqual(
    narrowLayout.pane.bottom + 1,
  );
  expect(narrowLayout.toolbar.right).toBeLessThanOrEqual(
    narrowLayout.pane.right + 1,
  );
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setZoomFactor(1);
    window.setContentSize(1480, 960);
  });
  checks.push(
    "query result toolbar and pager fit at 125% zoom in a small window",
  );
  await setTheme("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect
    .poll(() =>
      page
        .locator(".segmented > .active")
        .evaluate((element) => getComputedStyle(element).color),
    )
    .toBe("rgb(192, 59, 46)");
  const lightPalette = await page.locator("html").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      accent: style.getPropertyValue("--accent").trim(),
      background: style.getPropertyValue("--bg").trim(),
      positive: style.getPropertyValue("--positive").trim(),
    };
  });
  expect(lightPalette).toEqual({
    accent: "#c73e30",
    background: "#fff8e7",
    positive: "#2e7d47",
  });
  const lightRunButton = page.getByRole("button", {
    name: "執行",
    exact: true,
  });
  const lightRunStyle = await lightRunButton.evaluate((button) => {
    const icon = button.querySelector("svg");
    const iconStyle = icon ? getComputedStyle(icon) : null;
    const buttonStyle = getComputedStyle(button);
    return {
      buttonBackground: buttonStyle.backgroundColor,
      iconColor: iconStyle?.color ?? "",
      iconStroke: icon?.querySelector("path")
        ? getComputedStyle(icon.querySelector("path")).stroke
        : "",
    };
  });
  expect(lightRunStyle.buttonBackground).not.toBe("rgba(0, 0, 0, 0)");
  expect(lightRunStyle.iconColor).not.toBe("transparent");
  expect(lightRunStyle.iconStroke).not.toBe("transparent");
  expect(lightRunStyle.iconStroke).not.toBe("none");
  await setTheme("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  checks.push("light theme run icon contrast");
  const queryCsvPath = resolve(`.runtime/query-results-${Date.now()}.csv`);
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, queryCsvPath);
  await page
    .getByRole("button", { name: "匯出查詢結果 CSV", exact: true })
    .click();
  await page.getByRole("button", { name: /已載入.*CSV/ }).click();
  await expect
    .poll(async () => {
      try {
        return await readFile(queryCsvPath, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") return "";
        throw error;
      }
    })
    .toContain("Ada Lovelace");
  const queryExcelPath = resolve(
    ".runtime/query-results-" + Date.now() + ".xlsx",
  );
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, queryExcelPath);
  await page
    .getByRole("button", { name: "匯出查詢結果 Excel", exact: true })
    .click();
  await page.getByRole("button", { name: /已載入.*EXCEL/ }).click();
  await expect
    .poll(async () => {
      try {
        return (await readFile(queryExcelPath)).subarray(0, 4).toString("hex");
      } catch (error) {
        if (error?.code === "ENOENT") return "";
        throw error;
      }
    })
    .toBe("504b0304");
  const fullQueryPath = resolve(
    `.runtime/full-query-results-${Date.now()}.jsonl`,
  );
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, fullQueryPath);
  await page
    .getByRole("button", { name: "匯出查詢結果 CSV", exact: true })
    .click();
  await page
    .getByRole("button", { name: /所有符合條件.*Extended JSON/ })
    .click();
  await page.getByRole("button", { name: "選擇檔案", exact: true }).click();
  await page.getByRole("button", { name: "開始任務", exact: true }).click();
  await expect
    .poll(async () => {
      try {
        return await readFile(fullQueryPath, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") return "";
        throw error;
      }
    })
    .toContain("Ada Lovelace");
  await expect(page.locator(".job-row")).toContainText("3 筆成功");
  checks.push("loaded and streaming query export scopes");
  const cell = page.locator(".grid-cell").filter({ hasText: /^Ada Lovelace$/ });
  await expect(cell).toBeVisible();
  await cell.click();
  await expect(cell).toHaveClass(/selected-cell/);
  checks.push("cell selected");
  await page.keyboard.press("F3");
  const documentDialog = page
    .locator("dialog")
    .filter({ hasText: "Document JSON" });
  await expect(documentDialog).toBeVisible();
  const documentBox = await documentDialog.boundingBox();
  expect(documentBox?.width ?? 0).toBeGreaterThan(1200);
  expect(documentBox?.height ?? 0).toBeGreaterThan(840);
  const inspectEditor = documentDialog.locator(".monaco-editor");
  await expect(inspectEditor).toBeVisible();
  await expect
    .poll(async () =>
      inspectEditor.evaluate((el) => el.getBoundingClientRect().height),
    )
    .toBeGreaterThan(200);
  await expect(inspectEditor.locator(".view-lines")).toContainText(
    "Ada Lovelace",
  );
  const copyDocumentButton = documentDialog.getByRole("button", {
    name: "複製內容",
    exact: true,
  });
  await expect(copyDocumentButton).toBeVisible();
  expect((await copyDocumentButton.innerText()).trim()).toBe("");
  await expect(documentDialog).toHaveCSS("resize", "both");
  await documentDialog
    .getByRole("button", { name: "放大視窗", exact: true })
    .click();
  await expect(documentDialog).toHaveClass(/maximized/);
  await documentDialog
    .getByRole("button", { name: "還原視窗", exact: true })
    .click();
  await copyDocumentButton.click();
  await documentDialog
    .locator(".modal-footer")
    .getByRole("button", { name: "關閉", exact: true })
    .click();
  checks.push("F3 JSON view and document copy");
  await cell.dblclick();
  await page.getByRole("textbox", { name: "Edit cell" }).fill("Ada Updated");
  await page.getByRole("textbox", { name: "Edit cell" }).press("Enter");
  await expect(
    page.locator(".grid-cell").filter({ hasText: /^Ada Updated$/ }),
  ).toBeVisible();
  expect(
    await client
      .db("workbench_demo")
      .collection("people")
      .countDocuments({ name: "Ada Updated" }),
  ).toBe(1);
  checks.push("inline updateOne");
  const editedPerson = await client
    .db("workbench_demo")
    .collection("people")
    .findOne({ name: "Ada Updated" });
  if (!editedPerson?._id) throw new Error("Could not find edited person");
  const wholeDocument = `{
  _id: ObjectId("${editedPerson._id.toHexString()}"),
  name: "Ada Whole",
  team: "Research",
  score: 98,
  active: true,
  count: Int32("7"),
  ratio: Double("1.0"),
  safeLong: Long("42"),
  large: Long("9007199254740993"),
  amount: Decimal128("1234.50"),
  createdAt: ISODate("2025-01-02T03:04:05.000Z"),
  description: "This is a deliberately long table value used to verify selected-cell preview styling without covering adjacent columns."
}`;
  const editedRow = page
    .locator(".grid-row")
    .filter({ hasText: "Ada Updated" })
    .first();
  await editedRow.click({ button: "right" });
  await page.getByRole("button", { name: "編輯文件", exact: true }).click();
  await expect(page.locator("dialog")).toContainText("編輯文件");
  await expect(
    page.getByRole("button", { name: "格式化文件", exact: true }),
  ).toBeVisible();
  const documentEditor = page.locator("dialog .monaco-editor").first();
  await expect(documentEditor.locator(".view-lines")).toContainText(
    'ObjectId("',
  );
  await expect(documentEditor.locator(".view-lines")).not.toContainText(
    "$oid",
  );
  await documentEditor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(wholeDocument);
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Backspace");
  await page.getByRole("button", { name: "格式化文件", exact: true }).click();
  await expect(documentEditor.locator(".view-lines")).toContainText(
    'Double("1.0")',
  );
  await page.getByRole("button", { name: "檢視變更", exact: true }).click();
  const documentChangesDialog = page
    .locator("dialog")
    .filter({ hasText: "文件變更" });
  await expect(documentChangesDialog).toBeVisible();
  await expect(documentChangesDialog.locator(".notice.error")).toHaveCount(0);
  await documentChangesDialog
    .getByRole("button", { name: "保留目前編輯", exact: true })
    .click();
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(
    page.locator(".grid-cell").filter({ hasText: /^Ada Whole$/ }),
  ).toBeVisible();
  expect(
    await client
      .db("workbench_demo")
      .collection("people")
      .countDocuments({ name: "Ada Whole" }),
  ).toBe(1);
  const savedWholeDocument = await client
    .db("workbench_demo")
    .collection("people")
    .findOne({ name: "Ada Whole" }, { promoteValues: false });
  expect(savedWholeDocument?.count?._bsontype).toBe("Int32");
  expect(savedWholeDocument?.ratio?._bsontype).toBe("Double");
  expect(savedWholeDocument?.safeLong?._bsontype).toBe("Long");
  expect(savedWholeDocument?.large?._bsontype).toBe("Long");
  expect(savedWholeDocument?.amount?._bsontype).toBe("Decimal128");
  expect(savedWholeDocument?.createdAt).toBeInstanceOf(Date);
  checks.push("whole document edit and format");
  const copyId = new ObjectId();
  const copiedDocument = JSON.stringify(
    {
      _id: { $oid: copyId.toHexString() },
      name: "Ada Copy",
      team: "Research",
      score: 98,
      active: true,
    },
    null,
    2,
  );
  const wholeRow = page
    .locator(".grid-row")
    .filter({ hasText: "Ada Whole" })
    .first();
  await wholeRow.click({ button: "right" });
  await page.getByRole("button", { name: "複製文件", exact: true }).click();
  await expect(page.locator("dialog")).toContainText("複製文件");
  const copyEditor = page.locator("dialog .monaco-editor").first();
  await copyEditor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(copiedDocument);
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Backspace");
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await expect
    .poll(async () =>
      client
        .db("workbench_demo")
        .collection("people")
        .countDocuments({ name: "Ada Copy" }),
    )
    .toBe(1);
  checks.push("copy document");
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(
    page.locator(".grid-cell").filter({ hasText: /^Ada Copy$/ }),
  ).toBeVisible();
  await page.screenshot({ path: ".runtime/screenshots/table.png" });
  await page.getByRole("button", { name: "Tree", exact: true }).click();
  await expect(page.locator(".tree-header")).toContainText("Key");
  await expect(page.locator(".tree-header")).toContainText("Value");
  await expect(page.locator(".tree-header")).toContainText("Type");
  const firstDocument = page
    .locator(".tree-row")
    .filter({ hasText: "Document 1" })
    .first();
  await expect(firstDocument).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".tree-results")).toContainText("Ada Copy");
  await firstDocument.click();
  await expect(firstDocument).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".tree-results")).not.toContainText("Ada Copy");
  await firstDocument.click();
  await expect(page.locator(".tree-results")).toContainText("Ada Copy");
  await expect(page.locator(".tree-results")).toContainText('ObjectId("');
  await expect(page.locator(".tree-results")).not.toContainText("$oid");
  await expect(page.locator(".tree-results")).not.toContainText("$numberInt");
  const treeKeyHeader = page.locator(".tree-header > span").first();
  const treeResizer = treeKeyHeader.locator(".tree-column-resizer");
  await expect(treeResizer).toHaveCSS("cursor", "col-resize");
  const treeHeaderWidth = await treeKeyHeader.evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  const treeResizeBox = await treeResizer.boundingBox();
  if (!treeResizeBox)
    throw new Error("Tree column resizer is not interactable");
  await page.mouse.move(
    treeResizeBox.x + treeResizeBox.width / 2,
    treeResizeBox.y + treeResizeBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    treeResizeBox.x + treeResizeBox.width / 2 + 60,
    treeResizeBox.y + treeResizeBox.height / 2,
  );
  await page.mouse.up();
  await expect
    .poll(async () =>
      treeKeyHeader.evaluate((el) => el.getBoundingClientRect().width),
    )
    .toBeGreaterThan(treeHeaderWidth + 30);
  checks.push("tree view expand and BSON display");
  checks.push("tree column resize");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await expect(page.locator(".json-toolbar")).toBeVisible();
  await expect(page.locator(".json-editor-surface")).toBeVisible();
  checks.push("json view");
  expect(
    await page.locator(".json-editor-surface .squiggly-error").count(),
  ).toBe(0);
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByRole("button", { name: "自由命令", exact: true }).click();
  await page.locator(".shell-editor .monaco-editor").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("1+2");
  await page.getByRole("button", { name: "執行", exact: true }).click();
  await expect(page.locator("details.output")).toBeVisible();
  await expect(page.locator("details.output")).toHaveCSS("resize", "vertical");
  const output = page.locator("details.output");
  const outputHandle = output.locator(".output-resize-handle");
  await expect(outputHandle).toHaveCSS("cursor", "ns-resize");
  const outputBox = await output.boundingBox();
  const handleBox = await outputHandle.boundingBox();
  if (!outputBox || !handleBox)
    throw new Error("Output resize handle is not interactable");
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y - 45);
  await page.mouse.up();
  await expect
    .poll(async () => (await output.boundingBox())?.height ?? 0)
    .toBeGreaterThan(outputBox.height + 20);
  await output.getByRole("button", { name: "縮小輸出", exact: true }).click();
  await expect(output.locator("pre")).toBeHidden();
  await output.getByRole("button", { name: "展開輸出", exact: true }).click();
  await expect(output.locator("pre")).toBeVisible();
  checks.push("resizable and collapsible shell output");
  await expect(
    page.getByRole("button", { name: "執行", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page.getByRole("button", { name: "自由命令", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "執行", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  const profiles = await page.evaluate(() =>
    window.workbench.request("connections.list", {}),
  );
  const cid = profiles[0].id;
  await page.evaluate(async (id) => {
    await window.workbench.request("shellSessions.open", {
      sessionId: "smoke-shell",
      connectionId: id,
      database: "workbench_demo",
    });
  }, cid);
  const shellResult = await page.evaluate(() =>
    window.workbench.request("shellSessions.execute", {
      sessionId: "smoke-shell",
      code: "db.people.find().limit(10)",
    }),
  );
  expect(shellResult.rows.length).toBe(4);
  checks.push("shell utility process");
  const cancelled = await page.evaluate(async () => {
    const pending = window.workbench
      .request("shellSessions.execute", {
        sessionId: "smoke-shell",
        code: "while(true){}",
      })
      .then(
        () => false,
        () => true,
      );
    await new Promise((r) => setTimeout(r, 300));
    await window.workbench.request("shellSessions.cancel", {
      sessionId: "smoke-shell",
    });
    return pending;
  });
  expect(cancelled).toBe(true);
  checks.push("infinite loop cancellation");
  const after = await page.evaluate(() =>
    window.workbench.request("shellSessions.execute", {
      sessionId: "smoke-shell",
      code: "1+2",
    }),
  );
  expect(after.output.join("")).toContain("3");
  checks.push("shell reset after cancellation");
  await page.getByRole("button", { name: "新增文件", exact: true }).click();
  await page.locator("dialog .monaco-editor").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(
    '{"name":"Katherine Johnson","team":"Research","score":97}',
  );
  await page
    .locator("dialog")
    .getByRole("button", { name: "儲存", exact: true })
    .click();
  await expect(
    page.locator(".grid-cell").filter({ hasText: /^Katherine Johnson$/ }),
  ).toBeVisible();
  expect(
    await client
      .db("workbench_demo")
      .collection("people")
      .countDocuments({ name: "Katherine Johnson" }),
  ).toBe(1);
  checks.push("Add Doc");
  await page.getByRole("button", { name: "新增文件", exact: true }).click();
  const unsavedEditor = page.locator("dialog").filter({ hasText: "Add Doc" });
  await unsavedEditor.locator(".monaco-editor").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText('{"name":"Unsaved QA document"}');
  await unsavedEditor
    .locator(".modal-footer")
    .getByRole("button", { name: "關閉", exact: true })
    .click();
  const discardDialog = page.getByRole("dialog", {
    name: "放棄未儲存的變更",
    exact: true,
  });
  await expect(discardDialog).toBeVisible();
  await discardDialog
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(unsavedEditor).toBeVisible();
  await expect(unsavedEditor.locator(".view-lines")).toContainText(
    "Unsaved QA document",
  );
  await unsavedEditor
    .locator(".modal-footer")
    .getByRole("button", { name: "關閉", exact: true })
    .click();
  await discardDialog
    .getByRole("button", { name: "放棄變更", exact: true })
    .click();
  await expect(page.locator("dialog")).toHaveCount(0);
  expect(
    await client
      .db("workbench_demo")
      .collection("people")
      .countDocuments({ name: "Unsaved QA document" }),
  ).toBe(0);
  checks.push("unsaved document edits require explicit discard");
  const peopleCollectionRow = page
    .locator(".collection-row")
    .filter({ has: page.getByRole("button", { name: "people", exact: true }) })
    .first();
  await expect(
    peopleCollectionRow.getByRole("button", { name: "Shell", exact: true }),
  ).toHaveCount(0);
  await peopleCollectionRow.click({ button: "right" });
  const collectionMenu = page.locator(".collection-context-menu");
  await expect(
    collectionMenu.getByRole("button", { name: "Shell", exact: true }),
  ).toBeVisible();
  await peopleCollectionRow.click({ button: "right" });
  await expect(collectionMenu).toHaveCount(0);
  const collectionMenuTrigger = peopleCollectionRow.getByRole("button", {
    name: "Collection 選單",
    exact: true,
  });
  await collectionMenuTrigger.click();
  await expect(
    collectionMenu.getByRole("button", { name: "管理索引", exact: true }),
  ).toBeVisible();
  await collectionMenuTrigger.click();
  await expect(collectionMenu).toHaveCount(0);
  checks.push("collection context Shell and toggle");
  await peopleCollectionRow.click({ button: "right" });
  await page.getByRole("button", { name: "管理索引", exact: true }).click();
  await page.locator("dialog input").first().fill('{"name":1}');
  await page
    .locator("dialog")
    .getByRole("button", { name: "建立", exact: true })
    .click();
  await expect(
    page.locator(".index-row").filter({ hasText: "name_1" }),
  ).toBeVisible();
  checks.push("index creation");
  const createdIndex = page.locator(".index-row").filter({ hasText: "name_1" });
  await expect(createdIndex.locator("button").first()).toHaveAttribute(
    "aria-label",
    "編輯索引 name_1",
  );
  await createdIndex.locator("button").first().click();
  await page.locator("dialog input").first().fill('{"name":-1}');
  await page
    .locator("dialog")
    .getByRole("button", { name: "儲存變更", exact: true })
    .click();
  const rebuildIndexDialog = page.getByRole("dialog", {
    name: "重新建立索引",
    exact: true,
  });
  await expect(rebuildIndexDialog).toBeVisible();
  await expect(rebuildIndexDialog).toContainText("workbench_demo.people");
  await expect(rebuildIndexDialog).toContainText("name_1");
  await rebuildIndexDialog
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(createdIndex).toContainText('{"name":{"$numberInt":"1"}}');
  checks.push(
    "index rebuild requires confirmation and cancel preserves its definition",
  );
  await createdIndex.locator("button").last().click();
  const dropIndexDialog = page.getByRole("dialog", {
    name: "刪除索引",
    exact: true,
  });
  await expect(dropIndexDialog).toBeVisible();
  await expect(dropIndexDialog).toContainText("workbench_demo.people");
  await expect(dropIndexDialog).toContainText("name_1");
  await dropIndexDialog
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(createdIndex).toBeVisible();
  await createdIndex.locator("button").last().click();
  await dropIndexDialog
    .getByRole("button", { name: "刪除索引", exact: true })
    .click();
  await expect(
    page.locator(".index-row").filter({ hasText: "name_1" }),
  ).toHaveCount(0);
  const writeReceipts = await page.evaluate(() =>
    window.workbench.request("operationReceipts.list", {}),
  );
  assert.ok(
    writeReceipts.some(
      (receipt) =>
        receipt.action === "metadata.dropIndex" &&
        receipt.namespace === "workbench_demo.people" &&
        receipt.status === "completed",
    ),
    "index deletion should leave a local operation receipt",
  );
  checks.push("index deletion requires confirmation and identifies its target");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if (!(await page.locator(".jobs-panel").isVisible()))
    await page.getByRole("button", { name: "任務", exact: true }).click();
  await page.getByRole("button", { name: "操作收據" }).click();
  const receiptsDialog = page.getByRole("dialog", { name: "操作收據" });
  await expect(receiptsDialog).toContainText("刪除索引");
  await receiptsDialog
    .getByLabel("搜尋連線或目標")
    .fill("workbench_demo.people");
  await receiptsDialog
    .getByLabel("狀態", { exact: true })
    .selectOption("completed");
  await expect(receiptsDialog).toContainText("刪除索引");
  await receiptsDialog.getByRole("button", { name: "關閉" }).last().click();
  checks.push("operation receipts use readable labels and filters");
  const csvPath = resolve(`.runtime/ui-export-${Date.now()}.csv`);
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, csvPath);
  await page
    .locator(".collection-row")
    .getByRole("button", { name: "people", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("button", { name: "匯出 Collection", exact: true })
    .click();
  await page
    .locator("label.field")
    .filter({ hasText: "格式" })
    .locator("select")
    .selectOption("csv");
  await page.getByRole("button", { name: "選擇檔案", exact: true }).click();
  await page.getByRole("button", { name: "開始任務", exact: true }).click();
  await expect(
    page.locator(".job-row").filter({ hasText: "completed" }).first(),
  ).toBeVisible({ timeout: 30000 });
  checks.push("CSV export job");
  await page
    .locator(".collection-row")
    .getByRole("button", { name: "people", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("button", { name: "匯入 Collection", exact: true })
    .click();
  await page
    .locator("label.field")
    .filter({ hasText: "格式" })
    .locator("select")
    .selectOption("csv");
  await page
    .getByLabel("Collection（留空代表整個 DB）", { exact: true })
    .fill("csv_copy");
  await page.getByRole("button", { name: "選擇檔案", exact: true }).click();
  await expect(page.locator(".mapping-table")).toBeVisible();
  await page.screenshot({ path: ".runtime/screenshots/csv-mapping.png" });
  const importMode = page
    .locator("label.field")
    .filter({ hasText: "遇到既有文件" })
    .locator("select");
  await importMode.selectOption("replace");
  const transferConfirmation = page.locator(
    'input[name="transfer-confirmation"]',
  );
  await expect(
    page.getByRole("button", { name: "開始任務", exact: true }),
  ).toBeDisabled();
  await transferConfirmation.fill("csv_copy");
  await expect(
    page.getByRole("button", { name: "開始任務", exact: true }),
  ).toBeDisabled();
  await transferConfirmation.fill("workbench_demo.csv_copy");
  await expect(
    page.getByRole("button", { name: "開始任務", exact: true }),
  ).toBeEnabled();
  await importMode.selectOption("insert");
  await expect(transferConfirmation).toHaveCount(0);
  await page.getByRole("button", { name: "開始任務", exact: true }).click();
  await expect
    .poll(() =>
      client.db("workbench_demo").collection("csv_copy").countDocuments(),
    )
    .toBe(5);
  checks.push("CSV mapping preview and import");
  expect(
    (
      await client
        .db("workbench_demo")
        .collection("csv_copy")
        .findOne({ name: "Ada Whole" })
    ).large.toString(),
  ).toBe("9007199254740993");
  await page.locator(".connection-row .node-menu-trigger").click();
  await page
    .locator(".connection-node .node-menu")
    .getByRole("button", { name: "Shell", exact: true })
    .click();
  const draftEditor = page.locator(".shell-editor .monaco-editor");
  await draftEditor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("const recoveryCheck = true;");
  await page
    .getByRole("button", { name: "關閉分頁 Shell", exact: true })
    .click();
  const closeShellDialog = page.getByRole("dialog", {
    name: "關閉 Shell 分頁",
    exact: true,
  });
  await expect(closeShellDialog).toBeVisible();
  await closeShellDialog
    .getByRole("button", { name: "保留草稿並關閉", exact: true })
    .click();
  await expect
    .poll(async () =>
      page.evaluate(() => window.workbench.request("shellDrafts.list", {})),
    )
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "const recoveryCheck = true;" }),
      ]),
    );
  await page.getByRole("button", { name: /草稿 1/ }).click();
  const recoveryDialog = page.getByRole("dialog", {
    name: "恢復 Shell 草稿",
    exact: true,
  });
  await expect(recoveryDialog).toBeVisible();
  await recoveryDialog
    .getByRole("button", { name: "恢復", exact: true })
    .click();
  await expect(page.locator(".shell-editor .view-lines")).toContainText(
    "recoveryCheck",
  );
  await page.getByRole("button", { name: "執行", exact: true }).click();
  await expect
    .poll(
      async () =>
        page.evaluate(() => window.workbench.request("shellDrafts.list", {})),
      { timeout: 30000 },
    )
    .toEqual([]);
  checks.push("Shell draft keep, restore, and clear after execution");
  const jobsToggle = page.getByRole("button", { name: "任務", exact: true });
  const jobsPanel = page.locator(".jobs-panel");
  if (await jobsPanel.isVisible()) await jobsToggle.click();
  await expect(jobsPanel).toHaveCount(0);
  await jobsToggle.click();
  await expect(jobsPanel).toBeVisible();
  const jobsHandle = jobsPanel.locator(".bottom-panel-resize-handle");
  await expect(jobsHandle).toHaveCSS("cursor", "ns-resize");
  const jobsBox = await jobsPanel.boundingBox();
  const jobsHandleBox = await jobsHandle.boundingBox();
  if (!jobsBox || !jobsHandleBox)
    throw new Error("Jobs resize handle is not interactable");
  await page.mouse.move(
    jobsHandleBox.x + jobsHandleBox.width / 2,
    jobsHandleBox.y + jobsHandleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    jobsHandleBox.x + jobsHandleBox.width / 2,
    jobsHandleBox.y - 45,
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await jobsPanel.boundingBox())?.height ?? 0)
    .toBeGreaterThan(jobsBox.height + 20);
  const jobDiagnosticButton = jobsPanel
    .getByRole("button", {
      name: "複製任務診斷資料",
      exact: true,
    })
    .first();
  await expect(jobDiagnosticButton).toBeVisible();
  await jobDiagnosticButton.click();
  await expect
    .poll(() => app.evaluate(() => globalThis.irwinTestClipboardText))
    .toContain('"jobId"');
  if (
    nativeClipboard &&
    (await copiedText(app, true)) !==
      (await app.evaluate(() => globalThis.irwinTestClipboardText))
  )
    unverified.push(
      "OS clipboard changed after the app wrote job diagnostics; Electron write payload was verified.",
    );
  await jobsPanel
    .getByRole("button", { name: "關閉任務面板", exact: true })
    .click();
  await expect(jobsPanel).toHaveCount(0);
  await page.getByTitle("偏好設定").click();
  const languagePreferencesDialog = page.getByRole("dialog", {
    name: "偏好設定",
    exact: true,
  });
  await languagePreferencesDialog
    .locator('[data-preference-section="data-language"]')
    .click();
  await languagePreferencesDialog
    .locator("label.field")
    .filter({ hasText: "語言" })
    .locator("select")
    .selectOption("en");
  await page
    .locator("dialog.preferences-modal[open]")
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "History & saved" }),
  ).toBeVisible();
  checks.push("English language");
  await page
    .getByRole("button", { name: "History & saved", exact: true })
    .click();
  const historyPanel = page.locator(".history-panel");
  await expect(historyPanel).toBeVisible();
  await expect(page.locator("dialog")).toHaveCount(0);
  const historyHandle = historyPanel.locator(".bottom-panel-resize-handle");
  await expect(historyHandle).toHaveCSS("cursor", "ns-resize");
  const historyBox = await historyPanel.boundingBox();
  const historyHandleBox = await historyHandle.boundingBox();
  if (!historyBox || !historyHandleBox)
    throw new Error("History resize handle is not interactable");
  await page.mouse.move(
    historyHandleBox.x + historyHandleBox.width / 2,
    historyHandleBox.y + historyHandleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    historyHandleBox.x + historyHandleBox.width / 2,
    historyHandleBox.y - 45,
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await historyPanel.boundingBox())?.height ?? 0)
    .toBeGreaterThan(historyBox.height + 20);
  await page
    .getByRole("button", { name: "History & saved", exact: true })
    .click();
  await expect(historyPanel).toHaveCount(0);
  checks.push("resizable jobs and history panels");
  await page.getByTitle("Preferences").click();
  let themeDialog = page.getByRole("dialog", {
    name: "Preferences",
    exact: true,
  });
  await themeDialog
    .locator("label.field")
    .filter({ hasText: "Theme" })
    .locator("select")
    .selectOption("azure");
  await themeDialog
    .locator('[data-preference-section="data-language"]')
    .click();
  await themeDialog
    .locator("label.field")
    .filter({ hasText: "Timezone" })
    .locator("select")
    .selectOption("Asia/Taipei");
  await themeDialog
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "azure");
  await expect(page.locator("html")).toHaveCSS("--accent", "#285da8");
  await expect
    .poll(async () =>
      page.evaluate(() => window.workbench.request("settings.get", {})),
    )
    .toMatchObject({ timezone: "Asia/Taipei" });
  await page.getByTitle("Preferences").click();
  themeDialog = page.getByRole("dialog", { name: "Preferences", exact: true });
  await themeDialog
    .locator("label.field")
    .filter({ hasText: "Theme" })
    .locator("select")
    .selectOption("forest");
  await themeDialog
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "forest");
  await expect(page.locator("html")).toHaveCSS("--accent", "#3f7d46");
  await page.getByTitle("Preferences").click();
  themeDialog = page.getByRole("dialog", { name: "Preferences", exact: true });
  await themeDialog
    .locator("label.field")
    .filter({ hasText: "Theme" })
    .locator("select")
    .selectOption("dark");
  await themeDialog
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  checks.push("selectable color themes");
  await setTheme("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: ".runtime/screenshots/light.png" });
  checks.push("light theme");
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Preferences", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  checks.push("preferences dialog");
  const layoutCollectionRow = page
    .locator(".collection-row")
    .filter({
      has: page.getByRole("button", { name: "layout_docs", exact: true }),
    })
    .first();
  await layoutCollectionRow
    .getByRole("button", { name: "layout_docs", exact: true })
    .click();
  const typeHeading = page
    .locator(".grid-heading")
    .filter({ hasText: /^type$/ })
    .first();
  const kindHeading = page
    .locator(".grid-heading")
    .filter({ hasText: /^kind$/ })
    .first();
  await expect(typeHeading).toBeVisible({ timeout: 30000 });
  await expect(kindHeading).toBeVisible();
  expect(
    await typeHeading.evaluate((element) =>
      Math.round(element.getBoundingClientRect().width),
    ),
  ).toBeLessThanOrEqual(100);
  expect(
    await kindHeading.evaluate((element) =>
      Math.round(element.getBoundingClientRect().width),
    ),
  ).toBeLessThanOrEqual(80);
  await page.getByRole("button", { name: "Tree", exact: true }).click();
  await expect(page.locator(".tree-results")).toContainText("Document 100");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await expect(page.locator(".json-editor-surface")).toContainText(
    "filterList",
  );
  checks.push("first-open compact columns and shared loaded result views");
  await page.locator(".connection-row").getByRole("button").nth(1).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("button", { name: "Export saved URI", exact: true })
    .click();
  await expect(page.getByLabel("Exported URI", { exact: true })).toBeVisible();
  const uriField = page
    .locator("label.field")
    .filter({ hasText: "Import URI" })
    .locator("textarea");
  await uriField.fill(server.getUri());
  await page.getByRole("button", { name: "Parse URI", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "URI parsed" }),
  ).toBeVisible();
  await page
    .locator("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  checks.push("URI import and export");
  await page.evaluate(
    (id) => window.workbench.request("connections.close", { id }),
    cid,
  );
  await expect(
    page
      .locator(".connection-tree")
      .getByRole("button", { name: "Local Development", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".sidebar-empty")).toContainText(
    "No active connections",
  );
  checks.push("disconnected database leaves active workspace");
  expect(errors).toEqual([]);
  await closeElectronWindowNormally(app);
  app = undefined;
  checks.push("normal GUI shutdown");
  await writeFile(
    ".runtime/desktop-smoke.json",
    JSON.stringify(
      { time: new Date().toISOString(), checks, errors, unverified },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, errors, unverified }));
} catch (e) {
  await writeFile(".runtime/desktop-smoke-error.txt", String(e));
  if (app) {
    try {
      const page = await app.firstWindow();
      await page
        .screenshot({ path: ".runtime/screenshots/failure.png" })
        .catch(() => {});
      console.log((await page.locator("body").innerText()).slice(0, 4000));
    } catch {
      // A packaged process can exit before Playwright observes its window.
    }
  }
  console.error(e);
  process.exitCode = 1;
} finally {
  if (app)
    await closeElectronWindowNormally(app).catch(() =>
      app.close().catch(() => {}),
    );
  await client.close();
  await server.stop();
}
