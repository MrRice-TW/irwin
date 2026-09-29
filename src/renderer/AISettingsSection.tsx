import { useEffect, useState } from "react";
import { Plus, ShieldCheck, Trash2, Wifi } from "lucide-react";
import type { Settings } from "../shared/contracts";
import { validateAiEndpoint, type AiProvider } from "../shared/ai";
import { api, Field, message, Modal, useUi } from "./ui";
import { AI_SETTINGS_CHANGED } from "./preferences";

type ProviderRecord = AiProvider & {
  hasApiKey: boolean;
  persistentApiKey: boolean;
};

const emptyProvider = (): AiProvider => ({
  id: crypto.randomUUID(),
  name: "",
  kind: "openai-compatible",
  baseUrl: "http://localhost:11434/v1",
  model: "",
  allowInsecureHttp: false,
});

const endpointFor = (kind: AiProvider["kind"]) =>
  kind === "anthropic"
    ? "https://api.anthropic.com"
    : kind === "gemini"
      ? "https://generativelanguage.googleapis.com"
      : "https://api.openai.com/v1";

export function AISettingsSection({
  settings,
  onUpdate,
}: {
  settings: Settings;
  onUpdate(settings: Settings): void;
}) {
  const { t } = useUi();
  const [providers, setProviders] = useState<ProviderRecord[]>([]);
  const [draft, setDraft] = useState<AiProvider>(emptyProvider);
  const [apiKey, setApiKey] = useState("");
  const [isNew, setIsNew] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = async () => {
    const value = (await api.request(
      "ai.providers.list",
      {},
    )) as ProviderRecord[];
    setProviders(value);
    return value;
  };
  useEffect(() => {
    void load().catch((cause) => setError(message(cause)));
  }, []);

  const selectProvider = (id: string) => {
    if (!id) {
      setDraft(emptyProvider());
      setApiKey("");
      setIsNew(true);
      return;
    }
    const selected = providers.find((item) => item.id === id);
    if (!selected) return;
    const {
      hasApiKey: _hasKey,
      persistentApiKey: _persistent,
      ...provider
    } = selected;
    setDraft(provider);
    setApiKey("");
    setIsNew(false);
  };

  const saveProvider = async (test = false) => {
    if (busy) return;
    const endpoint = validateAiEndpoint(draft.baseUrl, draft.allowInsecureHttp);
    if (!endpoint.ok) {
      setError(
        t(
          endpoint.message || "Endpoint URL is invalid",
          endpoint.message || "Endpoint URL is invalid",
        ),
      );
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = (await api.request("ai.providers.save", {
        provider: draft,
        ...(apiKey ? { apiKey } : {}),
      })) as ProviderRecord;
      await load();
      window.dispatchEvent(new Event(AI_SETTINGS_CHANGED));
      setDraft({
        ...saved,
        hasApiKey: undefined,
        persistentApiKey: undefined,
      } as AiProvider);
      setIsNew(false);
      setApiKey("");
      if (!saved.persistentApiKey && saved.hasApiKey)
        setNotice(
          t(
            "模型金鑰只會保留到 Irwin 關閉；此系統沒有可用的安全儲存。",
            "The model key will stay in memory until Irwin closes because secure storage is unavailable.",
          ),
        );
      else setNotice(t("模型服務已儲存。", "Model service saved."));
      if (test) {
        const result = (await api.request("ai.providers.test", {
          id: saved.id,
        })) as {
          reachable: boolean;
          canRespond: boolean;
          canGenerateDraft: boolean;
        };
        setNotice(
          t(
            `對話 ${result.canRespond ? "通過" : "未通過"}；查詢草稿 ${result.canGenerateDraft ? "通過" : "未通過"}`,
            `Chat ${result.canRespond ? "passed" : "failed"}; query draft ${result.canGenerateDraft ? "passed" : "failed"}`,
          ),
        );
      }
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const removeProvider = async () => {
    if (isNew || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.request("ai.providers.delete", { id: draft.id });
      window.dispatchEvent(new Event(AI_SETTINGS_CHANGED));
      setConfirmDelete(false);
      if (settings.aiDefaultProviderId === draft.id)
        onUpdate({ ...settings, aiDefaultProviderId: "" });
      const next = await load();
      if (next.length) selectProvider(next[0].id);
      else selectProvider("");
      setNotice(t("模型服務已刪除。", "Model service deleted."));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="preferences-section-head">
        <div>
          <h3>{t("AI 助理", "AI assistant")}</h3>
          <p>
            {t(
              "連接自己的雲端或地端模型。AI 只提供說明與查詢草稿。",
              "Connect your own cloud or local model. AI provides explanations and query drafts.",
            )}
          </p>
        </div>
      </div>

      <label className="preference-toggle ai-consent-toggle">
        <input
          type="checkbox"
          name="ai-cloud-consent"
          checked={settings.aiCloudConsent}
          onChange={(event) =>
            onUpdate({ ...settings, aiCloudConsent: event.target.checked })
          }
        />
        <span>
          <strong>
            {t(
              "允許網路模型接收查詢脈絡",
              "Allow remote model services to receive query context",
            )}
          </strong>
          <small>
            {t(
              "一次設定並套用於整個應用程式。會傳送欄位名稱、遮蔽常值的查詢、Explain 指標及你輸入的問題；不會傳送文件樣本。可隨時撤回。",
              "Applies across Irwin. Field names, queries with values masked, Explain metrics and your prompt may be sent to remote services. Document samples are never sent. You can withdraw consent at any time.",
            )}
          </small>
        </span>
      </label>

      <div className="ai-provider-default">
        <Field label={t("預設模型服務", "Default model service")}>
          <select
            name="ai-default-provider"
            value={settings.aiDefaultProviderId}
            onChange={(event) =>
              onUpdate({ ...settings, aiDefaultProviderId: event.target.value })
            }
          >
            <option value="">
              {t("不使用預設服務", "No default service")}
            </option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name} · {provider.model}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="ai-provider-editor">
        <div className="ai-provider-list-head">
          <Field label={t("已設定的模型服務", "Configured model services")}>
            <select
              name="ai-configured-provider"
              value={isNew ? "" : draft.id}
              onChange={(event) => selectProvider(event.target.value)}
            >
              <option value="">
                {t("新增模型服務…", "Add a model service…")}
              </option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name} · {provider.kind}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            className="icon"
            aria-label={t("新增模型服務", "Add model service")}
            title={t("新增模型服務", "Add model service")}
            onClick={() => selectProvider("")}
          >
            <Plus size={15} />
          </button>
        </div>

        <div className="preferences-form-grid">
          <Field label={t("顯示名稱", "Name")}>
            <input
              name="ai-provider-name"
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              placeholder={t("例如：本機 Qwen", "For example: Local Qwen")}
            />
          </Field>
          <Field label={t("服務介面", "Provider interface")}>
            <select
              name="ai-provider-interface"
              value={draft.kind}
              onChange={(event) => {
                const kind = event.target.value as AiProvider["kind"];
                setDraft({ ...draft, kind, baseUrl: endpointFor(kind) });
              }}
            >
              <option value="openai-compatible">
                OpenAI compatible · Ollama · vLLM
              </option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Gemini</option>
            </select>
          </Field>
          <Field label={t("服務位址", "Service URL")} full>
            <input
              name="ai-provider-url"
              value={draft.baseUrl}
              onChange={(event) =>
                setDraft({ ...draft, baseUrl: event.target.value })
              }
              autoComplete="url"
              spellCheck={false}
            />
            <small>
              {t(
                "使用 HTTPS；本機 localhost 可使用 HTTP。",
                "Use HTTPS. HTTP is allowed for localhost.",
              )}
            </small>
          </Field>
          <Field label={t("模型名稱", "Model name")}>
            <input
              name="ai-provider-model"
              value={draft.model}
              onChange={(event) =>
                setDraft({ ...draft, model: event.target.value })
              }
              placeholder="gpt-4.1-mini / claude-sonnet / gemini-2.5-flash"
            />
          </Field>
          <Field
            label={t(
              "API 金鑰（本機模型可留空）",
              "API key (optional for local models)",
            )}
          >
            <input
              type="password"
              name="ai-provider-key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="new-password"
              placeholder={
                isNew
                  ? ""
                  : t(
                      "留白以保留已儲存金鑰",
                      "Leave blank to keep the saved key",
                    )
              }
            />
          </Field>
        </div>

        <label className="ai-insecure-toggle">
          <input
            type="checkbox"
            name="ai-allow-insecure-http"
            checked={draft.allowInsecureHttp}
            onChange={(event) =>
              setDraft({ ...draft, allowInsecureHttp: event.target.checked })
            }
          />
          <span>
            {t("允許內網 HTTP（未加密）", "Allow insecure HTTP on a LAN")}
          </span>
        </label>
        {draft.allowInsecureHttp && (
          <div className="warning notice">
            {t(
              "API 金鑰與查詢脈絡會以未加密方式傳送到此端點。",
              "The API key and query context will travel to this endpoint without encryption.",
            )}
          </div>
        )}

        <div className="ai-provider-actions">
          <button
            type="button"
            disabled={busy || isNew}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={14} /> {t("刪除", "Delete")}
          </button>
          <span />
          <button
            type="button"
            disabled={busy || !draft.name.trim() || !draft.model.trim()}
            onClick={() => void saveProvider()}
          >
            {t("儲存模型", "Save model")}
          </button>
          <button
            className="primary"
            type="button"
            disabled={busy || !draft.name.trim() || !draft.model.trim()}
            onClick={() => void saveProvider(true)}
          >
            <Wifi size={14} />{" "}
            {busy ? t("測試中…", "Testing…") : t("儲存並測試", "Save and test")}
          </button>
        </div>
        {(notice || error) && (
          <div
            className={error ? "error notice" : "success notice"}
            role={error ? "alert" : "status"}
          >
            {error || notice}
          </div>
        )}
        {!isNew &&
          providers.find((item) => item.id === draft.id)?.persistentApiKey && (
            <small className="ai-key-status">
              <ShieldCheck size={13} />{" "}
              {t(
                "API 金鑰已使用作業系統安全儲存。",
                "The API key is protected by operating-system secure storage.",
              )}
            </small>
          )}
      </div>
      {confirmDelete && (
        <Modal
          title={t("刪除模型服務？", "Delete model service?")}
          close={() => setConfirmDelete(false)}
          footer={
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmDelete(false)}
              >
                {t("取消", "Cancel")}
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => void removeProvider()}
              >
                {busy
                  ? t("正在刪除…", "Deleting…")
                  : t("刪除模型", "Delete model")}
              </button>
            </>
          }
        >
          <p>
            {t(
              `「${draft.name}」及其安全儲存的 API 金鑰會立即刪除。若它是全域預設，預設會清除；使用它的連線覆寫也會清除並改用全域預設。即使取消偏好設定，這項刪除也不會復原。`,
              `“${draft.name}” and its securely stored API key will be deleted now. If it is the global default, that default will be cleared; connection overrides that use it will also be cleared and fall back to the global default. Cancelling Preferences will not undo this deletion.`,
            )}
          </p>
        </Modal>
      )}
    </>
  );
}
