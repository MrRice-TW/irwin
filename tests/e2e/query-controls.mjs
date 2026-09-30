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
await client
  .db("query_qa")
  .collection("mixed")
  .insertMany([
    { _id: "a", name: "Alpha", score: 1, kind: "async" },
    { _id: "b", kind: "sync", score: 3, name: "Bravo", optional: true },
    { _id: "c", score: 2, name: "Charlie", kind: "async" },
  ]);
const env = {
  ...process.env,
  WORKBENCH_USER_DATA: resolve(`.runtime/query-qa-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const checks = [],
  failures = [],
  errors = [];
const active = () => page.locator(".workspace-panel.visible");
const check = async (name, run) => {
  try {
    await run();
    checks.push(name);
  } catch (e) {
    failures.push({ name, message: e.message });
    await page.screenshot({
      path: `.runtime/screenshots/query-check-${failures.length}.png`,
    });
    if (await page.locator("dialog[open]").count())
      await page.keyboard.press("Escape");
  }
};
const idle = () =>
  expect(active().locator(".results-wrapper")).toHaveAttribute(
    "aria-busy",
    "false",
  );
const heading = (field) =>
  active().getByRole("button", {
    name: `Sort by column ${field}`,
    exact: true,
  });
const layout = () =>
  active()
    .locator(".grid-heading")
    .evaluateAll((els) =>
      els.map((el) => ({
        field: el.querySelector("button").getAttribute("aria-label"),
        x: el.getBoundingClientRect().x,
        width: el.getBoundingClientRect().width,
      })),
    );
try {
  app = await electron.launch({ args: [".", "--disable-gpu"], env });
  page = await app.firstWindow();
  page.on("pageerror", (e) => {
    if (!/ICodeLensCache|treeViewsDndService/.test(e.message))
      errors.push(e.message);
  });
  await expect(page.locator(".brand strong")).toHaveText("Irwin", {
    timeout: 30000,
  });
  await page.evaluate(async (uri) => {
    const settings = await window.workbench.request("settings.get", {});
    await window.workbench.request("settings.set", {
      ...settings,
      language: "en",
      theme: "light",
    });
    await window.workbench.request("connections.save", {
      profile: { id: "query-qa", name: "Query QA", uri, database: "query_qa" },
    });
  }, server.getUri());
  await page.reload();
  await page
    .locator(".app-header")
    .getByRole("button", { name: "Connections", exact: true })
    .click();
  await page
    .locator(".connection-picker")
    .getByRole("button", { name: "Query QA" })
    .click();
  await page
    .locator(".db-row")
    .getByRole("button", { name: "query_qa", exact: true })
    .click();
  await page
    .locator(".collection-row")
    .getByRole("button", { name: "mixed", exact: true })
    .click();
  await expect(active().locator(".grid-row")).toHaveCount(3, {
    timeout: 30000,
  });
  await check(
    "Repeated header sorting does not move or resize heterogeneous fields",
    async () => {
      const before = await layout();
      for (let i = 0; i < 4; i++) {
        await heading("score").click();
        await idle();
        expect(await layout()).toEqual(before);
      }
    },
  );
  await check(
    "Sort cycles ascending, descending, none; explicit clear resets query and indicators",
    async () => {
      await active().getByLabel("SORT", { exact: true }).fill("{}");
      await active().getByRole("button", { name: "Run", exact: true }).click();
      await idle();
      for (const direction of [1, -1, undefined]) {
        await heading("score").click();
        await idle();
        expect(
          JSON.parse(
            await active().getByLabel("SORT", { exact: true }).inputValue(),
          ),
        ).toEqual(direction ? { score: direction } : {});
        await expect(heading("score")).toHaveText(
          direction ? `score ${direction === 1 ? "↑" : "↓"}` : "score",
        );
      }
      await active()
        .getByLabel("SORT", { exact: true })
        .fill("{name:-1,score:1}");
      await active().getByRole("button", { name: "Run", exact: true }).click();
      await idle();
      await expect(heading("name")).toHaveText("name ↓");
      await active()
        .getByRole("button", { name: "Clear sort", exact: true })
        .click();
      await idle();
      await expect(active().getByLabel("SORT", { exact: true })).toHaveValue(
        "{}",
      );
      await expect(heading("name")).toHaveText("name");
      await active()
        .locator(".table-scroll")
        .click({ position: { x: 20, y: 50 } });
      await page.keyboard.press("F5");
      await idle();
      await expect(active().getByLabel("SORT", { exact: true })).toHaveValue(
        "{}",
      );
    },
  );
  await check(
    "Enter accepts the highlighted MongoDB operator suggestion",
    async () => {
      const filter = active().getByLabel("FILTER", { exact: true });
      await filter.fill("{score:{$g");
      const options = active().locator(".query-suggestions [role=option]");
      await expect(options).toHaveCount(2);
      await expect(options.nth(0)).toContainText("$gt");
      await expect(options.nth(1)).toContainText("$gte");
      await filter.press("ArrowDown");
      await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
      await filter.press("Enter");
      await expect(filter).toHaveValue("{score:{$gte");
      await expect(active().locator(".query-suggestions")).toHaveCount(0);
      await expect(active().locator(".grid-row")).toHaveCount(3);
      await filter.fill("{}");
    },
  );
  await check(
    "Query fields resize and format valid Mongo literals without executing them",
    async () => {
      const filter = active().getByLabel("FILTER", { exact: true });
      await filter.fill('{kind:"async",score:{$gte:1}}');
      await active()
        .getByRole("button", { name: "Format FILTER", exact: true })
        .click();
      expect(await filter.inputValue()).toContain("\n");
      expect(JSON.parse(await filter.inputValue())).toEqual({
        kind: "async",
        score: { $gte: 1 },
      });
      await expect(active().locator(".grid-row")).toHaveCount(3);
      const before = await filter.boundingBox();
      await page.mouse.move(
        before.x + before.width - 3,
        before.y + before.height - 3,
      );
      await page.mouse.down();
      await page.mouse.move(
        before.x + before.width - 3,
        before.y + before.height + 70,
        { steps: 6 },
      );
      await page.mouse.up();
      expect((await filter.boundingBox()).height).toBeGreaterThan(
        before.height + 35,
      );
      const splitter = active().getByRole("separator", {
        name: "Resize FILTER and SORT",
        exact: true,
      });
      const box = await splitter.boundingBox();
      const oldWidth = (await filter.boundingBox()).width;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 70, box.y + box.height / 2, { steps: 6 });
      await page.mouse.up();
      expect((await filter.boundingBox()).width).toBeGreaterThan(oldWidth + 30);
      await active()
        .getByRole("button", { name: "Expand FILTER", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "FILTER editor",
        exact: true,
      });
      await expect(dialog.locator(".monaco-editor")).toBeVisible();
      const normalWidth = (await dialog.boundingBox()).width;
      await dialog
        .getByRole("button", { name: "Maximize window", exact: true })
        .click();
      expect((await dialog.boundingBox()).width).toBeGreaterThan(
        normalWidth + 100,
      );
      await dialog.locator(".monaco-editor").click();
      await expect(dialog.locator(".view-lines")).toContainText('"kind"');
      await page.keyboard.press("Control+a");
      await page.keyboard.press("Backspace");
      await expect
        .poll(async () =>
          (await dialog.locator(".view-lines").innerText()).trim(),
        )
        .toBe("");
      await page.keyboard.insertText("{score:{$gte:2}}");
      await expect
        .poll(async () =>
          (await dialog.locator(".view-lines").innerText()).replace(/\s/g, ""),
        )
        .toBe("{score:{$gte:2}}");
      await dialog
        .getByRole("button", { name: "Format document", exact: true })
        .click();
      await page.screenshot({
        path: ".runtime/screenshots/query-expanded.png",
      });
      await dialog.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(JSON.parse(await filter.inputValue())).toEqual({
        score: { $gte: 2 },
      });
      await active().getByRole("button", { name: "Run", exact: true }).click();
      await idle();
      await expect(active().locator(".grid-row")).toHaveCount(2);
      await filter.fill("{score:");
      await active()
        .getByRole("button", { name: "Format FILTER", exact: true })
        .click();
      await expect(filter).toHaveValue("{score:");
      await expect(active().locator(".query-format-error")).toBeVisible();
      await filter.fill("{}");
    },
  );
  await check(
    "SORT and PROJECTION format, apply and execute independently",
    async () => {
      const sort = active().getByLabel("SORT", { exact: true });
      await sort.fill("{score:-1}");
      await sort.press("Shift+Alt+f");
      expect(JSON.parse(await sort.inputValue())).toEqual({ score: -1 });
      await expect(heading("score")).toHaveText("score ↓");
      await active()
        .getByLabel("PROJECTION", { exact: true })
        .fill("{name:1,kind:1}");
      await active()
        .getByRole("button", { name: "Expand PROJECTION", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "PROJECTION editor",
        exact: true,
      });
      await expect(dialog.locator(".view-lines")).toContainText('"name"');
      await dialog.getByRole("button", { name: "Apply", exact: true }).click();
      await sort.press("F5");
      await idle();
      await expect(heading("score")).toHaveCount(0);
      await active().getByLabel("PROJECTION", { exact: true }).fill("{}");
      await active()
        .getByRole("button", { name: "Clear sort", exact: true })
        .click();
      await idle();
      await expect(heading("score")).toHaveText("score");
    },
  );
  await check(
    "Manual column widths, order and pins survive repeated sorts and projections",
    async () => {
      await heading("kind").locator("..").dragTo(heading("name").locator(".."));
      const grip = heading("score").locator("..").locator(".column-resizer");
      const box = await grip.boundingBox();
      await page.mouse.move(box.x + 4, box.y + 12);
      await page.mouse.down();
      await page.mouse.move(box.x + 64, box.y + 12, { steps: 6 });
      await page.mouse.up();
      await active()
        .locator(".grid-cell")
        .filter({ hasText: /^Alpha$/ })
        .click({ button: "right" });
      await page
        .getByRole("button", { name: "Pin column", exact: true })
        .click();
      const before = await layout();
      for (let i = 0; i < 3; i++) {
        await heading("score").click();
        await idle();
        await expect.poll(layout).toEqual(before);
      }
      await active()
        .getByLabel("PROJECTION", { exact: true })
        .fill("{name:1,kind:1}");
      await active().getByRole("button", { name: "Run", exact: true }).click();
      await idle();
      await active().getByLabel("PROJECTION", { exact: true }).fill("{}");
      await active().getByRole("button", { name: "Run", exact: true }).click();
      await idle();
      await expect.poll(layout).toEqual(before);
    },
  );
  await check(
    "Query controls fit a narrow window and keep resize proportions in the active tab",
    async () => {
      await page
        .getByRole("button", { name: "Preferences", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("combobox", { name: /^Theme/ })
        .selectOption("dark");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Save settings", exact: true })
        .click();
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].setContentSize(1000, 720);
      });
      await expect
        .poll(() => page.evaluate(() => innerWidth))
        .toBeLessThanOrEqual(1000);
      for (const field of ["FILTER", "SORT", "PROJECTION"]) {
        const rect = await active()
          .getByLabel(field, { exact: true })
          .boundingBox();
        expect(rect.x + rect.width).toBeLessThanOrEqual(1000);
        await expect(
          active().getByRole("button", {
            name: `Format ${field}`,
            exact: true,
          }),
        ).toBeVisible();
        expect(
          await active()
            .getByRole("button", { name: `Expand ${field}`, exact: true })
            .evaluate((el) => {
              const r = el.getBoundingClientRect();
              return el.contains(
                document.elementFromPoint(
                  r.x + r.width / 2,
                  r.y + r.height / 2,
                ),
              );
            }),
        ).toBe(true);
      }
      expect(
        await active()
          .locator(".query-bar")
          .evaluate((element) => element.style.gridTemplateColumns),
      ).toContain("minmax");
      await page.screenshot({
        path: ".runtime/screenshots/query-controls-narrow-dark.png",
      });
    },
  );
  await page.screenshot({ path: ".runtime/screenshots/query-controls.png" });
} catch (e) {
  failures.push({ name: "setup", message: e.stack });
} finally {
  if (page && !page.isClosed() && failures.length)
    await page.screenshot({
      path: ".runtime/screenshots/query-controls-failure.png",
    });
  try {
    if (app) await closeElectronWindowNormally(app);
  } catch (error) {
    failures.push({ name: "normal GUI shutdown", message: error.stack });
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
  ".runtime/query-controls-results.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
if (failures.length || errors.length) process.exitCode = 1;
