import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import {
  stat,
  open,
  readFile,
  writeFile,
  rename,
  mkdir,
  mkdtemp,
  rm,
  realpath,
} from "node:fs/promises";
import { resolve, join, dirname, relative, isAbsolute, win32 } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { spawn } from "node:child_process";
import { parse as parseCsv } from "csv-parse";
import { stringify as stringifyCsv } from "csv-stringify/sync";
import { parser } from "stream-json";
import { streamArray } from "stream-json/streamers/stream-array.js";
import { streamValues } from "stream-json/streamers/stream-values.js";
import { EJSON } from "bson";
import { z } from "zod";
import { ConnectionString } from "mongodb-connection-string-url";
import {
  csvColumnSchema,
  type TransferInput,
  type JobProgress,
  type ResolvedConnection,
  type CsvColumn,
  type AggregationExportInput,
} from "../shared/contracts";
import {
  encode,
  decode,
  object,
  getPath,
  setPath,
  csvValue,
  size,
  validateExtendedJson,
} from "../shared/bson";
import { escapeCsvText, unescapeCsvText } from "../shared/csv";
import { assertWritable, identity, partitionKey, redact } from "./policy";
import { assertCsvSidecarTargetSafe, writeCsvSidecar } from "./csv-sidecar";
import type { DatabaseService } from "./database";
import { compileReadOnlyPipeline } from "../shared/aggregation";
import { requiredTransferConfirmation } from "../shared/operation-safety";

