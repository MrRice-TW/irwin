import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { X } from "lucide-react";
import { useVirtualizer, defaultRangeExtractor } from "@tanstack/react-virtual";
import {
  cellValue,
  columnLabel,
  safeColumnPath,
  tableColumns,
  reorderColumn,
  moveColumnBy,
  rememberColumnOrder,
  type GridCell,
} from "./table-tools";
import { bsonType, type FilterAction } from "../shared/exploration";
import type { TableLayout } from "../shared/workspace";
import type { Row, Settings } from "../shared/contracts";
import { CodeEditor } from "./Editor";
import { api, useUi } from "./ui";
import { prettyDocument, shellJsonLanguage } from "./json-format";
import {
  DEFAULT_TABLE_COLUMN_WIDTH,
  fitInitialTableColumnWidths,
  initialTableLayout,
  isExtendedJsonScalar,
  MIN_TABLE_COLUMN_WIDTH,
  reconcileTableColumnWidths,
} from "./result-layout";
import { queryResultNotice, type QueryState } from "./query-state";
import { formatBsonDate } from "./datetime";
import { gridScrollOffset, moveGridSelection } from "./grid-keyboard";

export { prettyDocument } from "./json-format";

export function editedValue(original: any, text: string): string {
  if (typeof original === "string") return JSON.stringify(text);
  if (original && typeof original === "object") {
    if (Object.hasOwn(original, "$date")) {
      const date = new Date(text);
      if (Number.isNaN(date.valueOf())) throw new Error("Invalid date");
      return JSON.stringify({ $date: { $numberLong: String(date.valueOf()) } });
    }
    const key = Object.keys(original)[0];
    if (
      [
        "$numberInt",
        "$numberLong",
        "$numberDouble",
        "$numberDecimal",
        "$oid",
      ].includes(key)
    )
      return JSON.stringify({ [key]: text });
  }
  return JSON.stringify(JSON.parse(text));
}

function dateText(value: any, settings?: Partial<Settings>) {
  const date = new Date(Number(value?.$date?.$numberLong ?? value?.$date));
  if (Number.isNaN(date.valueOf())) return String(value);
  return formatBsonDate(date, settings);
}

export function label(value: any, settings?: Partial<Settings>): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value !== "object") return String(value);
  if (value.$oid) return value.$oid;
  if (value.$numberLong !== undefined) return value.$numberLong;
  if (value.$numberInt !== undefined) return value.$numberInt;
  if (value.$numberDouble !== undefined) return value.$numberDouble;
  if (value.$numberDecimal !== undefined) return value.$numberDecimal;
  if (value.$date) return dateText(value, settings);
  return JSON.stringify(value);
}

function needsCellPreview(text: string, columnWidth: number) {
  const visibleCharacterBudget = Math.max(
    16,
    Math.floor((columnWidth - 24) / 7),
  );
  return text.includes("\n") || text.length > visibleCharacterBudget;
}

export function typeLabel(value: any) {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object")
    return Object.keys(value)[0]?.startsWith("$")
      ? Object.keys(value)[0].slice(1)
      : "object";
  return typeof value;
}

function treeType(value: any, documentRoot = false) {
  if (documentRoot) return "Document";
  return (
    (
      {
        object: "Object",
        array: "Array",
        string: "String",
        boolean: "Bool",
        number: "Number",
        numberInt: "Int32",
        numberLong: "Int64",
        numberDouble: "Double",
        numberDecimal: "Decimal128",
        oid: "ObjectId",
        date: "Date",
        null: "Null",
        missing: "Missing",
      } as Record<string, string>
    )[typeLabel(value)] || typeLabel(value)
  );
}

function treeSummary(value: any) {
  const keys =
    value !== null && typeof value === "object" ? Object.keys(value) : [];
  return Array.isArray(value)
    ? `[ ${keys.length} elements ]`
    : `{ ${keys.length} fields }`;
}

