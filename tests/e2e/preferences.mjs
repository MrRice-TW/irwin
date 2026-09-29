import assert from "node:assert/strict";
import { _electron as electron, expect } from "@playwright/test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Long, MongoClient } from "mongodb";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { closeElectronWindowNormally } from "./helpers/close-electron.mjs";

const outputDir = ".runtime/preferences-qa";
await mkdir(outputDir, { recursive: true });
const dataDir = resolve(`.runtime/preferences-user-data-${Date.now()}`);
const server = await MongoMemoryServer.create({
  binary: { version: "8.0.18", downloadDir: ".runtime/mongodb" },
});
const client = await new MongoClient(server.getUri()).connect();
const documents = Array.from({ length: 18 }, (_, index) => ({
  _id: `qa-${String(index).padStart(3, "0")}`,
  name: `Document ${index}`,
  amount: Long.fromString("9007199254740993"),
  description:
    `Long field ${index}: This value is deliberately long to inspect truncation, wrapping and row height in the results grid. `.repeat(
      4,
    ),
  settings: {
    enabled: index % 2 === 0,
    profile: {
      labels: ["database", "preferences", `row-${index}`],
      nested: { level: 3, active: true, values: [index, index + 1] },
    },
  },
}));
await client.db("preferences_qa").collection("documents").insertMany(documents);
await client
  .db("preferences_qa")
  .collection("lazy_documents")
  .insertOne({ _id: "manual-run", title: "Loaded after F5" });

