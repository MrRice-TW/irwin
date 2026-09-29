import { useEffect, useId, useMemo, useState } from "react";
import { Bookmark, Folder, Pencil, Search, Trash2 } from "lucide-react";
import { savedQuerySchema, type SavedQuery } from "../shared/saved-query";
import { object } from "../shared/bson";
import { Modal, Field, api, message, useUi } from "./ui";
import { QueryInput } from "./QueryInput";

export function SavedQueryDialog({
  value,
  close,
  saved,
}: {
  value: SavedQuery;
  close(): void;
  saved(value: SavedQuery): void;
}) {
  const { t } = useUi();
  const [draft, setDraft] = useState(value);
  const [groups, setGroups] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const groupList = useId();
  useEffect(() => {
    let live = true;
    api
      .request("savedQueries.list", {})
      .then((items: SavedQuery[]) => {
        if (live)
          setGroups([
            ...new Set(items.map((item) => item.group).filter(Boolean)),
          ]);
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, []);
  const updateQuery = (key: string, value: string | number) =>
    setDraft((old) => ({ ...old, query: { ...old.query, [key]: value } }));
  const save = async () => {
    setError("");
    if (!draft.name.trim()) {
      setError(t("請輸入查詢名稱。", "Enter a query name."));
      return;
    }
    try {
      const parsed = savedQuerySchema.parse(draft);
      if (parsed.query.mode === "find") {
        for (const field of ["filter", "sort", "projection"] as const) {
          try {
            object(parsed.query[field] || "{}");
          } catch (e) {
            throw new Error(`${field.toUpperCase()}: ${message(e)}`);
          }
        }
      }
      setBusy(true);
      const result: SavedQuery = await api.request("savedQueries.save", parsed);
      saved(result);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      wide
      title={t("儲存／編輯查詢", "Save / edit query")}
      close={() => {
        if (!busy) close();
      }}
      footer={
        <>
          <button disabled={busy} onClick={close}>
            {t("取消", "Cancel")}
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {t("儲存查詢", "Save query")}
          </button>
        </>
      }
    >
      <div className="saved-query-form">
        <Field label={t("查詢名稱", "Query name")}>
          <input
            autoFocus
            name="saved-query-name"
            autoComplete="off"
            maxLength={160}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </Field>
        <Field label={t("群組／資料夾", "Group / folder")}>
          <input
            name="saved-query-group"
            autoComplete="off"
            list={groupList}
            maxLength={160}
            placeholder={t("例如：日常查詢／訂單", "e.g. Daily / Orders")}
            value={draft.group}
            onChange={(e) => setDraft({ ...draft, group: e.target.value })}
          />
          <datalist id={groupList}>
            {groups.map((group) => (
              <option key={group} value={group} />
            ))}
          </datalist>
        </Field>
        <Field full label={t("說明", "Description")}>
          <input
            name="saved-query-description"
            autoComplete="off"
            maxLength={2000}
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
          />
        </Field>
        {draft.query.mode === "find" ? (
          <>
            {(["filter", "sort", "projection"] as const).map((field) => (
              <QueryInput
                key={field}
                label={field.toUpperCase()}
                context={{ fields: [], collections: [] }}
                value={draft.query[field]}
                onChange={(value) => updateQuery(field, value)}
              />
            ))}
            <div className="saved-query-numbers">
              <Field label="BATCH">
                <input
                  type="number"
                  name="saved-query-batch"
                  min={1}
                  max={1000}
                  value={draft.query.batchSize}
                  onChange={(e) =>
                    updateQuery("batchSize", Number(e.target.value))
                  }
                />
                <small>
                  {t(
                    "每次從伺服器載入的筆數。",
                    "Rows fetched from the server per batch.",
                  )}
                </small>
              </Field>
            </div>
          </>
        ) : (
          <Field full label={t("Shell 程式", "Shell script")}>
            <textarea
              name="saved-query-script"
              autoComplete="off"
              rows={8}
              value={draft.query.code}
              onChange={(e) => updateQuery("code", e.target.value)}
            />
          </Field>
        )}
        <p className="muted full">
          {t(
            "保存完整條件；日後可套用到目前分頁的 DB／Collection，不會自動執行。",
            "Save all inputs for reuse on the current DB / collection. Applying does not execute the query.",
          )}
        </p>
        {draft.query.mode === "shell" && (
          <p className="muted full">
            {t(
              "Shell 會保留原始程式；程式內寫明的資料庫與 Collection 名稱需自行調整。",
              "Shell scripts are kept verbatim. Adjust any explicit database or collection names in the script before running.",
            )}
          </p>
        )}
        {error && (
          <p role="alert" className="error full">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

export function SavedQueries({
  revision,
  target,
  apply,
}: {
  revision: number;
  target?: { label: string; kind: "collection" | "shell" };
  apply(query: SavedQuery): void;
}) {
  const { t } = useUi();
  const [items, setItems] = useState<SavedQuery[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<SavedQuery>();
  const [removing, setRemoving] = useState<SavedQuery>();
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setItems(await api.request("savedQueries.list", {}));
  };
  useEffect(() => {
    let live = true;
    api
      .request("savedQueries.list", {})
      .then((value: SavedQuery[]) => {
        if (live) {
          setItems(value);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [revision]);
  const groups = useMemo(() => {
    const found = new Map<string, SavedQuery[]>();
    for (const item of items) {
      if (
        ![
          item.name,
          item.group,
          item.description,
          item.source?.database,
          item.source?.collection,
          JSON.stringify(item.query),
        ]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())
      )
        continue;
      found.set(item.group, [...(found.get(item.group) || []), item]);
    }
    return [...found.entries()];
  }, [items, search]);
  return (
    <div
      className="saved-queries"
      aria-label={t("已儲存查詢", "Saved queries")}
    >
      <div className="saved-query-search">
        <Search size={15} />
        <input
          aria-label={t("搜尋已儲存查詢", "Search saved queries")}
          placeholder={t("搜尋名稱、群組或條件", "Search name, group or query")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <p className="saved-query-target muted">
        {target
          ? t(`套用目標：${target.label}`, `Apply to: ${target.label}`)
          : t(
              "先開啟目標環境的 Collection 或 Shell 分頁，再套用查詢。",
              "Open the target environment's collection or Shell tab to apply a query.",
            )}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!groups.length && (
        <p className="muted">
          {t(
            "尚無符合的已儲存查詢。可從查詢工具列按「儲存查詢」。",
            "No saved queries match. Use Save query in the query toolbar to add one.",
          )}
        </p>
      )}
      {groups.map(([group, queries]) => (
        <details className="saved-query-group" open key={group}>
          <summary>
            <Folder size={14} /> {group || t("未分組", "Ungrouped")}{" "}
            <span className="muted">{queries.length}</span>
          </summary>
          {queries.map((item) => (
            <article
              key={item.id}
              className="saved-query-item"
              aria-label={item.name}
            >
              <div className="saved-query-details">
                <strong>
                  <Bookmark size={13} /> {item.name}
                </strong>
                {item.description && <span>{item.description}</span>}
                <small className="muted">
                  {item.query.mode === "find"
                    ? `Filter ${item.query.filter} · Sort ${item.query.sort} · Projection ${item.query.projection} · Batch ${item.query.batchSize}`
                    : item.query.code}
                </small>
                {item.source && (
                  <small className="muted">
                    {t("儲存來源", "Saved from")}: {item.source.connectionName}{" "}
                    / {item.source.database}.{item.source.collection}
                  </small>
                )}
              </div>
              <div className="saved-query-actions">
                <button
                  disabled={
                    !target ||
                    (item.query.mode === "find" && target.kind === "shell")
                  }
                  onClick={() => apply(item)}
                >
                  {t("套用到目前分頁", "Apply to current tab")}
                </button>
                <button
                  className="icon"
                  aria-label={t("編輯查詢", "Edit query")}
                  title={t(
                    "編輯名稱、群組與條件",
                    "Edit name, group and inputs",
                  )}
                  onClick={() => setEditing(item)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="icon"
                  aria-label={t("刪除已儲存查詢", "Delete saved query")}
                  onClick={() => {
                    setError("");
                    setRemoving(item);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))}
        </details>
      ))}
      {editing && (
        <SavedQueryDialog
          value={editing}
          close={() => setEditing(undefined)}
          saved={() => {
            setEditing(undefined);
            void refresh().catch((e) => setError(message(e)));
          }}
        />
      )}
      {removing && (
        <Modal
          title={t("刪除已儲存查詢", "Delete saved query")}
          close={() => {
            if (!busy) setRemoving(undefined);
          }}
          footer={
            <>
              <button disabled={busy} onClick={() => setRemoving(undefined)}>
                {t("取消", "Cancel")}
              </button>
              <button
                disabled={busy}
                className="danger"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.request("savedQueries.delete", {
                      id: removing.id,
                    });
                    await refresh();
                    setRemoving(undefined);
                  } catch (e) {
                    setError(message(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("確認刪除", "Confirm delete")}
              </button>
            </>
          }
        >
          <p>
            {t("確定刪除此已儲存查詢？", "Delete this saved query?")}{" "}
            <strong>{removing.name}</strong>
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
