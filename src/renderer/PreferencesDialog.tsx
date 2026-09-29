import { useState } from "react";
import {
  Code2,
  Languages,
  Palette,
  RotateCcw,
  Sparkles,
  TableProperties,
} from "lucide-react";
import { settingsSchema, type Settings } from "../shared/contracts";
import { Field, Modal, useUi } from "./ui";
import { resetSettingsSection, type PreferenceSection } from "./preferences";
import { AISettingsSection } from "./AISettingsSection";

const sections: {
  id: PreferenceSection;
  icon: typeof Palette;
  zh: string;
  en: string;
}[] = [
  { id: "appearance", icon: Palette, zh: "外觀", en: "Appearance" },
  { id: "editor", icon: Code2, zh: "編輯器", en: "Editor" },
  { id: "ai", icon: Sparkles, zh: "AI 助理", en: "AI assistant" },
  {
    id: "query-results",
    icon: TableProperties,
    zh: "查詢與結果",
    en: "Query & results",
  },
  {
    id: "data-language",
    icon: Languages,
    zh: "資料與語言",
    en: "Data & language",
  },
];

const lightThemes = [
  {
    id: "light",
    zh: "芒果暖色",
    en: "Mango warm",
    swatches: ["#fbf8f2", "#ffffff", "#e9b86b"],
  },
  {
    id: "azure",
    zh: "經典藍",
    en: "Classic blue",
    swatches: ["#f3f7fc", "#ffffff", "#4688c8"],
  },
  {
    id: "forest",
    zh: "森林綠",
    en: "Forest green",
    swatches: ["#f4f8f3", "#ffffff", "#548f68"],
  },
] as const;

