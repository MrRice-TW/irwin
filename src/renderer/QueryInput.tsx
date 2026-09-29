import { useId, useRef, useState, type PointerEvent } from "react";
import { Braces, Maximize2, ListX } from "lucide-react";
import { CodeEditor } from "./Editor";
import { shellJsonLanguage } from "./json-format";
import {
  editQueryIndentation,
  formatQuery,
  queryKeyIntent,
} from "./query-editing";
import { Modal, useUi, message } from "./ui";
import {
  mongoSuggestions,
  type CompletionContext,
} from "../shared/exploration";
export function QueryInput({
  value,
  onChange,
  context,
  label,
  onClear,
  clearDisabled,
  resizeLabel,
  resizeValue,
  onResizeStart,
  onResizeStep,
}: {
  value: string;
  onChange(v: string): void;
  context: CompletionContext;
  label: string;
  onClear?(): void;
  clearDisabled?: boolean;
  resizeLabel?: string;
  resizeValue?: number;
  onResizeStart?(event: PointerEvent): void;
  onResizeStep?(delta: number): void;
}) {
  const { t, theme, tabWidth, fontFamily, fontSize } = useUi();
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState("");
  const [draftError, setDraftError] = useState("");
  const resizeToContent = () =>
    requestAnimationFrame(() => {
      const el = input.current;
      if (el)
        el.style.height = `${Math.min(220, Math.max(56, el.scrollHeight + 4))}px`;
    });
  const format = () => {
    try {
      onChange(formatQuery(value, tabWidth));
      setError("");
      setOpen(false);
      resizeToContent();
    } catch (e) {
      setError(message(e));
    }
  };
  const expand = () => {
    setOpen(false);
    setDraftError("");
    try {
      setDraft(formatQuery(value, tabWidth));
    } catch {
      setDraft(value);
    }
  };
  const formatDraft = () => {
    try {
      setDraft(formatQuery(draft || "{}", tabWidth));
      setDraftError("");
    } catch (e) {
      setDraftError(message(e));
    }
  };
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState(0),
    [selected, setSelected] = useState(0);
  const prefix = value.slice(0, position),
    word = prefix.match(/[\w.$]*$/)?.[0] || "";
  const options = mongoSuggestions(prefix, context)
    .filter(
      (item) =>
        !item.detail.includes("→") &&
        !["ISODate", "Last 7 days"].includes(item.label) &&
        item.label.toLowerCase().startsWith(word.toLowerCase()),
    )
    .slice(0, 12);
  const accept = (index: number) => {
    const item = options[index];
    if (!item) return;
    const text =
      item.label === "ObjectId"
        ? '{ "$oid": "000000000000000000000000" }'
        : item.insertText;
    const start = position - word.length;
    onChange(value.slice(0, start) + text + value.slice(position));
    setOpen(false);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(
        start + text.length,
        start + text.length,
      );
    });
  };
  return (
    <div className="field query-field">
      <div className="query-field-heading">
        <label htmlFor={id}>{label}</label>
        <div className="query-field-actions">
          {onClear && (
            <button
              type="button"
              className="icon"
              aria-label={t("清除排序", "Clear sort")}
              title={t("清除排序並重新查詢", "Clear sort and run again")}
              disabled={clearDisabled}
              onClick={onClear}
            >
              <ListX size={13} />
            </button>
          )}
          <button
            type="button"
            className="icon"
            aria-label={`${t("格式化", "Format")} ${label}`}
            title={t("格式化 · Shift+Alt+F", "Format · Shift+Alt+F")}
            onClick={format}
          >
            <Braces size={13} />
          </button>
          <button
            type="button"
            className="icon"
            aria-label={`${t("展開", "Expand")} ${label}`}
            title={t("展開編輯（自動格式化）", "Expand editor (auto-format)")}
            onClick={expand}
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>
      <div className="query-input-wrap">
        <textarea
          ref={input}
          id={id}
          data-query-input="true"
          rows={1}
          style={{ fontFamily, fontSize, tabSize: tabWidth }}
          title={t(
            "拖曳右下角調整高度 · Enter 換行 · Tab 縮排 · Ctrl+Tab 取消 · F5 查詢",
            "Drag the bottom-right corner to resize · Enter adds a line · Tab indents · Ctrl+Tab outdents · F5 runs",
          )}
          aria-label={label}
          role="combobox"
          aria-expanded={open && !!options.length}
          aria-autocomplete="list"
          value={value}
          spellCheck={false}
          onChange={(e) => {
            onChange(e.target.value);
            setError("");
            setPosition(e.target.selectionStart || 0);
            setSelected(0);
            setOpen(
              /[A-Za-z_$][\w.$]*$/.test(
                e.target.value.slice(0, e.target.selectionStart || 0),
              ),
            );
          }}
          onClick={(e) => setPosition(e.currentTarget.selectionStart || 0)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            const intent = queryKeyIntent(
              e.key,
              e.ctrlKey,
              e.shiftKey,
              e.metaKey,
            );
            if (intent === "newline") {
              setOpen(false);
              return;
            }
            if (intent === "indent" || intent === "unindent") {
              e.preventDefault();
              const textarea = e.currentTarget;
              const edit = editQueryIndentation(
                textarea.value,
                textarea.selectionStart,
                textarea.selectionEnd,
                tabWidth,
                intent,
              );
              onChange(edit.value);
              setError("");
              setOpen(false);
              setPosition(edit.selectionStart);
              requestAnimationFrame(() => {
                textarea.setSelectionRange(
                  edit.selectionStart,
                  edit.selectionEnd,
                );
              });
              return;
            }
            if (e.shiftKey && e.altKey && e.code === "KeyF") {
              e.preventDefault();
              format();
              return;
            }
            if (e.ctrlKey && e.code === "Space") {
              e.preventDefault();
              setOpen(true);
              return;
            }
            if (!open || !options.length) return;
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setSelected(
                (i) =>
                  (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) %
                  options.length,
              );
            }
          }}
        />
        {open && !!options.length && (
          <div role="listbox" className="query-suggestions">
            {options.map((item, i) => (
              <button
                key={item.label}
                role="option"
                aria-selected={i === selected}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => accept(i)}
              >
                <code>{item.label}</code>
                <small>{item.detail}</small>
              </button>
            ))}
          </div>
        )}
      </div>
      {error && (
        <small className="query-format-error" role="alert">
          {error}
        </small>
      )}
      {onResizeStart && (
        <div
          className="query-column-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={resizeLabel}
          aria-valuemin={1}
          aria-valuemax={99}
          aria-valuenow={Math.max(1, Math.min(99, resizeValue ?? 50))}
          aria-valuetext={t(
            `左側欄位寬度 ${Math.max(1, Math.min(99, resizeValue ?? 50))}%`,
            `Left field width ${Math.max(1, Math.min(99, resizeValue ?? 50))}%`,
          )}
          title={resizeLabel}
          tabIndex={0}
          onPointerDown={onResizeStart}
          onKeyDown={(e) => {
            if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
              e.preventDefault();
              onResizeStep?.(e.key === "ArrowLeft" ? -20 : 20);
            }
          }}
        />
      )}
      {draft !== undefined && (
        <Modal
          title={`${label} ${t("編輯器", "editor")}`}
          wide
          resizable
          close={() => setDraft(undefined)}
          footer={
            <>
              <small className="muted">
                {t(
                  "套用後按 F5 或執行查詢 · Shift+Alt+F 格式化",
                  "Apply, then press F5 or Run · Shift+Alt+F formats",
                )}
              </small>
              <button onClick={() => setDraft(undefined)}>
                {t("取消", "Cancel")}
              </button>
              <button onClick={formatDraft}>
                <Braces size={14} />
                {t("格式化文件", "Format document")}
              </button>
              <button
                className="primary"
                onClick={() => {
                  try {
                    onChange(formatQuery(draft, tabWidth));
                    setDraft(undefined);
                    setError("");
                    resizeToContent();
                  } catch (e) {
                    setDraftError(message(e));
                  }
                }}
              >
                {t("套用", "Apply")}
              </button>
            </>
          }
        >
          <div
            className="document-editor-surface"
            onKeyDownCapture={(e) => {
              if (e.shiftKey && e.altKey && e.code === "KeyF") {
                e.preventDefault();
                e.stopPropagation();
                formatDraft();
              }
            }}
          >
            <CodeEditor
              value={draft}
              onChange={(v) => {
                setDraft(v);
                setDraftError("");
              }}
              theme={theme}
              language={shellJsonLanguage}
              height="100%"
              completionContext={context}
            />
          </div>
          {draftError && (
            <div className="notice error" role="alert">
              {draftError}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
