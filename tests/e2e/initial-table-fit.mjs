import { _electron as electron, expect } from "@playwright/test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { closeElectronWindowNormally } from "./helpers/close-electron.mjs";
import { createServer } from "vite";

await mkdir(".runtime/screenshots", { recursive: true });
const server = await MongoMemoryServer.create({
  binary: { version: "8.0.18", downloadDir: ".runtime/mongodb" },
});
const client = await new MongoClient(server.getUri()).connect();
await client
  .db("initial_layout_qa")
  .collection("documents")
  .insertMany(
    Array.from({ length: 120 }, (_, index) => ({
      _id: `document-${index}`,
      type: index % 8 === 0 ? "filterList" : "test",
      kind: "async",
      description:
        "This deliberately long content must retain the normal table column width.",
    })),
  );

const env = {
  ...process.env,
  WORKBENCH_USER_DATA: resolve(`.runtime/initial-layout-qa-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
let vite;
if (process.argv.includes("--dev")) {
  vite = await createServer({ server: { host: "127.0.0.1", port: 5187 } });
  await vite.listen();
  env.WORKBENCH_DEV_URL = vite.resolvedUrls.local[0];
}

const layout = {
  widths: { type: 220, kind: 220, description: 220 },
  order: ["_id", "type", "kind", "description"],
  hidden: [],
  pinned: [],
  expanded: [],
  remember: true,
};
let app;
let page;
const checks = [];
const failures = [];
const errors = [];
const active = () => page.locator(".workspace-panel.visible");
const headingWidth = async (field) =>
  active()
    .getByRole("button", { name: `Sort by column ${field}`, exact: true })
    .evaluate((element) => element.parentElement.getBoundingClientRect().width);

try {
  app = await electron.launch({
    args: [".", "--disable-gpu"],
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".brand strong")).toHaveText("Irwin", {
    timeout: 30000,
  });
  // Let the renderer's first empty-workspace save settle before installing
  // persisted data, including a legacy workspace record with open tabs.
  await page.waitForTimeout(400);
  await page.evaluate(
    async ({ uri, layout }) => {
      const settings = await window.workbench.request("settings.get", {});
      await window.workbench.request("settings.set", {
        ...settings,
        language: "en",
        theme: "dark",
      });
      await window.workbench.request("connections.save", {
        profile: {
          id: "initial-layout-qa",
          name: "Initial layout QA",
          uri,
          database: "initial_layout_qa",
        },
      });
      await window.workbench.request("tableLayouts.save", {
        key: JSON.stringify([
          "initial-layout-qa",
          "initial_layout_qa",
          "documents",
        ]),
        layout,
      });
      await window.workbench.request("workspace.save", {
        version: 1,
        active: "legacy-documents-tab",
        sidebarWidth: 268,
        jobsHeight: 220,
        historyHeight: 260,
        tabs: [{ id: "legacy-documents-tab", collection: "documents" }],
      });
    },
    { uri: server.getUri(), layout },
  );
  await page.reload();
  await expect(
    page.locator(".workspace-tab").filter({ hasText: "documents" }),
  ).toHaveCount(0);
  const restoredSettings = await page.evaluate(() =>
    window.workbench.request("settings.get", {}),
  );
  expect(restoredSettings).not.toHaveProperty("restoreWorkspace");
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await expect(
    page.getByText(
      "Restore tabs, queries and layout on startup (no automatic connections or execution)",
      {
        exact: true,
      },
    ),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  checks.push("startup opens a clean tab list without a restore preference");
  await page
    .locator(".app-header")
    .getByRole("button", { name: "Connections", exact: true })
    .click();
  await page
    .locator(".connection-picker")
    .locator(".connection-picker-item")
    .filter({ hasText: /^Initial layout QA/ })
    .click();
  await page
    .locator(".db-row")
    .getByRole("button", { name: "initial_layout_qa", exact: true })
    .click();
  await page
    .locator(".collection-row")
    .getByRole("button", { name: "documents", exact: true })
    .click();
  await expect(
    active()
      .locator(".grid-cell")
      .filter({ hasText: /^filterList$/ })
      .first(),
  ).toBeVisible({ timeout: 10000 });
  const freshOpen = {
    type: await headingWidth("type"),
    kind: await headingWidth("kind"),
    description: await headingWidth("description"),
  };
  expect(freshOpen.type).toBeLessThan(110);
  expect(freshOpen.kind).toBeLessThan(110);
  expect(freshOpen.description).toBeGreaterThanOrEqual(219);
  checks.push("opening a collection recalculates remembered column widths");
  await page.screenshot({
    path: ".runtime/screenshots/initial-table-fit-remembered-layout.png",
  });

  await page.keyboard.press("F5");
  await expect(active().locator(".results-wrapper")).toHaveAttribute(
    "aria-busy",
    "false",
    { timeout: 30000 },
  );
  expect(await headingWidth("type")).toBe(freshOpen.type);
  expect(await headingWidth("kind")).toBe(freshOpen.kind);
  checks.push("re-query leaves first-result widths unchanged");
} catch (error) {
  failures.push({ name: "initial table fit", message: error.stack });
  if (page && !page.isClosed())
    await page.screenshot({
      path: ".runtime/screenshots/initial-table-fit-failure.png",
    });
} finally {
  try {
    if (app) await closeElectronWindowNormally(app);
  } catch (error) {
    failures.push({ name: "normal GUI shutdown", message: error.stack });
  }
  await client.close();
  await server.stop();
  await vite?.close();
}

const result = {
  checks,
  failures,
  errors,
  timestamp: new Date().toISOString(),
};
await writeFile(
  ".runtime/initial-table-fit-results.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
if (failures.length || errors.length) process.exitCode = 1;
