import { _electron as electron, expect } from "@playwright/test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { closeElectronWindowNormally } from "./helpers/close-electron.mjs";

await mkdir(".runtime/screenshots", { recursive: true });
const server = await MongoMemoryServer.create({
  binary: { version: "8.0.18", downloadDir: ".runtime/mongodb" },
});
const client = await new MongoClient(server.getUri()).connect();
for (const database of ["source_qa", "target_qa"]) {
  await client
    .db(database)
    .collection(database === "target_qa" ? "target_records" : "records")
    .insertMany(
      Array.from({ length: 6 }, (_, i) => ({
        _id: `${database}-${i}`,
        marker: database,
        count: i,
        active: i % 2 === 0,
      })),
    );
}
const env = {
  ...process.env,
  WORKBENCH_USER_DATA: resolve(`.runtime/saved-independent-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.WORKBENCH_DEV_URL;
let app, page;
const checks = [],
  failures = [],
  errors = [];
const active = () => page.locator(".workspace-panel.visible");
const dialog = () =>
  page.getByRole("dialog", { name: "Save / edit query", exact: true });
const item = (name) => page.getByRole("article", { name, exact: true });
const check = async (name, fn) => {
  try {
    await fn();
    checks.push(name);
  } catch (e) {
    failures.push({ name, error: e.stack });
  }
};
const launch = async () => {
  app = await electron.launch({
    args: [".", "--disable-gpu"],
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator(".brand strong")).toHaveText("Irwin", {
    timeout: 30000,
  });
};
const connect = async (name, db) => {
  await page
    .locator(".app-header")
    .getByRole("button", { name: /^Connections/ })
    .click();
  await page
    .locator(".connection-picker-item")
    .filter({ hasText: name })
    .click();
  await page
    .locator(".db-row")
    .getByRole("button", { name: db, exact: true })
    .last()
    .click();
  await page
    .locator(".collection-row")
    .getByRole("button", {
      name: db === "target_qa" ? "target_records" : "records",
      exact: true,
    })
    .last()
    .click();
  await expect(
    active()
      .locator(".grid-cell")
      .filter({ hasText: new RegExp(`^${db}-0$`) }),
  ).toBeVisible();
};
try {
  await launch();
  await page.evaluate(async (uri) => {
    const s = await window.workbench.request("settings.get", {});
    await window.workbench.request("settings.set", {
      ...s,
      language: "en",
      theme: "dark",
    });
    for (const [id, name, database] of [
      ["qa-source", "QA Source", "source_qa"],
      ["qa-target", "QA Target", "target_qa"],
    ])
      await window.workbench.request("connections.save", {
        profile: { id, name, database, uri },
      });
  }, server.getUri());
  await page.reload();
  await connect("QA Source", "source_qa");
  await active().getByLabel("BATCH", { exact: true }).selectOption("25");
  await expect(active().locator(".results-wrapper")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await active().getByLabel("FILTER", { exact: true }).fill("{active:true}");
  await active().getByLabel("SORT", { exact: true }).fill("{count:-1}");
  await active()
    .getByLabel("PROJECTION", { exact: true })
    .fill("{_id:0,marker:1,count:1}");
  await active()
    .getByRole("button", { name: "Save query", exact: true })
    .click();
  await expect(dialog().getByLabel("FILTER", { exact: true })).toHaveValue(
    "{active:true}",
  );
  await expect(
    dialog().getByRole("spinbutton", { name: /^BATCH\b/ }),
  ).toHaveValue("25");
  await expect(
    dialog().getByLabel("Query name", { exact: true }),
  ).toHaveAttribute("name", "saved-query-name");
  await expect(
    dialog().getByLabel("Query name", { exact: true }),
  ).toHaveAttribute("autocomplete", "off");
  await expect(
    dialog().getByLabel("Group / folder", { exact: true }),
  ).toHaveAttribute("name", "saved-query-group");
  await expect(
    dialog().getByLabel("Description", { exact: true }),
  ).toHaveAttribute("name", "saved-query-description");
  await expect(
    dialog().getByRole("spinbutton", { name: /^BATCH\b/ }),
  ).toHaveAttribute("name", "saved-query-batch");
  await dialog().getByLabel("Query name", { exact: true }).fill("Active rows");
  await dialog()
    .getByLabel("Group / folder", { exact: true })
    .fill("Daily / Orders");
  await dialog()
    .getByLabel("Description", { exact: true })
    .fill("Independent GUI regression: reuse across environments");
  await page.screenshot({
    path: ".runtime/screenshots/qa-saved-dialog-dark.png",
  });
  await dialog()
    .getByRole("button", { name: "Save query", exact: true })
    .click();
  await expect(dialog()).toHaveCount(0);
  await active()
    .getByRole("button", { name: "Open saved queries", exact: true })
    .click();
  await expect(item("Active rows")).toBeVisible();
  await expect(page.locator(".saved-query-group summary")).toContainText(
    "Daily / Orders",
  );
  checks.push(
    "Save current filter/sort/projection/batch with custom name, group and description",
  );
  await active().getByLabel("FILTER", { exact: true }).fill("{}");
  await item("Active rows")
    .getByRole("button", { name: "Apply to current tab", exact: true })
    .click();
  await expect(active().getByLabel("FILTER", { exact: true })).toHaveValue(
    "{active:true}",
  );
  await expect(
    active()
      .locator(".grid-cell")
      .filter({ hasText: /^source_qa-0$/ }),
  ).toBeVisible();
  checks.push(
    "Apply to same collection restores inputs without auto-executing",
  );
  await item("Active rows")
    .getByRole("button", { name: "Edit query", exact: true })
    .click();
  await dialog().getByLabel("Query name", { exact: true }).fill(" ");
  await dialog()
    .getByRole("button", { name: "Save query", exact: true })
    .click();
  await expect(dialog().getByRole("alert")).toContainText("Enter a query name");
  await dialog()
    .getByLabel("Query name", { exact: true })
    .fill("Active rows renamed");
  await dialog().getByLabel("FILTER", { exact: true }).fill("{broken:");
  await dialog()
    .getByRole("button", { name: "Save query", exact: true })
    .click();
  await expect(dialog().getByRole("alert")).toContainText("FILTER");
  await dialog().getByLabel("FILTER", { exact: true }).fill("{active:true}");
  checks.push(
    "Empty names and invalid query inputs are rejected without saving",
  );
  await dialog()
    .getByLabel("Group / folder", { exact: true })
    .fill("Regression / Shared");
  await dialog()
    .getByRole("spinbutton", { name: /^BATCH\b/ })
    .fill("2");
  await dialog()
    .getByRole("button", { name: "Save query", exact: true })
    .click();
  await expect(item("Active rows renamed")).toBeVisible();
  await expect(item("Active rows")).toHaveCount(0);
  await expect(page.locator(".saved-query-group summary")).toContainText(
    "Regression / Shared",
  );
  checks.push("Rename, move group and edit saved query inputs");
  await connect("QA Target", "target_qa");
  await item("Active rows renamed")
    .getByRole("button", { name: "Apply to current tab", exact: true })
    .click();
  await expect(active().getByLabel("SORT", { exact: true })).toHaveValue(
    "{count:-1}",
  );
  await expect(active().getByLabel("PROJECTION", { exact: true })).toHaveValue(
    "{_id:0,marker:1,count:1}",
  );
  await check(
    "Custom saved batch 2 is accurately displayed",
    async () =>
      await expect(active().getByLabel("BATCH", { exact: true })).toHaveValue(
        "2",
      ),
  );
  await expect(
    active()
      .locator(".grid-cell")
      .filter({ hasText: /^target_qa-0$/ }),
  ).toBeVisible();
  await active().getByRole("button", { name: "Run", exact: true }).click();
  await expect(active().locator(".results-wrapper")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(active().locator(".grid-row")).toHaveCount(2);
  await expect(
    active()
      .locator(".grid-cell")
      .filter({ hasText: /^target_qa$/ }),
  ).toHaveCount(2);
  await expect(
    active().getByRole("button", { name: "Sort by column _id", exact: true }),
  ).toHaveCount(0);
  const rowText = await active().locator(".grid-row").allTextContents();
  expect(rowText[0]).toContain("4");
  expect(rowText[1]).toContain("2");
  checks.push(
    "Different profile/DB uses target namespace, preserves sort/projection/batch, and executes only after Run",
  );
  await page.screenshot({
    path: ".runtime/screenshots/qa-saved-cross-environment-dark.png",
  });
  await active()
    .getByRole("button", { name: "Next batch", exact: true })
    .click();
  await expect(active().locator(".grid-row")).toHaveCount(1);
  await expect(
    active().getByRole("button", { name: "Next batch", exact: true }),
  ).toBeDisabled();
  expect((await active().locator(".grid-row").allTextContents())[0]).toContain(
    "0",
  );
  checks.push(
    "Saved batch 2 pages through all three matching rows to completion",
  );
  await active()
    .getByRole("button", { name: "Free command", exact: true })
    .click();
  await active()
    .getByRole("button", { name: "Save query", exact: true })
    .click();
  await expect(
    dialog().getByRole("textbox", { name: /^Shell script/ }),
  ).toHaveValue(/getCollection\("target_records"\)/);
  await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
  checks.push(
    "Switching an applied find query to free command uses the target collection name",
  );
  // Close normally and relaunch the same isolated profile to prove persistence.
  await closeElectronWindowNormally(app);
  app = undefined;
  await launch();
  await expect(page.locator(".workspace-tab")).toHaveCount(0);
  await page
    .getByRole("button", { name: "History & saved", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Saved queries", exact: true })
    .click();
  await expect(item("Active rows renamed")).toBeVisible();
  await expect(
    item("Active rows renamed").getByRole("button", {
      name: "Apply to current tab",
      exact: true,
    }),
  ).toBeDisabled();
  checks.push(
    "Saved queries survive a normal app restart; no open collection is needed to browse them",
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1040, 760),
  );
  await page.screenshot({
    path: ".runtime/screenshots/qa-saved-narrow-dark.png",
  });
  await item("Active rows renamed")
    .getByRole("button", { name: "Edit query", exact: true })
    .click();
  await expect(
    dialog().getByRole("button", { name: "Save query", exact: true }),
  ).toBeVisible();
  const filterBox = await dialog()
    .getByLabel("FILTER", { exact: true })
    .boundingBox();
  await page.mouse.move(
    filterBox.x + filterBox.width - 4,
    filterBox.y + filterBox.height - 4,
  );
  await page.mouse.down();
  await page.mouse.move(
    filterBox.x + filterBox.width - 4,
    filterBox.y + filterBox.height + 55,
    { steps: 8 },
  );
  await page.mouse.up();
  const resizedFilter = await dialog()
    .getByLabel("FILTER", { exact: true })
    .boundingBox();
  expect(resizedFilter.height).toBeGreaterThan(filterBox.height + 30);
  await dialog()
    .getByRole("button", { name: "Format FILTER", exact: true })
    .click();
  expect(
    await dialog().getByLabel("FILTER", { exact: true }).inputValue(),
  ).toContain("\n");
  const overflowing = await dialog().evaluate(
    (el) => el.scrollWidth > el.clientWidth + 2,
  );
  expect(overflowing).toBe(false);
  checks.push(
    "Narrow saved-query dialog supports native vertical resize and JSON format without horizontal overflow",
  );
  await page.screenshot({
    path: ".runtime/screenshots/qa-saved-narrow-dialog-dark.png",
  });
  await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(async () => {
    const s = await window.workbench.request("settings.get", {});
    await window.workbench.request("settings.set", { ...s, theme: "light" });
  });
  await page.reload();
  await page
    .getByRole("button", { name: "History & saved", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Saved queries", exact: true })
    .click();
  await expect(item("Active rows renamed")).toBeVisible();
  await page.screenshot({
    path: ".runtime/screenshots/qa-saved-narrow-light.png",
  });
  await item("Active rows renamed")
    .getByRole("button", { name: "Edit query", exact: true })
    .click();
  await page.screenshot({
    path: ".runtime/screenshots/qa-saved-narrow-dialog-light.png",
  });
  await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
  checks.push(
    "Dark/light themes and 1040×760 window present saved-query library and editable dialog",
  );
  await item("Active rows renamed")
    .getByRole("button", { name: "Delete saved query", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Delete saved query", exact: true })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(item("Active rows renamed")).toBeVisible();
  await item("Active rows renamed")
    .getByRole("button", { name: "Delete saved query", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Delete saved query", exact: true })
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await expect(item("Active rows renamed")).toHaveCount(0);
  const stored = await page.evaluate(() =>
    window.workbench.request("savedQueries.list", {}),
  );
  expect(stored).toEqual([]);
  checks.push(
    "Delete cancel preserves entry; confirmed deletion removes it from persistent storage",
  );
} catch (e) {
  failures.push({ name: "Saved-query GUI flow", error: e.stack });
  if (page && !page.isClosed())
    await page.screenshot({
      path: ".runtime/screenshots/qa-saved-failure.png",
    });
} finally {
  try {
    if (app) await closeElectronWindowNormally(app);
  } catch (e) {
    failures.push({ name: "Normal shutdown", error: e.stack });
  }
  await client.close();
  await server.stop();
}
const result = {
  checks,
  failures,
  errors,
  timestamp: new Date().toISOString(),
};
await writeFile(
  ".runtime/qa-saved-queries-independent.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
if (failures.length || errors.length) process.exitCode = 1;
