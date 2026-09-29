import { useEffect, useRef, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import type { Page, Profile, Row } from "../shared/contracts";
import {
  AggregationStageError,
  compileReadOnlyPipeline,
  type AggregationStageDraft,
} from "../shared/aggregation";
import { Results } from "./Results";
import { api, message, useUi } from "./ui";
import type { WorkspaceTab } from "./CollectionTab";
import {
  savedPipelineSchema,
  type SavedPipeline,
} from "../shared/saved-pipeline";
import { Field, Modal } from "./ui";
import { AIAssistantPanel } from "./AIAssistantPanel";
import type { PreferenceSection } from "./preferences";

const templates: Record<string, string> = {
  $match: '{ "$match": { "field": "value" } }',
  $project: '{ "$project": { "field": 1, "_id": 0 } }',
  $group: '{ "$group": { "_id": "$field", "count": { "$sum": 1 } } }',
  $sort: '{ "$sort": { "field": 1 } }',
  $limit: '{ "$limit": 20 }',
  $unwind: '{ "$unwind": "$items" }',
  $lookup:
    '{ "$lookup": { "from": "other", "localField": "key", "foreignField": "key", "as": "joined" } }',
};

export default function AggregationTab({
  tab,
  profile,
  active,
  notify,
  collectionNames,
  onOpenPreferences,
}: {
  tab: WorkspaceTab;
  profile?: Profile;
  active: boolean;
  notify(text: string, error?: boolean): void;
  collectionNames: string[];
  onOpenPreferences(section?: PreferenceSection): void;
}) {
  const { t, theme, language } = useUi();
  const [template, setTemplate] = useState("$match");
  const [stages, setStages] = useState<AggregationStageDraft[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [view, setView] = useState("table");
  const [busy, setBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursorId, setCursorId] = useState("");
  const [error, setError] = useState("");
  const [stageError, setStageError] = useState(-1);
  const [elapsed, setElapsed] = useState(0);
  const [scope, setScope] = useState<"preview" | "run">("run");
  const [hasExecuted, setHasExecuted] = useState(false);
  const [explain, setExplain] = useState("");
  const [showAiAssistant, setShowAiAssistant] = useState(false);
  const [saved, setSaved] = useState<SavedPipeline[]>([]);
  const [selectedSavedId, setSelectedSavedId] = useState("");
  const [saveForm, setSaveForm] = useState<SavedPipeline>();
  const [saveError, setSaveError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [focusedStage, setFocusedStage] = useState<number | null>(null);
  const [editorPercent, setEditorPercent] = useState(38);
  const generation = useRef(0);
  const currentCursor = useRef("");
  useEffect(() => {
    let live = true;
    void api
      .request("savedPipelines.list", {})
      .then((items: SavedPipeline[]) => {
        if (live) setSaved(items);
      })
      .catch((cause) => {
        if (live) notify(message(cause), true);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(
    () => () => {
      generation.current++;
      if (currentCursor.current)
        void api
          .request("queries.cancel", { cursorId: currentCursor.current })
          .catch(() => {});
    },
    [],
  );

  const updateStages = (next: AggregationStageDraft[]) => {
    setStages(next);
    setFocusedStage((current) =>
      current === null
        ? null
        : next.length
          ? Math.min(current, next.length - 1)
          : null,
    );
    setError("");
    setStageError(-1);
    setRows([]);
    setHasMore(false);
    setHasExecuted(false);
    setExplain("");
    generation.current++;
    if (currentCursor.current)
      void api
        .request("queries.cancel", { cursorId: currentCursor.current })
        .catch(() => {});
    currentCursor.current = "";
    setCursorId("");
    setBusy(false);
  };
  const replaceStage = (index: number, next: AggregationStageDraft) =>
    updateStages(stages.map((stage, at) => (at === index ? next : stage)));
  const moveStage = (index: number, destination: number) => {
    if (destination < 0 || destination >= stages.length) return;
    const next = [...stages];
    [next[index], next[destination]] = [next[destination], next[index]];
    updateStages(next);
    setFocusedStage((current) => (current === index ? destination : current));
  };
  const input = (selectedStages = stages, id?: string) => ({
    connectionId: tab.connectionId,
    database: tab.database,
    collection: tab.collection,
    stages: selectedStages,
    maxTimeMS: profile?.queryTimeoutMS ?? 30000,
    ...(id ? { cursorId: id } : {}),
  });
  const reportError = (cause: unknown) => {
    setError(message(cause));
    setStageError(
      cause instanceof AggregationStageError ? cause.stageIndex : -1,
    );
    if (cause instanceof AggregationStageError && focusedStage !== null)
      setFocusedStage(cause.stageIndex);
    notify(message(cause), true);
  };
  const execute = async (mode: "run" | "preview", throughIndex?: number) => {
    if (busy) return;
    setError("");
    setStageError(-1);
    try {
      compileReadOnlyPipeline(stages);
    } catch (cause) {
      reportError(cause);
      return;
    }
    if (currentCursor.current)
      await api
        .request("queries.cancel", { cursorId: currentCursor.current })
        .catch(() => {});
    const id = crypto.randomUUID();
    const runGeneration = ++generation.current;
    currentCursor.current = id;
    setCursorId(id);
    setBusy(true);
    setScope(mode);
    setRows([]);
    setHasMore(false);
    setHasExecuted(false);
    const started = performance.now();
    try {
      const page: Page = await api.request(
        mode === "preview" ? "aggregations.preview" : "aggregations.run",
        {
          ...input(stages, id),
          ...(throughIndex === undefined ? {} : { throughIndex }),
        },
      );
      if (runGeneration !== generation.current) return;
      setRows(page.rows);
      setHasMore(page.hasMore);
      setHasExecuted(true);
      setElapsed(Math.round(performance.now() - started));
      if (!page.hasMore) currentCursor.current = "";
    } catch (cause) {
      if (runGeneration === generation.current) reportError(cause);
    } finally {
      if (runGeneration === generation.current) setBusy(false);
    }
  };
  const next = async () => {
    if (busy || !hasMore || !cursorId) return;
    const runGeneration = generation.current;
    setBusy(true);
    try {
      const page: Page = await api.request("queries.next", { cursorId });
      if (runGeneration !== generation.current) return;
      setRows((old) => [...old, ...page.rows].slice(-1000));
      setHasMore(page.hasMore);
      if (!page.hasMore) currentCursor.current = "";
    } catch (cause) {
      if (runGeneration === generation.current) reportError(cause);
    } finally {
      if (runGeneration === generation.current) setBusy(false);
    }
  };
  const cancel = async () => {
    generation.current++;
    const id = currentCursor.current;
    currentCursor.current = "";
    setBusy(false);
    setHasMore(false);
    if (id)
      await api.request("queries.cancel", { cursorId: id }).catch(() => {});
  };
  const showExplain = async () => {
    try {
      compileReadOnlyPipeline(stages);
      setBusy(true);
      setError("");
      setExplain(await api.request("aggregations.explain", input()));
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusy(false);
    }
  };
  const selectedSaved = saved.find((item) => item.id === selectedSavedId);
  const openSave = () => {
    setSaveError("");
    setSaveForm({
      id: selectedSaved?.id || crypto.randomUUID(),
      name: selectedSaved?.name || "",
      group: selectedSaved?.group || "",
      description: selectedSaved?.description || "",
      source: {
        connectionName: tab.connectionName,
        database: tab.database,
        collection: tab.collection,
      },
      stages,
      updatedAt: new Date().toISOString(),
    });
  };
  const savePipeline = async () => {
    if (!saveForm) return;
    try {
      compileReadOnlyPipeline(saveForm.stages);
      const item: SavedPipeline = await api.request(
        "savedPipelines.save",
        savedPipelineSchema.parse(saveForm),
      );
      setSaved((old) =>
        [...old.filter((entry) => entry.id !== item.id), item].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      setSelectedSavedId(item.id);
      setSaveForm(undefined);
    } catch (cause) {
      setSaveError(message(cause));
    }
  };
  const deletePipeline = async () => {
    if (!selectedSaved) return;
    try {
      await api.request("savedPipelines.delete", { id: selectedSaved.id });
      setSaved((old) => old.filter((item) => item.id !== selectedSaved.id));
      setSelectedSavedId("");
      setConfirmDelete(false);
    } catch (cause) {
      notify(message(cause), true);
    }
  };
  const exportComplete = async () => {
    try {
      compileReadOnlyPipeline(stages);
      const path: string | null = await api.request("files.choose", {
        kind: "save",
        title: t(
          "匯出完整 Aggregation 結果",
          "Export complete Aggregation result",
        ),
        defaultPath: `${tab.collection}-aggregation.jsonl`,
      });
      if (!path) return;
      const job = await api.request("aggregations.export", {
        ...input(),
        path,
      });
      notify(
        t(
          `完整結果匯出任務已開始：${job.jobId}`,
          `Complete export job started: ${job.jobId}`,
        ),
      );
    } catch (cause) {
      reportError(cause);
    }
  };

  return (
    <div className="aggregation-workspace" aria-hidden={!active}>
      <header className="aggregation-header">
        <div>
          <strong>Aggregation</strong>
          <span>
            {tab.connectionName} / {tab.database}.{tab.collection}
          </span>
          <span
            className={`environment-badge ${profile?.environment || "development"}`}
          >
            {(profile?.environment || "development").toUpperCase()}
          </span>
        </div>
        <span>
          {t(
            "唯讀 Pipeline · 結果不可直接編輯",
            "Read-only pipeline · results cannot be edited",
          )}
        </span>
      </header>
      <div className="aggregation-layout-controls">
        <strong>
          {t("階段", "Stages")} {stages.length}
        </strong>
        <button
          disabled={!stages.length}
          aria-pressed={focusedStage !== null}
          onClick={() =>
            setFocusedStage((current) => (current === null ? 0 : null))
          }
        >
          {focusedStage === null
            ? t("單階段檢視", "Focus one stage")
            : t("顯示全部階段", "Show all stages")}
        </button>
        {focusedStage !== null && (
          <>
            <button
              disabled={focusedStage === 0}
              onClick={() =>
                setFocusedStage((current) => Math.max(0, (current ?? 0) - 1))
              }
            >
              {t("上一階段", "Previous stage")}
            </button>
            <span role="status">
              {focusedStage + 1} / {stages.length}
            </span>
            <button
              disabled={focusedStage >= stages.length - 1}
              onClick={() =>
                setFocusedStage((current) =>
                  Math.min(stages.length - 1, (current ?? 0) + 1),
                )
              }
            >
              {t("下一階段", "Next stage")}
            </button>
          </>
        )}
        <label className="aggregation-editor-size">
          {t("編輯區高度", "Editor height")}
          <input
            type="range"
            min={25}
            max={65}
            step={5}
            value={editorPercent}
            onChange={(event) => setEditorPercent(Number(event.target.value))}
          />
        </label>
      </div>
      <div
        className="aggregation-stage-list"
        style={{
          height: stages.length
            ? `min(${editorPercent}%, max(160px, calc(100% - 400px)))`
            : undefined,
          maxHeight: `min(${editorPercent}%, max(160px, calc(100% - 400px)))`,
        }}
      >
        {stages.map((stage, index) =>
          focusedStage !== null && focusedStage !== index ? null : (
            <section
              className={`aggregation-stage ${stageError === index ? "invalid" : ""}`}
              key={stage.id}
            >
              <div className="aggregation-stage-toolbar">
                <strong>
                  {t("階段", "Stage")} {index + 1}
                </strong>
                <label>
                  <input
                    type="checkbox"
                    checked={stage.enabled}
                    onChange={(event) =>
                      replaceStage(index, {
                        ...stage,
                        enabled: event.target.checked,
                      })
                    }
                  />
                  {t("啟用", "Enabled")}
                </label>
                <button
                  disabled={busy || index === 0}
                  onClick={() => moveStage(index, index - 1)}
                  aria-label={`${t("上移階段", "Move stage up")} ${index + 1}`}
                >
                  ↑
                </button>
                <button
                  disabled={busy || index === stages.length - 1}
                  onClick={() => moveStage(index, index + 1)}
                  aria-label={`${t("下移階段", "Move stage down")} ${index + 1}`}
                >
                  ↓
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    updateStages([
                      ...stages.slice(0, index + 1),
                      { ...stage, id: crypto.randomUUID() },
                      ...stages.slice(index + 1),
                    ])
                  }
                >
                  {t("複製", "Duplicate")}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    updateStages(stages.filter((_, at) => at !== index))
                  }
                >
                  {t("刪除", "Delete")}
                </button>
                <button
                  disabled={busy}
                  onClick={() => void execute("preview", index)}
                >
                  {t("預覽至此", "Preview through here")}
                </button>
              </div>
              <textarea
                aria-label={`${t("階段內容", "Stage document")} ${index + 1}`}
                spellCheck={false}
                value={stage.text}
                onChange={(event) =>
                  replaceStage(index, { ...stage, text: event.target.value })
                }
              />
            </section>
          ),
        )}
      </div>
      <div className="aggregation-actions">
        <label>
          {t("階段範本", "Stage template")}
          <select
            aria-label={t("階段範本", "Stage template")}
            value={template}
            onChange={(event) => setTemplate(event.target.value)}
          >
            {Object.keys(templates).map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || stages.length >= 50}
          onClick={() =>
            updateStages([
              ...stages,
              {
                id: crypto.randomUUID(),
                enabled: true,
                text: templates[template],
              },
            ])
          }
        >
          {t("新增階段", "Add stage")}
        </button>
        <button
          disabled={busy}
          className="primary"
          onClick={() => void execute("run")}
        >
          {t("執行 Pipeline", "Run pipeline")}
        </button>
        <button
          disabled={busy}
          className="icon"
          aria-label={t("Explain Pipeline", "Explain pipeline")}
          title={t("Explain Pipeline", "Explain pipeline")}
          onClick={() => void showExplain()}
        >
          <Search size={15} />
        </button>
        {profile?.provider === "mongodb" && (
          <button
            disabled={busy}
            className={`icon${showAiAssistant ? " active" : ""}`}
            aria-label={t("AI 助理", "AI assistant")}
            title={t(
              "用口語撰寫 Aggregation",
              "Write an Aggregation in plain language",
            )}
            aria-expanded={showAiAssistant}
            onClick={() => setShowAiAssistant((open) => !open)}
          >
            <Sparkles size={15} />
          </button>
        )}
        <button disabled={!busy && !hasMore} onClick={() => void cancel()}>
          {t("停止", "Stop")}
        </button>
        <button disabled={busy} onClick={() => void exportComplete()}>
          {t("匯出完整結果 JSONL", "Export complete result JSONL")}
        </button>
        <button onClick={openSave}>
          {t("儲存 Pipeline", "Save pipeline")}
        </button>
        <details className="aggregation-library">
          <summary>{t("已儲存的 Pipeline", "Saved pipelines")}</summary>
          <div>
            <label>
              {t("已儲存 Pipeline", "Saved pipeline")}
              <select
                aria-label={t("已儲存 Pipeline", "Saved pipeline")}
                value={selectedSavedId}
                onChange={(event) => setSelectedSavedId(event.target.value)}
              >
                <option value="">{t("請選擇", "Select")}</option>
                {saved.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={!selectedSaved || busy}
              onClick={() =>
                selectedSaved &&
                updateStages(
                  selectedSaved.stages.map((stage) => ({
                    ...stage,
                    id: crypto.randomUUID(),
                  })),
                )
              }
            >
              {t("套用 Pipeline", "Apply pipeline")}
            </button>
            <button
              disabled={!selectedSaved}
              onClick={() => setConfirmDelete(true)}
            >
              {t("刪除已儲存 Pipeline", "Delete saved pipeline")}
            </button>
          </div>
        </details>
      </div>
      {selectedSaved && (
        <div className="aggregation-saved-source">
          {t("儲存來源", "Saved source")}:{" "}
          {selectedSaved.source?.connectionName || "—"} /{" "}
          {selectedSaved.source?.database || "—"}.
          {selectedSaved.source?.collection || "—"} →{" "}
          {t("目前目標", "Current target")}: {tab.connectionName} /{" "}
          {tab.database}.{tab.collection}
        </div>
      )}
      {error && (
        <div className="aggregation-error" role="alert">
          {error}
        </div>
      )}
      {showAiAssistant && profile?.provider === "mongodb" && (
        <AIAssistantPanel
          key={`${tab.connectionId}/${tab.database}/${tab.collection}/aggregation`}
          connectionId={tab.connectionId}
          database={tab.database}
          collection={tab.collection}
          task="query"
          draftMode="aggregation"
          language={language}
          profileProvider="mongodb"
          collectionNames={collectionNames}
          fieldHints={[]}
          aggregationStages={stages}
          onApplyAggregation={(draft) =>
            updateStages(
              draft.map((stage) => ({
                id: crypto.randomUUID(),
                enabled: true,
                text: JSON.stringify(stage, null, 2),
              })),
            )
          }
          onClose={() => setShowAiAssistant(false)}
          onOpenPreferences={onOpenPreferences}
        />
      )}
      {explain && (
        <details className="aggregation-explain" open>
          <summary>Explain</summary>
          <pre>{JSON.stringify(JSON.parse(explain), null, 2)}</pre>
        </details>
      )}
      <div className="aggregation-results">
        <div className="aggregation-results-toolbar">
          <strong>{t("唯讀結果", "Read-only results")}</strong>
          <span className="aggregation-result-count">
            {hasExecuted || busy ? (
              <>
                {scope === "preview"
                  ? t("階段預覽", "Stage preview")
                  : t("已載入", "Loaded")}{" "}
                {rows.length} {t("筆", "rows")}
                {hasMore ? "+" : ""} · {elapsed} ms
              </>
            ) : (
              t("尚未執行目前 Pipeline", "Current pipeline has not run")
            )}
          </span>
          {(["table", "tree", "json"] as const).map((mode) => (
            <button
              key={mode}
              className={view === mode ? "active" : ""}
              onClick={() => setView(mode)}
            >
              {mode === "table" ? "Table" : mode === "tree" ? "Tree" : "JSON"}
            </button>
          ))}
          <button disabled={!hasMore || busy} onClick={() => void next()}>
            {t("載入下一批", "Load next batch")}
          </button>
        </div>
        <Results
          showColumns={false}
          onCloseColumns={() => {}}
          rows={rows}
          view={view}
          theme={theme}
          onEdit={() => {}}
          onCommit={async () => {}}
          onSelect={() => {}}
          busy={busy}
          queryState={error ? "error" : hasExecuted ? "success" : "idle"}
          t={t}
        />
      </div>
      {saveForm && (
        <Modal
          title={t("儲存 Pipeline", "Save pipeline")}
          close={() => setSaveForm(undefined)}
          footer={
            <>
              <button onClick={() => setSaveForm(undefined)}>
                {t("取消", "Cancel")}
              </button>
              <button className="primary" onClick={() => void savePipeline()}>
                {t("儲存", "Save")}
              </button>
            </>
          }
        >
          <Field label={t("名稱", "Name")}>
            <input
              autoFocus
              name="saved-pipeline-name"
              maxLength={160}
              value={saveForm.name}
              onChange={(event) =>
                setSaveForm({ ...saveForm, name: event.target.value })
              }
            />
          </Field>
          <Field label={t("群組", "Group")}>
            <input
              maxLength={160}
              value={saveForm.group}
              onChange={(event) =>
                setSaveForm({ ...saveForm, group: event.target.value })
              }
            />
          </Field>
          <Field label={t("說明", "Description")}>
            <input
              maxLength={2000}
              value={saveForm.description}
              onChange={(event) =>
                setSaveForm({ ...saveForm, description: event.target.value })
              }
            />
          </Field>
          {saveError && <p role="alert">{saveError}</p>}
        </Modal>
      )}
      {confirmDelete && selectedSaved && (
        <Modal
          title={t("刪除已儲存 Pipeline", "Delete saved pipeline")}
          close={() => setConfirmDelete(false)}
          footer={
            <>
              <button onClick={() => setConfirmDelete(false)}>
                {t("取消", "Cancel")}
              </button>
              <button onClick={() => void deletePipeline()}>
                {t("刪除", "Delete")}
              </button>
            </>
          }
        >
          <p>{selectedSaved.name}</p>
        </Modal>
      )}
    </div>
  );
}
