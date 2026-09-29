import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  LoaderCircle,
  Send,
  Shield,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type { AiConnectionSettings, AssistantOutput } from "../shared/ai";
import {
  isAiEndpointRemote,
  redactAggregationStage,
  redactQueryValues,
  summarizeExplainForAI,
  type AiProvider,
} from "../shared/ai";
import { api, message, useUi } from "./ui";
import { AI_SETTINGS_CHANGED, type PreferenceSection } from "./preferences";

type ProviderRecord = AiProvider & {
  hasApiKey: boolean;
  persistentApiKey: boolean;
};
type FieldHint = { path: string; types: string[] };
type QueryDraft = {
  filter: Record<string, unknown>;
  sort: Record<string, unknown>;
  projection: Record<string, unknown>;
};
type Entry =
  | { role: "user"; content: string }
  | { role: "assistant"; output: AssistantOutput };

function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function parseEditorJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function outputText(output: AssistantOutput) {
  return JSON.stringify(output);
}

export function AIAssistantPanel({
  connectionId,
  database,
  collection,
  task,
  draftMode,
  language,
  profileProvider,
  collectionNames,
  fieldHints,
  currentQuery,
  aggregationStages,
  explainPlan,
  onApplyFind,
  onApplyAggregation,
  embedded = false,
  onClose,
  onOpenPreferences,
}: {
  connectionId: string;
  database: string;
  collection: string;
  task: "query" | "explain";
  draftMode?: "find" | "aggregation";
  language: "zh" | "en";
  profileProvider: "mongodb" | "cosmos";
  collectionNames: string[];
  fieldHints: FieldHint[];
  currentQuery?: { filter: string; sort: string; projection: string };
  aggregationStages?: { text: string; enabled: boolean }[];
  explainPlan?: string;
  onApplyFind?(query: QueryDraft): void;
  onApplyAggregation?(stages: Record<string, unknown>[]): void;
  embedded?: boolean;
  onClose(): void;
  onOpenPreferences(section?: PreferenceSection): void;
}) {
  const { t } = useUi();
  const [providers, setProviders] = useState<ProviderRecord[]>([]);
  const [settings, setSettings] = useState<any>();
  const [connectionSettings, setConnectionSettings] =
    useState<AiConnectionSettings>();
  const [providerSelection, setProviderSelection] = useState("");
  const [lookupCollection, setLookupCollection] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const activeRequest = useRef("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const load = async () => {
    const [savedProviders, savedSettings, connection] = await Promise.all([
      api.request("ai.providers.list", {}),
      api.request("settings.get", {}),
      api.request("ai.connections.get", { connectionId }),
    ]);
    setProviders(savedProviders as ProviderRecord[]);
    setSettings(savedSettings);
    setConnectionSettings(connection as AiConnectionSettings);
    setProviderSelection((connection as AiConnectionSettings).providerId || "");
  };

  useEffect(() => {
    setEntries([]);
    setError("");
    setLookupCollection("");
    void load().catch((cause) => setError(message(cause)));
    const focus = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(focus);
  }, [connectionId, database, collection]);

  useEffect(() => {
    const refresh = () =>
      void load().catch((cause) => setError(message(cause)));
    window.addEventListener(AI_SETTINGS_CHANGED, refresh);
    return () => window.removeEventListener(AI_SETTINGS_CHANGED, refresh);
  }, [connectionId]);

  useEffect(() => {
    if (embedded) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    const panel = panelRef.current;
    const focusableSelector =
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const focusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>(focusableSelector) || []);
    const focusInitial = () => {
      const question = panel?.querySelector<HTMLElement>("textarea");
      (question || focusables()[0] || panel)?.focus();
    };
    const timer = window.setTimeout(focusInitial, 0);
    const trapFocus = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        panel?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !panel?.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapFocus, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", trapFocus, true);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [embedded]);

  const effectiveProviderId =
    providerSelection || settings?.aiDefaultProviderId || "";
  const provider = providers.find((item) => item.id === effectiveProviderId);
  const remote = provider ? isAiEndpointRemote(provider.baseUrl) : false;
  const currentContext = useMemo(() => {
    if (task === "explain") {
      let plan: unknown;
      try {
        plan = explainPlan ? JSON.parse(explainPlan) : undefined;
      } catch {
        plan = undefined;
      }
      return {
        query: currentQuery
          ? {
              filter: redactQueryValues(currentQuery.filter),
              sort: redactQueryValues(currentQuery.sort, "sort"),
              projection: redactQueryValues(
                currentQuery.projection,
                "projection",
              ),
            }
          : undefined,
        explain: plan ? summarizeExplainForAI(plan) : undefined,
      };
    }
    return {
      fields: fieldHints.slice(0, 120),
      query: currentQuery
        ? {
            filter: redactQueryValues(currentQuery.filter),
            sort: redactQueryValues(currentQuery.sort, "sort"),
            projection: redactQueryValues(
              currentQuery.projection,
              "projection",
            ),
          }
        : undefined,
      pipeline: aggregationStages?.map((stage) =>
        stage.enabled ? redactAggregationStage(stage.text) : "<disabled stage>",
      ),
      lookupCollection: lookupCollection || undefined,
      schemaSampling:
        fieldHints.length === 0
          ? t(
              "送出時會在本機取樣最多 100 筆，只傳欄位與型別。",
              "Up to 100 documents will be sampled locally on send; only field paths and types are sent.",
            )
          : undefined,
    };
  }, [
    task,
    explainPlan,
    currentQuery,
    fieldHints,
    aggregationStages,
    lookupCollection,
    t,
  ]);

  const saveConnection = async (enabled: boolean, selected: string) => {
    const connection = (await api.request("ai.connections.set", {
      connectionId,
      enabled,
      ...(selected && selected !== settings?.aiDefaultProviderId
        ? { providerId: selected }
        : {}),
    })) as AiConnectionSettings;
    setConnectionSettings(connection);
  };

  const cancel = async () => {
    const requestId = activeRequest.current;
    if (!requestId) return;
    await api.request("ai.assistant.cancel", { requestId }).catch(() => {});
  };

  const send = async () => {
    const prompt = question.trim();
    if (!prompt || busy || !provider || !connectionSettings?.enabled) return;
    const requestId = crypto.randomUUID();
    const prior = entries.map((entry) =>
      entry.role === "user"
        ? { role: "user" as const, content: entry.content }
        : { role: "assistant" as const, content: outputText(entry.output) },
    );
    activeRequest.current = requestId;
    setBusy(true);
    setError("");
    setQuestion("");
    setEntries((old) => [...old, { role: "user", content: prompt }]);
    try {
      const output = (await api.request("ai.assistant.start", {
        requestId,
        connectionId,
        database,
        collection,
        task,
        ...(draftMode ? { draftMode } : {}),
        language,
        question: prompt,
        ...(currentQuery ? { currentQuery } : {}),
        ...(aggregationStages ? { aggregationStages } : {}),
        ...(explainPlan ? { explainPlan } : {}),
        priorMessages: prior,
        fieldHints: fieldHints.slice(0, 120),
        ...(lookupCollection ? { lookupCollection } : {}),
      })) as AssistantOutput;
      setEntries((old) => [...old, { role: "assistant", output }]);
    } catch (cause) {
      setError(message(cause));
    } finally {
      if (activeRequest.current === requestId) activeRequest.current = "";
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const enable = async () => {
    if (!effectiveProviderId) {
      setError(
        t(
          "請先在偏好設定新增模型服務。",
          "Add a model service in Preferences first.",
        ),
      );
      return;
    }
    setError("");
    try {
      await saveConnection(true, providerSelection);
    } catch (cause) {
      setError(message(cause));
    }
  };

  const applyOutput = (output: AssistantOutput) => {
    if (output.kind !== "draft") return;
    if (output.mode === "find" && onApplyFind) onApplyFind(output.query);
    if (output.mode === "aggregation" && onApplyAggregation)
      onApplyAggregation(output.stages);
  };

  return (
    <div
      className={`ai-assistant-layer${embedded ? " embedded" : ""}`}
      role="presentation"
      onKeyDown={(event) => {
        if (embedded && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onMouseDown={(event) => {
        if (!embedded && event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        className="ai-assistant-panel"
        role={embedded ? "complementary" : "dialog"}
        aria-modal={embedded ? undefined : true}
        aria-label={t("AI 助理", "AI assistant")}
        tabIndex={-1}
        data-ai-focus-trap={!embedded ? "true" : undefined}
      >
        <header className="ai-assistant-head">
          <div className="ai-assistant-title">
            <span className="ai-assistant-mark">
              <Sparkles size={16} />
            </span>
            <div>
              <strong>{t("Irwin 助理", "Irwin assistant")}</strong>
              <small>
                {database}.{collection}
              </small>
            </div>
          </div>
          <div className="ai-assistant-head-actions">
            {connectionSettings?.enabled && (
              <button
                type="button"
                onClick={() => void saveConnection(false, providerSelection)}
                title={t("停用此連線的 AI", "Disable AI for this connection")}
              >
                <Shield size={14} /> {t("已啟用", "On")}
              </button>
            )}
            <button
              className="icon"
              type="button"
              aria-label={t("關閉", "Close")}
              onClick={onClose}
            >
              <X size={17} />
            </button>
          </div>
        </header>

        <div className="ai-assistant-setup">
          <label>
            <span>{t("模型服務", "Model service")}</span>
            <select
              value={providerSelection}
              onChange={(event) => {
                setProviderSelection(event.target.value);
                if (connectionSettings?.enabled)
                  void saveConnection(true, event.target.value).catch((cause) =>
                    setError(message(cause)),
                  );
              }}
            >
              <option value="">{t("使用預設模型", "Use default model")}</option>
              {providers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.model}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ai-manage-link"
            onClick={() => onOpenPreferences("ai")}
          >
            {providers.length
              ? t("管理模型", "Manage models")
              : t("設定模型", "Set up a model")}
          </button>
        </div>

        {!connectionSettings?.enabled ? (
          <div className="ai-assistant-disabled">
            <div className="ai-empty-mark">
              <Sparkles size={20} />
            </div>
            <h3>{t("此資料庫尚未啟用 AI", "AI is off for this database")}</h3>
            <p>
              {t(
                "每個資料庫都要分別啟用。你可以隨時停用。",
                "Enable AI for each database connection. You can turn it off at any time.",
              )}
            </p>
            <button
              className="primary"
              type="button"
              disabled={!providers.length}
              onClick={() => void enable()}
            >
              {t("為此連線啟用", "Enable for this connection")}
            </button>
          </div>
        ) : !provider ? (
          <div className="ai-assistant-disabled">
            <h3>{t("選擇模型服務", "Choose a model service")}</h3>
            <p>
              {t(
                "請設定全域預設模型，或在上方選擇此連線的模型。",
                "Set a global default or choose a model for this connection above.",
              )}
            </p>
            <button type="button" onClick={() => onOpenPreferences("ai")}>
              {t("開啟偏好設定", "Open Preferences")}
            </button>
          </div>
        ) : remote && !settings?.aiCloudConsent ? (
          <div className="ai-assistant-disabled">
            <h3>
              {t(
                "尚未允許傳送到遠端模型服務",
                "Remote model data transfer is not enabled",
              )}
            </h3>
            <p>
              {t(
                "偏好設定會說明送出的內容。localhost 模型不需要這項設定。",
                "Preferences explains what is sent. Localhost models do not need this setting.",
              )}
            </p>
            <button type="button" onClick={() => onOpenPreferences("ai")}>
              {t("開啟 AI 隱私設定", "Open AI privacy settings")}
            </button>
          </div>
        ) : (
          <>
            <div className="ai-context-disclosure">
              <button
                type="button"
                onClick={() => setContextOpen((open) => !open)}
                aria-expanded={contextOpen}
              >
                <Shield size={13} />
                {t(
                  "查看本次提供給模型的脈絡",
                  "Review context sent to the model",
                )}
                <ChevronDown size={14} />
              </button>
              {contextOpen && (
                <div className="ai-context-preview">
                  <p>
                    {t(
                      "不包含文件樣本；既有查詢常值已遮蔽。你的提問會原文送出。",
                      "No document samples. Existing query values are masked. Your prompt is sent as written.",
                    )}
                  </p>
                  <pre>{json(currentContext)}</pre>
                </div>
              )}
            </div>

            {task === "query" &&
              draftMode === "aggregation" &&
              profileProvider === "mongodb" &&
              collectionNames.length > 1 && (
                <label className="ai-lookup-select">
                  <span>
                    {t(
                      "允許 $lookup 到（選填）",
                      "Allow $lookup to (optional)",
                    )}
                  </span>
                  <select
                    value={lookupCollection}
                    onChange={(event) =>
                      setLookupCollection(event.target.value)
                    }
                  >
                    <option value="">
                      {t("僅使用目前集合", "Current collection only")}
                    </option>
                    {collectionNames
                      .filter((name) => name !== collection)
                      .map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                  </select>
                </label>
              )}

            <div className="ai-conversation" role="log" aria-live="polite">
              {entries.length === 0 && (
                <div className="ai-conversation-empty">
                  <h3>
                    {task === "explain"
                      ? t("一起讀懂這份計畫", "Read this plan together")
                      : t(
                          "用口語描述你要查什麼",
                          "Describe what you want to query",
                        )}
                  </h3>
                  <p>
                    {task === "explain"
                      ? t(
                          "助理只會使用這次已執行的 Explain 指標，不會重跑查詢。",
                          "The assistant uses the existing Explain result and will not rerun the query.",
                        )
                      : t(
                          "查詢會先成為草稿。檢查欄位與條件後，再套用到編輯器。",
                          "The assistant creates a draft. Review its fields and conditions before applying it.",
                        )}
                  </p>
                </div>
              )}
              {entries.map((entry, index) => (
                <article key={index} className={`ai-message ${entry.role}`}>
                  {entry.role === "user" ? (
                    <p>{entry.content}</p>
                  ) : (
                    <AssistantCard
                      output={entry.output}
                      currentQuery={currentQuery}
                      currentPipeline={aggregationStages}
                      onApply={() => applyOutput(entry.output)}
                      canApply={
                        entry.output.kind === "draft" &&
                        (entry.output.mode === "find"
                          ? !!onApplyFind
                          : !!onApplyAggregation)
                      }
                      t={t}
                    />
                  )}
                </article>
              ))}
              {busy && (
                <div className="ai-thinking" role="status">
                  <LoaderCircle size={15} />{" "}
                  {t(
                    "正在整理脈絡並詢問模型…",
                    "Preparing context and asking the model…",
                  )}
                </div>
              )}
              {error && (
                <div className="error notice" role="alert">
                  {error}
                </div>
              )}
            </div>

            <form
              className="ai-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <textarea
                ref={inputRef}
                name="ai-assistant-prompt"
                aria-label={
                  task === "explain"
                    ? t("詢問 Explain 計畫", "Ask about this Explain plan")
                    : t("描述查詢需求", "Describe your query")
                }
                autoComplete="off"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    (event.ctrlKey || event.metaKey) &&
                    event.key === "Enter"
                  ) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder={
                  task === "explain"
                    ? t(
                        "例如：為什麼掃描的文件比回傳多？",
                        "For example: Why were more documents scanned than returned?",
                      )
                    : t(
                        "例如：列出上個月已付款的訂單，依金額由高到低",
                        "For example: Show paid orders from last month, highest amount first",
                      )
                }
                rows={3}
                maxLength={4000}
                disabled={busy}
              />
              <div className="ai-composer-footer">
                <small>
                  {t("Ctrl／⌘ + Enter 送出", "Ctrl / ⌘ + Enter to send")}
                </small>
                {busy ? (
                  <button
                    type="button"
                    className="icon"
                    onClick={() => void cancel()}
                    aria-label={t("取消請求", "Cancel request")}
                  >
                    <Square size={15} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="primary icon"
                    disabled={!question.trim()}
                    aria-label={t("送出", "Send")}
                  >
                    <Send size={15} />
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </aside>
    </div>
  );
}

function AssistantCard({
  output,
  currentQuery,
  currentPipeline,
  onApply,
  canApply,
  t,
}: {
  output: AssistantOutput;
  currentQuery?: { filter: string; sort: string; projection: string };
  currentPipeline?: { text: string; enabled: boolean }[];
  onApply(): void;
  canApply: boolean;
  t: (zh: string, en: string) => string;
}) {
  if (output.kind === "clarification")
    return (
      <div className="ai-answer">
        <strong>{t("先確認一下", "One clarification")}</strong>
        <p>{output.question}</p>
      </div>
    );
  if (output.kind === "explanation")
    return (
      <div className="ai-answer">
        <p>{output.summary}</p>
        {output.findings.length > 0 && (
          <ul>
            {output.findings.map((item, index) => (
              <li key={index}>
                {item.text}
                {item.metric && (
                  <small className="ai-evidence">
                    {item.metric}: {item.value}
                    {item.stage ? ` · ${item.stage}` : ""}
                  </small>
                )}
              </li>
            ))}
          </ul>
        )}
        {output.suggestions.length > 0 && (
          <div className="ai-suggestions">
            <strong>{t("可檢查的方向", "Things to investigate")}</strong>
            {output.suggestions.map((item, index) => (
              <p key={index}>
                {item.text}
                {(item.metric || item.stage) && (
                  <small className="ai-evidence">
                    {item.metric ? `${item.metric}: ${item.value}` : item.stage}
                  </small>
                )}
                <small>
                  {item.needsValidation
                    ? t("需再用 Explain 驗證", "Verify with Explain")
                    : ""}
                </small>
              </p>
            ))}
          </div>
        )}
      </div>
    );
  const draftBody = output.mode === "find" ? output.query : output.stages;
  return (
    <div className="ai-answer ai-draft-card">
      <p>{output.summary}</p>
      {output.fieldsUsed.length > 0 && (
        <div className="ai-field-chips">
          {output.fieldsUsed.map((field) => (
            <code key={field}>{field}</code>
          ))}
        </div>
      )}
      {output.assumptions.length > 0 && (
        <div className="ai-assumptions">
          <strong>{t("假設", "Assumptions")}</strong>
          <ul>
            {output.assumptions.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      <details className="ai-draft-details">
        <summary>
          {t("查看草稿與目前查詢", "Compare draft with current query")}
        </summary>
        {currentQuery && output.mode === "find" && (
          <div className="ai-compare-grid">
            <div>
              <small>{t("目前查詢", "Current query")}</small>
              <pre>
                {json({
                  filter: parseEditorJson(currentQuery.filter),
                  sort: parseEditorJson(currentQuery.sort),
                  projection: parseEditorJson(currentQuery.projection),
                })}
              </pre>
            </div>
            <div>
              <small>{t("新查詢草稿", "New query draft")}</small>
              <pre>{json(output.query)}</pre>
            </div>
          </div>
        )}
        {output.mode === "aggregation" && (
          <div className="ai-compare-grid">
            <div>
              <small>{t("目前 Pipeline", "Current pipeline")}</small>
              <pre>
                {json(
                  (currentPipeline || []).map((stage) => ({
                    enabled: stage.enabled,
                    stage: parseEditorJson(stage.text),
                  })),
                )}
              </pre>
            </div>
            <div>
              <small>{t("新 Pipeline 草稿", "New pipeline draft")}</small>
              <pre>{json(output.stages)}</pre>
            </div>
          </div>
        )}
      </details>
      {canApply && (
        <button type="button" className="primary ai-apply" onClick={onApply}>
          {t("套用到編輯器", "Apply to editor")}
        </button>
      )}
    </div>
  );
}
