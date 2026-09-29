import {
  ShellInstanceState,
  Cursor,
  AggregationCursor,
  toShellResult,
  getShellApiType,
} from "@mongosh/shell-api";
import { ShellEvaluator } from "@mongosh/shell-evaluator";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { createContext, Script, type Context } from "node:vm";
import { parse } from "@babel/parser";
import type {
  Profile,
  ResolvedConnection,
  ShellResult,
  Row,
} from "../shared/contracts";
import { encode } from "../shared/bson";
import { assertWritable } from "./policy";

export class ShellService {
  runtime: ShellInstanceState | undefined;
  private evaluator?: ShellEvaluator<any>;
  private context?: Context;
  private cursor: any;
  private output: string[] = [];
  private busy = false;
  private more = false;
  private profile?: Profile;
  async open(resolved: ResolvedConnection, database: string, nodb = false) {
    await this.close();
    this.profile = resolved.profile;
    const provider = await NodeDriverServiceProvider.connect(
      resolved.uri,
      { ...resolved.options, promoteValues: false, promoteLongs: false },
      { nodb },
    );
    this.runtime = new ShellInstanceState(provider, undefined, { nodb });
    this.context = createContext({
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    });
    this.runtime.setCtx(this.context);
    this.evaluator = new ShellEvaluator(this.runtime, (value) => value);
    this.runtime.setEvaluationListener({
      onPrint: (values: any[]) => {
        if (this.output.length < 1000)
          this.output.push(
            values
              .map((v) => this.print(v.printable))
              .join(" ")
              .slice(0, 32768),
          );
      },
      onPrompt: async () => {
        throw new Error(
          "Interactive shell prompts are not supported; use connection settings",
        );
      },
      getConfig: (key: string) =>
        (
          ({
            displayBatchSize: 100,
            inspectDepth: 6,
            inspectCompact: 3,
            maxTimeMS: 30000,
          }) as any
        )[key],
      onClearCommand: () => {
        this.output = [];
      },
    } as any);
    if (!nodb)
      await this.evaluate(`db = db.getSiblingDB(${JSON.stringify(database)})`);
  }
  private async evaluate(code: string) {
    // Mongosh awaits top-level expressions implicitly. Its script parser rejects
    // explicit top-level await; remove only AST-identified top-level keywords.
    // Await inside async functions stays untouched. Never use text substitution.
    const ranges: [number, number][] = [];
    try {
      const ast = parse(code, {
        sourceType: "script",
        allowAwaitOutsideFunction: true,
      });
      const visit = (node: any) => {
        if (!node || typeof node !== "object") return;
        if (/Function|Method/.test(node.type || "")) return;
        if (node.type === "AwaitExpression")
          ranges.push([node.start, node.argument.start]);
        for (const [key, value] of Object.entries(node)) {
          if (key === "loc" || key === "comments") continue;
          if (Array.isArray(value)) value.forEach(visit);
          else if (value && typeof value === "object") visit(value);
        }
      };
      visit(ast);
      for (const [start, end] of ranges.sort((a, b) => b[0] - a[0]))
        code = code.slice(0, start) + code.slice(end);
    } catch {
      /* Shell commands such as `use db` are parsed by mongosh itself. */
    }
    return this.evaluator!.customEval(
      async (source, context, filename) =>
        new Script(source, { filename }).runInContext(context as Context, {
          timeout: 30000,
        }),
      code,
      this.context!,
      "workbench-shell.js",
    );
  }
  private print(value: any) {
    if (typeof value === "string") return value;
    if (value === undefined) return "";
    try {
      return encode(value);
    } catch {
      return String(value);
    }
  }
  async execute(code: string): Promise<ShellResult> {
    if (!this.runtime) throw new Error("Shell is closed");
    if (this.profile) assertWritable(this.profile, "shell.execute");
    if (this.busy) throw new Error("Shell is already running");
    this.busy = true;
    this.output = [];
    this.more = false;
    try {
      const raw = await this.evaluate(code);
      if (raw instanceof Cursor || raw instanceof AggregationCursor) {
        this.cursor = raw;
        return await this.cursorPage();
      }
      this.cursor = undefined;
      if (
        raw &&
        typeof raw === "object" &&
        !getShellApiType(raw) &&
        !raw._bsontype &&
        !(raw instanceof Date) &&
        (Array.isArray(raw) ||
          Object.prototype.toString.call(raw) === "[object Object]")
      ) {
        const docs = Array.isArray(raw) ? raw : [raw];
        let bytes = 0;
        const rows: Row[] = [];
        for (const doc of docs) {
          const ejson = encode(doc);
          bytes += ejson.length * 2;
          if (rows.length >= 1000 || bytes > 16 * 1024 * 1024) {
            this.output.push(
              "Result display truncated; use a cursor for batched results.",
            );
            break;
          }
          rows.push({
            ejson,
            editable: false,
            reason: "Shell result is read-only",
          });
        }
        return { rows, output: this.output, hasMore: false };
      }
      const result = (await toShellResult(raw)) as any;
      const rows: Row[] = [];
      const printable = result.printable;
      if (
        result.type === "Cursor" ||
        result.type === "AggregationCursor" ||
        result.type === "ChangeStreamCursor"
      ) {
        const docs = Array.isArray(printable)
          ? printable
          : printable?.documents;
        if (Array.isArray(docs))
          docs.forEach((doc: any) =>
            rows.push({
              ejson: encode(doc),
              editable: false,
              reason: "Shell result is read-only; open the collection to edit",
            }),
          );
        else this.output.push(this.print(printable));
        this.more = Boolean(printable?.hasMore);
      } else if (
        result.type === "Document" ||
        result.type === "DocumentArray"
      ) {
        (Array.isArray(printable) ? printable : [printable]).forEach(
          (doc: any) =>
            rows.push({
              ejson: encode(doc),
              editable: false,
              reason: "Shell result is read-only",
            }),
        );
      } else if (printable !== undefined)
        this.output.push(this.print(printable).slice(0, 262144));
      return { rows, output: this.output, hasMore: this.more };
    } finally {
      this.busy = false;
    }
  }
  private async cursorPage(): Promise<ShellResult> {
    const rows: Row[] = [];
    let bytes = 0;
    while (
      rows.length < 100 &&
      bytes < 8 * 1024 * 1024 &&
      (await this.cursor.hasNext())
    ) {
      const doc = await this.cursor.next();
      const ejson = encode(doc);
      bytes += ejson.length * 2;
      rows.push({
        ejson,
        editable: false,
        reason: "Shell result is read-only; open the collection to edit",
      });
    }
    this.more = await this.cursor.hasNext();
    if (!this.more) {
      await this.cursor.close();
      this.cursor = undefined;
    }
    return { rows, output: this.output, hasMore: this.more };
  }
  async next() {
    if (!this.more || !this.cursor) throw new Error("No more shell results");
    if (this.busy) throw new Error("Shell is already running");
    this.busy = true;
    this.output = [];
    try {
      return await this.cursorPage();
    } finally {
      this.busy = false;
    }
  }
  async close() {
    const runtime = this.runtime;
    this.runtime = undefined;
    this.profile = undefined;
    if (runtime) await runtime.close();
  }
}