type Job = {
  input: TransferInput & { resolved: ResolvedConnection; toolsPath: string };
  state: JobProgress;
  abort: AbortController;
  done: Promise<void>;
  lastEmit: number;
};
type AggregationJob = {
  input: AggregationExportInput;
  state: JobProgress;
  abort: AbortController;
  done: Promise<void>;
  lastEmit: number;
};
const manifestSchema = z.object({
  version: z.literal(1),
  database: z.string(),
  format: z.enum(["json", "csv"]),
  collections: z.array(
    z.object({
      name: z.string().min(1),
      file: z.string(),
      csvColumns: z.array(csvColumnSchema).optional(),
      csvFormulaEscaping: z.literal("apostrophe-v1").optional(),
    }),
  ),
});
const csvMappingSidecarSchema = z.union([
  z.array(csvColumnSchema),
  z.object({
    version: z.literal(2),
    columns: z.array(csvColumnSchema),
    formulaEscaping: z.literal("apostrophe-v1"),
  }),
]);
export function within(directory: string, file: string) {
  const path = resolve(directory, file);
  const rel = relative(resolve(directory), path);
  if (
    isAbsolute(file) ||
    win32.isAbsolute(file) ||
    rel.startsWith("..") ||
    isAbsolute(rel)
  )
    throw new Error("Manifest path escapes selected directory");
  return path;
}
async function write(stream: WriteStream, text: string) {
  if (stream.errored) throw stream.errored;
  if (!stream.write(text)) await once(stream, "drain");
}
async function end(stream: WriteStream) {
  stream.end();
  await finished(stream);
}
export async function* readDocuments(
  path: string,
  format: "json" | "csv",
  columns: CsvColumn[] = [],
  signal?: AbortSignal,
  onRejected?: (error: Error, record: number) => Promise<void>,
  formulaEscaping?: "apostrophe-v1",
): AsyncGenerator<any> {
  if (format === "csv") {
    const source = createReadStream(path, { signal });
    const csv = source.pipe(
      parseCsv({
        columns: formulaEscaping
          ? (headers: string[]) => headers.map(unescapeCsvText)
          : true,
        bom: true,
        max_record_size: 32 * 1024 * 1024,
        skip_empty_lines: true,
      }),
    );
    source.on("error", (e) => csv.destroy(e));
    let record = 0;
    try {
      for await (const row of csv) {
        record++;
        try {
          if (
            columns.length === 1 &&
            columns[0].target === "" &&
            columns[0].type === "json"
          ) {
            yield object(row[columns[0].source]);
            continue;
          }
          const doc: any = {};
          const mapping = columns.length
            ? columns
            : Object.keys(row).map((source) => ({
                source,
                target: source,
                type: "string" as const,
                empty: "string" as const,
              }));
          for (const col of mapping) {
            if (!Object.hasOwn(row, col.source))
              throw new Error(`Missing CSV column: ${col.source}`);
            const value = row[col.source];
            const raw = formulaEscaping ? unescapeCsvText(value) : value;
            if (raw === "" && col.empty === "omit") continue;
            setPath(
              doc,
              col.target,
              raw === "" && col.empty === "null"
                ? null
                : csvValue(raw, col.type),
            );
          }
          yield doc;
        } catch (error) {
          if (!onRejected) throw error;
          await onRejected(error as Error, record);
        }
      }
    } finally {
      source.destroy();
      csv.destroy();
    }
  } else {
    const fd = await open(path, "r");
    const head = Buffer.alloc(4096);
    let first = "";
    let position = 0;
    try {
      while (!first) {
        const { bytesRead } = await fd.read(head, 0, head.length, position);
        if (!bytesRead) break;
        position += bytesRead;
        first =
          head
            .subarray(0, bytesRead)
            .toString("utf8")
            .replace(/^\uFEFF/, "")
            .trimStart()[0] || "";
      }
    } finally {
      await fd.close();
    }
    const source = createReadStream(path, { signal });
    const tokens = parser.asStream({ jsonStreaming: first !== "[" });
    const values =
      first === "[" ? streamArray.asStream() : streamValues.asStream();
    source.on("error", (e) => tokens.destroy(e));
    tokens.on("error", (e) => values.destroy(e));
    source.pipe(tokens).pipe(values);
    let record = 0;
    try {
      for await (const { value } of values) {
        record++;
        try {
          if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("Every imported item must be a document");
          validateExtendedJson(value);
          yield EJSON.deserialize(value, { relaxed: false });
        } catch (error) {
          if (!onRejected) throw error;
          await onRejected(error as Error, record);
        }
      }
    } finally {
      source.destroy();
      tokens.destroy();
      values.destroy();
    }
  }
}
export class TransferService {
  jobs = new Map<string, Job>();
  aggregationJobs = new Map<string, AggregationJob>();
  constructor(
    private database: DatabaseService,
    private emit: (state: JobProgress) => void,
  ) {}
  start(input: Job["input"]) {
    if (input.direction === "import") {
      const profile = this.database.get(input.connectionId).profile;
      assertWritable(profile, "transfer.import");
      const expected = requiredTransferConfirmation(input, profile.environment);
      if (expected && input.confirmation !== expected)
        throw new Error(`Transfer confirmation must match ${expected}`);
    }
    if (this.runningJobs() >= 2)
      throw new Error("At most two transfers can run at once");
    const id = randomUUID();
    const state: JobProgress = {
      jobId: id,
      status: "running",
      processed: 0,
      failed: 0,
      bytes: 0,
      message: "Starting",
      path: input.path,
    };
    const job: Job = {
      input,
      state,
      abort: new AbortController(),
      done: Promise.resolve(),
      lastEmit: 0,
    };
    this.jobs.set(id, job);
    job.done = this.run(job)
      .then(() => {
        state.status = job.abort.signal.aborted ? "cancelled" : "completed";
        state.message = state.failed
          ? `Completed ${state.processed} documents with ${state.failed} rejected; see error report`
          : `Completed ${state.processed} documents`;
      })
      .catch((e) => {
        state.status = job.abort.signal.aborted ? "cancelled" : "failed";
        state.message = redact(e.message);
      })
      .finally(() => {
        if (state.status === "cancelled")
          state.message =
            "Cancelled. Completed writes remain; partial files are not complete backups.";
        this.emit({ ...state });
        this.jobs.delete(id);
      });
    this.emit({ ...state });
    return { jobId: id };
  }
  cancel(id: string) {
    this.jobs.get(id)?.abort.abort();
    this.aggregationJobs.get(id)?.abort.abort();
    return { requested: true };
  }
  async cancelConnection(id: string) {
    const jobs = [
      ...this.jobs.values(),
      ...this.aggregationJobs.values(),
    ].filter((j) => j.input.connectionId === id);
    jobs.forEach((j) => j.abort.abort());
    await Promise.all(jobs.map((j) => j.done));
  }
  private runningJobs() {
    return [...this.jobs.values(), ...this.aggregationJobs.values()].filter(
      (job) => job.state.status === "running",
    ).length;
  }
  startAggregation(input: AggregationExportInput) {
    const pipeline = compileReadOnlyPipeline(input.stages);
    assertWritable(
      this.database.get(input.connectionId).profile,
      "aggregations.export",
    );
    if (this.runningJobs() >= 2)
      throw new Error("At most two transfers can run at once");
    const id = randomUUID();
    const state: JobProgress = {
      jobId: id,
      status: "running",
      processed: 0,
      failed: 0,
      bytes: 0,
      message: "Exporting complete aggregation result",
      path: input.path,
    };
    const job: AggregationJob = {
      input,
      state,
      abort: new AbortController(),
      done: Promise.resolve(),
      lastEmit: 0,
    };
    this.aggregationJobs.set(id, job);
    job.done = this.runAggregationExport(job, pipeline)
      .then(() => {
        state.status = job.abort.signal.aborted ? "cancelled" : "completed";
        state.message = `Exported ${state.processed} documents`;
      })
      .catch((error) => {
        state.status = job.abort.signal.aborted ? "cancelled" : "failed";
        state.message =
          state.status === "cancelled"
            ? "Cancelled. The .partial file is incomplete."
            : redact((error as Error).message);
      })
      .finally(() => {
        this.emit({ ...state });
        this.aggregationJobs.delete(id);
      });
    this.emit({ ...state });
    return { jobId: id };
  }
  private async runAggregationExport(
    job: AggregationJob,
    pipeline: Record<string, any>[],
  ) {
    const { input, state, abort } = job;
    const { client } = this.database.get(input.connectionId);
    const cursor = client
      .db(input.database)
      .collection(input.collection)
      .aggregate(pipeline, {
        maxTimeMS: input.maxTimeMS,
        allowDiskUse: false,
        batchSize: 100,
        signal: abort.signal,
      });
    const partial = `${input.path}.partial`;
    const stream = createWriteStream(partial, { flags: "wx" });
    stream.on("error", () => {
      // The write callback or finished() reports the error to the job.
    });
    try {
      await once(stream, "open");
      for await (const document of cursor) {
        if (abort.signal.aborted) throw new Error("Export cancelled");
        const line = `${encode(document)}\n`;
        await new Promise<void>((resolve, reject) =>
          stream.write(line, (error) => (error ? reject(error) : resolve())),
        );
        state.processed++;
        state.bytes += Buffer.byteLength(line);
        if (Date.now() - job.lastEmit > 150) {
          this.emit({ ...state });
          job.lastEmit = Date.now();
        }
      }
      if (abort.signal.aborted) throw new Error("Export cancelled");
      await end(stream);
      if (abort.signal.aborted) throw new Error("Export cancelled");
      await rename(partial, input.path);
    } finally {
      stream.destroy();
      await cursor.close().catch(() => {});
    }
  }
  private progress(job: Job, message: string) {
    job.state.message = message;
    if (Date.now() - job.lastEmit > 150) {
      this.emit({ ...job.state });
      job.lastEmit = Date.now();
    }
  }
  async preview(path: string) {
    const input = createReadStream(path);
    const csv = input.pipe(
      parseCsv({ columns: true, bom: true, max_record_size: 1024 * 1024 }),
    );
    input.on("error", (e) => csv.destroy(e));
    const rows: any[] = [];
    try {
      for await (const row of csv) {
        rows.push(row);
        if (rows.length === 10) break;
      }
    } finally {
      input.destroy();
      csv.destroy();
    }
    let mapping: CsvColumn[] | undefined;
    let formulaEscaping: "apostrophe-v1" | undefined;
    try {
      if ((await stat(`${path}.mapping.json`)).size < 1024 * 1024) {
        const sidecar = csvMappingSidecarSchema.parse(
          JSON.parse(await readFile(`${path}.mapping.json`, "utf8")),
        );
        if (Array.isArray(sidecar)) {
          if (sidecar.length) mapping = sidecar;
        } else {
          if (sidecar.columns.length) mapping = sidecar.columns;
          formulaEscaping = sidecar.formulaEscaping;
        }
      }
    } catch {
      /* An external CSV may not have mapping metadata. */
    }
    if (formulaEscaping) {
      for (let index = 0; index < rows.length; index++) {
        rows[index] = Object.fromEntries(
          Object.entries(rows[index]).map(([key, value]) => [
            unescapeCsvText(key),
            typeof value === "string" ? unescapeCsvText(value) : value,
          ]),
        );
      }
    }
    return { columns: Object.keys(rows[0] || {}), rows, mapping };
  }
  private async run(job: Job) {
    const p = job.input;
    if (p.format === "bson") return this.bson(job);
    if (p.collection)
      return p.direction === "export"
        ? this.exportCollection(job, p.collection, p.path, p.csvColumns)
        : this.importCollection(job, p.collection, p.path, p.csvColumns);
    if (p.direction === "export") {
      await mkdir(p.path, { recursive: true });
      const collections = await this.database
        .get(p.connectionId)
        .client.db(p.database)
        .listCollections({}, { nameOnly: true })
        .toArray();
      const manifest: z.infer<typeof manifestSchema> = {
        version: 1,
        database: p.database,
        format: p.format,
        collections: [],
      };
      for (const [index, coll] of collections.entries()) {
        job.abort.signal.throwIfAborted();
        if (coll.type === "view") continue;
        const file = `${String(index).padStart(5, "0")}-${Buffer.from(coll.name).toString("base64url")}.${p.format === "json" ? "jsonl" : "csv"}`;
        const mapping = await this.exportCollection(
          job,
          coll.name,
          within(p.path, file),
          p.csvColumns,
        );
        manifest.collections.push({
          name: coll.name,
          file,
          csvColumns: mapping,
          ...(p.format === "csv"
            ? { csvFormulaEscaping: "apostrophe-v1" as const }
            : {}),
        });
        await writeFile(
          join(p.path, "manifest.partial.json"),
          JSON.stringify(manifest, null, 2),
          { flag: "w" },
        );
      }
      await writeFile(
        join(p.path, "manifest.partial.json"),
        JSON.stringify(manifest, null, 2),
      );
      await rename(
        join(p.path, "manifest.partial.json"),
        join(p.path, "manifest.json"),
      );
    } else {
      const mpath = join(p.path, "manifest.json");
      if ((await stat(mpath)).size > 8 * 1024 * 1024)
        throw new Error("Manifest too large");
      const manifest = manifestSchema.parse(
        JSON.parse(await readFile(mpath, "utf8")),
      );
      if (manifest.format !== p.format)
        throw new Error("Manifest format does not match selected format");
      for (const c of manifest.collections) {
        job.abort.signal.throwIfAborted();
        const root = await realpath(p.path);
        const selected = await realpath(within(p.path, c.file));
        within(root, relative(root, selected));
        await this.importCollection(
          job,
          c.name,
          selected,
          c.csvColumns || [],
          c.csvFormulaEscaping,
        );
      }
    }
  }
  private async exportCollection(
    job: Job,
    name: string,
    path: string,
    requested: CsvColumn[],
  ) {
    const p = job.input;
    if (p.format === "csv") await assertCsvSidecarTargetSafe(path);
    const { client } = this.database.get(p.connectionId);
    const cursor = client
      .db(p.database)
      .collection(name)
      .find(object(p.filter), {
        projection: object(p.projection),
        sort: object(p.sort),
        limit: p.limit,
        batchSize: 100,
        signal: job.abort.signal,
      });
    const partial = `${path}.partial`;
    const output = createWriteStream(partial, { flags: "wx" });
    output.on("error", () => {});
    let columns = requested;
    try {
      if (p.format === "csv") {
        if (!columns.length)
          columns = [
            { source: "document", target: "", type: "json", empty: "string" },
          ];
        const header = stringifyCsv([
          columns.map((c) => escapeCsvText(c.source)),
        ]);
        await write(output, header);
        job.state.bytes += Buffer.byteLength(header);
      }
      for await (const doc of cursor) {
        job.abort.signal.throwIfAborted();
        const line =
          p.format === "json"
            ? `${encode(doc)}\n`
            : stringifyCsv([
                columns.map((c) => {
                  const value = c.target ? getPath(doc, c.target).value : doc;
                  if (value === undefined) return "";
                  if (c.type === "json") return encode(value);
                  if (value === null) return "";
                  if (typeof value === "string") return escapeCsvText(value);
                  return typeof value === "object" && value?._bsontype
                    ? value.toString()
                    : value instanceof Date
                      ? value.toISOString()
                      : typeof value === "object"
                        ? encode(value)
                        : String(value);
                }),
              ]);
        await write(output, line);
        job.state.processed++;
        job.state.bytes += Buffer.byteLength(line);
        this.progress(job, `Exporting ${name}`);
      }
      await end(output);
      job.abort.signal.throwIfAborted();
      await rename(partial, path);
      if (p.format === "csv")
        await writeCsvSidecar(
          path,
          JSON.stringify(
            { version: 2, columns, formulaEscaping: "apostrophe-v1" },
            null,
            2,
          ),
        );
      return columns;
    } finally {
      output.destroy();
      await cursor.close();
    }
  }
  private async importCollection(
    job: Job,
    name: string,
    path: string,
    columns: CsvColumn[],
    formulaEscaping?: "apostrophe-v1",
  ) {
    const p = job.input;
    const { client, profile } = this.database.get(p.connectionId);
    const collection = client.db(p.database).collection(name);
    if (p.format === "csv") {
      try {
        if ((await stat(`${path}.mapping.json`)).size < 1024 * 1024) {
          const sidecar = csvMappingSidecarSchema.parse(
            JSON.parse(await readFile(`${path}.mapping.json`, "utf8")),
          );
          if (Array.isArray(sidecar)) {
            if (!columns.length) columns = sidecar;
          } else {
            if (!columns.length) columns = sidecar.columns;
            formulaEscaping ??= sidecar.formulaEscaping;
          }
        }
      } catch (error: any) {
        if (error.code !== "ENOENT" && !columns.length)
          throw new Error(
            "CSV mapping sidecar is invalid. Review the mapping before importing.",
          );
      }
    }
    const errorPath = `${path}.${job.state.jobId}.errors.jsonl`;
    const errors = createWriteStream(errorPath, { flags: "wx" });
    errors.on("error", () => {});
    job.state.errorPath = errorPath;
    let batch: { doc: any; line: number }[] = [];
    let batchBytes = 0;
    let line = 0;
    const flush = async () => {
      if (!batch.length) return;
      job.abort.signal.throwIfAborted();
      const operations = batch.map(({ doc }) =>
        p.mode === "replace"
          ? {
              replaceOne: {
                filter: identity(doc, profile, p.database, name),
                replacement: doc,
                upsert: true,
              },
            }
          : { insertOne: { document: doc } },
      );
      try {
        await collection.bulkWrite(operations, { ordered: false });
        job.state.processed += batch.length;
      } catch (error: any) {
        const failures = error.writeErrors;
        if (
          !Array.isArray(failures) ||
          !failures.length ||
          error.writeConcernErrors?.length ||
          error.result?.getWriteConcernError?.()
        )
          throw new Error(
            `Write result may be partial or unknown; do not blindly retry. ${redact(error.message)}`,
          );
        job.state.processed += batch.length - failures.length;
        job.state.failed += failures.length;
        for (const failure of failures)
          await write(
            errors,
            JSON.stringify({
              collection: name,
              line: batch[failure.index]?.line,
              code: failure.code,
              message:
                failure.code === 11000
                  ? "Duplicate key"
                  : "Document rejected by server",
            }) + "\n",
          );
      }
      batch = [];
      batchBytes = 0;
      this.progress(job, `Importing ${name}`);
    };
    try {
      for await (let doc of readDocuments(
        path,
        p.format as "json" | "csv",
        columns,
        job.abort.signal,
        async (error, record) => {
          line = record;
          job.state.failed++;
          await write(
            errors,
            JSON.stringify({
              collection: name,
              line: record,
              message: redact(error.message),
            }) + "\n",
          );
        },
        formulaEscaping,
      )) {
        line++;
        job.abort.signal.throwIfAborted();
        try {
          const bytes = size(doc);
          if (bytes > 16 * 1024 * 1024)
            throw new Error("Document exceeds 16 MB");
          const pk = partitionKey(profile, p.database, name);
          if (profile.provider === "cosmos" && !pk)
            throw new Error("Configure partition key before importing");
          if (pk || p.mode === "replace")
            identity(
              {
                ...doc,
                _id: doc._id ?? (p.mode === "insert" ? "new" : undefined),
              },
              profile,
              p.database,
              name,
            );
          if (p.mode === "replace" && !Object.hasOwn(doc, "_id"))
            throw new Error("Replace mode requires _id");
        } catch (e: any) {
          job.state.failed++;
          await write(
            errors,
            JSON.stringify({
              collection: name,
              line,
              message: redact(e.message),
            }) + "\n",
          );
          continue;
        }
        const bytes = size(doc);
        if (batchBytes + bytes > 8 * 1024 * 1024) await flush();
        batch.push({ doc, line });
        batchBytes += bytes;
        job.state.bytes += bytes;
        if (batch.length >= 100) await flush();
      }
      await flush();
      await end(errors);
    } finally {
      errors.destroy();
    }
  }
  private async bson(job: Job) {
    const p = job.input;
    const r = p.resolved;
    if (r.profile.provider === "cosmos")
      throw new Error(
        "BSON tools are not verified for Cosmos RU. Use Extended JSON instead.",
      );
    if (
      r.profile.ssh.enabled &&
      (r.options.tls ||
        new ConnectionString(r.uri).searchParams.get("tls") === "true")
    )
      throw new Error(
        "BSON tools cannot preserve the SSH TLS hostname override; use a direct TLS connection or JSON/CSV.",
      );
    const serverInfo = await this.database
      .get(p.connectionId)
      .client.db(p.database)
      .command({ buildInfo: 1 });
    const targetMajor = Number(serverInfo.version.split(".")[0]);
    if (![6, 7, 8].includes(targetMajor))
      throw new Error(
        "BSON transfers currently support MongoDB 6, 7 and 8 only.",
      );
    const toolInfo = JSON.parse(
      await readFile(join(p.toolsPath, "version.json"), "utf8"),
    );
    if (toolInfo.version !== "100.18.0")
      throw new Error(
        "Database Tools version does not match the bundled compatibility configuration.",
      );
    if (p.direction === "import") {
      let sourceVersion = p.sourceVersion;
      try {
        const metadataPath = `${p.path}.metadata.json`;
        if ((await stat(metadataPath)).size > 65536)
          throw new Error("BSON metadata is too large");
        const metadata = z
          .object({
            version: z.literal(1),
            serverVersion: z.string(),
            toolsVersion: z.literal("100.18.0"),
            database: z.string(),
            collection: z.string(),
          })
          .parse(JSON.parse(await readFile(metadataPath, "utf8")));
        sourceVersion = metadata.serverVersion;
        if (
          metadata.database !== p.database ||
          (metadata.collection && metadata.collection !== p.collection)
        )
          throw new Error(
            "Archive namespace does not match the selected database / collection.",
          );
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
      if (!/^\d+\.\d+(\.\d+)?/.test(sourceVersion))
        throw new Error(
          "Provide the source MongoDB version for an external archive without metadata.",
        );
      if (Number(sourceVersion.split(".")[0]) !== targetMajor)
        throw new Error(
          "Source and target MongoDB major versions must match for BSON restore. Use Extended JSON for migration.",
        );
    }
    const tool = join(
      p.toolsPath,
      `${p.direction === "export" ? "mongodump" : "mongorestore"}${process.platform === "win32" ? ".exe" : ""}`,
    );
    const temp = await mkdtemp(join(tmpdir(), "mongo-workbench-"));
    const configPath = join(temp, "config.yaml");
    try {
      const uri = new ConnectionString(r.uri);
      uri.pathname = `/${encodeURIComponent(p.database)}`;
      const options = r.options;
      if (options.auth) {
        uri.username = encodeURIComponent(options.auth.username);
        uri.password = "";
      }
      for (const key of [
        "authSource",
        "authMechanism",
        "replicaSet",
        "tls",
        "directConnection",
        "readPreference",
      ])
        if (options[key] !== undefined)
          uri.searchParams.set(key, String(options[key]));
      const config = `uri: ${JSON.stringify(uri.toString())}\n${options.auth?.password ? `password: ${JSON.stringify(options.auth.password)}\n` : ""}${options.tlsCertificateKeyFilePassword ? `sslPEMKeyPassword: ${JSON.stringify(options.tlsCertificateKeyFilePassword)}\n` : ""}`;
      await writeFile(configPath, config, { mode: 0o600 });
      const destination =
        p.direction === "export" ? `${p.path}.partial` : p.path;
      if (p.direction === "export") {
        const probe = await open(destination, "wx");
        await probe.close();
      }
      const args = [
        "--config",
        configPath,
        `--archive=${destination}`,
        "--gzip",
      ];
      if (options.tlsCAFile) args.push("--sslCAFile", options.tlsCAFile);
      if (options.tlsCertificateKeyFile)
        args.push("--sslPEMKeyFile", options.tlsCertificateKeyFile);
      if (p.direction === "export") {
        args.push("--db", p.database);
        if (p.collection) args.push("--collection", p.collection);
      } else {
        args.push("--nsInclude", `${p.database}.${p.collection || "*"}`);
        if (p.drop) args.push("--drop");
      }
      this.progress(
        job,
        `${p.direction === "export" ? "mongodump" : "mongorestore"} running`,
      );
      await new Promise<void>((resolveRun, reject) => {
        const child = spawn(tool, args, {
          windowsHide: true,
          stdio: ["ignore", "ignore", "pipe"],
          signal: job.abort.signal,
        });
        let last = "";
        let pendingLine = "";
        let processError: Error | undefined;
        child.stderr.on("data", (chunk) => {
          last = redact(chunk.toString()).slice(-4096);
          pendingLine += chunk.toString();
          const lines = pendingLine.split(/\r?\n/);
          pendingLine = lines.pop()!.slice(-8192);
          for (const line of lines) {
            const dump = line.match(/done dumping .*\((\d+) documents?\)/);
            if (dump && p.direction === "export")
              job.state.processed += Number(dump[1]);
            const restore = line.match(
              /(\d+) document\(s\) restored successfully\. (\d+) document\(s\) failed/,
            );
            if (restore) {
              job.state.processed = Number(restore[1]);
              job.state.failed = Number(restore[2]);
            }
          }
          this.progress(job, last);
        });
        child.once("error", (error) => {
          processError = error;
        });
        child.once("close", (code) =>
          code === 0 && !processError
            ? resolveRun()
            : reject(
                processError ||
                  new Error(`Database tool exited ${code}: ${last}`),
              ),
        );
      });
      job.abort.signal.throwIfAborted();
      job.state.bytes = (await stat(destination)).size;
      if (p.direction === "export") {
        await rename(destination, p.path);
        await writeFile(
          `${p.path}.metadata.json`,
          JSON.stringify(
            {
              version: 1,
              serverVersion: serverInfo.version,
              toolsVersion: toolInfo.version,
              database: p.database,
              collection: p.collection,
            },
            null,
            2,
          ),
        );
      }
    } finally {
      const rel = relative(resolve(tmpdir()), resolve(temp));
      if (
        rel.startsWith("mongo-workbench-") &&
        !rel.includes("/") &&
        !rel.includes("\\")
      )
        await rm(temp, { recursive: true, force: true });
    }
  }
}
