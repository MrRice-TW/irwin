import { useState } from "react";
import { Modal, useUi } from "./ui";
export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  run(): void;
}
export function CommandPalette({
  commands,
  items,
  close,
}: {
  commands: boolean;
  items: PaletteItem[];
  close(): void;
}) {
  const { t } = useUi();
  const [text, setText] = useState(""),
    [index, setIndex] = useState(0);
  const matches = items
    .filter((item) =>
      `${item.label} ${item.hint || ""}`
        .toLocaleLowerCase()
        .includes(text.toLocaleLowerCase()),
    )
    .slice(0, 100);
  const choose = (i: number) => {
    const item = matches[i];
    if (item) {
      close();
      item.run();
    }
  };
  return (
    <Modal
      title={
        commands
          ? t("命令面板", "Command palette")
          : t("快速開啟 Collection", "Quick open collection")
      }
      close={close}
    >
      <div className="palette">
        <input
          autoFocus
          aria-label={t(
            "搜尋命令或 Collection",
            "Search commands or collections",
          )}
          placeholder={
            commands
              ? t("輸入功能名稱…", "Type a command…")
              : t(
                  "搜尋已載入的 DB／Collection…",
                  "Search loaded databases / collections…",
                )
          }
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) =>
                matches.length
                  ? (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) %
                    matches.length
                  : 0,
              );
            }
            if (e.key === "Enter") {
              e.preventDefault();
              choose(index);
            }
          }}
        />
        <div role="listbox" className="palette-results">
          {matches.map((item, i) => (
            <button
              key={item.id}
              role="option"
              aria-selected={i === index}
              onClick={() => choose(i)}
            >
              <span>
                {item.label}
                <small>{item.hint}</small>
              </span>
            </button>
          ))}
        </div>
        {!matches.length && (
          <p className="muted">
            {t(
              "沒有符合項目。先連線並展開 DB 以載入 Collection 清單。",
              "No matches. Connect and expand a database to load its collections.",
            )}
          </p>
        )}
        <small className="muted">
          {t(
            "↑↓ 選擇 · Enter 開啟 · Esc 關閉。搜尋不會發送資料庫查詢。",
            "↑↓ select · Enter open · Esc close. Search does not send database queries.",
          )}
        </small>
      </div>
    </Modal>
  );
}