function treeLabel(value: any, settings?: Partial<Settings>) {
  if (value?.$oid) return `ObjectId(${JSON.stringify(value.$oid)})`;
  if (value?.$binary)
    return `Binary(${JSON.stringify(value.$binary.base64)}, ${JSON.stringify(value.$binary.subType)})`;
  if (value?.$regularExpression)
    return `/${value.$regularExpression.pattern}/${value.$regularExpression.options}`;
  if (value?.$timestamp)
    return `Timestamp(${value.$timestamp.t}, ${value.$timestamp.i})`;
  if (value?.$minKey) return "MinKey()";
  if (value?.$maxKey) return "MaxKey()";
  if (value?.$undefined) return "undefined";
  if (value?.$symbol) return `Symbol(${JSON.stringify(value.$symbol)})`;
  if (value?.$code) return `Code(${JSON.stringify(value.$code)})`;
  if (value?.$dbPointer)
    return `DBRef(${JSON.stringify(value.$dbPointer.$ref)}, ObjectId(${JSON.stringify(value.$dbPointer.$id?.$oid)}))`;
  if (isExtendedJsonScalar(value) && !value?.$date)
    return prettyDocument(value, { indent: 2 });
  return label(value, settings);
}

function TreeNode({
  name,
  value,
  depth = 0,
  settings,
  defaultOpen = false,
  documentRoot = false,
  gridTemplate,
  gridMinWidth,
}: {
  name: string;
  value: any;
  depth?: number;
  settings?: Partial<Settings>;
  defaultOpen?: boolean;
  documentRoot?: boolean;
  gridTemplate: string;
  gridMinWidth: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [count, setCount] = useState(50);
  const expandable =
    value !== null && typeof value === "object" && !isExtendedJsonScalar(value);
  const keys = expandable ? Object.keys(value) : [];
  const toggle = () => expandable && setOpen((old) => !old);
  const valueType = typeLabel(value);
  return (
    <div className="tree-node">
      <div
        className={`tree-row ${expandable ? "expandable" : ""}`}
        style={{ gridTemplateColumns: gridTemplate, minWidth: gridMinWidth }}
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : -1}
        aria-expanded={expandable ? open : undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (expandable && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            toggle();
          }
        }}
      >
        <div
          className="tree-key"
          style={{ paddingLeft: `${depth * 18 + 6}px` }}
        >
          <span className="tree-arrow">
            {expandable ? (open ? "▾" : "▸") : "·"}
          </span>
          <span className="tree-name">{name}</span>
        </div>
        <div className={`tree-value tree-value-${valueType}`}>
          {expandable ? treeSummary(value) : treeLabel(value, settings)}
        </div>
        <div className={`tree-type tree-type-${valueType}`}>
          {treeType(value, documentRoot)}
        </div>
      </div>
      {open && expandable && (
        <div className="tree-children">
          {keys.slice(0, count).map((key) => (
            <TreeNode
              key={key}
              name={key}
              value={value[key]}
              depth={depth + 1}
              settings={settings}
              gridTemplate={gridTemplate}
              gridMinWidth={gridMinWidth}
            />
          ))}
          {keys.length > count && (
            <button className="tree-more" onClick={() => setCount(count + 50)}>
              + 50
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type ResultsProps = {
  showColumns: boolean;
  onCloseColumns: () => void;
  initialLayout?: TableLayout;
  onLayoutChange?: (layout: TableLayout) => void;
  onFilter?: (path: string, value: any, action: FilterAction) => void;
  busy?: boolean;
  queryState?: QueryState;
  rows: Row[];
  view: string;
  theme: Settings["theme"];
  onEdit: (row: number, field: string, value: any) => void;
  onCommit: (row: number, field: string, value: string) => Promise<void>;
  onSelect: (row: number) => void;
  onRowInspect?: (row: number) => void;
  onRowEdit?: (row: number) => void;
  onRowCopy?: (row: number) => void;
  onRowDelete?: (row: number) => void;
  sortDirections?: Record<string, 1 | -1>;
  onSort?: (field: string, direction: 1 | -1 | null) => void;
  autoFitTableColumns?: boolean;
  t: (zh: string, en: string) => string;
};

export function Results({
  showColumns,
  onCloseColumns,
  rows,
  view,
  theme,
  onEdit,
  onCommit,
  onSelect,
  onRowInspect,
  onRowEdit,
  onRowCopy,
  onRowDelete,
  onSort,
  sortDirections = {},
  autoFitTableColumns = false,
  t,
  busy = false,
  queryState = "idle",
  initialLayout,
  onLayoutChange,
  onFilter,
}: ResultsProps) {
  const ui = useUi();
  const rowHeight =
    ui.longTextDisplay === "wrap"
      ? ui.rowDensity === "compact"
        ? 42
        : 48
      : ui.rowDensity === "compact"
        ? 28
        : 36;
  const rememberedLayout = initialTableLayout(
    initialLayout,
    autoFitTableColumns,
  );
  const scroll = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<{ row: number; field: string }>();
  const [context, setContext] = useState<{
    row: number;
    field: string;
    x: number;
    y: number;
  }>();
  const [editing, setEditing] = useState<{
    row: number;
    field: string;
    text: string;
    original: any;
    busy?: boolean;
    error?: string;
  }>();
  const [widths, setWidths] = useState<Record<string, number>>(
    rememberedLayout?.widths || {},
  );
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(
    rememberedLayout?.hidden || [],
  );
  const [order, setOrder] = useState<string[]>(rememberedLayout?.order || []);
  const [pinned, setPinned] = useState<string[]>(
    rememberedLayout?.pinned || [],
  );
  const [expanded, setExpanded] = useState<string[]>(
    rememberedLayout?.expanded || [],
  );
  const [remember, setRemember] = useState(rememberedLayout?.remember || false);
  const [treeWidths, setTreeWidths] = useState([260, 420, 130]);
  const didInitialTableFit = useRef(
    !!rememberedLayout && Object.keys(rememberedLayout.widths).length > 0,
  );
  useEffect(() => {
    onLayoutChange?.({
      widths,
      hidden: hiddenColumns,
      order,
      pinned,
      expanded,
      remember,
    });
  }, [
    widths,
    hiddenColumns,
    order,
    pinned,
    expanded,
    remember,
    onLayoutChange,
  ]);
  const docs = useMemo(
    () =>
      rows.map((row) => {
        const v = JSON.parse(row.ejson);
        return v && typeof v === "object" && !Array.isArray(v)
          ? v
          : { value: v };
      }),
    [rows],
  );
  const { jsonText, jsonDocumentStarts } = useMemo(() => {
    let line = 1;
    const starts: number[] = [];
    const documents = rows.map((row) => {
      const document = prettyDocument(JSON.parse(row.ejson), {
        indent: ui.tabWidth,
      });
      starts.push(line);
      line += document.split("\n").length;
      return document;
    });
    return {
      jsonText: "[\n" + documents.join(",\n") + "\n]",
      jsonDocumentStarts: starts,
    };
  }, [rows, ui.tabWidth]);
  const columns = useMemo(
    () => tableColumns(docs, expanded, order),
    [docs, expanded, order],
  );
  useEffect(() => {
    setOrder((previous) => rememberColumnOrder(previous, columns));
  }, [columns]);
  const visibleColumns = useMemo(() => {
    const ordered = [
      ...order.filter((c) => columns.includes(c)),
      ...columns.filter((c) => !order.includes(c)),
    ].filter((c) => !hiddenColumns.includes(c));
    return [
      ...ordered.filter((c) => pinned.includes(c)),
      ...ordered.filter((c) => !pinned.includes(c)),
    ];
  }, [columns, hiddenColumns, order, pinned]);
  const width = (index: number) =>
    Object.hasOwn(widths, visibleColumns[index])
      ? widths[visibleColumns[index]]
      : DEFAULT_TABLE_COLUMN_WIDTH;
  const virtualRows = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });
  useEffect(() => {
    virtualRows.measure();
  }, [virtualRows, rowHeight]);
  const virtualCols = useVirtualizer({
    horizontal: true,
    count: visibleColumns.length,
    getItemKey: (index) => visibleColumns[index],
    getScrollElement: () => scroll.current,
    estimateSize: (index) => width(index),
    overscan: 2,
    rangeExtractor: (range) =>
      [
        ...new Set([
          ...visibleColumns
            .map((c, i) => (pinned.includes(c) ? i : -1))
            .filter((i) => i >= 0),
          ...defaultRangeExtractor(range),
        ]),
      ].sort((a, b) => a - b),
  });
  useEffect(() => {
    virtualCols.measure();
  }, [virtualCols, widths, visibleColumns]);
  const tableText = useMemo(
    () =>
      Object.fromEntries(
        columns.map((column) => [
          column,
          docs.map((document) => label(cellValue(document, column), ui)),
        ]),
      ),
    [columns, docs, ui],
  );
  useEffect(() => {
    // React may replay a state updater in development StrictMode. Decide and
    // mark the one-time fit outside it so every replay produces the same widths.
    const shouldFit =
      !didInitialTableFit.current &&
      autoFitTableColumns &&
      queryState === "success" &&
      !busy &&
      columns.length > 0;
    const fitted = shouldFit
      ? fitInitialTableColumnWidths(columns, tableText)
      : undefined;
    if (shouldFit) didInitialTableFit.current = true;
    setWidths((old) => {
      const normalized = reconcileTableColumnWidths(old, columns);
      return fitted ? { ...normalized, ...fitted } : normalized;
    });
  }, [autoFitTableColumns, busy, columns, queryState, tableText]);
  useEffect(() => {
    setEditing(undefined);
    setSelected(undefined);
    setContext(undefined);
  }, [rows]);
  useEffect(() => {
    const close = () => setContext(undefined);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);
  const resize = (index: number, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const start = width(index);
    const key = visibleColumns[index];
    const move = (e: globalThis.MouseEvent) => {
      const next = Math.max(
        MIN_TABLE_COLUMN_WIDTH,
        Math.min(640, start + e.clientX - startX),
      );
      setWidths((old) => ({ ...old, [key]: next }));
      virtualCols.measure();
    };
    const end = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
  };
  const treeTemplate = treeWidths.map((width) => `${width}px`).join(" ");
  const treeMinWidth = treeWidths.reduce((total, width) => total + width, 0);
  const resizeTree = (index: number, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const start = treeWidths[index];
    const minimum = [150, 180, 90][index];
    const move = (e: globalThis.MouseEvent) => {
      const next = Math.max(minimum, Math.min(900, start + e.clientX - startX));
      setTreeWidths((old) =>
        old.map((width, i) => (i === index ? next : width)),
      );
    };
    const end = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
  };
  const copy = (row: number, field: string) => {
    const value = cellValue(docs[row], field);
    const text =
      value === undefined
        ? ""
        : typeof value === "string"
          ? value
          : JSON.stringify(value);
    void api.request("clipboard.write", { text });
  };
  const selectCell = (next: GridCell, reveal = true) => {
    setSelected(next);
    onSelect(next.row);
    const viewport = scroll.current;
    if (!reveal || !viewport) return;
    viewport.scrollTop = gridScrollOffset(
      rowHeight + next.row * rowHeight,
      rowHeight,
      viewport.scrollTop,
      viewport.clientHeight,
      rowHeight,
    );
    if (!pinned.includes(next.field)) {
      const index = Math.max(0, visibleColumns.indexOf(next.field));
      const start =
        52 +
        visibleColumns.slice(0, index).reduce((sum, _, i) => sum + width(i), 0);
      const frozen =
        52 +
        visibleColumns.reduce(
          (sum, field, i) => sum + (pinned.includes(field) ? width(i) : 0),
          0,
        );
      viewport.scrollLeft = gridScrollOffset(
        start,
        width(index),
        viewport.scrollLeft,
        viewport.clientWidth,
        frozen,
      );
    }
  };
  const toggle = (list: string[], key: string) =>
    list.includes(key) ? list.filter((v) => v !== key) : [...list, key];
  if (!rows.length)
    return (
      <div className="result-empty" role="status">
        <div className="empty-grid" aria-hidden="true">
          {busy ? "…" : "∅"}
        </div>
        <strong>
          {busy
            ? t("正在讀取資料…", "Loading documents…")
            : queryState === "error"
              ? t("查詢未完成", "Query did not complete")
              : queryState === "success"
                ? t("沒有符合條件的文件", "No matching documents")
                : t("準備好執行查詢", "Ready to run a query")}
        </strong>
        <p>
          {busy
            ? t(
                "結果會在查詢完成後顯示。",
                "Results will appear when the query completes.",
              )
            : queryState === "error"
              ? t(
                  "請查看錯誤訊息，確認連線與查詢語法後重試。",
                  "Check the error, connection, and query syntax, then try again.",
                )
              : queryState === "success"
                ? t(
                    "請調整 Filter 後重新執行；若是空的 Collection，可新增文件。",
                    "Adjust your filter and run again, or add a document to an empty collection.",
                  )
                : t(
                    "使用 Filter 或自由命令開始探索資料。",
                    "Use a filter or Free command to explore your data.",
                  )}
        </p>
      </div>
    );
  return (
    <div className="results-view" onClick={() => setContext(undefined)}>
      {queryResultNotice(queryState, rows.length > 0) !== "none" && (
        <div
          className={`result-state-notice ${queryResultNotice(queryState, rows.length > 0)}`}
          role="status"
        >
          {queryResultNotice(queryState, rows.length > 0) === "stale-results"
            ? t(
                "查詢條件已變更，畫面顯示上次成功的結果。請執行查詢以更新。",
                "Query inputs changed. Showing the last successful results; run the query to refresh.",
              )
            : queryResultNotice(queryState, rows.length > 0) ===
                "previous-results-error"
              ? t(
                  "最新查詢失敗，畫面保留上次成功的結果。請查看輸出後重試。",
                  "The latest query failed. The previous successful results remain visible; check Output and retry.",
                )
              : t(
                  "查詢未完成，請查看輸出後重試。",
                  "Query did not complete. Check Output and retry.",
                )}
        </div>
      )}
      {view === "json" && (
        <div className="json-results">
          <div className="json-toolbar">
            <span>
              {t(
                "JSON 使用 Shell 型別表示法；可在偏好設定調整縮排、字型與行距。",
                "JSON uses shell-friendly BSON constructors; adjust indentation, font and line spacing in Preferences.",
              )}
            </span>
            <span className="json-badge">
              {ui.tabWidth} spaces · Extended JSON
            </span>
          </div>
          <div className="json-editor-surface">
            <CodeEditor
              theme={theme}
              value={jsonText}
              language={shellJsonLanguage}
              readOnly
              defaultExpandedDepth={ui.jsonExpandedDepth}
              defaultExpandedLines={jsonDocumentStarts}
              height="100%"
            />
          </div>
        </div>
      )}
      {view === "tree" && (
        <div className="tree-results">
          <div
            className="tree-header"
            role="row"
            style={{
              gridTemplateColumns: treeTemplate,
              minWidth: treeMinWidth,
            }}
          >
            <span>
              Key
              <span
                className="column-resizer tree-column-resizer"
                title={t("拖曳調整欄寬", "Drag to resize column")}
                onMouseDown={(event) => resizeTree(0, event)}
              />
            </span>
            <span>
              Value
              <span
                className="column-resizer tree-column-resizer"
                title={t("拖曳調整欄寬", "Drag to resize column")}
                onMouseDown={(event) => resizeTree(1, event)}
              />
            </span>
            <span>
              Type
              <span
                className="column-resizer tree-column-resizer"
                title={t("拖曳調整欄寬", "Drag to resize column")}
                onMouseDown={(event) => resizeTree(2, event)}
              />
            </span>
          </div>
          <div className="tree-body">
            {rows.map((row, i) => (
              <TreeNode
                key={`${i}-${row.ejson.length}`}
                name={`Document ${i + 1}`}
                value={JSON.parse(row.ejson)}
                settings={ui}
                defaultOpen={i === 0}
                documentRoot
                gridTemplate={treeTemplate}
                gridMinWidth={treeMinWidth}
              />
            ))}
          </div>
        </div>
      )}
      {view === "table" && (
        <div
          className="table-content"
          data-density={ui.rowDensity}
          data-long-text={ui.longTextDisplay}
        >
          <div
            className="table-scroll"
            role="grid"
            aria-label={t("查詢結果", "Query results")}
            aria-rowcount={rows.length + 1}
            aria-colcount={visibleColumns.length + 1}
            tabIndex={0}
            ref={scroll}
            onKeyDown={(e) => {
              if (
                (e.ctrlKey || e.metaKey) &&
                e.key.toLowerCase() === "c" &&
                selected &&
                !(e.target instanceof HTMLInputElement) &&
                !(e.target instanceof HTMLTextAreaElement)
              ) {
                e.preventDefault();
                copy(selected.row, selected.field);
              } else if (
                selected &&
                [
                  "ArrowLeft",
                  "ArrowRight",
                  "ArrowUp",
                  "ArrowDown",
                  "Home",
                  "End",
                ].includes(e.key)
              ) {
                e.preventDefault();
                selectCell(
                  moveGridSelection(
                    selected,
                    visibleColumns,
                    rows.length,
                    e.key,
                  ),
                );
              }
            }}
          >
            <div
              className="data-grid"
              style={{
                width: virtualCols.getTotalSize() + 52,
                minWidth: "100%",
                height: virtualRows.getTotalSize() + 36,
              }}
            >
              <div className="grid-head" role="row" aria-rowindex={1}>
                <div
                  className="row-number"
                  role="columnheader"
                  aria-colindex={1}
                >
                  #
                </div>
                {virtualCols.getVirtualItems().map((col) => {
                  const field = visibleColumns[col.index];
                  const path = safeColumnPath(field);
                  const direction =
                    path && Object.hasOwn(sortDirections, path)
                      ? sortDirections[path]
                      : undefined;
                  return (
                    <div
                      className={`grid-heading ${pinned.includes(field) ? "pinned-heading" : ""}`}
                      role="columnheader"
                      aria-colindex={col.index + 2}
                      aria-sort={
                        direction === 1
                          ? "ascending"
                          : direction === -1
                            ? "descending"
                            : "none"
                      }
                      key={col.key}
                      draggable
                      onDragStart={(e) =>
                        e.dataTransfer.setData("text/irwin-column", field)
                      }
                      onDragOver={(e) => {
                        if (e.dataTransfer.types.includes("text/irwin-column"))
                          e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setOrder(
                          reorderColumn(
                            visibleColumns,
                            e.dataTransfer.getData("text/irwin-column"),
                            field,
                          ),
                        );
                      }}
                      style={{
                        left: col.start + 52,
                        width: col.size,
                      }}
                    >
                      <button
                        className="grid-heading-label grid-sort-button"
                        aria-label={`${path ? t("依欄位排序", "Sort by column") : t("欄位", "Column")} ${field}`}
                        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                        title={t(
                          "點擊切換排序；Alt+←／→ 移動欄位",
                          "Click to cycle sort; Alt+←/→ moves the column",
                        )}
                        disabled={busy}
                        onKeyDown={(event) => {
                          if (
                            !event.altKey ||
                            !["ArrowLeft", "ArrowRight"].includes(event.key)
                          )
                            return;
                          event.preventDefault();
                          const direction = event.key === "ArrowLeft" ? -1 : 1;
                          const neighbor =
                            visibleColumns[col.index + direction];
                          if (
                            !neighbor ||
                            pinned.includes(field) !== pinned.includes(neighbor)
                          )
                            return;
                          setOrder(
                            moveColumnBy(visibleColumns, field, direction),
                          );
                        }}
                        onClick={() => {
                          if (!onSort || !path) return;
                          const next =
                            direction === 1 ? -1 : direction === -1 ? null : 1;
                          onSort(path!, next);
                        }}
                      >
                        {pinned.includes(field) ? "◆ " : ""}
                        {columnLabel(field)}
                        {direction ? (direction === 1 ? " ↑" : " ↓") : ""}
                      </button>
                      <span
                        className="column-resizer"
                        role="separator"
                        tabIndex={0}
                        aria-orientation="vertical"
                        aria-label={`${t("調整欄寬", "Resize column")} ${field}`}
                        aria-valuemin={MIN_TABLE_COLUMN_WIDTH}
                        aria-valuemax={640}
                        aria-valuenow={width(col.index)}
                        title={t(
                          "拖曳或使用左右方向鍵調整欄寬",
                          "Drag or use left/right arrows to resize",
                        )}
                        onMouseDown={(e) => resize(col.index, e)}
                        onKeyDown={(event) => {
                          if (
                            event.key !== "ArrowLeft" &&
                            event.key !== "ArrowRight"
                          )
                            return;
                          event.preventDefault();
                          const delta = event.shiftKey ? 48 : 16;
                          const next = Math.max(
                            MIN_TABLE_COLUMN_WIDTH,
                            Math.min(
                              640,
                              width(col.index) +
                                (event.key === "ArrowRight" ? delta : -delta),
                            ),
                          );
                          setWidths((old) => ({ ...old, [field]: next }));
                          virtualCols.measure();
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              {virtualRows.getVirtualItems().map((row) => (
                <div
                  key={row.key}
                  className={`grid-row ${selected?.row === row.index ? "selected-row" : ""}`}
                  role="row"
                  aria-rowindex={row.index + 2}
                  style={{ top: row.start + 36, height: row.size }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    selectCell({
                      row: row.index,
                      field: visibleColumns[0] || "value",
                    });
                    setContext({
                      row: row.index,
                      field: visibleColumns[0] || "value",
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                >
                  <div
                    className="row-number"
                    role="rowheader"
                    aria-colindex={1}
                    onClick={() =>
                      selectCell({
                        row: row.index,
                        field: visibleColumns[0] || "value",
                      })
                    }
                  >
                    {row.index + 1}
                  </div>
                  {virtualCols.getVirtualItems().map((col) => {
                    const field = visibleColumns[col.index];
                    const value = cellValue(docs[row.index], field);
                    const displayText = label(value, ui);
                    const valueType = typeLabel(value);
                    const showTypeLabel = [
                      "numberInt",
                      "numberLong",
                      "numberDouble",
                      "numberDecimal",
                      "oid",
                      "date",
                      "binary",
                      "timestamp",
                      "regularExpression",
                    ].includes(valueType);
                    const isSelected =
                      selected?.row === row.index && selected?.field === field;
                    const isEditing =
                      editing?.row === row.index && editing.field === field;
                    const showPreview =
                      isSelected &&
                      !isEditing &&
                      needsCellPreview(displayText, col.size);
                    return (
                      <div
                        key={col.key}
                        className={`grid-cell type-${typeLabel(value)} ${isSelected ? "selected-cell" : ""} ${pinned.includes(field) ? "pinned-cell" : ""} ${showPreview ? "has-cell-preview" : ""}`}
                        role="gridcell"
                        aria-colindex={col.index + 2}
                        style={{
                          left: col.start + 52,
                          width: col.size,
                        }}
                        title={`${typeLabel(value)} · ${displayText}`}
                        onMouseDown={(e) => {
                          if (e.button !== 0 || isEditing) return;
                          selectCell({ row: row.index, field }, false);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          selectCell({ row: row.index, field }, false);
                          setContext({
                            row: row.index,
                            field,
                            x: e.clientX,
                            y: e.clientY,
                          });
                        }}
                        onClick={() => {
                          if (!isEditing) scroll.current?.focus();
                        }}
                        onDoubleClick={() => {
                          const scalar =
                            value === null ||
                            typeof value !== "object" ||
                            [
                              "$numberInt",
                              "$numberLong",
                              "$numberDouble",
                              "$numberDecimal",
                              "$oid",
                              "$date",
                            ].includes(Object.keys(value)[0]);
                          if (
                            scalar &&
                            rows[row.index].editable &&
                            safeColumnPath(field) &&
                            !safeColumnPath(field)!.startsWith("_id")
                          )
                            setEditing({
                              row: row.index,
                              field,
                              text: value === undefined ? "null" : displayText,
                              original: value,
                            });
                          else if (safeColumnPath(field))
                            onEdit(row.index, safeColumnPath(field)!, value);
                          else onRowInspect?.(row.index);
                        }}
                      >
                        {isEditing ? (
                          <>
                            <input
                              className="cell-editor"
                              aria-label="Edit cell"
                              autoFocus
                              disabled={editing.busy}
                              value={editing.text}
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  text: e.target.value,
                                  error: "",
                                })
                              }
                              onKeyDown={async (e) => {
                                e.stopPropagation();
                                if (e.key === "Escape") {
                                  setEditing(undefined);
                                  scroll.current?.focus();
                                }
                                if (e.key === "Enter" && !editing.busy) {
                                  e.preventDefault();
                                  setEditing({ ...editing, busy: true });
                                  try {
                                    await onCommit(
                                      editing.row,
                                      safeColumnPath(editing.field) ||
                                        editing.field,
                                      editedValue(
                                        editing.original,
                                        editing.text,
                                      ),
                                    );
                                    setEditing(undefined);
                                    scroll.current?.focus();
                                  } catch (error) {
                                    setEditing({
                                      ...editing,
                                      busy: false,
                                      error: String((error as Error).message),
                                    });
                                  }
                                }
                              }}
                            />
                            {editing.error && (
                              <div className="cell-error" role="alert">
                                {editing.error}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="cell-value-line">
                            {showTypeLabel &&
                              (ui.bsonTypeLabels === "always" ||
                                isSelected) && (
                                <span className="cell-type-badge">
                                  {treeType(value)}
                                </span>
                              )}
                            <span className="cell-preview">{displayText}</span>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {context && (
              <div
                className="row-context-menu"
                style={{
                  left: Math.min(context.x, window.innerWidth - 260),
                  top: Math.max(
                    8,
                    Math.min(context.y, window.innerHeight - 460),
                  ),
                  maxHeight: "calc(100vh - 32px)",
                  overflowY: "auto",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {onFilter && (
                  <>
                    <small>{columnLabel(context.field)}</small>
                    {[
                      ["only", "只顯示此值", "Filter to this value"],
                      ["exclude", "排除此值", "Exclude this value"],
                      ["and", "加入 AND 條件", "Add AND condition"],
                      ["or", "加入 OR 條件", "Add OR condition"],
                      ...(bsonType(
                        cellValue(docs[context.row], context.field),
                      ) === "Date"
                        ? [
                            [
                              "today",
                              "今天（本機時區）",
                              "Today (local timezone)",
                            ],
                            ["week", "最近七天", "Last seven days"],
                          ]
                        : []),
                    ].map(([action, zh, en]) => (
                      <button
                        key={action}
                        disabled={!safeColumnPath(context.field)}
                        title={
                          !safeColumnPath(context.field)
                            ? t(
                                "此特殊欄名不能安全轉成查詢路徑",
                                "This field cannot be used as a safe query path",
                              )
                            : undefined
                        }
                        onClick={() => {
                          onFilter(
                            safeColumnPath(context.field)!,
                            cellValue(docs[context.row], context.field),
                            action as FilterAction,
                          );
                          setContext(undefined);
                        }}
                      >
                        {t(zh, en)}
                      </button>
                    ))}
                    <hr />
                  </>
                )}
                <button
                  onClick={() => {
                    copy(context.row, context.field);
                    setContext(undefined);
                  }}
                >
                  {t("複製欄位值", "Copy cell value")}
                </button>
                <button
                  onClick={() => {
                    setPinned(toggle(pinned, context.field));
                    setContext(undefined);
                  }}
                >
                  {pinned.includes(context.field)
                    ? t("取消凍結此欄", "Unpin column")
                    : t("凍結此欄", "Pin column")}
                </button>
                <button
                  onClick={() => {
                    onRowInspect?.(context.row);
                    setContext(undefined);
                  }}
                >
                  {t("檢視 JSON", "View JSON")}
                </button>
                <button
                  onClick={() => {
                    onRowEdit?.(context.row);
                    setContext(undefined);
                  }}
                >
                  {t("編輯文件", "Edit document")}
                </button>
                <button
                  onClick={() => {
                    onRowCopy?.(context.row);
                    setContext(undefined);
                  }}
                >
                  {t("複製文件", "Copy document")}
                </button>
                <button
                  className="danger-text"
                  onClick={() => {
                    onRowDelete?.(context.row);
                    setContext(undefined);
                  }}
                >
                  {t("刪除文件", "Delete document")}
                </button>
              </div>
            )}
          </div>
          {showColumns && (
            <aside
              className="table-column-menu"
              aria-label={t("欄位設定", "Column settings")}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="table-column-panel-header">
                <strong>{t("顯示欄位", "Visible columns")}</strong>
                <button
                  className="icon"
                  aria-label={t("關閉欄位設定", "Close column settings")}
                  onClick={onCloseColumns}
                >
                  <X size={15} />
                </button>
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                {t(
                  "記住此 Collection 的欄位配置",
                  "Remember this collection layout",
                )}
              </label>
              <small>
                {t(
                  "勾選顯示、菱形凍結；在欄名按 Alt+←／→ 移動，欄界按方向鍵調寬。",
                  "Show or pin fields; Alt+←/→ on a header moves it, arrows on its edge resize it.",
                )}
              </small>
              <div className="table-column-list">
                {columns.map((column) => (
                  <div className="column-option" key={column}>
                    <label title={columnLabel(column)}>
                      <input
                        type="checkbox"
                        checked={!hiddenColumns.includes(column)}
                        disabled={
                          visibleColumns.length === 1 &&
                          !hiddenColumns.includes(column)
                        }
                        onChange={() =>
                          setHiddenColumns((old) =>
                            old.includes(column)
                              ? old.filter((item) => item !== column)
                              : [...old, column],
                          )
                        }
                      />
                      <span>{columnLabel(column)}</span>
                    </label>
                    <button
                      className="column-action"
                      title={t("凍結／取消凍結欄位", "Pin / unpin column")}
                      aria-pressed={pinned.includes(column)}
                      onClick={(e) => {
                        e.preventDefault();
                        setPinned(toggle(pinned, column));
                      }}
                    >
                      {pinned.includes(column) ? "◆" : "◇"}
                    </button>
                    {docs.some((doc) =>
                      ["Object", "Array"].includes(
                        bsonType(cellValue(doc, column)),
                      ),
                    ) && (
                      <button
                        className="column-action"
                        aria-expanded={expanded.includes(column)}
                        title={t(
                          "展開／收合巢狀欄位",
                          "Expand / collapse nested columns",
                        )}
                        onClick={(e) => {
                          e.preventDefault();
                          setExpanded(toggle(expanded, column));
                        }}
                      >
                        {expanded.includes(column) ? "−" : "+"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