export function PreferencesDialog({
  savedSettings,
  draft,
  initialSection = "appearance",
  onUpdate,
  onSave,
  onClose,
}: {
  savedSettings: Settings;
  draft: Settings;
  initialSection?: PreferenceSection;
  onUpdate(settings: Settings): void;
  onSave(): Promise<void>;
  onClose(): void;
}) {
  const { t } = useUi();
  const [section, setSection] = useState<PreferenceSection>(initialSection);
  const [saving, setSaving] = useState(false);
  const defaults = settingsSchema.parse({});
  const hasChanges = JSON.stringify(savedSettings) !== JSON.stringify(draft);
  const parsed = settingsSchema.safeParse(draft);
  const fontError = (value: string) =>
    !value.trim() || value.length > 160
      ? t("請輸入 1 至 160 個字元。", "Enter between 1 and 160 characters.")
      : "";
  const numberError = (value: number, min: number, max: number) =>
    !Number.isInteger(value) || value < min || value > max
      ? t(
          `請輸入 ${min} 至 ${max} 的整數。`,
          `Enter a whole number from ${min} to ${max}.`,
        )
      : "";
  const errors = {
    fontFamily: fontError(draft.fontFamily),
    editorFontFamily: fontError(draft.editorFontFamily),
    fontSize: numberError(draft.fontSize, 11, 18),
    editorLineHeight: numberError(draft.editorLineHeight, 18, 36),
    editorPadding: numberError(draft.editorPadding, 8, 32),
    jsonExpandedDepth: numberError(draft.jsonExpandedDepth, 0, 4),
  };
  const hasErrors = !parsed.success || Object.values(errors).some(Boolean);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onUpdate({ ...draft, [key]: value });
  const updateColor = (key: keyof Settings["colors"], value: string) =>
    onUpdate({ ...draft, colors: { ...draft.colors, [key]: value } });
  const resetSection = () =>
    onUpdate(resetSettingsSection(draft, section, defaults));
  const save = async () => {
    if (saving || hasErrors) return;
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  };
  const errorHint = (name: keyof typeof errors) =>
    errors[name] ? (
      <small className="preference-error" role="alert">
        {errors[name]}
      </small>
    ) : null;

  return (
    <Modal
      className="preferences-modal"
      title={t("偏好設定", "Preferences")}
      close={onClose}
      footer={
        <div className="preferences-footer">
          <div className="preferences-reset-actions">
            <button onClick={resetSection}>
              <RotateCcw size={13} />
              {t("重設此分類", "Reset section")}
            </button>
            <button
              className="subtle"
              onClick={() => onUpdate(defaults)}
              disabled={!hasChanges}
            >
              {t("全部恢復預設", "Reset all")}
            </button>
          </div>
          <span className="preferences-save-status" aria-live="polite">
            {hasChanges
              ? t("有尚未儲存的變更", "Unsaved changes")
              : t("設定已同步", "All changes saved")}
          </span>
          <button onClick={onClose}>{t("取消", "Cancel")}</button>
          <button
            className="primary"
            disabled={!hasChanges || hasErrors || saving}
            onClick={() => void save()}
          >
            {saving
              ? t("正在儲存…", "Saving…")
              : t("儲存設定", "Save settings")}
          </button>
        </div>
      }
    >
      <div className="preferences-layout">
        <nav
          className="preferences-nav"
          aria-label={t("設定分類", "Preference sections")}
        >
          {sections.map(({ id, icon: Icon, zh, en }) => (
            <button
              data-preference-section={id}
              key={id}
              className={section === id ? "active" : ""}
              aria-current={section === id ? "page" : undefined}
              onClick={() => setSection(id)}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{t(zh, en)}</span>
            </button>
          ))}
          <div className="preferences-scope-note">
            {t(
              "全域偏好會套用於工作區；尚未儲存的修改可隨時取消還原。",
              "Global preferences apply across the workspace; Cancel restores unsaved changes.",
            )}
          </div>
        </nav>

        <section
          className="preferences-content"
          data-section={section}
          aria-live="polite"
        >
          {section === "appearance" && (
            <>
              <div className="preferences-section-head">
                <div>
                  <h3>{t("外觀", "Appearance")}</h3>
                  <p>
                    {t(
                      "選擇工作區色彩與系統跟隨方式。",
                      "Choose the workspace palette and system behavior.",
                    )}
                  </p>
                </div>
              </div>
              <div className="preferences-form-grid">
                <Field label={t("主題", "Theme")}>
                  <select
                    value={draft.theme}
                    onChange={(event) =>
                      update("theme", event.target.value as Settings["theme"])
                    }
                  >
                    <option value="system">
                      {t("依照系統切換", "Follow system")}
                    </option>
                    <option value="light">
                      {t("芒果暖色（淺色）", "Mango warm")}
                    </option>
                    <option value="azure">
                      {t("經典藍（淺色）", "Classic blue")}
                    </option>
                    <option value="forest">
                      {t("森林綠（淺色）", "Forest green")}
                    </option>
                    <option value="dark">{t("深色", "Dark")}</option>
                  </select>
                  <small>
                    {t(
                      "主題會立即預覽；取消會還原已儲存的外觀。",
                      "Theme changes preview immediately; Cancel restores the saved appearance.",
                    )}
                  </small>
                </Field>
                {draft.theme === "system" && (
                  <Field
                    label={t(
                      "系統為淺色時使用",
                      "Light palette for System mode",
                    )}
                  >
                    <select
                      value={draft.systemLightTheme}
                      onChange={(event) =>
                        update(
                          "systemLightTheme",
                          event.target.value as Settings["systemLightTheme"],
                        )
                      }
                    >
                      {lightThemes.map(({ id, zh, en }) => (
                        <option key={id} value={id}>
                          {t(zh, en)}
                        </option>
                      ))}
                    </select>
                    <small>
                      {t(
                        "系統為深色時使用 Irwin 深色主題。",
                        "Irwin Dark is used when your system is in dark mode.",
                      )}
                    </small>
                  </Field>
                )}
                <Field label={t("介面縮放", "Interface scale")}>
                  <select
                    value={draft.uiScale}
                    onChange={(event) =>
                      update(
                        "uiScale",
                        Number(event.target.value) as Settings["uiScale"],
                      )
                    }
                  >
                    {[100, 110, 125].map((value) => (
                      <option key={value} value={value}>
                        {value}%
                      </option>
                    ))}
                  </select>
                  <small>
                    {t(
                      "縮放整個工作區；編輯器字級可另外調整。",
                      "Scales the workspace; editor text size remains separate.",
                    )}
                  </small>
                </Field>
              </div>
              <div
                className="preference-theme-preview"
                aria-label={t("主題預覽", "Theme previews")}
              >
                {lightThemes.map(({ id, zh, en, swatches }) => {
                  const selected =
                    draft.theme === id ||
                    (draft.theme === "system" && draft.systemLightTheme === id);
                  return (
                    <button
                      type="button"
                      key={id}
                      className={`theme-preview ${selected ? "selected" : ""}`}
                      onClick={() =>
                        draft.theme === "system"
                          ? update("systemLightTheme", id)
                          : update("theme", id)
                      }
                      aria-pressed={selected}
                      title={t(zh, en)}
                    >
                      <div className="theme-preview-window" data-theme={id}>
                        <span />
                        <span />
                        <span />
                      </div>
                      <span>{t(zh, en)}</span>
                      <div className="theme-swatches" aria-hidden="true">
                        {swatches.map((color) => (
                          <i key={color} style={{ background: color }} />
                        ))}
                      </div>
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={`theme-preview dark-preview ${draft.theme === "dark" ? "selected" : ""}`}
                  aria-pressed={draft.theme === "dark"}
                  onClick={() => update("theme", "dark")}
                  title={t("深色", "Dark")}
                >
                  <div className="theme-preview-window" data-theme="dark">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span>{t("深色", "Dark")}</span>
                  <div className="theme-swatches" aria-hidden="true">
                    <i style={{ background: "#101722" }} />
                    <i style={{ background: "#172230" }} />
                    <i style={{ background: "#e9b86b" }} />
                  </div>
                </button>
              </div>
            </>
          )}

          {section === "editor" && (
            <>
              <div className="preferences-section-head">
                <div>
                  <h3>{t("編輯器", "Editor")}</h3>
                  <p>
                    {t(
                      "分開控制介面字體與 JSON／命令編輯器字體。",
                      "Set the interface font separately from JSON and command editors.",
                    )}
                  </p>
                </div>
              </div>
              <div className="preferences-form-grid">
                <Field label={t("介面字體", "Interface font")}>
                  <input
                    value={draft.fontFamily}
                    aria-invalid={Boolean(errors.fontFamily)}
                    onChange={(event) =>
                      update("fontFamily", event.target.value)
                    }
                    placeholder='Inter, "Segoe UI", sans-serif'
                  />
                  {errorHint("fontFamily")}
                </Field>
                <Field label={t("等寬編輯器字體", "Editor monospace font")}>
                  <input
                    value={draft.editorFontFamily}
                    aria-invalid={Boolean(errors.editorFontFamily)}
                    onChange={(event) =>
                      update("editorFontFamily", event.target.value)
                    }
                    placeholder='Consolas, "Liberation Mono", monospace'
                  />
                  {errorHint("editorFontFamily")}
                </Field>
                <Field label={t("編輯器字體大小", "Editor font size")}>
                  <input
                    type="number"
                    min={11}
                    max={18}
                    value={draft.fontSize}
                    aria-invalid={Boolean(errors.fontSize)}
                    onChange={(event) =>
                      update("fontSize", Number(event.target.value))
                    }
                  />
                  {errorHint("fontSize")}
                </Field>
                <Field label={t("JSON 行距", "JSON line height")}>
                  <input
                    type="number"
                    min={18}
                    max={36}
                    value={draft.editorLineHeight}
                    aria-invalid={Boolean(errors.editorLineHeight)}
                    onChange={(event) =>
                      update("editorLineHeight", Number(event.target.value))
                    }
                  />
                  {errorHint("editorLineHeight")}
                </Field>
                <Field label={t("JSON 上下內距", "JSON vertical padding")}>
                  <input
                    type="number"
                    min={8}
                    max={32}
                    value={draft.editorPadding}
                    aria-invalid={Boolean(errors.editorPadding)}
                    onChange={(event) =>
                      update("editorPadding", Number(event.target.value))
                    }
                  />
                  {errorHint("editorPadding")}
                </Field>
                <Field label={t("縮排空格數", "Indent spaces")}>
                  <select
                    value={draft.tabWidth}
                    onChange={(event) =>
                      update(
                        "tabWidth",
                        Number(event.target.value) as Settings["tabWidth"],
                      )
                    }
                  >
                    {[2, 4, 8].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="preferences-inline-preview">
                <span>{t("即時預覽", "Live preview")}</span>
                <code
                  style={{
                    fontFamily: draft.editorFontFamily,
                    fontSize: `${draft.fontSize}px`,
                  }}
                >{`{ "collection": "orders", "count": 42 }`}</code>
              </div>
            </>
          )}

          {section === "query-results" && (
            <>
              <div className="preferences-section-head">
                <div>
                  <h3>{t("查詢與結果", "Query & results")}</h3>
                  <p>
                    {t(
                      "調整查詢載入、結果呈現與背景工作通知。",
                      "Control query loading, result display and background job notifications.",
                    )}
                  </p>
                </div>
              </div>
              <label className="preference-toggle">
                <span>
                  <strong>
                    {t(
                      "開啟 Collection 時自動查詢",
                      "Run a query when opening a Collection",
                    )}
                  </strong>
                  <small>
                    {t(
                      "關閉後，新開啟的 Collection 會先顯示空結果，按 F5 執行查詢。",
                      "When off, newly opened Collections wait for F5 before loading results.",
                    )}
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={draft.autoRunOnOpen}
                  onChange={(event) =>
                    update("autoRunOnOpen", event.target.checked)
                  }
                />
              </label>
              <div className="preferences-form-grid">
                <Field label={t("資料表列密度", "Table row density")}>
                  <select
                    value={draft.rowDensity}
                    onChange={(event) =>
                      update(
                        "rowDensity",
                        event.target.value as Settings["rowDensity"],
                      )
                    }
                  >
                    <option value="comfortable">
                      {t("舒適", "Comfortable")}
                    </option>
                    <option value="compact">{t("緊湊", "Compact")}</option>
                  </select>
                  <small>
                    {t(
                      "影響資料表中每列的高度。",
                      "Changes the height of table rows.",
                    )}
                  </small>
                </Field>
                <Field
                  label={t("資料表 BSON 型別提示", "Table BSON type labels")}
                >
                  <select
                    value={draft.bsonTypeLabels}
                    onChange={(event) =>
                      update(
                        "bsonTypeLabels",
                        event.target.value as Settings["bsonTypeLabels"],
                      )
                    }
                  >
                    <option value="selected">
                      {t("選取時顯示", "Show on selection")}
                    </option>
                    <option value="always">
                      {t("持續顯示", "Always show")}
                    </option>
                  </select>
                  <small>
                    {t(
                      "標示 ObjectId、Int64、Decimal128 等特殊型別。",
                      "Labels special types such as ObjectId, Int64 and Decimal128.",
                    )}
                  </small>
                </Field>
                <Field label={t("長文字顯示", "Long text display")}>
                  <select
                    value={draft.longTextDisplay}
                    onChange={(event) =>
                      update(
                        "longTextDisplay",
                        event.target.value as Settings["longTextDisplay"],
                      )
                    }
                  >
                    <option value="truncate">
                      {t("截斷並顯示省略號", "Truncate with ellipsis")}
                    </option>
                    <option value="wrap">{t("換行顯示", "Wrap text")}</option>
                  </select>
                  <small>
                    {t(
                      "換行模式最多顯示兩行，完整內容仍可檢視。",
                      "Wrap mode shows up to two lines; the full value remains available.",
                    )}
                  </small>
                </Field>
                <Field
                  label={t("JSON 初始展開層數", "Initial JSON expanded depth")}
                >
                  <input
                    type="number"
                    min={0}
                    max={4}
                    value={draft.jsonExpandedDepth}
                    aria-invalid={Boolean(errors.jsonExpandedDepth)}
                    onChange={(event) =>
                      update("jsonExpandedDepth", Number(event.target.value))
                    }
                  />
                  {errorHint("jsonExpandedDepth")}
                  <small>
                    {t(
                      "0 代表全部展開；1 至 4 會逐層預設折疊更深的物件。",
                      "0 expands everything; 1–4 fold objects below that depth by default.",
                    )}
                  </small>
                </Field>
              </div>
              <div className="preferences-scope-banner">
                {t(
                  "結果顯示偏好會套用於所有分頁；檢視方式、查詢／資料排列與 BATCH 仍保存在各自分頁。",
                  "Result display preferences apply across tabs. View, query/data arrangement and BATCH remain saved per tab.",
                )}
              </div>
              <div className="preferences-job-section">
                <strong>{t("背景任務", "Background jobs")}</strong>
                <Field label={t("完成通知", "Job notifications")}>
                  <select
                    value={draft.jobNotifications}
                    onChange={(event) =>
                      update(
                        "jobNotifications",
                        event.target.value as Settings["jobNotifications"],
                      )
                    }
                  >
                    <option value="failures">
                      {t("僅失敗", "Failures only")}
                    </option>
                    <option value="all">
                      {t("完成與失敗", "Completions and failures")}
                    </option>
                    <option value="off">{t("關閉", "Off")}</option>
                  </select>
                  <small>
                    {t(
                      "適用於匯入、匯出等背景任務；取消不會通知。",
                      "For import, export and other background jobs; cancellations stay quiet.",
                    )}
                  </small>
                </Field>
              </div>
            </>
          )}

          {section === "data-language" && (
            <>
              <div className="preferences-section-head">
                <div>
                  <h3>{t("資料與語言", "Data & language")}</h3>
                  <p>
                    {t(
                      "選擇日期時間格式、顯示語言與 BSON 型別色彩。",
                      "Choose date formatting, interface language and BSON type colors.",
                    )}
                  </p>
                </div>
              </div>
              <div className="preferences-form-grid">
                <Field label={t("語言", "Language")}>
                  <select
                    value={draft.language}
                    onChange={(event) =>
                      update(
                        "language",
                        event.target.value as Settings["language"],
                      )
                    }
                  >
                    <option value="zh">繁體中文</option>
                    <option value="en">English</option>
                  </select>
                </Field>
                <Field label={t("時區", "Timezone")}>
                  <select
                    value={draft.timezone}
                    onChange={(event) =>
                      update(
                        "timezone",
                        event.target.value as Settings["timezone"],
                      )
                    }
                  >
                    <option value="local">{t("本機時區", "Local")}</option>
                    <option value="UTC">UTC</option>
                    <option value="Asia/Taipei">Asia/Taipei</option>
                    <option value="Asia/Tokyo">Asia/Tokyo</option>
                    <option value="America/New_York">America/New_York</option>
                    <option value="Europe/London">Europe/London</option>
                    <option value="Europe/Berlin">Europe/Berlin</option>
                  </select>
                </Field>
                <Field label={t("日期時間格式", "Datetime format")}>
                  <select
                    value={draft.datetimeFormat}
                    onChange={(event) =>
                      update(
                        "datetimeFormat",
                        event.target.value as Settings["datetimeFormat"],
                      )
                    }
                  >
                    <option value="iso">ISO 8601</option>
                    <option value="space">YYYY-MM-DD HH:mm:ss</option>
                    <option value="locale">
                      {t("系統格式", "System locale")}
                    </option>
                  </select>
                </Field>
              </div>
              <div className="preferences-color-section">
                <div className="section-heading">
                  <strong>{t("BSON 型別顏色", "BSON type colors")}</strong>
                  <span className="muted small">
                    {t(
                      "套用於 Table 與 Tree 顯示",
                      "Applied to Table and Tree views",
                    )}
                  </span>
                </div>
                <div className="preferences-colors">
                  {(
                    [
                      ["string", t("字串", "String")],
                      ["number", t("數值", "Number")],
                      ["objectId", "ObjectId"],
                      ["boolean", t("布林", "Boolean")],
                      ["null", "Null / missing"],
                    ] as const
                  ).map(([key, label]) => (
                    <label className="color-field" key={key}>
                      <span>{label}</span>
                      <input
                        type="color"
                        value={draft.colors[key]}
                        onChange={(event) =>
                          updateColor(key, event.target.value)
                        }
                      />
                      <code>{draft.colors[key]}</code>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {section === "ai" && (
            <AISettingsSection settings={draft} onUpdate={onUpdate} />
          )}
        </section>
      </div>
    </Modal>
  );
}
