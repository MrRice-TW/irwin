import { _electron as electron, expect } from "@playwright/test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Long, Decimal128, BSON } from "mongodb";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cpus, totalmem } from "node:os";
import { createHash } from "node:crypto";

const count = Number(process.env.BENCHMARK_DOCS || 1000000);
const root = resolve(`.runtime/benchmark-${Date.now()}`);
await mkdir(root, { recursive: true });
const server = await MongoMemoryServer.create({
  binary: { version: "8.0.18", downloadDir: ".runtime/mongodb" },
  instance: { dbPath: root },
});
const client = new MongoClient(server.getUri(), { promoteValues: false });
await client.connect();
let app, monitor;
const report = {
  at: new Date().toISOString(),
  platform: process.platform,
  cpu: cpus()[0].model,
  logicalCpus: cpus().length,
  memoryGB: totalmem() / 2 ** 30,
  count,
  payloadBytes: 5300,
  stages: [],
  samples: [],
  uiLatencyMS: [],
  errors: [],
};
const mark = (stage, detail) => {
  console.log(JSON.stringify({ stage, ...detail }));
  report.stages.push({ stage, ...detail });
};
try {
  const started = performance.now();
  const payload = "0123456789abcdefghijklmnopqrstuvwxyz"
    .repeat(148)
    .slice(0, 5300);
  for (let n = 0; n < count; n += 1000) {
    await client
      .db("benchmark")
      .collection("source")
      .insertMany(
        Array.from({ length: Math.min(1000, count - n) }, (_, i) => ({
          _id: n + i,
          label: `Document ${n + i}`,
          payload,
          value: Long.fromString("9007199254740993"),
          decimal: Decimal128.fromString("123.4500"),
          date: new Date("2026-01-01Z"),
          nested: { active: true, nullable: null },
        })),
      );
    if (n % 100000 === 0) console.log(`Seeded ${n + 1000}/${count}`);
  }
  mark("seed", { elapsedMS: performance.now() - started });
  const env = {
    ...process.env,
    WORKBENCH_USER_DATA: resolve(root, "user-data"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    args: [".", "--disable-gpu"],
    env,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => report.errors.push(e.message));
  await expect(
    page.getByRole("button", { name: "新增資料庫連線", exact: true }),
  ).toBeVisible();
  await page.evaluate(async (uri) => {
    window.__jobs = {};
    window.workbench.subscribe((e) => {
      if (e.type === "job") window.__jobs[e.data.jobId] = e.data;
    });
    for (let n = 0; n < 10; n++) {
      await window.workbench.request("connections.save", {
        profile: {
          id: `bench-${n}`,
          name: `Benchmark ${n + 1}`,
          uri,
          database: "benchmark",
        },
      });
      await window.workbench.request("connections.open", { id: `bench-${n}` });
    }
  }, server.getUri());
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Benchmark 1", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.__jobs = {};
    window.workbench.subscribe((e) => {
      if (e.type === "job") window.__jobs[e.data.jobId] = e.data;
    });
  });
  await page.getByRole("button", { name: "Benchmark 1", exact: true }).click();
  // A reloaded UI knows connections are open; the initial tree displays the default DB.
  await page
    .locator(".db-row")
    .getByRole("button", { name: "benchmark", exact: true })
    .first()
    .click();
  await page
    .locator(".collection-row")
    .getByRole("button", { name: "source", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "執行", exact: true }).click();
  await expect(
    page.locator(".grid-cell").filter({ hasText: /^Document 0$/ }),
  ).toBeVisible();
  for (let i = 0; i < 6; i++)
    for (const view of ["JSON", "Tree", "Table"]) {
      const before = performance.now();
      await page.getByRole("button", { name: view, exact: true }).click();
      await page.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          ),
      );
      report.uiLatencyMS.push({ view, ms: performance.now() - before });
    }
  mark("ten-connections-and-views", {
    connections: 10,
    viewLatencyMaxMS: Math.max(...report.uiLatencyMS.map((v) => v.ms)),
  });
  let sampling = false;
  monitor = setInterval(async () => {
    if (sampling) return;
    sampling = true;
    try {
      const before = performance.now();
      await page.evaluate(() => document.title);
      const metrics = await app.evaluate(({ app }) =>
        app.getAppMetrics().map((v) => ({
          type: v.type,
          name: v.name,
          rssKB: v.memory.workingSetSize,
        })),
      );
      report.samples.push({
        at: Date.now(),
        latencyMS: performance.now() - before,
        metrics,
      });
    } catch (e) {
      report.errors.push(e.message);
    } finally {
      sampling = false;
    }
  }, 1000);
  const transfer = async (direction, path, collection) => {
    await app.evaluate(
      ({ dialog }, { direction, path }) => {
        if (direction === "export")
          dialog.showSaveDialog = async () => ({
            canceled: false,
            filePath: path,
          });
        else
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [path],
          });
      },
      { direction, path },
    );
    const job = await page.evaluate(
      async ({ direction, path, collection }) => {
        await window.workbench.request("files.choose", {
          kind: direction === "export" ? "save" : "open",
          title: "Benchmark fixture",
        });
        return window.workbench.request("transferJobs.start", {
          connectionId: "bench-0",
          database: "benchmark",
          collection,
          direction,
          format: "json",
          path,
        });
      },
      { direction, path, collection },
    );
    const started = performance.now();
    await page.waitForFunction(
      (id) =>
        window.__jobs[id]?.status && window.__jobs[id].status !== "running",
      job.jobId,
      { timeout: 60 * 60 * 1000, polling: 1000 },
    );
    const result = await page.evaluate((id) => window.__jobs[id], job.jobId);
    expect(result.status, result.message).toBe("completed");
    expect(result.failed).toBe(0);
    expect(result.processed).toBe(count);
    mark(direction, { elapsedMS: performance.now() - started, result });
    return result;
  };
  const path = resolve(root, "five-gb.jsonl");
  await transfer("export", path, "source");
  report.fileBytes = (await stat(path)).size;
  if (count === 1000000) expect(report.fileBytes).toBeGreaterThan(5e9);
  await transfer("import", path, "copy");
  expect(
    Number(await client.db("benchmark").collection("copy").countDocuments()),
  ).toBe(count);
  const digest = async (name) => {
    const hash = createHash("sha256");
    const cursor = client
      .db("benchmark")
      .collection(name)
      .find({})
      .sort({ _id: 1 })
      .batchSize(100);
    for await (const doc of cursor) hash.update(BSON.serialize(doc));
    return hash.digest("hex");
  };
  const sourceHash = await digest("source");
  const copyHash = await digest("copy");
  expect(copyHash).toBe(sourceHash);
  mark("full-bson-comparison", { sourceHash, copyHash });
  expect(report.errors).toEqual([]);
  report.passed = true;
} catch (e) {
  report.errors.push(e.stack);
  report.passed = false;
  process.exitCode = 1;
  console.error(e);
} finally {
  clearInterval(monitor);
  await writeFile(
    resolve(root, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await writeFile(
    ".runtime/benchmark-latest.json",
    JSON.stringify({ root, ...report }, null, 2),
  );
  await app?.close();
  await client.close();
  await server.stop();
  console.log(`Report: ${root}`);
}
