import { useEffect, useRef, useState } from "react";
import type { Profile, QueryInput } from "../shared/contracts";
import { summarizeExplain, type PlanNode } from "../shared/exploration";
import { api, Field, message, Modal, useUi } from "./ui";
import { CodeEditor } from "./Editor";
import { prettyDocument } from "./json-format";
import { AIAssistantPanel } from "./AIAssistantPanel";
import type { PreferenceSection } from "./preferences";

export type AnalysisTarget = {
  connectionId: string;
  database: string;
  collection: string;
};
export function AnalysisDialog({
  mode,
  initial,
  profiles,
  close,
  applyFilter,
}: {
  mode: "schema" | "compare";
  initial: AnalysisTarget;
  profiles: Profile[];
  close(): void;
  applyFilter?(field: string, value: any, target: AnalysisTarget): void;
}) {
  const { t, theme } = useUi();
  const [source, setSource] = useState(initial),
    [target, setTarget] = useState(initial);
  const [filter, setFilter] = useState("{}"),
    [targetFilter, setTargetFilter] = useState("{}");
  const [keys, setKeys] = useState("_id"),
    [ignore, setIgnore] = useState("");
  const [sampleSize, setSampleSize] = useState(200),
    [seconds, setSeconds] = useState(mode === "schema" ? 30 : 300);
  const [report, setReport] = useState<any>(),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [detail, setDetail] = useState<any>();
  const job = useRef("");
  useEffect(() => {
    const unsubscribe = api.subscribe((e) => {
      if (
        e.type === "analysis" &&
        e.data.jobId === job.current &&
        e.data.processed !== undefined
      )
        setProgress(e.data.processed);
    });
    return () => {
      unsubscribe();
      if (job.current)
        void api.request("analysis.cancel", { jobId: job.current });
    };
  }, []);
  const run = async () => {
    setBusy(true);
    setError("");
    setReport(undefined);
    setProgress(0);
    job.current = crypto.randomUUID();
    try {
      setReport(
        mode === "schema"
          ? await api.request("analysis.schema", {
              ...source,
              filter,
              sampleSize,
              jobId: job.current,
              maxTimeMS: seconds * 1000,
            })
          : await api.request("analysis.compare", {
              source,
              target,
              sourceFilter: filter,
              targetFilter,
              matchKeys: keys
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              ignorePaths: ignore
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              jobId: job.current,
              maxTimeMS: seconds * 1000,
            }),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      job.current = "";
    }
  };
  const exportReport = async () => {
    try {
      const path = await api.request("files.choose", {
        kind: "save",
        title: t("匯出分析報告", "Export analysis report"),
        defaultPath: `irwin-${mode}-report.json`,
      });
      if (path)
        await api.request("reports.export", {
          path,
          content: JSON.stringify(report, null, 2),
        });
    } catch (e) {
      setError(message(e));
    }
  };
  const targetFields = (
    id: "source" | "target",
    label: string,
    value: AnalysisTarget,
    update: (v: AnalysisTarget) => void,
  ) => (
    <fieldset className="analysis-target" disabled={busy}>
      <legend>{label}</legend>
      <Field label={t("連線", "Connection")}>
        <select
          name={`analysis-${id}-connection`}
          value={value.connectionId}
          onChange={(e) => update({ ...value, connectionId: e.target.value })}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Database">
        <input
          name={`analysis-${id}-database`}
          autoComplete="off"
          value={value.database}
          onChange={(e) => update({ ...value, database: e.target.value })}
        />
      </Field>
      <Field label="Collection">
        <input
          name={`analysis-${id}-collection`}
          autoComplete="off"
          value={value.collection}
          onChange={(e) => update({ ...value, collection: e.target.value })}
        />
      </Field>
    </fieldset>
  );
  return (
    <Modal
      wide
      resizable
      title={
        mode === "schema"
          ? t("Schema 與資料品質", "Schema & data quality")
          : t("跨環境資料比較 · 唯讀", "Compare collections · read-only")
      }
      close={close}
      footer={
        <>
          <span className="muted">
            {busy ? `${t("已讀取", "Read")} ${progress}` : report?.capturedAt}
          </span>
          {report && (
            <button onClick={() => void exportReport()}>
              {t("匯出報告", "Export report")}
            </button>
          )}
          {busy ? (
            <button
              onClick={() =>
                void api.request("analysis.cancel", { jobId: job.current })
              }
            >
              {t("取消分析", "Cancel analysis")}
            </button>
          ) : (
            <button className="primary" onClick={() => void run()}>
              {t("開始分析", "Run analysis")}
            </button>
          )}
        </>
      }
    >
      <details className="analysis-configuration" open={!report}>
        <summary>{t("分析範圍與設定", "Scope & settings")}</summary>
        <div className="analysis-targets">
          {targetFields("source", t("來源", "Source"), source, setSource)}
          {mode === "compare" &&
            targetFields("target", t("目標", "Target"), target, setTarget)}
        </div>
        <fieldset className="form-grid analysis-options" disabled={busy}>
          <Field label={t("來源 Filter", "Source filter")}>
            <input
              name="analysis-source-filter"
              autoComplete="off"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </Field>
          {mode === "compare" && (
            <>
              <Field label={t("目標 Filter", "Target filter")}>
                <input
                  name="analysis-target-filter"
                  autoComplete="off"
                  value={targetFilter}
                  onChange={(e) => setTargetFilter(e.target.value)}
                />
              </Field>
              <Field
                label={t("比對鍵（逗號分隔）", "Match keys (comma separated)")}
              >
                <input
                  name="analysis-match-keys"
                  autoComplete="off"
                  value={keys}
                  onChange={(e) => setKeys(e.target.value)}
                />
              </Field>
              <Field
                label={t(
                  "忽略欄位（逗號分隔）",
                  "Ignore paths (comma separated)",
                )}
              >
                <input
                  name="analysis-ignore-paths"
                  autoComplete="off"
                  value={ignore}
                  onChange={(e) => setIgnore(e.target.value)}
                />
              </Field>
            </>
          )}
          {mode === "schema" && (
            <Field label={t("樣本上限（1–1,000）", "Sample limit (1–1,000)")}>
              <input
                type="number"
                name="analysis-sample-limit"
                min={1}
                max={1000}
                value={sampleSize}
                onChange={(e) => setSampleSize(Number(e.target.value))}
              />
            </Field>
          )}
          <Field label={t("時間上限（秒）", "Time limit (seconds)")}>
            <input
              type="number"
              name="analysis-time-limit"
              min={1}
              max={3600}
              value={seconds}
              onChange={(e) => setSeconds(Number(e.target.value))}
            />
          </Field>
        </fieldset>
      </details>
      <p className="muted">
        {mode === "schema"
          ? t(
              "取樣最多 8 MB；分布僅代表樣本。MongoDB 隨機取樣，Cosmos 使用前 N 筆。巢狀物件依路徑分析；陣列顯示長度。",
              "Sample capped at 8 MB. Distributions describe the sample only. MongoDB uses random sampling; Cosmos uses the first N matches. Nested objects use field paths; arrays report lengths.",
            )
          : t(
              "讀取所有符合條件的文件，以本機暫存檔比對；不修改資料。不是同一時間點的快照，資料持續變更時請重新確認。畫面與匯出報告最多保留 500 項／8 MB 差異。",
              "Reads all matches using temporary disk storage; no writes. This is not a point-in-time snapshot. Displayed/exported differences are capped at 500 entries / 8 MB.",
            )}
      </p>
      {error && (
        <div className="error notice" role="alert">
          {error}
        </div>
      )}
      {report && mode === "schema" && (
        <>
          <div className="analysis-summary">
            <strong>
              {report.sampled} {t("筆樣本", "sample documents")}
            </strong>
            <span>
              {report.method} · {report.namespace}
            </span>
            {(report.byteLimited || report.fieldsTruncated) && (
              <span className="warning">
                {t(
                  "已達容量／欄位上限，這是部分分析。",
                  "Byte/field limit reached: partial analysis.",
                )}
              </span>
            )}
          </div>
          <div className="analysis-table-wrap">
            <table className="analysis-table">
              <thead>
                <tr>
                  {[
                    t("欄位", "Field"),
                    t("型別分布", "Types"),
                    t("缺少／Null", "Missing / null"),
                    t("常見值／範圍", "Values / range"),
                  ].map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.fields.map((field: any) => (
                  <tr key={field.path}>
                    <td>
                      <code>{field.path}</code>
                    </td>
                    <td>
                      {Object.entries(field.types).map(([type, n]) => (
                        <div key={type} className="type-distribution">
                          <span>
                            {type} · {String(n)}
                          </span>
                          <meter
                            min={0}
                            max={Math.max(1, report.sampled)}
                            value={Number(n)}
                          />
                        </div>
                      ))}
                    </td>
                    <td>
                      <button
                        className="link-button"
                        disabled={!applyFilter}
                        onClick={() => {
                          applyFilter?.(field.path, undefined, report.source);
                          close();
                        }}
                      >
                        {field.missing}
                      </button>{" "}
                      /{" "}
                      <button
                        className="link-button"
                        disabled={!applyFilter}
                        onClick={() => {
                          applyFilter?.(field.path, null, report.source);
                          close();
                        }}
                      >
                        {field.types.Null || 0}
                      </button>
                    </td>
                    <td>
                      {field.min !== undefined && (
                        <small>
                          {String(field.min)} … {String(field.max)}
                        </small>
                      )}
                      {field.array && (
                        <small>
                          length {field.array.min} … {field.array.max} · avg{" "}
                          {field.array.average.toFixed(1)}
                        </small>
                      )}
                      <div className="schema-values">
                        {field.values.slice(0, 5).map((v: any, i: number) => (
                          <button
                            key={i}
                            disabled={!applyFilter}
                            title={JSON.stringify(v.value)}
                            onClick={() => {
                              applyFilter?.(field.path, v.value, report.source);
                              close();
                            }}
                          >
                            <span>
                              {prettyDocument(v.value, { indent: 2 })}
                            </span>{" "}
                            ×{v.count}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {report && mode === "compare" && (
        <>
          <p className="muted">
            {profiles.find((p) => p.id === report.source.connectionId)?.name} /{" "}
            {report.source.database}.{report.source.collection} →{" "}
            {profiles.find((p) => p.id === report.target.connectionId)?.name} /{" "}
            {report.target.database}.{report.target.collection}
          </p>
          <p className="warning">
            {t(
              "這是兩端依序讀取的比較證據，不是同一時間點的快照；持續寫入時結果可能不一致。",
              "The two sides were read in sequence. This is not a point-in-time snapshot; concurrent writes may change the comparison.",
            )}
          </p>
          <details>
            <summary>
              {t("比對條件與讀取時間", "Comparison inputs and read times")}
            </summary>
            <p className="muted">
              {t("來源讀取", "Source read")}:{" "}
              {report.readWindows.source.startedAt} →{" "}
              {report.readWindows.source.completedAt}
              <br />
              {t("目標讀取", "Target read")}:{" "}
              {report.readWindows.target.startedAt} →{" "}
              {report.readWindows.target.completedAt}
              <br />
              {t("來源條件", "Source filter")}:{" "}
              <code>{report.sourceFilter}</code>
              <br />
              {t("目標條件", "Target filter")}:{" "}
              <code>{report.targetFilter}</code>
              <br />
              {t("比對鍵", "Match keys")}: {report.matchKeys.join(", ")}
              <br />
              {t("忽略欄位", "Ignored paths")}:{" "}
              {report.ignorePaths.join(", ") || "—"}
            </p>
          </details>
          <div className="analysis-summary">
            {Object.entries(report.counts).map(([key, n]) => (
              <span key={key}>
                <strong>{String(n)}</strong>{" "}
                {
                  (
                    {
                      source: t("來源", "Source"),
                      target: t("目標", "Target"),
                      equal: t("相同", "Equal"),
                      changed: t("不同", "Changed"),
                      sourceOnly: t("僅來源", "Source only"),
                      targetOnly: t("僅目標", "Target only"),
                      duplicates: t("重複鍵組", "Duplicate keys"),
                      missingKeys: t("缺少鍵文件", "Missing keys"),
                    } as any
                  )[key]
                }
              </span>
            ))}
          </div>
          {report.reportTruncated && (
            <p className="warning">
              {t(
                "計數涵蓋全部已完成的比對，但差異清單已截斷。",
                "Counts cover the completed comparison; the difference list is truncated.",
              )}
            </p>
          )}
          <div className="analysis-table-wrap">
            <table className="analysis-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Key</th>
                  <th>{t("差異欄位", "Changed paths")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {report.differences.map((d: any, i: number) => (
                  <tr key={i}>
                    <td>{d.status}</td>
                    <td>
                      <code>{JSON.stringify(d.key ?? d.identity)}</code>
                    </td>
                    <td>{d.paths.join(", ")}</td>
                    <td>
                      <button onClick={() => setDetail(d)}>
                        {t("檢視差異", "Inspect difference")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {detail && (
        <Modal
          title={t("差異文件", "Document difference")}
          wide
          close={() => setDetail(undefined)}
        >
          <CodeEditor
            value={JSON.stringify(detail, null, 2)}
            theme={theme}
            readOnly
            height="420px"
          />
        </Modal>
      )}
    </Modal>
  );
}
function PlanTree({ nodes }: { nodes: PlanNode[] }) {
  return (
    <ul className="explain-tree">
      {nodes.map((node, i) => (
        <li key={i}>
          <strong>{node.stage}</strong>
          {node.index && <code>{node.index}</code>}
          {node.children.length > 0 && <PlanTree nodes={node.children} />}
        </li>
      ))}
    </ul>
  );
}
export function ExplainDialog({
  query,
  close,
  profileProvider = "mongodb",
  onOpenPreferences,
}: {
  query: QueryInput;
  close(): void;
  profileProvider?: "mongodb" | "cosmos";
  onOpenPreferences?(section?: PreferenceSection): void;
}) {
  const { t, theme, language } = useUi();
  const [inputs, setInputs] = useState(query);
  const [runs, setRuns] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [raw, setRaw] = useState(false);
  const [showAiAssistant, setShowAiAssistant] = useState(false);
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const data = JSON.parse(await api.request("queries.explain", inputs));
      setRuns((old) => [
        ...old.slice(-1),
        {
          data,
          query: inputs,
          summary: summarizeExplain(data),
          time: new Date().toISOString(),
        },
      ]);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      wide
      resizable
      className={`explain-modal${showAiAssistant ? " has-ai-assistant" : ""}`}
      title="Explain · executionStats"
      close={close}
      footer={
        <>
          <button onClick={() => setRaw((v) => !v)}>
            {raw ? t("圖形檢視", "Visual plan") : "JSON"}
          </button>
          {profileProvider === "mongodb" && runs.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAiAssistant((open) => !open)}
              aria-expanded={showAiAssistant}
            >
              {t("AI 解讀計畫", "Explain with AI")}
            </button>
          )}
          <button
            className="primary"
            disabled={busy}
            onClick={() => void run()}
          >
            {busy
              ? t("執行中…", "Running…")
              : t("執行／再次比較", "Run / compare again")}
          </button>
        </>
      }
    >
      <div
        className={`explain-layout${showAiAssistant ? " with-ai-assistant" : ""}`}
      >
        <div className="explain-content">
          <p className="muted">
            {t(
              "會實際執行目前查詢以取得統計，遵守查詢時間上限；保留最近兩次供比較。執行時間受快取與伺服器負載影響。",
              "Executes the current query within its time limit to collect statistics. Keeps the last two runs for comparison; cache and server load affect timings.",
            )}
          </p>
          <code>
            {query.database}.{query.collection}
          </code>
          <fieldset disabled={busy} className="analysis-options form-grid">
            <Field label="Filter">
              <input
                name="explain-filter"
                autoComplete="off"
                value={inputs.filter}
                onChange={(e) =>
                  setInputs((old) => ({ ...old, filter: e.target.value }))
                }
              />
            </Field>
            <Field label="Sort">
              <input
                name="explain-sort"
                autoComplete="off"
                value={inputs.sort}
                onChange={(e) =>
                  setInputs((old) => ({ ...old, sort: e.target.value }))
                }
              />
            </Field>
            <Field label="Projection">
              <input
                name="explain-projection"
                autoComplete="off"
                value={inputs.projection}
                onChange={(e) =>
                  setInputs((old) => ({ ...old, projection: e.target.value }))
                }
              />
            </Field>
          </fieldset>
          {error && <div className="error notice">{error}</div>}
          {raw ? (
            <CodeEditor
              theme={theme}
              readOnly
              value={JSON.stringify(
                runs.map((r) => ({
                  time: r.time,
                  query: r.query,
                  plan: r.data,
                })),
                null,
                2,
              )}
              height="400px"
            />
          ) : (
            <div className="explain-runs">
              {runs.map((run, i) => (
                <section key={i}>
                  <small>{run.time}</small>
                  <p className="muted">
                    <code>
                      {run.query.filter} · sort {run.query.sort}
                    </code>
                  </p>
                  <div className="analysis-summary">
                    {[
                      [t("回傳", "Returned"), run.summary.returned],
                      [t("掃描文件", "Docs examined"), run.summary.examined],
                      [t("掃描索引鍵", "Keys examined"), run.summary.keys],
                      ["ms", run.summary.elapsed],
                      [
                        t("掃描／回傳", "Examined / returned"),
                        run.summary.ratio,
                      ],
                    ].map(([label, v]) => (
                      <span key={label}>
                        <strong>{v === undefined ? "—" : v}</strong> {label}
                      </span>
                    ))}
                  </div>
                  {run.summary.collectionScan && (
                    <p className="warning">
                      COLLSCAN · {t("集合掃描", "Collection scan")}
                    </p>
                  )}
                  <p>
                    {t("使用索引", "Indexes used")}:{" "}
                    {run.summary.indexes.join(", ") || "—"}
                  </p>
                  <PlanTree nodes={run.summary.tree} />
                </section>
              ))}
            </div>
          )}
        </div>
        {showAiAssistant && runs.length > 0 && (
          <AIAssistantPanel
            key={`${query.connectionId}/${query.database}/${query.collection}/explain`}
            connectionId={query.connectionId}
            database={query.database}
            collection={query.collection}
            task="explain"
            language={language}
            profileProvider={profileProvider}
            collectionNames={[]}
            fieldHints={[]}
            currentQuery={{
              filter: runs.at(-1).query.filter,
              sort: runs.at(-1).query.sort,
              projection: runs.at(-1).query.projection,
            }}
            explainPlan={JSON.stringify(runs.at(-1).data)}
            embedded
            onClose={() => setShowAiAssistant(false)}
            onOpenPreferences={(section) => onOpenPreferences?.(section)}
          />
        )}
      </div>
    </Modal>
  );
}
