import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import type { z } from "zod";
import type { DatabaseService } from "./database";
import { schemaInput, compareInput } from "../shared/contracts";
import { encode, object, validPath } from "../shared/bson";
import { analyzeDocuments, bsonType } from "../shared/exploration";

const canonical = (value: any): string => JSON.stringify(normalize(value));
function normalize(v: any): any {
  if (Array.isArray(v)) return v.map(normalize);
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(
    Object.keys(v)
      .sort()
      .map((k) => [k, normalize(v[k])]),
  );
}
function at(doc: any, path: string) {
  return path
    .split(".")
    .reduce((v, k) => (v && Object.hasOwn(v, k) ? v[k] : undefined), doc);
}
function omit(doc: any, paths: string[]) {
  for (const path of paths) {
    const parts = path.split("."),
      key = parts.pop()!;
    const parent = parts.reduce(
      (v, k) => (v && Object.hasOwn(v, k) ? v[k] : undefined),
      doc,
    );
    if (parent && typeof parent === "object") delete parent[key];
  }
  return doc;
}
function diff(a: any, b: any, path = "", result: string[] = []): string[] {
  if (result.length >= 100 || canonical(a) === canonical(b)) return result;
  if (bsonType(a) === "Object" && bsonType(b) === "Object") {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
      diff(a[key], b[key], path ? `${path}.${key}` : key, result);
  } else result.push(path || "(document)");
  return result;
}
export class ExplorationService {
  private jobs = new Map<
    string,
    { abort: AbortController; connections: string[] }
  >();
  constructor(
    private database: DatabaseService,
    private emit: (event: any) => void,
  ) {}
  cancel(jobId: string) {
    this.jobs.get(jobId)?.abort.abort(new Error("Analysis cancelled"));
  }
  cancelConnection(id: string) {
    for (const [key, job] of this.jobs)
      if (job.connections.includes(id)) this.cancel(key);
  }
  async close() {
    for (const id of this.jobs.keys()) this.cancel(id);
  }
  private async run<T>(
    id: string,
    connections: string[],
    timeout: number,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.jobs.has(id)) throw new Error("Analysis job already running");
    const abort = new AbortController();
    this.jobs.set(id, { abort, connections });
    const timer = setTimeout(
      () =>
        abort.abort(
          new Error(
            "Analysis time limit exceeded; narrow the filters or increase the limit",
          ),
        ),
      timeout,
    );
    this.emit({ jobId: id, status: "running", processed: 0 });
    try {
      const result = await fn(abort.signal);
      this.emit({ jobId: id, status: "completed" });
      return result;
    } catch (e) {
      this.emit({
        jobId: id,
        status: abort.signal.aborted ? "cancelled" : "failed",
      });
      throw e;
    } finally {
      clearTimeout(timer);
      this.jobs.delete(id);
    }
  }
  async schema(input: z.input<typeof schemaInput>) {
    const p = schemaInput.parse(input);
    return this.run(p.jobId, [p.connectionId], p.maxTimeMS, async (signal) => {
      const { client, profile } = this.database.get(p.connectionId);
      const collection = client.db(p.database).collection(p.collection);
      const method =
        profile.provider === "cosmos"
          ? "first matching documents"
          : "random sample";
      const cursor =
        profile.provider === "cosmos"
          ? collection.find(object(p.filter), {
              limit: p.sampleSize,
              batchSize: 100,
              maxTimeMS: p.maxTimeMS,
              signal,
            })
          : collection.aggregate(
              [
                { $match: object(p.filter) },
                { $sample: { size: p.sampleSize } },
              ],
              { batchSize: 100, maxTimeMS: p.maxTimeMS, signal },
            );
      const docs: any[] = [];
      let bytes = 0,
        byteLimited = false;
      try {
        for await (const doc of cursor) {
          signal.throwIfAborted();
          const raw = encode(doc);
          bytes += Buffer.byteLength(raw);
          if (bytes > 8 * 1024 * 1024) {
            byteLimited = true;
            break;
          }
          docs.push(JSON.parse(raw));
          if (docs.length >= p.sampleSize) break;
        }
      } finally {
        await cursor.close();
      }
      return {
        ...analyzeDocuments(docs),
        method,
        byteLimited,
        requested: p.sampleSize,
        filter: p.filter,
        namespace: `${p.database}.${p.collection}`,
        source: {
          connectionId: p.connectionId,
          database: p.database,
          collection: p.collection,
        },
        capturedAt: new Date().toISOString(),
      };
    });
  }
  async compare(input: z.input<typeof compareInput>) {
    const p = compareInput.parse(input);
    if ([...p.matchKeys, ...p.ignorePaths].some((path) => !validPath(path)))
      throw new Error("Comparison paths must be safe dotted field paths");
    return this.run(
      p.jobId,
      [p.source.connectionId, p.target.connectionId],
      p.maxTimeMS,
      async (signal) => {
        const dir = await mkdtemp(join(tmpdir(), "irwin-compare-"));
        let cache: DatabaseSync | undefined;
        const counts = {
          source: 0,
          target: 0,
          equal: 0,
          changed: 0,
          sourceOnly: 0,
          targetOnly: 0,
          duplicates: 0,
          missingKeys: 0,
        };
        const differences: any[] = [];
        const readWindows = {
          source: { startedAt: "", completedAt: "" },
          target: { startedAt: "", completedAt: "" },
        };
        let bytes = 0,
          reportTruncated = false;
        const add = (entry: any) => {
          const length = Buffer.byteLength(JSON.stringify(entry));
          if (differences.length >= 500 || bytes + length > 8 * 1024 * 1024) {
            reportTruncated = true;
            return;
          }
          differences.push(entry);
          bytes += length;
        };
        try {
          cache = new DatabaseSync(join(dir, "comparison.sqlite"));
          cache.exec(
            "PRAGMA journal_mode=OFF; PRAGMA cache_size=-8192; PRAGMA temp_store=FILE; CREATE TABLE docs(side TEXT, key TEXT, doc TEXT, copies INTEGER, PRIMARY KEY(side,key));",
          );
          const insert = cache.prepare(
            "INSERT INTO docs VALUES(?,?,?,1) ON CONFLICT(side,key) DO UPDATE SET copies=copies+1",
          );
          for (const side of ["source", "target"] as const) {
            const target = p[side];
            readWindows[side].startedAt = new Date().toISOString();
            const cursor = this.database
              .get(target.connectionId)
              .client.db(target.database)
              .collection(target.collection)
              .find(object(p[`${side}Filter`]), {
                batchSize: 100,
                maxTimeMS: p.maxTimeMS,
                signal,
              });
            try {
              for await (const value of cursor) {
                signal.throwIfAborted();
                counts[side]++;
                const raw = JSON.parse(encode(value)),
                  keys = p.matchKeys.map((path) => at(raw, path));
                if (keys.some((key) => key === undefined)) {
                  counts.missingKeys++;
                  add({
                    status: "missing-key",
                    side,
                    paths: p.matchKeys.filter(
                      (path) => at(raw, path) === undefined,
                    ),
                    identity: raw._id,
                  });
                } else
                  insert.run(
                    side,
                    canonical(keys),
                    canonical(omit(raw, p.ignorePaths)),
                  );
                if (counts[side] % 100 === 0) {
                  this.emit({
                    jobId: p.jobId,
                    status: "running",
                    phase: side,
                    processed: counts.source + counts.target,
                  });
                  await tick();
                }
              }
            } finally {
              await cursor.close();
            }
            readWindows[side].completedAt = new Date().toISOString();
          }
          const pairs =
            cache.prepare(`SELECT s.key, s.doc AS source, t.doc AS target, s.copies AS sc, t.copies AS tc FROM docs s LEFT JOIN docs t ON t.key=s.key AND t.side='target' WHERE s.side='source'
          UNION ALL SELECT t.key, NULL, t.doc, NULL, t.copies FROM docs t WHERE t.side='target' AND NOT EXISTS(SELECT 1 FROM docs s WHERE s.side='source' AND s.key=t.key)`);
          let processed = 0;
          for (const pair of pairs.iterate()) {
            signal.throwIfAborted();
            const key = JSON.parse(pair.key as string);
            if (Number(pair.sc) > 1 || Number(pair.tc) > 1) {
              counts.duplicates++;
              add({
                status: "duplicate-key",
                key,
                sourceCount: pair.sc || 0,
                targetCount: pair.tc || 0,
                paths: p.matchKeys,
              });
            } else if (!pair.source) {
              counts.targetOnly++;
              add({
                status: "target-only",
                key,
                target: JSON.parse(pair.target as string),
                paths: [],
              });
            } else if (!pair.target) {
              counts.sourceOnly++;
              add({
                status: "source-only",
                key,
                source: JSON.parse(pair.source as string),
                paths: [],
              });
            } else if (pair.source === pair.target) counts.equal++;
            else {
              counts.changed++;
              const source = JSON.parse(pair.source as string),
                target = JSON.parse(pair.target as string);
              add({
                status: "changed",
                key,
                paths: diff(source, target),
                source,
                target,
              });
            }
            if (++processed % 100 === 0) await tick();
          }
          return {
            source: p.source,
            target: p.target,
            sourceFilter: p.sourceFilter,
            targetFilter: p.targetFilter,
            matchKeys: p.matchKeys,
            ignorePaths: p.ignorePaths,
            readWindows,
            capturedAt: new Date().toISOString(),
            snapshot: false,
            counts,
            differences,
            reportTruncated,
            complete: true,
          };
        } finally {
          cache?.close();
          await rm(dir, { recursive: true, force: true });
        }
      },
    );
  }
}
