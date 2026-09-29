import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Play,
  Square,
  Plus,
  FileJson,
  Table2,
  ListTree,
  Terminal,
  Trash2,
  Bookmark,
  FolderOpen,
  Hash,
  Braces,
  Layers,
  Pencil,
  Search,
  Download,
  FileSpreadsheet,
  Copy,
  ChevronDown,
  ChevronUp,
  Columns3,
  Columns2,
  Rows2,
  Maximize2,
  Minimize2,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import type { editor } from "monaco-editor";
import type {
  Row,
  QueryInput as MongoQueryInput,
  TransferInput,
  Page,
  Profile,
  ShellDraft,
} from "../shared/contracts";
import { CodeEditor } from "./Editor";
import { QueryInput } from "./QueryInput";
import {
  hasQuerySort,
  queryKeyIntent,
  querySortDirections,
} from "./query-editing";
import { ExplainDialog } from "./AnalysisDialog";
import { buildCellFilter, fieldCatalog } from "../shared/exploration";
import { validPath } from "../shared/bson";
import type { TabState, TableLayout } from "../shared/workspace";
import { Results, prettyDocument } from "./Results";
import { formatDocument, shellJsonLanguage } from "./json-format";
import { Modal, Field, useUi, api, message } from "./ui";
import { csvContent, excelContent, shellSessionId } from "./helpers";
import { allMatchingTransfer } from "./query-export";
import { documentChanges } from "./document-diff";
import { queryStateAfterInputChange, type QueryState } from "./query-state";
import { initialQueryLayout, queryOptionIndicators } from "./query-layout";
import type { SavedQuery } from "../shared/saved-query";
import { SavedQueryDialog } from "./SavedQueries";
import { AIAssistantPanel } from "./AIAssistantPanel";
import type { PreferenceSection } from "./preferences";
export interface WorkspaceTab {
  id: string;
  connectionId: string;
  connectionName: string;
  database: string;
  collection: string;
  kind: "collection" | "shell" | "aggregation";
  initialCode?: string;
  draftId?: string;
  showIndexes?: string;
  state?: TabState;
  requestedFilter?: { value: string; id: string };
  requestedQuery?: { value: SavedQuery; id: string };
}
export type ShellDraftChange = {
  dirty: boolean;
  draft?: ShellDraft;
  discard?: boolean;
};
type IndexSettings = {
  keys: string;
  name: string;
  unique: boolean;
  expireAfterSeconds?: number;
};
export default function CollectionTab({
  tab,
  active,
  transfer,
  notify,
  openIndexes,
  profile,
  onShellDraftChange,
  onStateChange,
  onOpenSavedQueries,
  onQuerySaved,
  onOpenPreferences,
  collectionNames = [],
}: {
  tab: WorkspaceTab;
  active: boolean;
  transfer(
    p: Partial<TransferInput> & { connectionId: string; database: string },
  ): void;
  notify(text: string, error?: boolean): void;
  openIndexes?: string;
  profile?: Profile;
  onShellDraftChange?(tabId: string, change: ShellDraftChange): void;
  onStateChange?(tabId: string, state: TabState): void;
  onOpenSavedQueries?(): void;
  onQuerySaved?(): void;
  onOpenPreferences?(section?: PreferenceSection): void;
  collectionNames?: string[];
}) {
  const { t, theme, language, tabWidth, autoRunOnOpen, jsonExpandedDepth } =
    useUi();
  const readOnly = profile?.readOnly ?? false;
  const [rows, setRows] = useState<Row[]>([]);
  const [view, setView] = useState(tab.state?.view || "table");
  const [showColumns, setShowColumns] = useState(false);
  const [busy, setBusy] = useState(false);
  const [queryState, setQueryState] = useState<QueryState>("idle");
  const [savingQuery, setSavingQuery] = useState<SavedQuery>();
  const [hasMore, setHasMore] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const [outputHeight, setOutputHeight] = useState(
    tab.state?.outputHeight || 170,
  );
  const [outputCollapsed, setOutputCollapsed] = useState(
    tab.state?.outputCollapsed || false,
  );
  const [queryOptionsExpanded, setQueryOptionsExpanded] = useState(
    () => initialQueryLayout(tab.state).queryOptionsExpanded,
  );
  const [resultFocus, setResultFocus] = useState(
    () => initialQueryLayout(tab.state).resultFocus,
  );
  const [resultLayout, setResultLayout] = useState<
    NonNullable<TabState["resultLayout"]>
  >(tab.state?.resultLayout || "vertical");
  const [hasSelection, setHasSelection] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [selected, setSelected] = useState(-1);
  const [filter, setFilter] = useState(tab.state?.filter || "{}");
  const [sort, setSort] = useState(tab.state?.sort || "{}");
  const [projection, setProjection] = useState(tab.state?.projection || "{}");
  const [queryWidths, setQueryWidths] = useState(
    tab.state?.queryWidths || [2, 1, 1],
  );
  const queryBar = useRef<HTMLDivElement>(null);
  const queryResizeCleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => queryResizeCleanup.current?.(), []);
  const sortDirections = useMemo(() => querySortDirections(sort), [sort]);
  const resizeQuery = (index: number, delta: number, original?: number[]) => {
    const widths =
      original ||
      [
        ...(queryBar.current?.querySelectorAll<HTMLElement>(".query-field") ||
          []),
      ].map((field) => field.getBoundingClientRect().width);
    if (widths.length !== 3) return;
    const total = widths[index] + widths[index + 1];
    const next = Math.max(120, Math.min(total - 120, widths[index] + delta));
    setQueryWidths(
      widths.map((width, i) =>
        i === index ? next : i === index + 1 ? total - next : width,
      ),
    );
  };
  const startQueryResize = (index: number, event: ReactPointerEvent) => {
    event.preventDefault();
    queryResizeCleanup.current?.();
    const start = event.clientX;
    const widths = [
      ...queryBar.current!.querySelectorAll<HTMLElement>(".query-field"),
    ].map((field) => field.getBoundingClientRect().width);
    const move = (e: globalThis.PointerEvent) =>
      resizeQuery(index, e.clientX - start, widths);
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
    };
    queryResizeCleanup.current = end;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
  };
  const [batchSize, setBatch] = useState(tab.state?.batchSize || 100);
  const [pageIndex, setPageIndex] = useState(0);
  const [count, setCount] = useState<number>();
  const [counting, setCounting] = useState(false);
  const defaultCode = `// ${tab.database}\ndb.getCollection(${JSON.stringify(tab.collection || "collection")}).find()`;
  const [code, setCode] = useState(
    tab.state?.code || tab.initialCode || defaultCode,
  );
  const [showExplain, setShowExplain] = useState(false);
  const [showAiAssistant, setShowAiAssistant] = useState(false);
  const [layout, setLayout] = useState<TableLayout | undefined>(
    tab.state?.layout,
  );
  const [layoutReady, setLayoutReady] = useState(!!tab.state?.layout);
  const layoutKey = JSON.stringify([
    tab.connectionId,
    tab.database,
    tab.collection,
  ]);
  const completionFields = useMemo(
    () => fieldCatalog(rows.slice(0, 100).map((row) => JSON.parse(row.ejson))),
    [rows],
  );
  const completions = {
    fields: completionFields,
    collections: collectionNames,
  };
  const onLayoutChange = useCallback((value: TableLayout) => {
    setLayout((old) =>
      JSON.stringify(old) === JSON.stringify(value) ? old : value,
    );
  }, []);
  useEffect(() => {
    let live = true;
    if (layoutReady) return;
    void api
      .request("tableLayouts.get", { key: layoutKey })
      .then((value) => {
        if (live) {
          setLayout(value || undefined);
          setLayoutReady(true);
        }
      })
      .catch((e) => {
        if (live) {
          notify(message(e), true);
          setLayoutReady(true);
        }
      });
    return () => {
      live = false;
    };
  }, [layoutKey]);
  useEffect(() => {
    if (!layout || !layoutReady) return;
    const timer = setTimeout(
      () =>
        void api
          .request("tableLayouts.save", { key: layoutKey, layout })
          .catch((e) => notify(message(e), true)),
      250,
    );
    return () => clearTimeout(timer);
  }, [layout, layoutKey, layoutReady]);
  useEffect(() => {
    if (tab.requestedFilter) setFilter(tab.requestedFilter.value);
  }, [tab.requestedFilter]);
  const editorRef = useRef<editor.IStandaloneCodeEditor>(null);
  const runRef = useRef<() => void>(() => {});
  const cursor = useRef("");
  const pageIndexRef = useRef(0);
  const sessionReady = useRef(false);
  const generation = useRef(0);
  const draftBaseline = useRef(tab.initialCode || defaultCode);
  const draftRevision = useRef(0);
  const [exportFormat, setExportFormat] = useState<"csv" | "excel">();
  const [docEditor, setDocEditor] = useState<{
    title: string;
    value: string;
    originalValue: string;
    submit: (value: string) => Promise<any>;
    readOnly?: boolean;
  }>();
  const [docError, setDocError] = useState("");
  const [docBusy, setDocBusy] = useState(false);
  const [discardDocEditor, setDiscardDocEditor] = useState(false);
  const [showDocChanges, setShowDocChanges] = useState(false);
  const [conflictServerDocument, setConflictServerDocument] =
    useState<string>();
  const [indexes, setIndexes] = useState<string>();
  const [indexKeys, setIndexKeys] = useState('{"field":1}');
  const [indexName, setIndexName] = useState("");
  const [unique, setUnique] = useState(false);
  const [ttl, setTtl] = useState("");
  const [editingIndex, setEditingIndex] = useState<string>();
  const [indexDeleteTarget, setIndexDeleteTarget] = useState<{
    name: string;
    keys: string;
  }>();
  const [indexDeleting, setIndexDeleting] = useState(false);
  const [indexRebuildTarget, setIndexRebuildTarget] = useState<
    IndexSettings & { oldName: string; oldKeys: string }
  >();
  const [indexRebuilding, setIndexRebuilding] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [freeMode, setFreeMode] = useState(
    tab.state?.freeMode ?? tab.kind === "shell",
  );
  useEffect(() => setHasSelection(false), [freeMode, tab.id]);
  const appliedQuery = useRef("");
  useEffect(() => {
    if (
      !tab.requestedQuery ||
      busy ||
      appliedQuery.current === tab.requestedQuery.id
    )
      return;
    appliedQuery.current = tab.requestedQuery.id;
    const value = tab.requestedQuery.value.query;
    // Reusing a query never changes the tab's connection/namespace or runs it.
    setFilter(value.filter);
    setSort(value.sort);
    setProjection(value.projection);
    setBatch(value.batchSize);
    setCode(
      value.mode === "shell"
        ? value.code
        : `db.getCollection(${JSON.stringify(tab.collection)}).find(${value.filter || "{}"}, ${value.projection || "{}"}).sort(${value.sort || "{}"})`,
    );
    setFreeMode(value.mode === "shell");
    setQueryState("stale");
  }, [tab.requestedQuery, busy]);
  useEffect(() => {
    onStateChange?.(tab.id, {
      filter,
      sort,
      projection,
      queryWidths,
      queryOptionsExpanded,
      resultFocus,
      resultLayout,
      batchSize,
      view: view as TabState["view"],
      code,
      freeMode,
      outputHeight,
      outputCollapsed,
      layout,
    });
  }, [
    tab.id,
    filter,
    sort,
    projection,
    queryWidths,
    queryOptionsExpanded,
    resultFocus,
    resultLayout,
    batchSize,
    view,
    code,
    freeMode,
    outputHeight,
    outputCollapsed,
    layout,
    onStateChange,
  ]);
  const [didAutoRun, setDidAutoRun] = useState(false);
  const shellId = shellSessionId(tab);
  const draftId = tab.kind === "shell" ? tab.draftId : undefined;
  const target = {
    connectionId: tab.connectionId,
    database: tab.database,
    collection: tab.collection,
  };
  const query: MongoQueryInput = {
    ...target,
    filter,
    sort,
    projection,
    skip: 0,
    batchSize,
    maxTimeMS: profile?.queryTimeoutMS ?? 30000,
  };
  useEffect(() => {
    setCount(undefined);
    setPageIndex(0);
    pageIndexRef.current = 0;
    setQueryState((state) => queryStateAfterInputChange(state));
  }, [filter, sort, projection, batchSize]);
  useEffect(() => {
    if (!draftId) return;
    const dirty = code !== draftBaseline.current;
    const draft: ShellDraft = {
      id: draftId,
      connectionId: tab.connectionId,
      database: tab.database,
      collection: tab.collection,
      code,
      updatedAt: new Date().toISOString(),
    };
    onShellDraftChange?.(tab.id, { dirty, ...(dirty ? { draft } : {}) });
    const revision = ++draftRevision.current;
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      if (revision !== draftRevision.current) return;
      void api.request("shellDrafts.save", draft);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    code,
    draftId,
    onShellDraftChange,
    tab.collection,
    tab.connectionId,
    tab.database,
    tab.id,
  ]);
  useEffect(
    () => () => onShellDraftChange?.(tab.id, { dirty: false }),
    [onShellDraftChange, tab.id],
  );
  useEffect(
    () => () => {
      generation.current++;
      if (cursor.current)
        void api
          .request("queries.cancel", { cursorId: cursor.current })
          .catch(() => {});
      if (tab.kind === "shell" || freeMode)
        void api
          .request("shellSessions.close", { sessionId: shellId })
          .catch(() => {});
      sessionReady.current = false;
    },
    [freeMode, shellId, tab.id],
  );
  useEffect(
    () =>
      api.subscribe((event) => {
        if (
          event.type === "connection" &&
          (event.data.allClosed ||
            (event.data.id === tab.connectionId && !event.data.connected))
        ) {
          generation.current++;
          sessionReady.current = false;
          cursor.current = "";
          setBusy(false);
          setHasMore(false);
          setRows((old) =>
            old.map((row) => ({
              ...row,
              editable: false,
              reason: "Connection changed. Run the query again before editing.",
            })),
          );
        }
      }),
    [tab.connectionId],
  );
  const result = (incoming: Row[], append: boolean) => {
    setSelected(-1);
    setRows((old) => {
      const all = append ? [...old, ...incoming] : incoming;
      let bytes = 0;
      const kept: Row[] = [];
      for (let i = all.length - 1; i >= 0 && kept.length < 1000; i--) {
        if (bytes > 24 * 1024 * 1024) break;
        bytes += all[i].ejson.length * 2;
        kept.push(all[i]);
      }
      return kept.reverse();
    });
  };
  const readOnlyMessage = t(
    `${profile?.environment === "production" ? "正式" : "此"}連線已設為唯讀，無法執行寫入操作。`,
    `This ${profile?.environment || ""} connection is read-only; write operations are disabled.`,
  );
  const ensureWritable = () => {
    if (!readOnly) return true;
    notify(readOnlyMessage, true);
    return false;
  };
  const run = async (
    next = false,
    override: Partial<MongoQueryInput> = {},
    selectedOnly = false,
  ) => {
    if (busy) return;
    const selection = selectedOnly ? editorRef.current?.getSelection() : null;
    const selectedText = selection
      ? editorRef.current?.getModel()?.getValueInRange(selection) || ""
      : "";
    if (selectedOnly && !selectedText.trim()) return;
    setBusy(true);
    const g = ++generation.current;
    const started = performance.now();
    const activeQuery = { ...query, ...override };
    try {
      if (tab.kind === "shell" || freeMode) {
        if (!sessionReady.current) {
          await api.request("shellSessions.open", {
            sessionId: shellId,
            connectionId: tab.connectionId,
            database: tab.database,
          });
          if (g !== generation.current) {
            await api.request("shellSessions.close", { sessionId: shellId });
            sessionReady.current = false;
            return;
          }
          sessionReady.current = true;
        }
        const script = selectedOnly ? selectedText : code;
        const res = next
          ? await api.request("shellSessions.next", { sessionId: shellId })
          : await api.request("shellSessions.execute", {
              sessionId: shellId,
              code: script,
            });
        if (g !== generation.current) return;
        result(res.rows, next);
        setOutput(res.output);
        setHasMore(res.hasMore);
        if (!next) {
          await api.request("history.save", { ...target, code: script });
          if (draftId && !selectedOnly) {
            draftBaseline.current = code;
            draftRevision.current++;
            onShellDraftChange?.(tab.id, { dirty: false, discard: true });
            void api.request("shellDrafts.delete", { id: draftId });
          }
        }
      } else {
        const requestedPage = next
          ? pageIndexRef.current + 1
          : Math.floor((activeQuery.skip ?? 0) / activeQuery.batchSize);
        if (cursor.current)
          await api
            .request("queries.cancel", { cursorId: cursor.current })
            .catch(() => {});
        cursor.current = crypto.randomUUID();
        const res: Page = await api.request("queries.run", {
          ...activeQuery,
          skip: requestedPage * activeQuery.batchSize,
          cursorId: cursor.current,
        });
        if (g !== generation.current) {
          void api.request("queries.cancel", { cursorId: res.cursorId });
          return;
        }
        cursor.current = res.cursorId;
        result(res.rows, false);
        pageIndexRef.current = requestedPage;
        setPageIndex(requestedPage);
        setHasMore(res.hasMore);
        if (!next)
          await api.request("history.save", {
            ...target,
            code: `db.getCollection(${JSON.stringify(tab.collection)}).find(${activeQuery.filter}, ${activeQuery.projection}).sort(${activeQuery.sort})`,
          });
      }
      setElapsed(Math.round(performance.now() - started));
      setQueryState("success");
    } catch (e) {
      if (g === generation.current) {
        setQueryState("error");
        setOutput([message(e)]);
        notify(message(e), true);
      }
    } finally {
      if (g === generation.current) setBusy(false);
    }
  };
  runRef.current = () => {
    void run();
  };
  const runToLast = async () => {
    if (busy || tab.kind !== "collection" || freeMode) return;
    try {
      const total = Number(await api.request("queries.count", query));
      const lastPage = total > 0 ? Math.ceil(total / batchSize) - 1 : 0;
      await run(false, { skip: lastPage * batchSize });
    } catch (e) {
      notify(message(e), true);
    }
  };
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open], [aria-modal="true"]')) {
        if (
          queryKeyIntent(
            event.key,
            event.ctrlKey,
            event.shiftKey,
            event.metaKey,
          ) === "run" ||
          event.key === "F3"
        )
          event.preventDefault();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        queryKeyIntent(
          event.key,
          event.ctrlKey,
          event.shiftKey,
          event.metaKey,
        ) === "run"
      ) {
        event.preventDefault();
        const isTextInput = target?.matches(
          'input, textarea, [contenteditable="true"]',
        );
        if (isTextInput && !target?.closest('[data-query-input="true"]'))
          return;
        runRef.current();
        return;
      }
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;
      if (event.key === "F3") {
        if (
          view === "table" &&
          tab.kind === "collection" &&
          !freeMode &&
          selected >= 0 &&
          rows[selected]
        ) {
          event.preventDefault();
          inspectRow(selected);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, freeMode, rows, selected, tab.kind, view]);
  useEffect(() => {
    if (tab.kind === "collection" && autoRunOnOpen && !didAutoRun) {
      setDidAutoRun(true);
      void run();
    }
  }, [tab.id]);
  useEffect(() => {
    if (openIndexes && tab.kind === "collection") void showIndexes();
  }, [openIndexes, tab.kind]);
  const inspectRow = (row: number) => {
    setConflictServerDocument(undefined);
    const value = prettyDocument(JSON.parse(rows[row].ejson), {
      indent: tabWidth,
    });
    setDocEditor({
      title: "Document JSON",
      value,
      originalValue: value,
      readOnly: true,
      submit: async () => {},
    });
  };
  const refreshConflictDocument = async () => {
    if (!docEditor) return;
    try {
      const result = await api.request("documents.fetch", {
        ...target,
        original: docEditor.originalValue,
      });
      setConflictServerDocument(formatDocument(result.ejson, tabWidth));
    } catch (e) {
      setDocError(message(e));
    }
  };
  const applyServerDocument = () => {
    if (!docEditor || !conflictServerDocument) return;
    setDocEditor({
      ...docEditor,
      value: conflictServerDocument,
      originalValue: conflictServerDocument,
    });
    setConflictServerDocument(undefined);
    setDocError("");
  };
  const editRow = (row: number) => {
    if (!ensureWritable()) return;
    setDocError("");
    setConflictServerDocument(undefined);
    const value = formatDocument(rows[row].ejson, tabWidth);
    setDocEditor({
      title: t("編輯文件", "Edit document"),
      value,
      originalValue: value,
      submit: (value) => replaceRow(row, value),
    });
  };
  const copyRow = (row: number) => {
    if (!ensureWritable()) return;
    setConflictServerDocument(undefined);
    const source = rows[row].source;
    if (
      tab.kind !== "collection" ||
      freeMode ||
      !source ||
      source.connectionId !== tab.connectionId ||
      source.database !== tab.database ||
      source.collection !== tab.collection
    ) {
      notify(
        t(
          "此結果沒有可安全複製的文件來源",
          "This result has no safe collection source to copy.",
        ),
        true,
      );
      return;
    }
    setDocError("");
    const value = formatDocument(rows[row].ejson, tabWidth);
    setDocEditor({
      title: t("複製文件", "Copy document"),
      value,
      originalValue: value,
      submit: async (document) => {
        const result = await api.request("documents.insert", {
          ...target,
          document,
        });
        setOutput([result]);
        notify(t("文件已複製", "Document copied"));
        await run();
      },
    });
  };
  const replaceRow = async (row: number, document: string) => {
    if (readOnly) throw new Error(readOnlyMessage);
    const source = rows[row].source;
    if (
      !source ||
      source.connectionId !== tab.connectionId ||
      source.database !== tab.database ||
      source.collection !== tab.collection
    )
      throw new Error(
        "Result source changed. Run the query again before editing.",
      );
    const result = await api.request("documents.replace", {
      connectionId: source.connectionId,
      database: source.database,
      collection: source.collection,
      original: rows[row].ejson,
      document,
    });
    setRows((old) => old.map((item, index) => (index === row ? result : item)));
    notify(t("文件已儲存", "Document saved"));
  };
  const cancel = async () => {
    generation.current++;
    setBusy(false);
    setHasMore(false);
    try {
      if (tab.kind === "shell" || freeMode) {
        await api.request("shellSessions.cancel", { sessionId: shellId });
        sessionReady.current = true;
        setOutput([
          t(
            "已取消並重設 Shell 變數。已完成寫入不會撤回。",
            "Cancelled and reset Shell variables. Completed writes remain.",
          ),
        ]);
      } else if (cursor.current)
        await api.request("queries.cancel", { cursorId: cursor.current });
    } catch (e) {
      sessionReady.current = false;
      notify(message(e), true);
    }
  };
  const edit = (row: number, field: string, value: any) => {
    if (
      !rows[row].editable ||
      field === "_id" ||
      field.startsWith("_id.") ||
      !validPath(field)
    ) {
      notify(
        rows[row].reason ||
          t("此欄位無法直接編輯", "This field cannot be edited directly"),
        true,
      );
      return;
    }
    setDocError("");
    const editorValue = JSON.stringify(value ?? null, null, 2);
    setDocEditor({
      title: `${t("編輯欄位", "Edit field")} · ${field}`,
      value: editorValue,
      originalValue: editorValue,
      submit: (v) => commit(row, field, v),
    });
  };
  const commit = async (row: number, field: string, value: string) => {
    if (readOnly) throw new Error(readOnlyMessage);
    const source = rows[row].source;
    if (
      !rows[row].editable ||
      !source ||
      source.connectionId !== tab.connectionId ||
      source.database !== tab.database ||
      source.collection !== tab.collection
    )
      throw new Error(
        "Result source changed. Run the query again before editing.",
      );
    const res = await api.request("documents.update", {
      connectionId: source.connectionId,
      database: source.database,
      collection: source.collection,
      original: rows[row].ejson,
      field,
      value,
    });
    setRows((old) =>
      res.row
        ? old.map((v, i) => (i === row ? res.row : v))
        : old.filter((_, i) => i !== row),
    );
    setOutput([res.update]);
    notify(t("已儲存", "Saved"));
  };
  const add = () => {
    if (!ensureWritable()) return;
    setDocError("");
    setDocEditor({
      title: "Add Doc",
      value: "{\n  \n}",
      originalValue: "{\n  \n}",
      submit: async (document) => {
        const res = await api.request("documents.insert", {
          ...target,
          document,
        });
        setOutput([res]);
        notify(t("文件已新增", "Document added"));
        await run();
      },
    });
  };
  const showIndexes = async () => {
    try {
      setIndexes(await api.request("metadata.indexes", target));
    } catch (e) {
      notify(message(e), true);
    }
  };
  const deleteIndex = async () => {
    if (!indexDeleteTarget || indexDeleting) return;
    if (!ensureWritable()) return;
    setIndexDeleting(true);
    try {
      await api.request("metadata.dropIndex", {
        ...target,
        name: indexDeleteTarget.name,
      });
      setIndexDeleteTarget(undefined);
      await showIndexes();
      notify(t("索引已刪除", "Index deleted"));
    } catch (e) {
      notify(message(e), true);
    } finally {
      setIndexDeleting(false);
    }
  };
  const resetIndexEditor = () => {
    setEditingIndex(undefined);
    setIndexKeys('{"field":1}');
    setIndexName("");
    setUnique(false);
    setTtl("");
  };
  const createIndex = async (settings: IndexSettings) => {
    if (!ensureWritable()) return;
    try {
      await api.request("metadata.createIndex", { ...target, ...settings });
      resetIndexEditor();
      await showIndexes();
      notify(t("索引已建立", "Index created"));
    } catch (e) {
      notify(message(e), true);
    }
  };
  const rebuildIndex = async () => {
    if (!indexRebuildTarget || indexRebuilding) return;
    if (!ensureWritable()) return;
    setIndexRebuilding(true);
    try {
      await api.request("metadata.editIndex", {
        ...target,
        ...indexRebuildTarget,
      });
      setIndexRebuildTarget(undefined);
      resetIndexEditor();
      await showIndexes();
      notify(t("索引已重新建立", "Index rebuilt"));
    } catch (e) {
      notify(message(e), true);
    } finally {
      setIndexRebuilding(false);
    }
  };
  const explain = async () => {
    setShowExplain(true);
  };
  const countDocuments = async () => {
    if (tab.kind !== "collection" || freeMode || counting) return;
    setCounting(true);
    try {
      const total = await api.request("queries.count", query);
      setCount(Number(total));
    } catch (e) {
      notify(message(e), true);
    } finally {
      setCounting(false);
    }
  };
  const exportLoadedResults = async (format: "csv" | "excel") => {
    if (!rows.length) return;
    try {
      const extension = format === "csv" ? "csv" : "xlsx";
      const path = await api.request("files.choose", {
        kind: "save",
        title: t(
          format === "csv" ? "匯出查詢結果 CSV" : "匯出查詢結果 Excel",
          format === "csv"
            ? "Export query results as CSV"
            : "Export query results as Excel",
        ),
        defaultPath: `${tab.collection || "query-results"}.${extension}`,
      });
      if (!path) return;
      const content =
        format === "csv" ? csvContent(rows) : await excelContent(rows);
      await api.request("results.export", { path, format, content });
      notify(
        t(
          format === "csv" ? "查詢結果 CSV 已匯出" : "查詢結果 Excel 已匯出",
          format === "csv"
            ? "Query results exported as CSV"
            : "Query results exported as Excel",
        ),
      );
    } catch (e) {
      notify(message(e), true);
    }
  };
  const exportAllMatching = (format: "json" | "csv") => {
    transfer(allMatchingTransfer(query, format));
    setExportFormat(undefined);
  };
  const encodedNumber = (value: any) => {
    if (value && typeof value === "object")
      return value.$numberInt ?? value.$numberLong ?? value.$numberDouble ?? "";
    return value;
  };
  const resizeOutput = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOutputCollapsed(false);
    const startY = event.clientY;
    const startHeight = outputHeight;
    const move = (nextEvent: PointerEvent) => {
      const maxHeight = Math.max(260, Math.floor(window.innerHeight * 0.8));
      const nextHeight = Math.max(
        76,
        Math.min(maxHeight, startHeight + startY - nextEvent.clientY),
      );
      setOutputHeight(nextHeight);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  };
  const copyDocumentContent = async () => {
    if (!docEditor) return;
    try {
      await api.request("clipboard.write", { text: docEditor.value });
      notify(t("文件內容已複製", "Document content copied"));
    } catch (e) {
      setDocError(message(e));
    }
  };
  const requestCloseDocEditor = () => {
    if (docBusy || !docEditor) return;
    if (!docEditor.readOnly && docEditor.value !== docEditor.originalValue) {
      setDiscardDocEditor(true);
      return;
    }
    setConflictServerDocument(undefined);
    setDocEditor(undefined);
  };
  return (
    <div
      className={`collection-panel${resultFocus ? " result-focus" : ""}${resultLayout === "horizontal" ? " horizontal" : ""}`}
    >
      <div className="breadcrumb">
        <span className="connection-dot" />
        {tab.connectionName}
        <span>/</span>
        {tab.database}
        {tab.collection && (
          <>
            <span>/</span>
            <strong>{tab.collection}</strong>
          </>
        )}
        <span className="badge">
          {tab.kind === "shell" ? "MONGOSH" : "COLLECTION"}
        </span>
        {profile && (
          <span className={`environment-badge ${profile.environment}`}>
            {profile.environment.toUpperCase()}
          </span>
        )}
        {readOnly && <span className="read-only-badge">READ ONLY</span>}
      </div>
      {readOnly && (
        <div className="read-only-notice" role="status">
          {t(
            "此連線以唯讀模式開啟。標準查詢可使用；寫入、匯入與 Shell 已由應用程式封鎖。資料庫帳號仍應使用唯讀權限。",
            "This connection is read-only. Standard queries remain available; writes, imports, and Shell execution are blocked by the app. Use a database read-only role as well.",
          )}
        </div>
      )}
      <div className="query-pane">
        {!resultFocus &&
          (tab.kind === "shell" || freeMode ? (
            <div className="shell-editor">
              <CodeEditor
                completionContext={completions}
                theme={theme}
                value={code}
                onChange={setCode}
                language="javascript"
                height="220px"
                onSelectionChange={(text) => setHasSelection(!!text.trim())}
                onReady={(ed) => {
                  editorRef.current = ed;
                }}
              />
            </div>
          ) : (
            <div
              className={`query-bar${queryOptionsExpanded ? "" : " compact"}`}
              id={`query-bar-${tab.id}`}
              ref={queryBar}
              style={{
                gridTemplateColumns: queryOptionsExpanded
                  ? queryWidths
                      .map((width) => `minmax(0, ${width}fr)`)
                      .join(" ")
                  : "minmax(0, 1fr)",
              }}
            >
              <QueryInput
                label="FILTER"
                value={filter}
                onChange={setFilter}
                context={completions}
                resizeLabel={
                  queryOptionsExpanded
                    ? t("調整 FILTER 與 SORT 寬度", "Resize FILTER and SORT")
                    : undefined
                }
                resizeValue={Math.round(
                  (queryWidths[0] / (queryWidths[0] + queryWidths[1])) * 100,
                )}
                onResizeStart={
                  queryOptionsExpanded
                    ? (event) => startQueryResize(0, event)
                    : undefined
                }
                onResizeStep={
                  queryOptionsExpanded
                    ? (delta) => resizeQuery(0, delta)
                    : undefined
                }
              />
              {queryOptionsExpanded && (
                <>
                  <QueryInput
                    label="SORT"
                    value={sort}
                    onChange={setSort}
                    context={completions}
                    onClear={() => {
                      setSort("{}");
                      void run(false, { sort: "{}" });
                    }}
                    clearDisabled={busy || !hasQuerySort(sort)}
                    resizeLabel={t(
                      "調整 SORT 與 PROJECTION 寬度",
                      "Resize SORT and PROJECTION",
                    )}
                    resizeValue={Math.round(
                      (queryWidths[1] / (queryWidths[1] + queryWidths[2])) *
                        100,
                    )}
                    onResizeStart={(event) => startQueryResize(1, event)}
                    onResizeStep={(delta) => resizeQuery(1, delta)}
                  />
                  <QueryInput
                    label="PROJECTION"
                    value={projection}
                    onChange={setProjection}
                    context={completions}
                  />
                </>
              )}
            </div>
          ))}
        {!resultFocus && (
          <div className="toolbar query-actions">
            {tab.kind === "collection" && (
              <button
                className={freeMode ? "active icon" : "icon"}
                aria-label={t("自由命令", "Free command")}
                title={t("自由命令", "Free command")}
                disabled={busy || readOnly}
                onClick={() => setFreeMode(!freeMode)}
              >
                <Terminal size={14} />
              </button>
            )}
            <button
              className="primary run-query"
              aria-label={t("執行", "Run")}
              title={t("執行", "Run")}
              disabled={busy || (tab.kind === "shell" && readOnly)}
              onClick={() => void run()}
            >
              <Play size={14} />
              {t("執行", "Run")}
            </button>
            {(tab.kind === "shell" || freeMode) && (
              <button
                className="run-selection"
                aria-label={t("執行選取內容", "Run selection")}
                title={t("只執行已反白的程式碼", "Run only the selected code")}
                disabled={busy || readOnly || !hasSelection}
                onClick={() => void run(false, {}, true)}
              >
                <Play size={13} />
                {t("執行選取內容", "Run selection")}
              </button>
            )}
            {tab.kind === "collection" && !freeMode && (
              <button
                className={`icon query-options-toggle${queryOptionsExpanded ? " active" : ""}`}
                aria-label={t("查詢選項", "Query options")}
                title={`${t("查詢選項", "Query options")}${queryOptionIndicators(sort, projection).length ? ` · ${queryOptionIndicators(sort, projection).join(" / ")}` : ""}`}
                aria-expanded={queryOptionsExpanded}
                aria-controls={`query-bar-${tab.id}`}
                onClick={() => setQueryOptionsExpanded((expanded) => !expanded)}
              >
                <SlidersHorizontal size={14} />
              </button>
            )}
            {tab.kind === "collection" && !freeMode && (
              <button
                className={`icon${showAiAssistant ? " active" : ""}`}
                aria-label={t("AI 助理", "AI assistant")}
                title={t("用口語撰寫查詢", "Write a query in plain language")}
                aria-expanded={showAiAssistant}
                onClick={() => setShowAiAssistant((open) => !open)}
              >
                <Sparkles size={14} />
              </button>
            )}
            <button
              className="icon"
              aria-label={t("停止", "Stop")}
              title={t("停止", "Stop")}
              disabled={!busy && !hasMore}
              onClick={() => void cancel()}
            >
              <Square size={13} />
            </button>
            {tab.kind === "collection" && !freeMode && (
              <>
                <button
                  className="icon"
                  aria-label={t("計算筆數", "Count documents")}
                  title={t(
                    "計算符合條件的文件數",
                    "Count documents matching the filter",
                  )}
                  disabled={counting}
                  onClick={() => void countDocuments()}
                >
                  <Hash size={14} />
                </button>
                {count !== undefined && (
                  <span className="count-result" role="status">
                    {count.toLocaleString()}
                  </span>
                )}
              </>
            )}
            <div className="separator" />
            <button
              className="icon"
              aria-label={t("儲存查詢", "Save query")}
              title={t("儲存查詢", "Save query")}
              onClick={() =>
                setSavingQuery({
                  id: crypto.randomUUID(),
                  name: `${tab.database}.${tab.collection || "shell"}`,
                  group: "",
                  description: "",
                  source: {
                    connectionName: tab.connectionName,
                    database: tab.database,
                    collection: tab.collection,
                  },
                  query: {
                    mode: tab.kind === "shell" || freeMode ? "shell" : "find",
                    filter,
                    sort,
                    projection,
                    batchSize,
                    code,
                  },
                })
              }
            >
              <Bookmark size={15} />
            </button>
            <button
              className="icon"
              aria-label={t("開啟已儲存查詢", "Open saved queries")}
              title={t("開啟已儲存查詢", "Open saved queries")}
              onClick={onOpenSavedQueries}
            >
              <FolderOpen size={15} />
            </button>
            {tab.kind === "collection" && !freeMode && (
              <button
                className="icon"
                aria-label={t("Explain 查詢", "Explain query")}
                title={t("Explain 查詢", "Explain query")}
                onClick={() => void explain()}
              >
                <Search size={15} />
              </button>
            )}
            <button
              className="icon result-layout-toggle"
              aria-label={
                resultLayout === "vertical"
                  ? t(
                      "左右排列查詢與結果",
                      "Arrange query and results side by side",
                    )
                  : t("上下排列查詢與結果", "Stack query and results")
              }
              title={
                resultLayout === "vertical"
                  ? t("切換為左右排列", "Switch to side-by-side layout")
                  : t("切換為上下排列", "Switch to stacked layout")
              }
              aria-pressed={resultLayout === "horizontal"}
              onClick={() =>
                setResultLayout((layout) =>
                  layout === "vertical" ? "horizontal" : "vertical",
                )
              }
            >
              {resultLayout === "vertical" ? (
                <Columns2 size={15} />
              ) : (
                <Rows2 size={15} />
              )}
            </button>
            <div className="spacer" />
            <span className="muted small">
              {busy
                ? t("執行中…", "Running…")
                : elapsed
                  ? `${elapsed} ms`
                  : t("準備就緒", "Ready")}
            </span>
          </div>
        )}
      </div>
      <div className="results-pane">
        <div className="result-toolbar">
          <div className="segmented">
            {[
              ["table", Table2, "Table"],
              ["tree", ListTree, "Tree"],
              ["json", FileJson, "JSON"],
            ].map(([id, Icon, text]: any) => (
              <button
                key={id}
                className={view === id ? "active" : ""}
                aria-pressed={view === id}
                onClick={() => setView(id)}
              >
                <Icon size={14} />
                {text}
              </button>
            ))}
          </div>
          <span className="muted small" role="status">
            {rows.length.toLocaleString()} {t("筆已載入", "loaded")}
            {hasMore ? t(" · 尚可載入更多", " · more available") : ""}
          </span>
          <div className="spacer" />
          {tab.kind === "collection" && !freeMode && (
            <button
              className={`icon result-focus-toggle${resultFocus ? " active" : ""}`}
              aria-label={
                resultFocus
                  ? t("返回查詢", "Show query")
                  : t("專注結果", "Focus results")
              }
              title={
                resultFocus
                  ? t("返回查詢", "Show query")
                  : t("專注結果", "Focus results")
              }
              aria-pressed={resultFocus}
              onClick={() => setResultFocus((focused) => !focused)}
            >
              {resultFocus ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          )}
          {view === "table" && (
            <button
              className="icon column-settings-trigger"
              aria-label={t("欄位設定", "Column settings")}
              title={t("欄位設定", "Column settings")}
              aria-expanded={showColumns}
              disabled={!rows.length}
              onClick={() => setShowColumns((open) => !open)}
            >
              <Columns3 size={15} />
            </button>
          )}
          <button
            className="icon"
            aria-label={t(
              "匯出查詢結果 Excel",
              "Export query results as Excel",
            )}
            title={t(
              "匯出查詢結果 Excel（.xlsx）",
              "Export query results as Excel (.xlsx)",
            )}
            disabled={queryState !== "success"}
            onClick={() => setExportFormat("excel")}
          >
            <FileSpreadsheet size={15} />
          </button>
          <button
            className="icon"
            aria-label={t("匯出查詢結果 CSV", "Export query results as CSV")}
            title={t("匯出查詢結果 CSV", "Export query results as CSV")}
            disabled={queryState !== "success"}
            onClick={() => setExportFormat("csv")}
          >
            <Download size={15} />
          </button>
          {tab.kind === "collection" && (
            <>
              <button
                className="icon"
                aria-label={t("新增文件", "Add document")}
                title={t("新增文件", "Add document")}
                onClick={add}
                disabled={readOnly}
              >
                <Plus size={15} />
              </button>
              <button
                className="icon"
                disabled={readOnly || selected < 0 || !rows[selected]?.editable}
                aria-label={t("刪除文件", "Delete document")}
                title={t("刪除文件", "Delete document")}
                onClick={() => setDeleteConfirm(true)}
              >
                <Trash2 size={15} />
              </button>
            </>
          )}
        </div>
        <div className="results-wrapper" aria-busy={busy}>
          {layoutReady && (
            <Results
              showColumns={showColumns}
              onCloseColumns={() => setShowColumns(false)}
              initialLayout={layout}
              onLayoutChange={onLayoutChange}
              onFilter={
                tab.kind === "collection" && !freeMode
                  ? (path, value, action) => {
                      try {
                        setFilter(buildCellFilter(filter, path, value, action));
                      } catch (e) {
                        notify(message(e), true);
                      }
                    }
                  : undefined
              }
              busy={busy}
              queryState={queryState}
              rows={rows}
              view={view}
              theme={theme}
              onEdit={edit}
              onCommit={commit}
              onSelect={setSelected}
              onRowInspect={inspectRow}
              onRowEdit={editRow}
              onRowCopy={copyRow}
              onRowDelete={(row) => {
                setSelected(row);
                setDeleteConfirm(true);
              }}
              onSort={
                tab.kind === "collection" && !freeMode
                  ? (field, direction) => {
                      const nextSort =
                        direction === null
                          ? "{}"
                          : JSON.stringify({ [field]: direction });
                      setSort(nextSort);
                      void run(false, { sort: nextSort });
                    }
                  : undefined
              }
              sortDirections={!freeMode ? sortDirections : {}}
              autoFitTableColumns={tab.kind === "collection" && !freeMode}
              t={t}
            />
          )}
        </div>
        {showExplain && (
          <ExplainDialog
            query={query}
            close={() => setShowExplain(false)}
            profileProvider={profile?.provider || "mongodb"}
            onOpenPreferences={onOpenPreferences}
          />
        )}
        {showAiAssistant && tab.kind === "collection" && !freeMode && (
          <AIAssistantPanel
            key={`${tab.connectionId}/${tab.database}/${tab.collection}/query`}
            connectionId={tab.connectionId}
            database={tab.database}
            collection={tab.collection}
            task="query"
            draftMode="find"
            language={language}
            profileProvider={profile?.provider || "mongodb"}
            collectionNames={collectionNames}
            fieldHints={completionFields}
            currentQuery={{ filter, sort, projection }}
            onApplyFind={(draft) => {
              setFilter(JSON.stringify(draft.filter, null, 2));
              setSort(JSON.stringify(draft.sort, null, 2));
              setProjection(JSON.stringify(draft.projection, null, 2));
            }}
            onClose={() => setShowAiAssistant(false)}
            onOpenPreferences={(section) => onOpenPreferences?.(section)}
          />
        )}
        {savingQuery && (
          <SavedQueryDialog
            value={savingQuery}
            close={() => setSavingQuery(undefined)}
            saved={() => {
              setSavingQuery(undefined);
              onQuerySaved?.();
              notify(t("查詢已儲存", "Query saved"));
            }}
          />
        )}
        <div className="result-footer">
          {!resultFocus && (
            <>
              <span>
                {t(
                  "雙擊編輯 · Ctrl/Cmd+C 複製欄位值",
                  "Double-click to edit · Ctrl/Cmd+C to copy a cell",
                )}
              </span>
              <span>
                {t(
                  "最多保留最近 1,000 筆／24 MB；其他批次可透過分頁重新載入。",
                  "Keeps the latest 1,000 rows / 24 MB; use paging to reload other batches.",
                )}
              </span>
            </>
          )}
          {tab.kind === "collection" && !freeMode && (
            <>
              <div className="page-actions">
                <button
                  aria-label={t("第一頁", "First page")}
                  title={t("第一頁", "First page")}
                  disabled={busy || pageIndex === 0}
                  onClick={() => void run()}
                >
                  |←
                </button>
                <button
                  aria-label={t("上一批", "Previous batch")}
                  title={t("上一批", "Previous batch")}
                  disabled={busy || pageIndex === 0}
                  onClick={() =>
                    void run(false, {
                      skip: Math.max(0, pageIndexRef.current - 1) * batchSize,
                    })
                  }
                >
                  ←
                </button>
                <button
                  aria-label={t("下一批", "Next batch")}
                  title={t("下一批", "Next batch")}
                  disabled={busy || !hasMore}
                  onClick={() => void run(true)}
                >
                  →
                </button>
                <button
                  aria-label={t("最後一頁", "Last page")}
                  title={t("最後一頁", "Last page")}
                  disabled={
                    busy || !rows.length || (!hasMore && pageIndex === 0)
                  }
                  onClick={() => void runToLast()}
                >
                  →|
                </button>
              </div>
              <span className="page-range" role="status">
                {rows.length
                  ? t(
                      `第 ${(pageIndex * batchSize + 1).toLocaleString()}–${(pageIndex * batchSize + rows.length).toLocaleString()} 筆${count !== undefined ? `／共 ${count.toLocaleString()} 筆` : ""}`,
                      `Rows ${(pageIndex * batchSize + 1).toLocaleString()}–${(pageIndex * batchSize + rows.length).toLocaleString()}${count !== undefined ? ` of ${count.toLocaleString()}` : ""}`,
                    )
                  : t("沒有已載入文件", "No loaded documents")}
              </span>
              <label
                className="batch-control footer-batch"
                title={t(
                  "每批取回的筆數；可透過分頁檢視所有符合條件的文件。",
                  "Rows fetched per batch. Continue paging to review all matching documents.",
                )}
              >
                <span>BATCH</span>
                <select
                  aria-label="BATCH"
                  value={batchSize}
                  onChange={(e) => {
                    const nextBatchSize = Number(e.target.value);
                    setBatch(nextBatchSize);
                    void run(false, { batchSize: nextBatchSize, skip: 0 });
                  }}
                >
                  {[...new Set([25, 100, 250, 500, 1000, batchSize])]
                    .sort((a, b) => a - b)
                    .map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                </select>
              </label>
            </>
          )}
        </div>
      </div>
      {output.length > 0 && !resultFocus && (
        <details
          className={`output ${outputCollapsed ? "collapsed" : ""}`}
          open={!outputCollapsed}
          style={{ height: outputCollapsed ? undefined : outputHeight }}
          onToggle={(event) => setOutputCollapsed(!event.currentTarget.open)}
        >
          <summary>
            <Terminal size={14} />
            {t("輸出", "Output")}
            <button
              className="icon"
              aria-label={
                outputCollapsed
                  ? t("展開輸出", "Expand output")
                  : t("縮小輸出", "Collapse output")
              }
              title={
                outputCollapsed
                  ? t("展開輸出", "Expand output")
                  : t("縮小輸出", "Collapse output")
              }
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setOutputCollapsed((old) => !old);
              }}
            >
              {outputCollapsed ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronUp size={14} />
              )}
            </button>
            <button
              className="text-button"
              onClick={(e) => {
                e.preventDefault();
                setOutput([]);
              }}
            >
              {t("清除", "Clear")}
            </button>
          </summary>
          {!outputCollapsed && (
            <>
              <div
                className="output-resize-handle"
                role="separator"
                aria-orientation="horizontal"
                aria-label={t("調整輸出高度", "Resize output height")}
                aria-valuemin={76}
                aria-valuemax={Math.max(
                  260,
                  Math.floor(window.innerHeight * 0.8),
                )}
                aria-valuenow={Math.min(
                  outputHeight,
                  Math.max(260, Math.floor(window.innerHeight * 0.8)),
                )}
                tabIndex={0}
                onPointerDown={resizeOutput}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault();
                    setOutputHeight((old) =>
                      Math.max(76, old + (event.key === "ArrowUp" ? 24 : -24)),
                    );
                  }
                }}
              />
              <pre>{output.join("\n")}</pre>
            </>
          )}
        </details>
      )}
      {exportFormat && (
        <Modal
          title={t("匯出查詢結果", "Export query results")}
          close={() => setExportFormat(undefined)}
          footer={
            <button onClick={() => setExportFormat(undefined)}>
              {t("取消", "Cancel")}
            </button>
          }
        >
          <p>
            {t(
              "選擇匯出範圍。已載入結果只包含目前畫面保留的文件；完整匯出會從資料庫串流所有符合目前 Filter、Sort 與 Projection 的文件。",
              "Choose the export scope. Loaded results contain only the documents retained in this view; a full export streams every document matching the current Filter, Sort, and Projection from the database.",
            )}
          </p>
          <div className="export-scope-actions">
            <button
              disabled={!rows.length}
              onClick={() => {
                const format = exportFormat;
                setExportFormat(undefined);
                void exportLoadedResults(format);
              }}
            >
              {t(
                `匯出已載入的 ${rows.length.toLocaleString()} 筆（${exportFormat.toUpperCase()}）`,
                `Export ${rows.length.toLocaleString()} loaded rows (${exportFormat.toUpperCase()})`,
              )}
            </button>
            <button
              className="primary"
              onClick={() => exportAllMatching("json")}
            >
              {t(
                "串流匯出所有符合條件的文件（Extended JSON）",
                "Stream all matching documents (Extended JSON)",
              )}
            </button>
            <button onClick={() => exportAllMatching("csv")}>
              {t(
                "串流匯出所有符合條件的文件（CSV）",
                "Stream all matching documents (CSV)",
              )}
            </button>
          </div>
          <p className="hint">
            {t(
              "完整匯出完成後，背景任務面板會顯示實際成功與失敗筆數。Excel 格式僅支援已載入結果，避免大型工作表耗盡記憶體。",
              "When a full export finishes, Background jobs shows the actual successful and failed document counts. Excel is limited to loaded rows to avoid exhausting memory for large worksheets.",
            )}
          </p>
        </Modal>
      )}
      {docEditor && (
        <Modal
          wide
          resizable
          documentViewer={docEditor.readOnly}
          title={docEditor.title}
          close={requestCloseDocEditor}
          footer={
            <>
              <span className="muted">Extended JSON · BSON</span>
              <button
                className="icon"
                aria-label={t("複製內容", "Copy content")}
                title={t("複製內容", "Copy content")}
                onClick={() => void copyDocumentContent()}
                disabled={docBusy}
              >
                <Copy size={15} />
              </button>
              <button onClick={requestCloseDocEditor} disabled={docBusy}>
                {t("關閉", "Close")}
              </button>
              {!docEditor.readOnly && (
                <button
                  onClick={() => {
                    try {
                      setDocEditor({
                        ...docEditor,
                        value: formatDocument(docEditor.value, tabWidth),
                      });
                      setDocError("");
                    } catch (e) {
                      setDocError(message(e));
                    }
                  }}
                  disabled={docBusy}
                >
                  <Braces size={15} />
                  {t("格式化文件", "Format document")}
                </button>
              )}
              {!docEditor.readOnly && (
                <button
                  disabled={
                    docBusy || docEditor.value === docEditor.originalValue
                  }
                  onClick={() => setShowDocChanges(true)}
                >
                  {t("檢視變更", "Review changes")}
                </button>
              )}
              {!docEditor.readOnly && (
                <button
                  className="primary"
                  disabled={docBusy}
                  onClick={async () => {
                    setDocBusy(true);
                    setDocError("");
                    try {
                      await docEditor.submit(docEditor.value);
                      setDiscardDocEditor(false);
                      setConflictServerDocument(undefined);
                      setDocEditor(undefined);
                    } catch (e) {
                      const error = message(e);
                      setDocError(error);
                      if (/^Conflict:/.test(error))
                        void refreshConflictDocument();
                    } finally {
                      setDocBusy(false);
                    }
                  }}
                >
                  {t("儲存", "Save")}
                </button>
              )}
            </>
          }
        >
          <div className="document-editor-surface">
            <CodeEditor
              theme={theme}
              value={docEditor.value}
              onChange={(v) => setDocEditor({ ...docEditor, value: v })}
              height="100%"
              language={shellJsonLanguage}
              readOnly={docEditor.readOnly}
              defaultExpandedDepth={jsonExpandedDepth}
            />
          </div>
          {docError && <div className="notice error">{docError}</div>}
          {conflictServerDocument && (
            <div className="notice warning" role="status">
              {t(
                "已讀取資料庫目前版本。請檢視差異後，選擇保留目前編輯或使用資料庫版本。",
                "The current database version was loaded. Review the differences, then keep your edit or use the database version.",
              )}
            </div>
          )}
        </Modal>
      )}
      {showDocChanges && docEditor && (
        <Modal
          wide
          title={t("文件變更", "Document changes")}
          close={() => setShowDocChanges(false)}
          footer={
            <>
              {conflictServerDocument && (
                <button className="danger" onClick={applyServerDocument}>
                  {t("使用資料庫版本", "Use database version")}
                </button>
              )}
              <button onClick={() => setShowDocChanges(false)}>
                {t("保留目前編輯", "Keep current edit")}
              </button>
            </>
          }
        >
          {(() => {
            try {
              const changes = documentChanges(
                conflictServerDocument || docEditor.originalValue,
                docEditor.value,
              );
              return changes.length ? (
                <div className="document-change-list">
                  {changes.map((change) => (
                    <div
                      className={`document-change ${change.kind}`}
                      key={`${change.kind}:${change.path}`}
                    >
                      <code>{change.path}</code>
                      <span>{change.kind}</span>
                      {change.before !== undefined && (
                        <del>{change.before}</del>
                      )}
                      {change.after !== undefined && <ins>{change.after}</ins>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">
                  {t("沒有可比較的變更。", "No changes to compare.")}
                </p>
              );
            } catch {
              return (
                <p className="notice error">
                  {t(
                    "目前內容不是有效的 Extended JSON，請先格式化或修正後再比較。",
                    "The current content is not valid Extended JSON. Correct it before comparing.",
                  )}
                </p>
              );
            }
          })()}
        </Modal>
      )}
      {discardDocEditor && docEditor && (
        <Modal
          title={t("放棄未儲存的變更", "Discard unsaved changes")}
          close={() => setDiscardDocEditor(false)}
          footer={
            <>
              <button onClick={() => setDiscardDocEditor(false)}>
                {t("取消", "Cancel")}
              </button>
              <button
                className="danger"
                onClick={() => {
                  setDiscardDocEditor(false);
                  setConflictServerDocument(undefined);
                  setDocEditor(undefined);
                }}
              >
                {t("放棄變更", "Discard changes")}
              </button>
            </>
          }
        >
          <p>
            {t(
              "關閉後將遺失此文件中尚未儲存的內容。",
              "Closing will discard the unsaved content in this document.",
            )}
          </p>
        </Modal>
      )}
      {deleteConfirm && (
        <Modal
          title={t("刪除選取文件", "Delete selected document")}
          close={() => setDeleteConfirm(false)}
          footer={
            <>
              <button onClick={() => setDeleteConfirm(false)}>
                {t("取消", "Cancel")}
              </button>
              <button
                className="danger"
                onClick={async () => {
                  if (!ensureWritable()) return;
                  try {
                    await api.request("documents.delete", {
                      ...target,
                      original: rows[selected].ejson,
                    });
                    setRows(rows.filter((_, i) => i !== selected));
                    setSelected(-1);
                    setDeleteConfirm(false);
                  } catch (e) {
                    notify(message(e), true);
                  }
                }}
              >
                {t("刪除", "Delete")}
              </button>
            </>
          }
        >
          <p>
            {t(
              "此操作會將文件從資料庫刪除。",
              "This removes the selected document from the database.",
            )}
          </p>
          <pre className="preview">{rows[selected]?.ejson.slice(0, 2000)}</pre>
        </Modal>
      )}
      {indexes !== undefined && (
        <Modal
          wide
          title={`${t("索引管理", "Indexes")} · ${tab.collection}`}
          close={() => setIndexes(undefined)}
        >
          <div className="index-list">
            {JSON.parse(indexes).map((i: any) => (
              <div className="index-row" key={i.name}>
                <Layers size={17} />
                <div>
                  <strong>{i.name}</strong>
                  <code>{JSON.stringify(i.key)}</code>
                </div>
                <span className="badge">{i.unique ? "UNIQUE" : "INDEX"}</span>
                <button
                  className="icon"
                  disabled={readOnly || i.name === "_id_"}
                  aria-label={`${t("編輯索引", "Edit index")} ${i.name}`}
                  title={t("編輯索引", "Edit index")}
                  onClick={() => {
                    setEditingIndex(i.name);
                    setIndexKeys(JSON.stringify(i.key));
                    setIndexName(i.name);
                    setUnique(Boolean(i.unique));
                    setTtl(
                      i.expireAfterSeconds === undefined
                        ? ""
                        : String(encodedNumber(i.expireAfterSeconds)),
                    );
                  }}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="icon"
                  disabled={readOnly || i.name === "_id_"}
                  aria-label={`${t("刪除索引", "Delete index")} ${i.name}`}
                  title={t("刪除索引", "Delete index")}
                  onClick={() =>
                    setIndexDeleteTarget({
                      name: i.name,
                      keys: JSON.stringify(i.key),
                    })
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <h3>
            {editingIndex
              ? t("編輯索引", "Edit index")
              : t("新增索引", "Create index")}
          </h3>
          <div className="form-grid">
            <Field full label="Keys (JSON)">
              <input
                disabled={readOnly}
                value={indexKeys}
                onChange={(e) => setIndexKeys(e.target.value)}
              />
            </Field>
            <Field label={t("名稱（可省略）", "Name (optional)")}>
              <input
                disabled={readOnly}
                value={indexName}
                onChange={(e) => setIndexName(e.target.value)}
              />
            </Field>
            <Field label="TTL seconds (optional)">
              <input
                type="number"
                min={0}
                disabled={readOnly}
                value={ttl}
                onChange={(e) => setTtl(e.target.value)}
              />
            </Field>
            <label className="checkbox">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={unique}
                onChange={(e) => setUnique(e.target.checked)}
              />
              Unique
            </label>
            <button
              className="primary"
              disabled={readOnly}
              onClick={async () => {
                const settings: IndexSettings = {
                  keys: indexKeys,
                  name: indexName,
                  unique,
                  ...(ttl ? { expireAfterSeconds: Number(ttl) } : {}),
                };
                if (editingIndex) {
                  const current = JSON.parse(indexes).find(
                    (index: { name: string; key: unknown }) =>
                      index.name === editingIndex,
                  );
                  setIndexRebuildTarget({
                    ...settings,
                    oldName: editingIndex,
                    oldKeys: JSON.stringify(current?.key ?? {}),
                  });
                } else {
                  await createIndex(settings);
                }
              }}
            >
              {editingIndex
                ? t("儲存變更", "Save changes")
                : t("建立", "Create")}
            </button>
          </div>
        </Modal>
      )}
      {indexDeleteTarget && (
        <Modal
          title={t("刪除索引", "Delete index")}
          close={() => {
            if (!indexDeleting) setIndexDeleteTarget(undefined);
          }}
          footer={
            <>
              <button
                disabled={indexDeleting}
                onClick={() => setIndexDeleteTarget(undefined)}
              >
                {t("取消", "Cancel")}
              </button>
              <button
                className="danger"
                disabled={indexDeleting}
                onClick={() => void deleteIndex()}
              >
                {indexDeleting
                  ? t("刪除中…", "Deleting…")
                  : t("刪除索引", "Delete index")}
              </button>
            </>
          }
        >
          <p>
            {t(
              "這會移除索引，後續查詢可能變慢。請確認目標後再繼續。",
              "This removes the index and can slow later queries. Confirm the target before continuing.",
            )}
          </p>
          <dl className="confirmation-details">
            <div>
              <dt>{t("連線", "Connection")}</dt>
              <dd>{tab.connectionName}</dd>
            </div>
            <div>
              <dt>{t("Collection", "Collection")}</dt>
              <dd>
                {tab.database}.{tab.collection}
              </dd>
            </div>
            <div>
              <dt>{t("索引", "Index")}</dt>
              <dd>{indexDeleteTarget.name}</dd>
            </div>
            <div>
              <dt>{t("欄位", "Keys")}</dt>
              <dd>
                <code>{indexDeleteTarget.keys}</code>
              </dd>
            </div>
          </dl>
        </Modal>
      )}
      {indexRebuildTarget && (
        <Modal
          title={t("重新建立索引", "Rebuild index")}
          close={() => {
            if (!indexRebuilding) setIndexRebuildTarget(undefined);
          }}
          footer={
            <>
              <button
                disabled={indexRebuilding}
                onClick={() => setIndexRebuildTarget(undefined)}
              >
                {t("取消", "Cancel")}
              </button>
              <button
                className="danger"
                disabled={indexRebuilding}
                onClick={() => void rebuildIndex()}
              >
                {indexRebuilding
                  ? t("重新建立中…", "Rebuilding…")
                  : t("重新建立索引", "Rebuild index")}
              </button>
            </>
          }
        >
          <p>
            {t(
              "更新索引會先刪除既有索引，再以新設定建立。這段期間查詢可能變慢。",
              "Updating an index deletes the current index before creating the new one. Queries can be slower during that interval.",
            )}
          </p>
          <dl className="confirmation-details">
            <div>
              <dt>{t("連線", "Connection")}</dt>
              <dd>{tab.connectionName}</dd>
            </div>
            <div>
              <dt>{t("Collection", "Collection")}</dt>
              <dd>
                {tab.database}.{tab.collection}
              </dd>
            </div>
            <div>
              <dt>{t("原索引", "Current index")}</dt>
              <dd>
                <code>
                  {indexRebuildTarget.oldName} {indexRebuildTarget.oldKeys}
                </code>
              </dd>
            </div>
            <div>
              <dt>{t("新欄位", "New keys")}</dt>
              <dd>
                <code>{indexRebuildTarget.keys}</code>
              </dd>
            </div>
          </dl>
        </Modal>
      )}
    </div>
  );
}