let app;
let page;
const checks = [];
const screenshots = [];
const errors = [];
const active = () => page.locator(".workspace-panel.visible");
const dialog = () => page.locator("dialog.preferences-modal[open]");
const check = async (name, run) => {
  try {
    await run();
    checks.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    const path = `${outputDir}/failure-${screenshots.length + 1}.png`;
    if (page) await page.screenshot({ path, fullPage: false }).catch(() => {});
    screenshots.push(path);
    console.error(`FAIL ${name}: ${error.stack || error}`);
    throw error;
  }
};
const shot = async (name) => {
  const path = `${outputDir}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  screenshots.push(path);
};
const resize = async (width, height) => {
  await app.evaluate(
    ({ BrowserWindow }, size) =>
      BrowserWindow.getAllWindows()[0].setContentSize(...size),
    [width, height],
  );
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
  await expect.poll(() => page.evaluate(() => innerHeight)).toBe(height);
};
const openPreferences = async () => {
  const label =
    (await page.locator("html").getAttribute("lang")) === "en"
      ? "Preferences"
      : "偏好設定";
  await page.locator(`.app-header button[title="${label}"]`).click();
  await expect(dialog()).toBeVisible();
};
const section = async (id) => {
  await dialog().locator(`[data-preference-section="${id}"]`).click();
};
const savePreferences = async () => {
  const label =
    (await page.locator("html").getAttribute("lang")) === "en"
      ? "Save settings"
      : "儲存設定";
  await dialog().getByRole("button", { name: label, exact: true }).click();
  await expect(dialog()).toHaveCount(0);
};
const cancelPreferences = async () => {
  const label =
    (await page.locator("html").getAttribute("lang")) === "en"
      ? "Cancel"
      : "取消";
  await dialog().getByRole("button", { name: label, exact: true }).click();
  await expect(dialog()).toHaveCount(0);
};
const settingsSnapshot = () =>
  page.evaluate(() => window.workbench.request("settings.get", {}));
const foldingStats = (editor) =>
  editor.evaluate((element) => ({
    collapsed: element.querySelectorAll(".codicon-folding-collapsed").length,
    expanded: element.querySelectorAll(".codicon-folding-expanded").length,
    lines: element.querySelectorAll(".view-lines .view-line").length,
    text: element.querySelector(".view-lines")?.textContent || "",
    fontFamily: getComputedStyle(element.querySelector(".view-line"))
      .fontFamily,
    fontSize: getComputedStyle(element.querySelector(".view-line")).fontSize,
  }));

try {
  const env = { ...process.env, WORKBENCH_USER_DATA: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    args: [".", "--disable-gpu"],
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => {
    if (!/ICodeLensCache|treeViewsDndService/.test(error.message))
      errors.push(error.message);
  });
  await expect(page.locator(".brand strong")).toHaveText("Irwin", {
    timeout: 30000,
  });
  await resize(1480, 960);

  await check(
    "five preference sections and workspace/per-tab scope are visible",
    async () => {
      await openPreferences();
      await expect(dialog().locator("[data-preference-section]")).toHaveCount(
        5,
      );
      await section("query-results");
      await expect(dialog()).toContainText("BATCH");
      await expect(dialog().locator(".modal-footer")).toBeVisible();
      const bounds = await dialog().evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const footer = element
          .querySelector(".modal-footer")
          .getBoundingClientRect();
        return {
          inside:
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= innerWidth &&
            rect.bottom <= innerHeight,
          footerInside: footer.bottom <= innerHeight && footer.height > 0,
        };
      });
      assert.deepEqual(bounds, { inside: true, footerInside: true });
      const visual = await page.evaluate(() => ({
        height: document
          .querySelector("dialog.preferences-modal")
          .getBoundingClientRect().height,
        logoBorder: getComputedStyle(document.querySelector(".brand-icon"))
          .borderTopWidth,
        logoBackground: getComputedStyle(document.querySelector(".brand-icon"))
          .backgroundColor,
      }));
      assert.ok(
        visual.height <= 700,
        `Preferences dialog too tall: ${visual.height}`,
      );
      assert.equal(visual.logoBorder, "0px");
      assert.equal(visual.logoBackground, "rgba(0, 0, 0, 0)");
      await section("appearance");
      await shot("01-dark-zh-preferences-full");
    },
  );

  await check(
    "interface scale previews and Cancel restores the saved zoom",
    async () => {
      await dialog()
        .locator(".preferences-content .preferences-form-grid select")
        .last()
        .selectOption("125");
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
          ),
        )
        .toBe(1.25);
      const zoomBounds = await dialog().evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const footer = element
          .querySelector(".modal-footer")
          .getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          footerBottom: footer.bottom,
          width: innerWidth,
          height: innerHeight,
        };
      });
      assert.ok(
        zoomBounds.left >= 0 &&
          zoomBounds.right <= zoomBounds.width &&
          zoomBounds.top >= 0 &&
          zoomBounds.bottom <= zoomBounds.height &&
          zoomBounds.footerBottom <= zoomBounds.height,
        `Zoomed preferences must fit: ${JSON.stringify(zoomBounds)}`,
      );
      const zoomShot = `${outputDir}/12-interface-scale-preview.png`;
      const png = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].capturePage())
          .toPNG()
          .toString("base64"),
      );
      await writeFile(zoomShot, Buffer.from(png, "base64"));
      screenshots.push(zoomShot);
      await cancelPreferences();
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
          ),
        )
        .toBe(1);
      assert.equal((await settingsSnapshot()).uiScale, 100);
    },
  );

  await check(
    "theme previews immediately and Cancel restores the saved theme",
    async () => {
      await openPreferences();
      await dialog()
        .getByRole("button", { name: "芒果暖色", exact: true })
        .click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await shot("02-light-zh-preview");
      await cancelPreferences();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      assert.equal((await settingsSnapshot()).theme, "dark");
    },
  );

  await check(
    "System mode pairs the chosen light palette with OS dark mode",
    async () => {
      await openPreferences();
      await page.emulateMedia({ colorScheme: "light" });
      const selects = dialog().locator(
        ".preferences-content .preferences-form-grid select",
      );
      await selects.nth(0).selectOption("system");
      await selects.nth(1).selectOption("forest");
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        "forest",
      );
      await page.emulateMedia({ colorScheme: "dark" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await shot("03-system-dark-zh-preview");
      await cancelPreferences();
      await page.emulateMedia({ colorScheme: "no-preference" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      const saved = await settingsSnapshot();
      assert.equal(saved.theme, "dark");
      assert.equal(saved.systemLightTheme, "light");
    },
  );

  await check(
    "editor fields validate inline, preview fonts and language, and Cancel rolls back",
    async () => {
      await openPreferences();
      await section("editor");
      const fields = dialog().locator(
        ".preferences-content .preferences-form-grid input",
      );
      await fields.nth(0).fill("");
      await expect(dialog()).toContainText("請輸入 1 至 160 個字元。");
      await expect(
        dialog().getByRole("button", { name: "儲存設定", exact: true }),
      ).toBeDisabled();
      await fields.nth(0).fill("Arial, sans-serif");
      await expect
        .poll(() =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement)
              .getPropertyValue("--font-family")
              .trim(),
          ),
        )
        .toBe("Arial, sans-serif");
      await fields.nth(2).fill("99");
      await expect(dialog()).toContainText("請輸入 11 至 18 的整數。");
      await fields.nth(2).fill("14");
      assert.equal(
        await page.evaluate(
          () => getComputedStyle(document.documentElement).fontSize,
        ),
        "13px",
      );
      await section("data-language");
      await dialog()
        .locator(".preferences-content .preferences-form-grid select")
        .nth(0)
        .selectOption("en");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(
        dialog().locator("[data-preference-section='query-results']"),
      ).toContainText("Query & results");
      await shot("04-english-preview");
      await cancelPreferences();
      await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
      await expect
        .poll(() =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement)
              .getPropertyValue("--font-family")
              .trim(),
          ),
        )
        .toContain("Inter");
    },
  );

  await page.evaluate(async (uri) => {
    await window.workbench.request("connections.save", {
      profile: {
        id: "preferences-qa",
        name: "Preferences QA",
        uri,
        database: "preferences_qa",
      },
      secrets: {},
    });
  }, server.getUri());
  await page.reload();
  await resize(1480, 960);
  await page
    .locator(".app-header")
    .getByRole("button", { name: "連線", exact: true })
    .click();
  await page
    .locator(".connection-picker")
    .getByRole("button", { name: "Preferences QA" })
    .click();
  await page
    .locator(".db-row")
    .getByRole("button", { name: "preferences_qa", exact: true })
    .click();
  await page
    .locator(".collection-row")
    .getByRole("button", { name: "documents", exact: true })
    .click();
  await expect(
    active().locator(".grid-cell").filter({ hasText: "qa-000" }).first(),
  ).toBeVisible({ timeout: 30000 });

  await check(
    "existing query results keep the comfortable, truncated defaults",
    async () => {
      const rows = active().locator(".grid-row");
      await expect(rows.first()).toBeVisible();
      const presentation = await active()
        .locator(".table-content")
        .evaluate((element) => ({
          density: element.getAttribute("data-density"),
          longText: element.getAttribute("data-long-text"),
          rowHeight: element.querySelector(".grid-row").getBoundingClientRect()
            .height,
          whiteSpace: getComputedStyle(element.querySelector(".cell-preview"))
            .whiteSpace,
        }));
      assert.deepEqual(presentation, {
        density: "comfortable",
        longText: "truncate",
        rowHeight: 36,
        whiteSpace: "nowrap",
      });
      await active().locator(".grid-cell.type-numberLong").first().click();
      await expect(
        active().locator(".grid-cell.selected-cell .cell-type-badge"),
      ).toContainText("Int64");
      await shot("05-default-table-dark-zh");
    },
  );

  await check(
    "query/results settings live-preview density and wrapping, then persist settings",
    async () => {
      await openPreferences();
      await section("appearance");
      await page.emulateMedia({ colorScheme: "light" });
      const appearanceSelects = dialog().locator(
        ".preferences-content .preferences-form-grid select",
      );
      await appearanceSelects.nth(0).selectOption("system");
      await appearanceSelects.nth(1).selectOption("forest");
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        "forest",
      );
      await section("query-results");
      const toggle = dialog().locator(
        ".preference-toggle input[type=checkbox]",
      );
      await toggle.uncheck();
      const selects = dialog().locator(
        ".preferences-content .preferences-form-grid select",
      );
      await selects.nth(0).selectOption("compact");
      await selects.nth(1).selectOption("always");
      await selects.nth(2).selectOption("wrap");
      await dialog()
        .locator(".preferences-job-section select")
        .selectOption("all");
      const jobSetting = dialog().locator(".preferences-job-section select");
      await jobSetting.scrollIntoViewIfNeeded();
      const jobBounds = await jobSetting.evaluate((element) => ({
        control: element.getBoundingClientRect().bottom,
        footer: document
          .querySelector("dialog.preferences-modal .modal-footer")
          .getBoundingClientRect().top,
      }));
      assert.ok(
        jobBounds.control <= jobBounds.footer,
        `Job setting hidden by footer: ${JSON.stringify(jobBounds)}`,
      );
      const depth = dialog().locator(".preferences-content input[type=number]");
      await depth.fill("2");
      await section("editor");
      const editorInputs = dialog().locator(
        ".preferences-content .preferences-form-grid input",
      );
      await editorInputs.nth(0).fill("Arial, sans-serif");
      await editorInputs.nth(1).fill("'Courier New', monospace");
      await editorInputs.nth(2).fill("14");
      await editorInputs.nth(3).fill("26");
      await editorInputs.nth(4).fill("18");
      await dialog()
        .locator(".preferences-content .preferences-form-grid select")
        .selectOption("4");
      await section("data-language");
      const dataSelects = dialog().locator(
        ".preferences-content .preferences-form-grid select",
      );
      await dataSelects.nth(0).selectOption("en");
      await dataSelects.nth(1).selectOption("Asia/Taipei");
      await dataSelects.nth(2).selectOption("space");
      await section("query-results");
      const preview = await active()
        .locator(".table-content")
        .evaluate((element) => ({
          density: element.getAttribute("data-density"),
          longText: element.getAttribute("data-long-text"),
          rowHeight: element.querySelector(".grid-row").getBoundingClientRect()
            .height,
          whiteSpace: getComputedStyle(element.querySelector(".cell-preview"))
            .whiteSpace,
        }));
      assert.deepEqual(preview, {
        density: "compact",
        longText: "wrap",
        rowHeight: 42,
        whiteSpace: "normal",
      });
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await shot("06-query-results-live-preview-compact");
      await savePreferences();
      const saved = await settingsSnapshot();
      assert.equal(saved.autoRunOnOpen, false);
      assert.equal(saved.rowDensity, "compact");
      assert.equal(saved.longTextDisplay, "wrap");
      assert.equal(saved.bsonTypeLabels, "always");
      assert.equal(saved.jobNotifications, "all");
      await expect(
        active().locator(".grid-cell.type-numberLong .cell-type-badge").first(),
      ).toBeVisible();
      assert.equal(saved.jsonExpandedDepth, 2);
      assert.equal(saved.theme, "system");
      assert.equal(saved.systemLightTheme, "forest");
      assert.equal(saved.editorFontFamily, "'Courier New', monospace");
      assert.equal(saved.tabWidth, 4);
      assert.equal(saved.language, "en");
      await expect(active().locator(".table-content")).toHaveAttribute(
        "data-long-text",
        "wrap",
      );
      await page.emulateMedia({ colorScheme: "dark" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await page.emulateMedia({ colorScheme: "light" });
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        "forest",
      );
      await page.emulateMedia({ colorScheme: "dark" });
    },
  );

  await check(
    "background job notification preference surfaces a completed job",
    async () => {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send("workbench:event", {
          type: "job",
          data: {
            jobId: "qa-complete",
            status: "completed",
            processed: 4,
            failed: 0,
            bytes: 64,
            message: "Done",
          },
        });
      });
      await expect(page.locator(".toast")).toContainText(
        "Background job completed",
      );
      await page.locator(".toast button").click();
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send("workbench:event", {
          type: "openJobs",
          data: {},
        });
      });
      await expect(page.locator(".jobs-panel")).toBeVisible();
      await page
        .locator(".jobs-panel")
        .getByRole("button", { name: "Close jobs panel" })
        .click();
    },
  );

  await check(
    "JSON results and a single document receive the configured initial folds",
    async () => {
      await active().getByRole("button", { name: "JSON", exact: true }).click();
      const resultEditor = active().locator(
        ".json-editor-surface .monaco-editor",
      );
      await expect(resultEditor).toBeVisible();
      await page.waitForTimeout(500);
      const resultFolds = await foldingStats(resultEditor);
      assert.ok(
        resultFolds.collapsed > 0,
        `Expected collapsed result JSON regions; got ${JSON.stringify(resultFolds)}`,
      );
      assert.match(resultFolds.text, /qa-000/);
      assert.match(resultFolds.fontFamily, /Courier New/i);
      assert.equal(resultFolds.fontSize, "14px");
      await openPreferences();
      await section("query-results");
      await dialog()
        .locator(".preferences-content input[type=number]")
        .fill("0");
      await expect
        .poll(async () => (await foldingStats(resultEditor)).collapsed)
        .toBe(0);
      await cancelPreferences();
      await expect
        .poll(async () => (await foldingStats(resultEditor)).collapsed)
        .toBeGreaterThan(0);
      await shot("07-json-results-default-folds");
      await active()
        .getByRole("button", { name: "Table", exact: true })
        .click();
      await active()
        .locator(".grid-cell")
        .filter({ hasText: "qa-000" })
        .first()
        .click();
      await page.keyboard.press("F3");
      const documentDialog = page.getByRole("dialog", {
        name: "Document JSON",
        exact: true,
      });
      await expect(documentDialog).toBeVisible();
      const documentEditor = documentDialog.locator(".monaco-editor");
      await expect(documentEditor).toBeVisible();
      await page.waitForTimeout(500);
      const documentFolds = await foldingStats(documentEditor);
      assert.ok(
        documentFolds.collapsed > 0,
        `Expected collapsed document JSON regions; got ${JSON.stringify(documentFolds)}`,
      );
      await shot("08-document-json-default-folds");
      await documentDialog
        .locator(".modal-head-actions button[aria-label='Close']")
        .click();
      await expect(documentDialog).toHaveCount(0);
    },
  );

  await check(
    "F5 manually runs a Collection when automatic loading is disabled",
    async () => {
      await page
        .locator(".collection-row")
        .getByRole("button", { name: "lazy_documents", exact: true })
        .click();
      await expect(
        page.getByText("Ready to run a query", { exact: true }),
      ).toBeVisible({ timeout: 10000 });
      await expect(active().locator(".grid-row")).toHaveCount(0);
      await page.keyboard.press("F5");
      await expect(active().locator(".results-wrapper")).toHaveAttribute(
        "aria-busy",
        "false",
        { timeout: 30000 },
      );
      await expect(
        active()
          .locator(".grid-cell")
          .filter({ hasText: "manual-run" })
          .first(),
      ).toBeVisible();
    },
  );

  await check(
    "reset section and reset all affect only the draft until saved",
    async () => {
      await openPreferences();
      await section("query-results");
      await dialog()
        .locator(".preferences-content .preferences-form-grid select")
        .nth(0)
        .selectOption("comfortable");
      await dialog()
        .getByRole("button", { name: "Reset section", exact: true })
        .click();
      await expect(dialog().locator(".preference-toggle input")).toBeChecked();
      await expect(
        dialog()
          .locator(".preferences-content .preferences-form-grid select")
          .nth(0),
      ).toHaveValue("comfortable");
      await expect(
        dialog()
          .locator(".preferences-content .preferences-form-grid select")
          .nth(2),
      ).toHaveValue("truncate");
      await expect(
        dialog().locator(".preferences-content input[type=number]"),
      ).toHaveValue("0");
      await expect
        .poll(() =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement)
              .getPropertyValue("--font-family")
              .trim(),
          ),
        )
        .toBe("Arial, sans-serif");
      await dialog()
        .getByRole("button", { name: "Reset all", exact: true })
        .click();
      await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await shot("09-reset-all-preview");
      await cancelPreferences();
      const saved = await settingsSnapshot();
      assert.equal(saved.autoRunOnOpen, false);
      assert.equal(saved.rowDensity, "compact");
      assert.equal(saved.longTextDisplay, "wrap");
      assert.equal(saved.language, "en");
      assert.equal(saved.fontFamily, "Arial, sans-serif");
    },
  );

  await check(
    "connection query timeout validates and persists independently",
    async () => {
      await page
        .getByRole("button", { name: "Preferences QA connection menu" })
        .click();
      await page
        .locator(".node-menu")
        .getByRole("button", { name: "Edit", exact: true })
        .click();
      const connectionDialog = page.getByRole("dialog", {
        name: "Edit connection",
      });
      await connectionDialog
        .getByRole("button", { name: "Advanced", exact: true })
        .click();
      const timeout = connectionDialog.locator(
        "input[name='query-timeout-seconds']",
      );
      await timeout.fill("121");
      await expect(connectionDialog).toContainText(
        "Enter a whole number from 5 to 120 seconds.",
      );
      await expect(
        connectionDialog.getByRole("button", { name: "Save connection" }),
      ).toBeDisabled();
      await connectionDialog
        .locator(".query-timeout-presets button", { hasText: "15 s" })
        .click();
      await expect(timeout).toHaveValue("15");
      await shot("13-connection-query-timeout");
      await connectionDialog
        .getByRole("button", { name: "Save connection" })
        .click();
      await expect(connectionDialog).toHaveCount(0);
      const profiles = await page.evaluate(() =>
        window.workbench.request("connections.list", {}),
      );
      assert.equal(
        profiles.find((profile) => profile.name === "Preferences QA")
          .queryTimeoutMS,
        15000,
      );
    },
  );

  await check(
    "compact window keeps navigation, content and footer accessible in both themes",
    async () => {
      await resize(1024, 768);
      await openPreferences();
      const status = await dialog().evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const footer = element
          .querySelector(".modal-footer")
          .getBoundingClientRect();
        const body = element.querySelector(".modal-body");
        return {
          inside:
            bounds.left >= 0 &&
            bounds.top >= 0 &&
            bounds.right <= innerWidth &&
            bounds.bottom <= innerHeight,
          footerVisible: footer.height > 0 && footer.bottom <= innerHeight,
          horizontalOverflow: body.scrollWidth > body.clientWidth,
        };
      });
      assert.deepEqual(status, {
        inside: true,
        footerVisible: true,
        horizontalOverflow: false,
      });
      await expect(
        dialog().getByRole("button", { name: "Save settings", exact: true }),
      ).toBeVisible();
      await section("appearance");
      await dialog()
        .locator(".preferences-content .preferences-form-grid select")
        .nth(0)
        .selectOption("light");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await shot("10-english-light-preferences-compact");
      await cancelPreferences();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await shot("11-english-dark-workspace-compact");
      await openPreferences();
      await dialog()
        .locator(".preferences-content .preferences-form-grid select")
        .last()
        .selectOption("125");
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
          ),
        )
        .toBe(1.25);
      const scaled = await dialog().evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const footer = element
          .querySelector(".modal-footer")
          .getBoundingClientRect();
        return {
          inside:
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= innerWidth &&
            rect.bottom <= innerHeight,
          footerVisible: footer.height > 0 && footer.bottom <= innerHeight,
          horizontalOverflow:
            element.querySelector(".modal-body").scrollWidth >
            element.querySelector(".modal-body").clientWidth,
        };
      });
      assert.deepEqual(scaled, {
        inside: true,
        footerVisible: true,
        horizontalOverflow: false,
      });
      const scaledShot = `${outputDir}/14-interface-scale-compact.png`;
      const scaledPng = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].capturePage())
          .toPNG()
          .toString("base64"),
      );
      await writeFile(scaledShot, Buffer.from(scaledPng, "base64"));
      screenshots.push(scaledShot);
      await cancelPreferences();
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
          ),
        )
        .toBe(1);
    },
  );

  await check("renderer reports no uncaught page errors", async () => {
    assert.deepEqual(errors, []);
  });

  const report = { checks, screenshots, errors, completed: true };
  await writeFile(`${outputDir}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = {
    checks,
    screenshots,
    errors,
    completed: false,
    error: error.stack || String(error),
  };
  await writeFile(`${outputDir}/report.json`, JSON.stringify(report, null, 2));
  throw error;
} finally {
  if (app) await closeElectronWindowNormally(app).catch(() => {});
  await client.close().catch(() => {});
  await server.stop().catch(() => {});
}
