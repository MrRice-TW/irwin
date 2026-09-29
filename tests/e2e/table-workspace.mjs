import { _electron as electron, expect } from "@playwright/test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { closeElectronWindowNormally } from "./helpers/close-electron.mjs";
import {
  prepareClipboardCheck,
  copiedText,
} from "./helpers/clipboard-check.mjs";

// Independent QA: isolated database and preferences; close the real GUI normally.
await mkdir(".runtime/screenshots", { recursive: true });
const dataDir = resolve(`.runtime/independent-table-qa-${Date.now()}`);
const server = await MongoMemoryServer.create({
  binary: { version: "8.0.18", downloadDir: ".runtime/mongodb" },
});
const client = await new MongoClient(server.getUri()).connect();
const longField =
  "a_very_long_field_name_that_must_not_push_the_column_panel_beyond_its_own_bounds";
await client
  .db("independent_qa")
  .collection("documents")
  .insertMany(
    Array.from({ length: 180 }, (_, i) => ({
      _id: `qa-${String(i).padStart(3, "0")}`,
      kind: "async",
      description:
        `Document ${i}: ` + "Long content beside frozen columns. ".repeat(20),
      config: { enabled: i % 2 === 0, title: `Nested ${i}` },
      [longField]: `Long field ${i}`,
      ...Object.fromEntries(
        Array.from({ length: 28 }, (_, n) => [`field_${n}`, `value-${i}-${n}`]),
      ),
    })),
  );
let app, page, nativeClipboard;
const checks = [],
  failures = [],
  errors = [],
  unverified = [],
  screenshots = [];
const active = () => page.locator(".workspace-panel.visible");
const cell = (text) =>
  active()
    .locator(".grid-cell")
    .filter({ hasText: new RegExp(`^${text}$`) })
    .first();
const panel = () =>
  active().getByRole("complementary", { name: "Column settings" });
const shot = async (name) => {
  const path = `.runtime/screenshots/independent-${name}.png`;
  await page.screenshot({ path });
  screenshots.push(path);
};
const check = async (name, run) => {
  try {
    await run();
    checks.push(name);
    console.log(`PASS ${name}`);
  } catch (e) {
    failures.push({ name, message: e.stack });
    console.error(`FAIL ${name}: ${e.message}`);
    await shot(`failure-${failures.length}`);
  }
};
const openPanel = async () => {
  if (!(await panel().count()))
    await active()
      .getByRole("button", { name: "Column settings", exact: true })
      .click();
};
const closePanel = async () => {
  if (await panel().count())
    await panel()
      .getByRole("button", { name: "Close column settings", exact: true })
      .click();
};
const option = (name) =>
  panel()
    .locator(".column-option")
    .filter({ has: page.locator(`label[title="${name}"]`) });
const pin = async (name) => {
  await openPanel();
  const b = option(name).getByTitle("Pin / unpin column");
  if ((await b.getAttribute("aria-pressed")) !== "true") await b.click();
};
const query = async (filter, sort = "{}") => {
  await active().getByLabel("FILTER", { exact: true }).fill(filter);
  await active().getByLabel("SORT", { exact: true }).fill(sort);
  await active().getByRole("button", { name: "Run", exact: true }).click();
  await expect(active().locator(".results-wrapper")).toHaveAttribute(
    "aria-busy",
    "false",
  );
};
const setTheme = async (theme) => {
  if (!(await page.locator("dialog[open]").count()))
    await page
      .getByRole("button", { name: "Preferences", exact: true })
      .click();
  await page
    .locator("dialog[open] .field")
    .filter({ has: page.locator("span").filter({ hasText: /^Theme$/ }) })
    .locator("select")
    .selectOption(theme);
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
};
const resize = async (width, height) => {
  await app.evaluate(
    ({ BrowserWindow }, size) =>
      BrowserWindow.getAllWindows()[0].setContentSize(...size),
    [width, height],
  );
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
};
const checkPinned = async () => {
  const result = await active()
    .locator(".table-scroll")
    .evaluate((el) => {
      const viewport = el.getBoundingClientRect();
      const headings = [...el.querySelectorAll(".pinned-heading")];
      const row = [...el.querySelectorAll(".grid-row")].find((r) => {
        const b = r.getBoundingClientRect();
        return b.y > viewport.y + 38 && b.bottom < viewport.bottom - 20;
      });
      if (!row) return { error: "No completely visible row" };
      const cells = [...row.querySelectorAll(".pinned-cell")];
      return {
        headings: headings.length,
        headerY: el.querySelector(".grid-head").getBoundingClientRect().y,
        rowY: row.getBoundingClientRect().y,
        cells: cells.map((cell, i) => {
          const b = cell.getBoundingClientRect(),
            h = headings[i]?.getBoundingClientRect();
          const covered = [2, b.width / 2, b.width - 2].every((dx) =>
            cell.contains(document.elementFromPoint(b.x + dx, b.y + 18)),
          );
          return {
            x: b.x,
            h: h?.x,
            y: b.y,
            hy: h?.y,
            width: b.width,
            hw: h?.width,
            covered,
            background: getComputedStyle(cell).backgroundColor,
          };
        }),
      };
    });
  expect(result.error).toBeUndefined();
  expect(result.headings).toBe(2);
  expect(result.cells).toHaveLength(2);
  for (const c of result.cells) {
    expect(Math.abs(c.x - c.h)).toBeLessThan(1);
    expect(Math.abs(c.y - result.rowY)).toBeLessThan(1);
    expect(Math.abs(c.hy - result.headerY)).toBeLessThan(1);
    expect(Math.abs(c.width - c.hw)).toBeLessThan(1);
    expect(c.covered).toBe(true);
    expect(c.background).not.toMatch(/rgba\([^)]*, 0\)/);
  }
};
try {
  const env = { ...process.env, WORKBENCH_USER_DATA: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    args: [".", "--disable-gpu"],
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.on("pageerror", (e) => {
    if (!/ICodeLensCache|treeViewsDndService/.test(e.message))
      errors.push(e.message);
  });
  await expect(page.locator(".brand strong")).toHaveText("Irwin", {
    timeout: 30000,
  });
  nativeClipboard = await prepareClipboardCheck(app);
  if (!nativeClipboard)
    unverified.push(
      "Native clipboard unavailable: only the real Electron write payload was checked.",
    );
  await page.evaluate(async (uri) => {
    const s = await window.workbench.request("settings.get", {});
    await window.workbench.request("settings.set", {
      ...s,
      language: "en",
      theme: "light",
    });
    await window.workbench.request("connections.save", {
      profile: {
        id: "independent-qa",
        name: "Independent QA",
        uri,
        database: "independent_qa",
      },
    });
  }, server.getUri());
  await page.reload();
  await resize(1440, 900);
  await page
    .locator(".app-header")
    .getByRole("button", { name: "Connections", exact: true })
    .click();
  await page
    .locator(".connection-picker")
    .getByRole("button", { name: "Independent QA" })
    .click();
  await page
    .locator(".db-row")
    .getByRole("button", { name: "independent_qa", exact: true })
    .click();
  await page
    .locator(".collection-row")
    .getByRole("button", { name: "documents", exact: true })
    .click();
  await expect(cell("qa-000")).toBeVisible({ timeout: 30000 });

  await check(
    "Shift click, Shift arrows and drag keep one selected cell; clipboard is scalar",
    async () => {
      await cell("qa-000").click();
      await cell("qa-003").click({ modifiers: ["Shift"] });
      await page.keyboard.press("Control+c");
      await expect.poll(() => copiedText(app, nativeClipboard)).toBe("qa-003");
      const a = await cell("qa-003").boundingBox(),
        b = await cell("async").boundingBox();
      await page.mouse.move(a.x + 12, a.y + 15);
      await page.mouse.down();
      await page.mouse.move(b.x + 15, b.y + 15, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.press("Shift+ArrowRight");
      await page.keyboard.press("Control+c");
      await expect.poll(() => copiedText(app, nativeClipboard)).toBe("async");
      await expect(active().locator(".selected-cell")).toHaveCount(1);
      await expect(active().locator(".range-cell")).toHaveCount(0);
    },
  );
  await pin("_id");
  await pin("kind");
  await closePanel();
  await check(
    "Two frozen columns align synchronously and stay above long previews during both scroll axes",
    async () => {
      await active()
        .locator(".grid-cell")
        .filter({ hasText: /^Document 0:/ })
        .click();
      const immediate = await active()
        .locator(".table-scroll")
        .evaluate((el) => {
          const c = el.querySelector(".pinned-cell"),
            before = c.getBoundingClientRect().x;
          el.scrollLeft = 400;
          return Math.abs(before - c.getBoundingClientRect().x);
        });
      expect(immediate).toBeLessThan(1);
      for (const [x, y] of [
        [80, 0],
        [480, 90],
        [950, 420],
        [1600, 1100],
      ]) {
        await active()
          .locator(".table-scroll")
          .evaluate(
            (el, p) => {
              el.scrollLeft = p[0];
              el.scrollTop = p[1];
            },
            [x, y],
          );
        await expect
          .poll(async () => active().locator(".grid-row").count())
          .toBeGreaterThan(0);
        await checkPinned();
      }
      await shot("light-frozen-scrolled");
    },
  );
  await check(
    "Frozen header resize keeps both frozen body columns aligned",
    async () => {
      const h = active().locator(".pinned-heading").first(),
        before = (await h.boundingBox()).width;
      const handle = await h.locator(".column-resizer").boundingBox();
      await page.mouse.move(
        handle.x + handle.width / 2,
        handle.y + handle.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        handle.x + handle.width / 2 + 55,
        handle.y + handle.height / 2,
        { steps: 8 },
      );
      await page.mouse.up();
      await expect
        .poll(async () => (await h.boundingBox()).width)
        .toBeGreaterThan(before + 45);
      await checkPinned();
    },
  );
  await check(
    "Arrow navigation reveals the first scrolling column beside the frozen strip",
    async () => {
      await active()
        .locator(".table-scroll")
        .evaluate((el) => {
          el.scrollLeft = 1100;
          el.scrollTop = 0;
        });
      await expect(cell("qa-000")).toBeVisible();
      await active()
        .locator(".grid-row")
        .filter({
          has: page.locator(".grid-cell").filter({ hasText: /^qa-000$/ }),
        })
        .locator(".grid-cell")
        .filter({ hasText: /^async$/ })
        .click();
      await page.keyboard.press("ArrowRight");
      const selected = active().locator(".selected-cell");
      await expect(selected).toContainText("Document 0:");
      await expect
        .poll(() =>
          selected.evaluate((el) => {
            const b = el.getBoundingClientRect(),
              pins = [...el.parentElement.querySelectorAll(".pinned-cell")];
            const right = Math.max(
              ...pins.map((p) => p.getBoundingClientRect().right),
            );
            return (
              b.x >= right - 1 &&
              el.contains(document.elementFromPoint(b.x + 10, b.y + 18))
            );
          }),
        )
        .toBe(true);
      await shot("keyboard-frozen-navigation");
    },
  );
  await check(
    "Column panel is separate, long labels ellipsize, many fields scroll, hide/restore and nested expansion work",
    async () => {
      await openPanel();
      const p = await panel().boundingBox(),
        s = await active().locator(".table-scroll").boundingBox();
      expect(p.x).toBeGreaterThanOrEqual(s.x + s.width - 1);
      expect(
        await panel().evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await panel().getByLabel("kind", { exact: true }).uncheck();
      await expect(active().locator(".pinned-heading")).toHaveCount(1);
      await panel().getByLabel("kind", { exact: true }).check();
      await expect(active().locator(".pinned-heading")).toHaveCount(2);
      await option("config")
        .getByTitle("Expand / collapse nested columns")
        .click();
      await expect(
        panel().getByLabel("config.enabled", { exact: true }),
      ).toBeVisible();
      await option("config")
        .getByTitle("Expand / collapse nested columns")
        .click();
      await expect(
        panel().getByLabel("config.enabled", { exact: true }),
      ).toHaveCount(0);
      await option("config")
        .getByTitle("Expand / collapse nested columns")
        .click();
      await panel()
        .getByLabel("Remember this collection layout", { exact: true })
        .check();
      const span = option(longField).locator("label span");
      expect(
        await span.evaluate(
          (el) =>
            el.scrollWidth > el.clientWidth &&
            getComputedStyle(el).textOverflow === "ellipsis",
        ),
      ).toBe(true);
      await panel().getByLabel("field_27", { exact: true }).uncheck();
      await panel().getByLabel("field_27", { exact: true }).check();
      await option(longField).scrollIntoViewIfNeeded();
      await shot("light-column-panel");
      await closePanel();
      await expect(panel()).toHaveCount(0);
    },
  );
  for (const theme of ["dark", "azure", "forest"])
    await check(
      `${theme} theme at 1000×720 keeps panel and frozen rows usable`,
      async () => {
        await setTheme(theme);
        await resize(1000, 720);
        await openPanel();
        await active()
          .locator(".table-scroll")
          .evaluate((el) => {
            el.scrollLeft = 450;
            el.scrollTop = 360;
          });
        await checkPinned();
        const p = await panel().boundingBox(),
          s = await active().locator(".table-scroll").boundingBox();
        expect(p.x).toBeGreaterThanOrEqual(s.x + s.width - 1);
        expect(p.x + p.width).toBeLessThanOrEqual(1000);
        expect(s.width).toBeGreaterThan(200);
        expect(
          await panel().evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true);
        await option(longField).scrollIntoViewIfNeeded();
        await shot(`${theme}-narrow-column-panel`);
        await closePanel();
      },
    );
  await resize(1440, 900);
  await setTheme("light");
  await check(
    "Changed-query notice stays above frozen headings and remains readable",
    async () => {
      await active()
        .getByLabel("FILTER", { exact: true })
        .fill('{kind:"async"}');
      const notice = active().locator(".result-state-notice");
      await expect(notice).toBeVisible();
      expect(
        await notice.evaluate((el) => {
          const b = el.getBoundingClientRect();
          return el.contains(
            document.elementFromPoint(b.x + 30, b.y + b.height / 2),
          );
        }),
      ).toBe(true);
      await shot("query-notice");
    },
  );
  await check(
    "Collection can open three independent filter/sort/view tabs; normal click focuses existing tab",
    async () => {
      await query('{_id:{$in:["qa-001","qa-002"]}}', "{_id:-1}");
      await expect(cell("qa-002")).toBeVisible();
      await active().getByRole("button", { name: "Tree", exact: true }).click();
      await page
        .locator(".collection-row")
        .getByRole("button", { name: "Collection menu", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Open in new tab", exact: true })
        .click();
      await expect(page.locator(".workspace-tab")).toHaveCount(2);
      await expect(cell("qa-000")).toBeVisible();
      await expect(active().getByLabel("FILTER", { exact: true })).toHaveValue(
        "{}",
      );
      await query('{_id:"qa-005"}', "{_id:1}");
      await expect(cell("qa-005")).toBeVisible();
      await active().getByRole("button", { name: "JSON", exact: true }).click();
      await page
        .locator(".collection-row")
        .getByRole("button", { name: "documents", exact: true })
        .click({ modifiers: ["Control"] });
      await expect(page.locator(".workspace-tab")).toHaveCount(3);
      await expect(cell("qa-000")).toBeVisible();
      await query('{_id:"qa-009"}');
      await expect(cell("qa-009")).toBeVisible();
      const tabs = page.locator(".workspace-tab");
      await tabs.nth(0).locator("button").first().click();
      await expect(active().getByLabel("FILTER", { exact: true })).toHaveValue(
        '{_id:{$in:["qa-001","qa-002"]}}',
      );
      await expect(active().getByLabel("SORT", { exact: true })).toHaveValue(
        "{_id:-1}",
      );
      await expect(active().locator(".tree-results")).toBeVisible();
      await tabs.nth(1).locator("button").first().click();
      await expect(active().getByLabel("FILTER", { exact: true })).toHaveValue(
        '{_id:"qa-005"}',
      );
      await expect(active().getByLabel("SORT", { exact: true })).toHaveValue(
        "{_id:1}",
      );
      await expect(active().locator(".monaco-editor")).toBeVisible();
      await page
        .locator(".collection-row")
        .getByRole("button", { name: "documents", exact: true })
        .click();
      await expect(tabs).toHaveCount(3);
      await expect(active().getByLabel("FILTER", { exact: true })).toHaveValue(
        '{_id:"qa-005"}',
      );
      await tabs.nth(2).locator("button").first().click();
      await expect(cell("qa-009")).toBeVisible();
      await expect(tabs.locator(".tab-number")).toHaveText(["1", "2", "3"]);
      for (const badge of await tabs.locator(".tab-number").all()) {
        expect(
          await badge.evaluate((el) => {
            const b = el.getBoundingClientRect();
            return (
              el.scrollWidth <= el.clientWidth &&
              b.width > 0 &&
              el.contains(
                document.elementFromPoint(
                  b.x + b.width / 2,
                  b.y + b.height / 2,
                ),
              )
            );
          }),
        ).toBe(true);
      }
      await shot("three-independent-tabs");
      expect(
        new Set(await tabs.locator("button:first-child").allTextContents())
          .size,
      ).toBe(3);
      await tabs
        .nth(2)
        .getByRole("button", { name: /^Close tab / })
        .click();
      await expect(tabs).toHaveCount(2);
      await tabs.nth(0).locator("button").first().click();
      await expect(active().getByLabel("FILTER", { exact: true })).toHaveValue(
        '{_id:{$in:["qa-001","qa-002"]}}',
      );
    },
  );
  await check(
    "Remembered column layout restores on close and reopen",
    async () => {
      while (await page.locator(".workspace-tab").count())
        await page
          .locator(".workspace-tab")
          .last()
          .getByRole("button", { name: /^Close tab / })
          .click();
      await page
        .locator(".collection-row")
        .getByRole("button", { name: "documents", exact: true })
        .click();
      await expect(cell("qa-000")).toBeVisible();
      await openPanel();
      await expect(
        panel().getByLabel("Remember this collection layout", { exact: true }),
      ).toBeChecked();
      await expect(
        option("_id").getByTitle("Pin / unpin column"),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        option("kind").getByTitle("Pin / unpin column"),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        panel().getByLabel("config.enabled", { exact: true }),
      ).toBeVisible();
      await shot("remembered-layout");
    },
  );
} catch (e) {
  failures.push({ name: "setup or unhandled", message: e.stack });
  if (page && !page.isClosed()) await shot("fatal");
} finally {
  if (app) await closeElectronWindowNormally(app);
  await client.close();
  await server.stop();
}
const result = {
  checks,
  failures,
  errors,
  unverified,
  nativeClipboard,
  screenshots,
  dataDir,
  timestamp: new Date().toISOString(),
};
await writeFile(
  ".runtime/independent-table-qa-results.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
if (failures.length || errors.length) process.exitCode = 1;
