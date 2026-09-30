import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Database,
  Plus,
  Search,
  Terminal,
  Settings2,
  MoreHorizontal,
  PlugZap,
  Unplug,
  ChevronRight,
  ChevronDown,
  Layers,
  X,
  History,
  Activity,
  House,
  Copy,
  Pencil,
  Trash2,
  FolderPlus,
  Upload,
  Download,
  CircleCheck,
  CircleAlert,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import {
  settingsSchema,
  type Profile,
  type JobProgress,
  type Settings,
  type TransferInput,
  type ShellDraft,
} from "../shared/contracts";
import type { UpdateStatus } from "../main/update-service";
import { UiContext, Modal, Field, api, message } from "./ui";
import { PreferencesDialog } from "./PreferencesDialog";
import { UpdateDialog } from "./UpdateDialog";
import ConnectionDialog from "./ConnectionDialog";
import type { ShellDraftChange, WorkspaceTab } from "./CollectionTab";
import TransferDialog from "./TransferDialog";
import WorkspaceHome from "./WorkspaceHome";
import { collectionSort } from "./helpers";
import { filterHistory } from "./history-filter";
import { jobDiagnosticText } from "./job-diagnostic";
import { diagnoseConnectionError } from "../shared/connection-diagnostics";
import irwinMangoIcon from "../../build/icon.png";
import { navigationEntries } from "./navigation";
import { CommandPalette, type PaletteItem } from "./CommandPalette";
import { AnalysisDialog, type AnalysisTarget } from "./AnalysisDialog";
import { buildCellFilter } from "../shared/exploration";
import type { TabState } from "../shared/workspace";
import {
  AI_SETTINGS_CHANGED,
  resolveTheme,
  type PreferenceSection,
} from "./preferences";
import { jobNotificationKind } from "../shared/job-notifications";

const CollectionTab = lazy(() => import("./CollectionTab"));
const AggregationTab = lazy(() => import("./AggregationTab"));
const ReceiptsDialog = lazy(() => import("./ReceiptsDialog"));
const UsersRolesDialog = lazy(() => import("./UsersRolesDialog"));
const SavedQueries = lazy(() =>
  import("./SavedQueries").then(({ SavedQueries }) => ({
    default: SavedQueries,
  })),
);

export default function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [settings, setSettings] = useState<Settings>(() =>
    settingsSchema.parse({}),
  );
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const notifiedJobs = useRef(new Set<string>());
  const [preferences, setPreferences] = useState(false);
  const [showUpdates, setShowUpdates] = useState(false);
  const [applicationVersion, setApplicationVersion] = useState("");
  const [applicationPlatform, setApplicationPlatform] = useState("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>();
  const [preferencesSection, setPreferencesSection] =
    useState<PreferenceSection>("appearance");
  const [settingsDraft, setSettingsDraft] = useState<Settings>(() =>
    settingsSchema.parse({}),
  );
  const [systemTheme, setSystemTheme] = useState<"dark" | "light">(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );
  const effectiveSettings = preferences ? settingsDraft : settings;
  const resolvedTheme = resolveTheme(
    effectiveSettings.theme,
    systemTheme,
    effectiveSettings.systemLightTheme,
  );
  const t = (zh: string, en: string) =>
    effectiveSettings.language === "zh" ? zh : en;
  const uiValue = useMemo(
    () => ({
      ...effectiveSettings,
      theme: resolvedTheme,
      settings: effectiveSettings,
      t: (zh: string, en: string) =>
        effectiveSettings.language === "zh" ? zh : en,
    }),
    [effectiveSettings, resolvedTheme],
  );
  const [connected, setConnected] = useState<string[]>([]);
  const [connecting, setConnecting] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dbs, setDbs] = useState<Record<string, string[]>>({});
  const [collections, setCollections] = useState<
    Record<string, { name: string; type: string }[]>
  >({});
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [active, setActive] = useState("");
  const activeTab = tabs.find((tab) => tab.id === active);
  const [search, setSearch] = useState("");
  const [connectionDialog, setConnectionDialog] = useState<{
    profile?: Profile;
  }>();
  const [connectionPickerOpen, setConnectionPickerOpen] = useState(false);
  const [menu, setMenu] = useState("");
  const [transfer, setTransfer] = useState<
    Partial<TransferInput> & { connectionId: string; database: string }
  >();
  const [jobs, setJobs] = useState<JobProgress[]>([]);
  const [showJobs, setShowJobs] = useState(false);
  const [showReceipts, setShowReceipts] = useState(false);
  const [usersRolesProfile, setUsersRolesProfile] = useState<Profile>();
  const [jobsHeight, setJobsHeight] = useState(220);
  const [history, setHistory] = useState<any[]>();
  const [historyHeight, setHistoryHeight] = useState(260);
  const [historySearch, setHistorySearch] = useState("");
  const [historyView, setHistoryView] = useState<"history" | "saved">(
    "history",
  );
  const [savedQueryRevision, setSavedQueryRevision] = useState(0);
  const [toast, setToast] = useState<{
    text: string;
    error: boolean;
    time: number;
  }>();
  const [secure, setSecure] = useState<boolean>();
  const [admin, setAdmin] = useState<{
    kind: "create" | "drop";
    profile: Profile;
    database: string;
    collection: string;
  }>();
  const [adminDb, setAdminDb] = useState("");
  const [adminColl, setAdminColl] = useState("");
  const [confirm, setConfirm] = useState("");
  const [adminError, setAdminError] = useState("");
  const [removingProfile, setRemovingProfile] = useState<Profile>();
  const [removing, setRemoving] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(268);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [shellDrafts, setShellDrafts] = useState<ShellDraft[]>([]);
  const [showShellDrafts, setShowShellDrafts] = useState(false);
  const [shellDirty, setShellDirty] = useState<Record<string, boolean>>({});
  const [shellDraftByTab, setShellDraftByTab] = useState<
    Record<string, ShellDraft>
  >({});
  const [closingShellTab, setClosingShellTab] = useState<WorkspaceTab>();
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [palette, setPalette] = useState<"collections" | "commands">();
  const [analysis, setAnalysis] = useState<{
    mode: "schema" | "compare";
    target: AnalysisTarget;
  }>();
  const onTabStateChange = useCallback((id: string, state: TabState) => {
    setTabs((old) =>
      old.map((tab) =>
        tab.id === id && JSON.stringify(tab.state) !== JSON.stringify(state)
          ? { ...tab, state }
          : tab,
      ),
    );
  }, []);
  const notify = (text: string, error = false) =>
    setToast({ text, error, time: Date.now() });
  const checkForUpdates = () =>
    void api
      .request("updates.check", {})
      .then(setUpdateStatus)
      .catch((error) => notify(message(error), true));
  const installUpdate = () =>
    void api
      .request("updates.install", {})
      .catch((error) => notify(message(error), true));
  const openReleasePage = () =>
    void api
      .request("updates.openRelease", {})
      .catch((error) => notify(message(error), true));
  const loadProfiles = () =>
    api
      .request("connections.list", {})
      .then(setProfiles)
      .catch((e) => notify(message(e), true));
  useEffect(() => {
    if (!api) return;
    void loadProfiles();
    void Promise.all([
      api.request("settings.get", {}),
      api.request("workspace.get", {}),
    ])
      .then(([preferences, workspace]) => {
        setSettings(preferences);
        // Tabs intentionally start clean on every launch. The persisted
        // workspace is limited to pane sizes, never queries or open targets.
        setSidebarWidth(workspace.sidebarWidth);
        setJobsHeight(workspace.jobsHeight);
        setHistoryHeight(workspace.historyHeight);
        setWorkspaceReady(true);
      })
      .catch((e) => notify(message(e), true));
    void api
      .request("app.status", {})
      .then((s) => {
        setApplicationVersion(s.version);
        setApplicationPlatform(s.platform);
        setSecure(s.secureStorage);
        setConnected(s.connections);
        setUpdateStatus(s.update);
      })
      .catch((e) => notify(message(e), true));
    void api
      .request("shellDrafts.list", {})
      .then((drafts) => {
        setShellDrafts(drafts);
        setShowShellDrafts(drafts.length > 0);
      })
      .catch((e) => notify(message(e), true));
    return api.subscribe((event) => {
      if (event.type === "job") {
        setJobs((old) =>
          [
            ...old.filter((j) => j.jobId !== event.data.jobId),
            event.data,
          ].slice(-100),
        );
        const kind = jobNotificationKind(
          settingsRef.current.jobNotifications,
          event.data,
        );
        if (
          kind &&
          document.hasFocus() &&
          !notifiedJobs.current.has(event.data.jobId)
        ) {
          notifiedJobs.current.add(event.data.jobId);
          const zh = settingsRef.current.language === "zh";
          setToast({
            text:
              kind === "failed"
                ? zh
                  ? "背景任務失敗，請開啟任務面板查看結果。"
                  : "Background job failed. Open Jobs for details."
                : zh
                  ? "背景任務已完成，請開啟任務面板查看結果。"
                  : "Background job completed. Open Jobs for details.",
            error: kind === "failed",
            time: Date.now(),
          });
        }
      }
      if (event.type === "connection") {
        if (event.data.allClosed) {
          setConnected([]);
          notify("Database engine stopped. Reconnect to continue.", true);
        } else
          setConnected((old) =>
            event.data.connected
              ? [...new Set([...old, event.data.id])]
              : old.filter((id) => id !== event.data.id),
          );
      }
      if (event.type === "openJobs") setShowJobs(true);
      if (event.type === "update") setUpdateStatus(event.data);
    });
  }, []);
  useEffect(() => {
    if (!workspaceReady) return;
    const timer = setTimeout(
      () =>
        void api
          .request("workspace.save", {
            version: 1,
            sidebarWidth,
            jobsHeight,
            historyHeight,
          })
          .catch((e) => notify(message(e), true)),
      150,
    );
    return () => clearTimeout(timer);
  }, [workspaceReady, sidebarWidth, jobsHeight, historyHeight]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemTheme(media.matches ? "dark" : "light");
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "p")
        return;
      event.preventDefault();
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
      setPalette(event.shiftKey ? "commands" : "collections");
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.lang =
      effectiveSettings.language === "zh" ? "zh-Hant" : "en";
  }, [resolvedTheme, effectiveSettings.language]);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--font-family", effectiveSettings.fontFamily);
    root.style.setProperty("--tab-width", String(effectiveSettings.tabWidth));
    root.style.setProperty("--bson-string", effectiveSettings.colors.string);
    root.style.setProperty("--bson-number", effectiveSettings.colors.number);
    root.style.setProperty(
      "--bson-object-id",
      effectiveSettings.colors.objectId,
    );
    root.style.setProperty("--bson-boolean", effectiveSettings.colors.boolean);
    root.style.setProperty("--bson-null", effectiveSettings.colors.null);
  }, [effectiveSettings]);
  useEffect(() => {
    void api
      .request("settings.zoom", { value: effectiveSettings.uiScale })
      .catch((e) => notify(message(e), true));
  }, [effectiveSettings.uiScale]);
  useEffect(() => {
    if (toast && !toast.error) {
      const timer = setTimeout(() => setToast(undefined), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    const closeTransientMenus = (event?: PointerEvent) => {
      const target = event?.target;
      if (
        target instanceof Element &&
        target.closest(
          ".row-context-menu, .node-menu, .connection-picker-anchor",
        )
      ) {
        return;
      }
      setMenu("");
      setConnectionPickerOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeTransientMenus();
    };
    window.addEventListener("pointerdown", closeTransientMenus);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeTransientMenus);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
  const startSidebarResize = (event: ReactMouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const move = (current: globalThis.MouseEvent) =>
      setSidebarWidth(
        Math.max(220, Math.min(420, startWidth + current.clientX - startX)),
      );
    const end = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
  };
  const clampBottomPanelHeight = (height: number) =>
    Math.max(
      120,
      Math.min(Math.max(220, Math.floor(window.innerHeight * 0.55)), height),
    );
  const startBottomPanelResize = (
    event: ReactPointerEvent<HTMLDivElement>,
    currentHeight: number,
    setHeight: (height: number) => void,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const move = (nextEvent: PointerEvent) =>
      setHeight(
        clampBottomPanelHeight(currentHeight + startY - nextEvent.clientY),
      );
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  };
  const savePreferences = async () => {
    const parsed = settingsSchema.safeParse(settingsDraft);
    if (!parsed.success) {
      notify(
        parsed.error.issues[0]?.message ||
          t("偏好設定無效", "Invalid preferences"),
        true,
      );
      return;
    }
    try {
      const saved = await api.request("settings.set", parsed.data);
      setSettings(saved);
      setSettingsDraft(saved);
      window.dispatchEvent(new Event(AI_SETTINGS_CHANGED));
      setPreferences(false);
    } catch (e) {
      notify(message(e), true);
    }
  };
  const toggle = (key: string) =>
    setExpanded((old) => ({ ...old, [key]: !old[key] }));
  const openConnection = async (profile: Profile, force = false) => {
    if (connecting.includes(profile.id)) return;
    if (connected.includes(profile.id) && !force) {
      toggle(profile.id);
      return;
    }
    setConnecting((old) => [...old, profile.id]);
    try {
      await api.request("connections.open", { id: profile.id });
      const data = await api.request("metadata.databases", {
        connectionId: profile.id,
      });
      setDbs((old) => ({ ...old, [profile.id]: data.names }));
      setExpanded((old) => ({ ...old, [profile.id]: true }));
      if (data.restricted)
        notify(
          t(
            "僅顯示有權限的預設資料庫。",
            "Showing the permitted default database.",
          ),
        );
    } catch (e) {
      const diagnostic = diagnoseConnectionError(e);
      notify(
        `${message(e)}\n${t(
          "連線診斷：",
          "Connection diagnosis: ",
        )}${diagnostic.advice}`,
        true,
      );
    } finally {
      setConnecting((old) => old.filter((id) => id !== profile.id));
    }
  };
  const openDb = async (profile: Profile, db: string, force = false) => {
    const key = `${profile.id}/${db}`;
    if (expanded[key] && !force) {
      toggle(key);
      return;
    }
    try {
      const names = await api.request("metadata.collections", {
        connectionId: profile.id,
        database: db,
      });
      setCollections((old) => ({ ...old, [key]: names }));
      setExpanded((old) => ({ ...old, [key]: true }));
    } catch (e) {
      notify(message(e), true);
    }
  };
  const openTab = (
    profile: Profile,
    database: string,
    collection: string,
    kind: "collection" | "shell" | "aggregation",
    initialCode?: string,
    draftId?: string,
    options?: { newTab?: boolean },
  ) => {
    const matches =
      kind !== "shell" && !options?.newTab
        ? tabs.filter(
            (v) =>
              v.connectionId === profile.id &&
              v.database === database &&
              v.collection === collection &&
              v.kind === kind,
          )
        : [];
    const existing = matches.find((tab) => tab.id === active) || matches[0];
    if (existing) {
      setActive(existing.id);
      return existing.id;
    }
    const tab: WorkspaceTab = {
      id: crypto.randomUUID(),
      connectionId: profile.id,
      connectionName: profile.name,
      database,
      collection,
      kind,
      initialCode,
      draftId: kind === "shell" ? draftId || crypto.randomUUID() : undefined,
    };
    setTabs((old) => [...old, tab]);
    setActive(tab.id);
    return tab.id;
  };
  const tabNumber = (tab: WorkspaceTab) => {
    if (tab.kind === "shell" || tab.kind === "aggregation") return undefined;
    const siblings = tabs.filter(
      (candidate) =>
        candidate.kind === "collection" &&
        candidate.connectionId === tab.connectionId &&
        candidate.database === tab.database &&
        candidate.collection === tab.collection,
    );
    return siblings.length > 1
      ? siblings.findIndex((candidate) => candidate.id === tab.id) + 1
      : undefined;
  };
  const tabLabel = (tab: WorkspaceTab) => {
    const number = tabNumber(tab);
    return tab.kind === "shell"
      ? "Shell"
      : tab.kind === "aggregation"
        ? `${tab.collection} · Aggregation`
        : `${tab.collection}${number ? ` (${number})` : ""}`;
  };
  const openCollectionIndexes = (
    profile: Profile,
    database: string,
    collection: string,
  ) => {
    const tabId = openTab(profile, database, collection, "collection");
    setTabs((old) =>
      old.map((tab) =>
        tab.id === tabId ? { ...tab, showIndexes: crypto.randomUUID() } : tab,
      ),
    );
    setActive(tabId);
    setMenu("");
  };
  const removeTab = (id: string) => {
    const rest = tabs.filter((v) => v.id !== id);
    setTabs(rest);
    if (active === id) setActive(rest.at(-1)?.id || "");
    setShellDirty((old) => {
      const next = { ...old };
      delete next[id];
      return next;
    });
    setShellDraftByTab((old) => {
      const next = { ...old };
      delete next[id];
      return next;
    });
  };
  const closeTab = (id: string) => {
    const tab = tabs.find((item) => item.id === id);
    if (tab?.kind === "shell" && shellDirty[id]) {
      setClosingShellTab(tab);
      return;
    }
    removeTab(id);
  };
  const onShellDraftChange = useCallback(
    (id: string, change: ShellDraftChange) => {
      setShellDirty((old) =>
        old[id] === change.dirty ? old : { ...old, [id]: change.dirty },
      );
      if (change.draft)
        setShellDraftByTab((old) => ({ ...old, [id]: change.draft! }));
      if (change.discard)
        setShellDraftByTab((old) => {
          const next = { ...old };
          delete next[id];
          return next;
        });
    },
    [],
  );
  const restoreShellDraft = (draft: ShellDraft) => {
    const profile = profiles.find((item) => item.id === draft.connectionId);
    if (!profile) {
      notify(
        t(
          "找不到草稿所屬連線。",
          "The saved connection for this draft is unavailable.",
        ),
        true,
      );
      return;
    }
    const tab: WorkspaceTab = {
      id: crypto.randomUUID(),
      connectionId: profile.id,
      connectionName: profile.name,
      database: draft.database,
      collection: draft.collection,
      kind: "shell",
      initialCode: draft.code,
      draftId: draft.id,
    };
    setTabs((old) => [...old, tab]);
    setActive(tab.id);
    setShellDrafts((old) => old.filter((item) => item.id !== draft.id));
    setShellDraftByTab((old) => ({ ...old, [tab.id]: draft }));
  };
  const discardShellDraft = (draft: ShellDraft) => {
    void api
      .request("shellDrafts.delete", { id: draft.id })
      .catch((e) => notify(message(e), true));
    setShellDrafts((old) => old.filter((item) => item.id !== draft.id));
  };
  const removeProfile = async () => {
    if (!removingProfile || removing) return;
    setRemoving(true);
    try {
      await api.request("connections.delete", { id: removingProfile.id });
      setTabs((old) =>
        old.filter((tab) => tab.connectionId !== removingProfile.id),
      );
      setProfiles((old) =>
        old.filter((profile) => profile.id !== removingProfile.id),
      );
      setRemovingProfile(undefined);
      notify(t("已移除連線設定", "Saved connection removed"));
    } catch (e) {
      notify(message(e), true);
    } finally {
      setRemoving(false);
    }
  };
  const adminAction = (
    kind: "create" | "drop",
    profile: Profile,
    database = "",
    collection = "",
  ) => {
    if (profile.readOnly) {
      notify(
        t(
          "此連線已設為唯讀，無法建立或刪除資料庫物件。",
          "This connection is read-only; database objects cannot be created or deleted.",
        ),
        true,
      );
      setMenu("");
      return;
    }
    setAdmin({ kind, profile, database, collection });
    setAdminDb(database);
    setAdminColl(kind === "drop" ? collection : "");
    setConfirm("");
    setAdminError("");
    setMenu("");
  };
  const submitAdmin = async () => {
    if (!admin) return;
    try {
      if (admin.kind === "create") {
        await api.request("metadata.createCollection", {
          connectionId: admin.profile.id,
          database: adminDb,
          collection: adminColl,
        });
      } else {
        await api.request("metadata.drop", {
          connectionId: admin.profile.id,
          database: adminDb,
          collection: adminColl,
          confirmation: confirm,
        });
        setTabs((old) =>
          old.filter(
            (tab) =>
              !(
                tab.connectionId === admin.profile.id &&
                tab.database === adminDb &&
                (!adminColl || tab.collection === adminColl)
              ),
          ),
        );
      }
      await openConnection(admin.profile, true);
      if (admin.kind === "create" || adminColl)
        await openDb(admin.profile, adminDb, true);
      setAdmin(undefined);
    } catch (e) {
      setAdminError(message(e));
    }
  };
  if (!api)
    return (
      <div className="desktop-required">
        <Database size={48} />
        <h1>Irwin</h1>
        <p>
          {t(
            "請使用 Electron 桌面程式啟動：pnpm dev",
            "Launch the Electron desktop application: pnpm dev",
          )}
        </p>
      </div>
    );
  const running = jobs.filter((j) => j.status === "running").length;
  const activeProfiles = profiles.filter((profile) =>
    connected.includes(profile.id),
  );
  const searchTerm = search.trim().toLocaleLowerCase();
  const navigation = navigationEntries(profiles, connected, dbs, collections);
  const matchesName = (value: string) =>
    value.toLocaleLowerCase().includes(searchTerm);
  const shown = activeProfiles.filter(
    (profile) =>
      matchesName(`${profile.name} ${profile.group}`) ||
      navigation.some(
        (entry) =>
          entry.connectionId === profile.id && matchesName(entry.label),
      ),
  );
  const currentTab = tabs.find((tab) => tab.id === active);
  const paletteItems: PaletteItem[] =
    palette === "collections"
      ? navigation
          .filter((entry) => entry.collection)
          .map((entry) => ({
            id: JSON.stringify(entry),
            label: entry.collection,
            hint: `${entry.connectionName} / ${entry.database}`,
            run: () => {
              const profile = profiles.find((p) => p.id === entry.connectionId);
              if (profile)
                openTab(
                  profile,
                  entry.database,
                  entry.collection,
                  "collection",
                );
            },
          }))
      : [
          {
            id: "open",
            label: t("快速開啟 Collection", "Quick open collection"),
            hint: "Ctrl/Cmd+P",
            run: () => setPalette("collections"),
          },
          {
            id: "connection",
            label: t("新增連線", "New connection"),
            run: () => setConnectionDialog({}),
          },
          {
            id: "settings",
            label: t("偏好設定", "Preferences"),
            run: () => {
              setSettingsDraft(settings);
              setPreferencesSection("appearance");
              setPreferences(true);
            },
          },
          {
            id: "history",
            label: t("歷史與收藏", "History & saved"),
            run: () => {
              void api
                .request("history.list", {})
                .then(setHistory)
                .catch((e) => notify(message(e), true));
            },
          },
          {
            id: "jobs",
            label: t("傳輸任務", "Transfer jobs"),
            run: () => setShowJobs(true),
          },
          ...(currentTab?.collection
            ? [
                {
                  id: "schema",
                  label: t(
                    "分析目前 Collection 的 Schema",
                    "Analyze collection schema",
                  ),
                  run: () =>
                    setAnalysis({ mode: "schema", target: currentTab }),
                },
                {
                  id: "compare",
                  label: t("跨環境比較", "Compare collections"),
                  run: () =>
                    setAnalysis({ mode: "compare", target: currentTab }),
                },
                {
                  id: "export",
                  label: t("匯出目前 Collection", "Export current collection"),
                  run: () =>
                    setTransfer({ ...currentTab, direction: "export" }),
                },
              ]
            : []),
        ];
  const updateAvailable = Boolean(updateStatus?.availableVersion);
  return (
    <UiContext.Provider value={uiValue}>
      <div className="app-shell">
        <aside
          className={`sidebar${sidebarCollapsed ? " collapsed" : ""}`}
          style={{ width: sidebarCollapsed ? 52 : sidebarWidth }}
        >
          <div className="brand">
            <div className="brand-icon">
              <img src={irwinMangoIcon} alt="Irwin" width={36} height={36} />
            </div>
            <div>
              <strong>Irwin</strong>
              <small>{t("MongoDB 資料工作台", "MongoDB workspace")}</small>
            </div>
          </div>
          <div className="sidebar-heading">
            <span>{t("連線工作區", "Connections")}</span>
            <div className="sidebar-heading-actions">
              <button
                className="icon new-connection-button"
                title={t("新增連線", "New connection")}
                aria-label={t("新增連線", "New connection")}
                onClick={() => setConnectionDialog({})}
              >
                <Plus size={17} />
              </button>
              <button
                className="icon"
                title={
                  sidebarCollapsed
                    ? t("展開連線工作區", "Expand connections")
                    : t(
                        "收合連線工作區，擴大資料區",
                        "Collapse connections to expand data area",
                      )
                }
                aria-label={
                  sidebarCollapsed
                    ? t("展開連線工作區", "Expand connections")
                    : t(
                        "收合連線工作區，擴大資料區",
                        "Collapse connections to expand data area",
                      )
                }
                aria-expanded={!sidebarCollapsed}
                aria-controls="connections-tree"
                onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen size={16} />
                ) : (
                  <PanelLeftClose size={16} />
                )}
              </button>
            </div>
          </div>
          {activeProfiles.length > 0 && (
            <div className="sidebar-search">
              <Search size={15} />
              <input
                aria-label={t("搜尋連線", "Search connections")}
                placeholder={t(
                  "搜尋連線、DB 或 Collection…",
                  "Find connection, DB or collection…",
                )}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}
          <nav
            id="connections-tree"
            className="connection-tree"
            aria-label={t("資料庫連線", "Database connections")}
          >
            {!shown.length && (
              <div className="sidebar-empty">
                <PlugZap size={25} />
                <p>
                  {search.trim() && activeProfiles.length
                    ? t("沒有符合的連線", "No matching connections")
                    : t("尚未連線任何資料庫", "No active connections")}
                </p>
                <button
                  className="text-button"
                  onClick={() => {
                    if (search.trim() && activeProfiles.length) {
                      setSearch("");
                      return;
                    }
                    if (profiles.length) {
                      setConnectionPickerOpen(true);
                      return;
                    }
                    setConnectionDialog({});
                  }}
                >
                  {search.trim() && activeProfiles.length
                    ? t("清除搜尋", "Clear search")
                    : profiles.length
                      ? t("開啟已儲存連線", "Open saved connection")
                      : t("新增連線", "New connection")}
                </button>
              </div>
            )}
            {[
              ...new Set(shown.map((p) => p.group || t("未分組", "Ungrouped"))),
            ].map((group) => (
              <div key={group}>
                <div className="group-label">{group}</div>
                {shown
                  .filter(
                    (p) => (p.group || t("未分組", "Ungrouped")) === group,
                  )
                  .map((profile) => (
                    <div className="connection-node" key={profile.id}>
                      <div className="connection-row">
                        <button
                          className="tree-main"
                          disabled={connecting.includes(profile.id)}
                          aria-expanded={
                            connected.includes(profile.id) &&
                            !!expanded[profile.id]
                          }
                          title={
                            connected.includes(profile.id)
                              ? t("已連線", "Connected")
                              : t("點擊連線", "Click to connect")
                          }
                          onClick={() => void openConnection(profile)}
                        >
                          {connecting.includes(profile.id) ? (
                            <LoaderCircle className="spin" size={15} />
                          ) : expanded[profile.id] &&
                            connected.includes(profile.id) ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                          <Database size={16} />
                          <span>{profile.name}</span>
                          <em
                            aria-hidden="true"
                            className={`environment-badge ${profile.environment}`}
                          >
                            {profile.environment.slice(0, 3).toUpperCase()}
                          </em>
                          {profile.readOnly && (
                            <em aria-hidden="true" className="read-only-badge">
                              RO
                            </em>
                          )}
                          <i
                            className={
                              connected.includes(profile.id)
                                ? "online-dot"
                                : "offline-dot"
                            }
                          />
                        </button>
                        <button
                          className="icon node-menu-trigger"
                          aria-label={`${profile.name} ${t("連線選單", "connection menu")}`}
                          aria-expanded={menu === profile.id}
                          onClick={() =>
                            setMenu(menu === profile.id ? "" : profile.id)
                          }
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      </div>
                      {menu === profile.id && (
                        <div className="node-menu">
                          <button
                            disabled={profile.readOnly}
                            onClick={() => {
                              setConnectionDialog({ profile });
                              setMenu("");
                            }}
                          >
                            <Pencil size={14} />
                            {t("編輯連線", "Edit")}
                          </button>
                          <button
                            onClick={() =>
                              void api
                                .request("connections.copy", { id: profile.id })
                                .then(() => {
                                  setMenu("");
                                  void loadProfiles();
                                })
                                .catch((e) => notify(message(e), true))
                            }
                          >
                            <Copy size={14} />
                            {t("複製", "Duplicate")}
                          </button>
                          <button
                            disabled={profile.readOnly}
                            onClick={() => {
                              openTab(profile, profile.database, "", "shell");
                              setMenu("");
                            }}
                          >
                            <Terminal size={14} />
                            Shell
                          </button>
                          <button
                            disabled={profile.readOnly}
                            onClick={() => adminAction("create", profile)}
                          >
                            <FolderPlus size={14} />
                            {t("建立資料庫", "Create database")}
                          </button>
                          <button
                            disabled={connecting.includes(profile.id)}
                            onClick={() => {
                              setUsersRolesProfile(profile);
                              setMenu("");
                            }}
                          >
                            <ShieldCheck size={14} />
                            {t("使用者與角色", "Users & roles")}
                          </button>
                          <button
                            onClick={() => void openConnection(profile, true)}
                          >
                            <PlugZap size={14} />
                            {t("重新整理", "Refresh")}
                          </button>
                          <button
                            onClick={() =>
                              void api
                                .request("connections.close", {
                                  id: profile.id,
                                })
                                .then(() => {
                                  setMenu("");
                                  setTabs((old) =>
                                    old.filter(
                                      (tab) => tab.connectionId !== profile.id,
                                    ),
                                  );
                                })
                                .catch((e) => notify(message(e), true))
                            }
                          >
                            <Unplug size={14} />
                            {t("中斷連線", "Disconnect")}
                          </button>
                          <button
                            className="danger-text"
                            onClick={() => {
                              setMenu("");
                              setRemovingProfile(profile);
                            }}
                          >
                            <Trash2 size={14} />
                            {t("刪除連線設定", "Remove saved connection")}
                          </button>
                        </div>
                      )}
                      {connected.includes(profile.id) &&
                        (expanded[profile.id] || !!searchTerm) && (
                          <div className="databases">
                            {(dbs[profile.id] || [profile.database])
                              .filter(
                                (db) =>
                                  matchesName(
                                    `${profile.name} ${profile.group} ${db}`,
                                  ) ||
                                  (
                                    collections[`${profile.id}/${db}`] || []
                                  ).some((c) => matchesName(c.name)),
                              )
                              .map((db) => {
                                const key = `${profile.id}/${db}`;
                                return (
                                  <div key={key}>
                                    <div className="db-row">
                                      <button
                                        className="tree-main"
                                        aria-expanded={!!expanded[key]}
                                        onClick={() => void openDb(profile, db)}
                                      >
                                        {expanded[key] ? (
                                          <ChevronDown size={13} />
                                        ) : (
                                          <ChevronRight size={13} />
                                        )}
                                        <Database size={14} />
                                        <span>{db}</span>
                                      </button>
                                      <button
                                        className="icon node-menu-trigger"
                                        aria-label={`${db} ${t("資料庫選單", "database menu")}`}
                                        aria-expanded={menu === key}
                                        onClick={() =>
                                          setMenu(menu === key ? "" : key)
                                        }
                                      >
                                        <MoreHorizontal size={15} />
                                      </button>
                                    </div>
                                    {menu === key && (
                                      <div className="node-menu">
                                        <button
                                          disabled={profile.readOnly}
                                          onClick={() => {
                                            openTab(profile, db, "", "shell");
                                            setMenu("");
                                          }}
                                        >
                                          <Terminal size={14} />
                                          Shell
                                        </button>
                                        <button
                                          disabled={profile.readOnly}
                                          onClick={() =>
                                            adminAction("create", profile, db)
                                          }
                                        >
                                          <Plus size={14} />
                                          {t(
                                            "建立 Collection",
                                            "Create collection",
                                          )}
                                        </button>
                                        <button
                                          onClick={() => {
                                            setTransfer({
                                              connectionId: profile.id,
                                              database: db,
                                              direction: "export",
                                            });
                                            setMenu("");
                                          }}
                                        >
                                          <Download size={14} />
                                          {t("匯出 DB", "Export DB")}
                                        </button>
                                        <button
                                          disabled={profile.readOnly}
                                          onClick={() => {
                                            setTransfer({
                                              connectionId: profile.id,
                                              database: db,
                                              direction: "import",
                                            });
                                            setMenu("");
                                          }}
                                        >
                                          <Upload size={14} />
                                          {t("匯入 DB", "Import DB")}
                                        </button>
                                        <button
                                          onClick={() =>
                                            void openDb(profile, db, true)
                                          }
                                        >
                                          {t("重新整理", "Refresh")}
                                        </button>
                                        <button
                                          className="danger-text"
                                          disabled={profile.readOnly}
                                          onClick={() =>
                                            adminAction("drop", profile, db)
                                          }
                                        >
                                          <Trash2 size={14} />
                                          {t("刪除 DB", "Drop database")}
                                        </button>
                                      </div>
                                    )}
                                    {(expanded[key] || !!searchTerm) && (
                                      <div className="collections">
                                        {collectionSort(
                                          (collections[key] || []).filter((c) =>
                                            matchesName(
                                              `${profile.name} ${profile.group} ${db} ${c.name}`,
                                            ),
                                          ),
                                        ).map((coll) => {
                                          const collectionMenu = `${key}/${coll.name}`;
                                          return (
                                            <div
                                              className="collection-node"
                                              key={coll.name}
                                            >
                                              <div
                                                className={`collection-row ${tabs.find((v) => v.id === active)?.collection === coll.name && tabs.find((v) => v.id === active)?.database === db && tabs.find((v) => v.id === active)?.connectionId === profile.id ? "active" : ""}`}
                                                onPointerDown={(event) =>
                                                  event.stopPropagation()
                                                }
                                                onContextMenu={(event) => {
                                                  event.preventDefault();
                                                  setMenu((current) =>
                                                    current === collectionMenu
                                                      ? ""
                                                      : collectionMenu,
                                                  );
                                                }}
                                              >
                                                <button
                                                  className="tree-main"
                                                  onClick={(event) => {
                                                    setMenu("");
                                                    openTab(
                                                      profile,
                                                      db,
                                                      coll.name,
                                                      "collection",
                                                      undefined,
                                                      undefined,
                                                      {
                                                        newTab:
                                                          event.ctrlKey ||
                                                          event.metaKey,
                                                      },
                                                    );
                                                  }}
                                                >
                                                  <Layers size={13} />
                                                  <span>{coll.name}</span>
                                                </button>
                                                <button
                                                  className="icon node-menu-trigger"
                                                  title={t(
                                                    "Collection 選單",
                                                    "Collection menu",
                                                  )}
                                                  aria-label={t(
                                                    "Collection 選單",
                                                    "Collection menu",
                                                  )}
                                                  onClick={() =>
                                                    setMenu((current) =>
                                                      current === collectionMenu
                                                        ? ""
                                                        : collectionMenu,
                                                    )
                                                  }
                                                >
                                                  <MoreHorizontal size={13} />
                                                </button>
                                              </div>
                                              {menu === collectionMenu && (
                                                <div className="node-menu collection-context-menu">
                                                  <button
                                                    onClick={() => {
                                                      setMenu("");
                                                      openTab(
                                                        profile,
                                                        db,
                                                        coll.name,
                                                        "collection",
                                                        undefined,
                                                        undefined,
                                                        { newTab: true },
                                                      );
                                                    }}
                                                  >
                                                    <Plus size={14} />
                                                    {t(
                                                      "在新分頁開啟",
                                                      "Open in new tab",
                                                    )}
                                                  </button>
                                                  <button
                                                    onClick={() => {
                                                      setMenu("");
                                                      openTab(
                                                        profile,
                                                        db,
                                                        coll.name,
                                                        "aggregation",
                                                      );
                                                    }}
                                                  >
                                                    <Layers size={14} />
                                                    {t(
                                                      "開啟 Aggregation",
                                                      "Open Aggregation",
                                                    )}
                                                  </button>
                                                  <button
                                                    onClick={() => {
                                                      setMenu("");
                                                      setAnalysis({
                                                        mode: "schema",
                                                        target: {
                                                          connectionId:
                                                            profile.id,
                                                          database: db,
                                                          collection: coll.name,
                                                        },
                                                      });
                                                    }}
                                                  >
                                                    {t(
                                                      "Schema 與資料品質",
                                                      "Schema & data quality",
                                                    )}
                                                  </button>
                                                  <button
                                                    onClick={() => {
                                                      setMenu("");
                                                      setAnalysis({
                                                        mode: "compare",
                                                        target: {
                                                          connectionId:
                                                            profile.id,
                                                          database: db,
                                                          collection: coll.name,
                                                        },
                                                      });
                                                    }}
                                                  >
                                                    {t(
                                                      "跨環境資料比較",
                                                      "Compare collections",
                                                    )}
                                                  </button>
                                                  <button
                                                    disabled={profile.readOnly}
                                                    onClick={() => {
                                                      openTab(
                                                        profile,
                                                        db,
                                                        coll.name,
                                                        "shell",
                                                      );
                                                      setMenu("");
                                                    }}
                                                  >
                                                    <Terminal size={14} />
                                                    Shell
                                                  </button>
                                                  <button
                                                    onClick={() =>
                                                      openCollectionIndexes(
                                                        profile,
                                                        db,
                                                        coll.name,
                                                      )
                                                    }
                                                  >
                                                    <Layers size={14} />
                                                    {t(
                                                      "管理索引",
                                                      "Manage indexes",
                                                    )}
                                                  </button>
                                                  <button
                                                    onClick={() => {
                                                      setTransfer({
                                                        connectionId:
                                                          profile.id,
                                                        database: db,
                                                        collection: coll.name,
                                                        direction: "export",
                                                      });
                                                      setMenu("");
                                                    }}
                                                  >
                                                    <Download size={14} />
                                                    {t(
                                                      "匯出 Collection",
                                                      "Export collection",
                                                    )}
                                                  </button>
                                                  <button
                                                    disabled={profile.readOnly}
                                                    onClick={() => {
                                                      setTransfer({
                                                        connectionId:
                                                          profile.id,
                                                        database: db,
                                                        collection: coll.name,
                                                        direction: "import",
                                                      });
                                                      setMenu("");
                                                    }}
                                                  >
                                                    <Upload size={14} />
                                                    {t(
                                                      "匯入 Collection",
                                                      "Import collection",
                                                    )}
                                                  </button>
                                                  <button
                                                    className="danger-text"
                                                    disabled={profile.readOnly}
                                                    onClick={() =>
                                                      adminAction(
                                                        "drop",
                                                        profile,
                                                        db,
                                                        coll.name,
                                                      )
                                                    }
                                                  >
                                                    <Trash2 size={14} />
                                                    {t(
                                                      "刪除 Collection",
                                                      "Drop collection",
                                                    )}
                                                  </button>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                        {collections[key]?.length === 0 && (
                                          <span className="muted small empty-collection">
                                            {t(
                                              "尚無 Collection",
                                              "No collections",
                                            )}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                        )}
                    </div>
                  ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className={connected.length ? "online-dot" : "offline-dot"} />
            <span>
              {connected.length} {t("個連線開啟", "connections open")}
            </span>
            <button
              className={`version ${
                updateAvailable ? "version-update-available" : ""
              }`}
              aria-label={t(
                updateAvailable
                  ? `目前版本 v${applicationVersion || "…"}，有新版本 v${updateStatus?.availableVersion} 可用，開啟查看更新`
                  : `目前版本 v${applicationVersion || "…"}，開啟更新檢查`,
                updateAvailable
                  ? `Version ${applicationVersion || "…"}; version ${updateStatus?.availableVersion} is available, open updates`
                  : `Version ${applicationVersion || "…"}, open update checker`,
              )}
              title={t(
                updateAvailable
                  ? `有新版本 v${updateStatus?.availableVersion} 可用，點此查看`
                  : "檢查軟體更新",
                updateAvailable
                  ? `Version ${updateStatus?.availableVersion} is available. Click to view.`
                  : "Check for software updates",
              )}
              onClick={() => {
                setShowUpdates(true);
                checkForUpdates();
              }}
            >
              {updateStatus?.state === "checking" ? (
                <RefreshCw size={11} className="update-version-spinner" />
              ) : null}
              v{applicationVersion || "…"}
              {updateAvailable && (
                <span className="version-update-dot" aria-hidden="true" />
              )}
            </button>
          </div>
        </aside>
        <div
          className="sidebar-resizer"
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-valuemin={220}
          aria-valuemax={420}
          aria-valuenow={sidebarWidth}
          aria-label={t(
            "調整 Collections 側欄寬度",
            "Resize collections sidebar",
          )}
          onMouseDown={startSidebarResize}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              setSidebarWidth((width) =>
                Math.max(
                  220,
                  Math.min(
                    420,
                    width + (event.key === "ArrowRight" ? 20 : -20),
                  ),
                ),
              );
            }
          }}
        />
        <main className="main-workspace">
          <header className="app-header">
            <div className="workspace-title">
              {t("資料工作台", "Data workspace")}
            </div>
            <div className="toolbar">
              <button
                className="icon"
                aria-label={t("命令面板", "Command palette")}
                title="Ctrl/Cmd+Shift+P"
                onClick={() => setPalette("commands")}
              >
                <Search size={16} />
              </button>
              <div
                className="connection-picker-anchor"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <button
                  className={connectionPickerOpen ? "active" : ""}
                  aria-expanded={connectionPickerOpen}
                  onClick={() => setConnectionPickerOpen(!connectionPickerOpen)}
                >
                  <PlugZap size={16} />
                  {t("連線", "Connections")}
                  {connected.length > 0 && (
                    <span className="count">{connected.length}</span>
                  )}
                </button>
                {connectionPickerOpen && (
                  <div
                    className="connection-picker"
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <div className="connection-picker-heading">
                      <strong>{t("已儲存連線", "Saved connections")}</strong>
                      <button
                        className="icon"
                        onClick={() => setConnectionDialog({})}
                        title={t("新增連線", "New connection")}
                        aria-label={t("新增連線", "New connection")}
                      >
                        <Plus size={15} />
                      </button>
                    </div>
                    {!profiles.length && (
                      <p className="muted small">
                        {t("尚未儲存連線。", "No saved connections yet.")}
                      </p>
                    )}
                    {profiles.map((profile) => (
                      <button
                        className="connection-picker-item"
                        key={profile.id}
                        disabled={connecting.includes(profile.id)}
                        onClick={() => {
                          setConnectionPickerOpen(false);
                          void openConnection(profile);
                        }}
                      >
                        <Database size={15} />
                        <span>
                          {profile.name}
                          <small>{profile.group || profile.database}</small>
                        </span>
                        <i
                          className={
                            connected.includes(profile.id)
                              ? "online-dot"
                              : "offline-dot"
                          }
                        />
                      </button>
                    ))}
                    <button
                      className="text-button connection-picker-new"
                      onClick={() => {
                        setConnectionPickerOpen(false);
                        setConnectionDialog({});
                      }}
                    >
                      <Plus size={14} />
                      {t("新增資料庫連線", "New database connection")}
                    </button>
                  </div>
                )}
              </div>
              <button
                className={history ? "active" : ""}
                onClick={() => {
                  if (history) {
                    setHistory(undefined);
                    return;
                  }
                  void api
                    .request("history.list", {})
                    .then((items) => {
                      setShowJobs(false);
                      setHistory(items);
                    })
                    .catch((e) => notify(message(e), true));
                }}
              >
                <History size={16} />
                {t("歷史與收藏", "History & saved")}
              </button>
              {shellDrafts.length > 0 && (
                <button onClick={() => setShowShellDrafts(true)}>
                  <Terminal size={16} />
                  {t(
                    `草稿 ${shellDrafts.length}`,
                    `Drafts ${shellDrafts.length}`,
                  )}
                </button>
              )}
              <button
                className={showJobs ? "active" : ""}
                onClick={() => {
                  setHistory(undefined);
                  setShowJobs((current) => !current);
                }}
              >
                <Activity size={16} />
                {t("任務", "Jobs")}
                {running > 0 && <span className="count">{running}</span>}
              </button>
              <div className="separator" />
              <button
                className="icon"
                title={t("偏好設定", "Preferences")}
                aria-label={t("偏好設定", "Preferences")}
                onClick={() => {
                  setSettingsDraft(settings);
                  setPreferencesSection("appearance");
                  setPreferences(true);
                }}
              >
                <Settings2 size={17} />
              </button>
            </div>
          </header>
          {secure === false && (
            <div className="security-banner">
              {t(
                "系統安全儲存不可用；密碼只保留於本次工作階段。",
                "Secure storage is unavailable. Passwords are kept for this session only.",
              )}
            </div>
          )}
          <div
            className="tabs-bar"
            aria-label={t("工作區分頁", "Workspace tabs")}
          >
            <button
              className={`home-tab ${!tabs.some((tab) => tab.id === active) ? "active" : ""}`}
              aria-pressed={!tabs.some((tab) => tab.id === active)}
              onClick={() => setActive("")}
            >
              <House size={15} />
              {t("首頁", "Home")}
            </button>
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`workspace-tab ${active === tab.id ? "active" : ""}`}
              >
                <button
                  aria-pressed={active === tab.id}
                  aria-label={`${tabLabel(tab)} · ${tab.connectionName} / ${tab.database}`}
                  title={`${tab.connectionName} / ${tab.database} / ${tabLabel(tab)}`}
                  onClick={() => setActive(tab.id)}
                >
                  {tab.kind === "shell" ? (
                    <Terminal size={15} />
                  ) : (
                    <Layers size={15} />
                  )}
                  <span>{tabLabel(tab)}</span>
                  {tabNumber(tab) && (
                    <b className="tab-number" aria-hidden="true">
                      {tabNumber(tab)}
                    </b>
                  )}
                  <small>{tab.database}</small>
                  {profiles.find(
                    (profile) => profile.id === tab.connectionId,
                  ) && (
                    <em
                      aria-hidden="true"
                      className={`environment-badge ${profiles.find((profile) => profile.id === tab.connectionId)!.environment}`}
                    >
                      {profiles
                        .find((profile) => profile.id === tab.connectionId)!
                        .environment.slice(0, 3)
                        .toUpperCase()}
                    </em>
                  )}
                </button>
                <button
                  className="icon"
                  onClick={() => closeTab(tab.id)}
                  aria-label={`${t("關閉分頁", "Close tab")} ${tabLabel(tab)}`}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          <div className="panels">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`workspace-panel ${active === tab.id ? "visible" : ""}`}
              >
                <Suspense
                  fallback={
                    <div className="workspace-loading" role="status">
                      {t("正在載入資料工作區…", "Loading data workspace…")}
                    </div>
                  }
                >
                  {tab.kind === "aggregation" ? (
                    <AggregationTab
                      tab={tab}
                      active={active === tab.id}
                      profile={profiles.find(
                        (profile) => profile.id === tab.connectionId,
                      )}
                      notify={notify}
                      collectionNames={(
                        collections[`${tab.connectionId}/${tab.database}`] || []
                      ).map((collection) => collection.name)}
                      onOpenPreferences={(section) => {
                        setSettingsDraft(settings);
                        setPreferencesSection(section || "appearance");
                        setPreferences(true);
                      }}
                    />
                  ) : (
                    <CollectionTab
                      tab={tab}
                      active={active === tab.id}
                      transfer={setTransfer}
                      notify={notify}
                      onOpenPreferences={(section) => {
                        setSettingsDraft(settings);
                        setPreferencesSection(section || "appearance");
                        setPreferences(true);
                      }}
                      openIndexes={tab.showIndexes}
                      profile={profiles.find(
                        (profile) => profile.id === tab.connectionId,
                      )}
                      onShellDraftChange={onShellDraftChange}
                      onStateChange={onTabStateChange}
                      onOpenSavedQueries={() => {
                        setHistory((old) => old || []);
                        setHistoryView("saved");
                      }}
                      onQuerySaved={() =>
                        setSavedQueryRevision((value) => value + 1)
                      }
                      collectionNames={(
                        collections[`${tab.connectionId}/${tab.database}`] || []
                      ).map((c) => c.name)}
                    />
                  )}
                </Suspense>
              </div>
            ))}
            {!tabs.some((tab) => tab.id === active) && (
              <WorkspaceHome
                profiles={profiles}
                connected={connected}
                connecting={connecting}
                secure={secure}
                create={() => setConnectionDialog({})}
                edit={(profile) => setConnectionDialog({ profile })}
                remove={(profile) => setRemovingProfile(profile)}
                connect={(profile) => {
                  setSearch("");
                  if (connected.includes(profile.id))
                    setExpanded((old) => ({ ...old, [profile.id]: true }));
                  else void openConnection(profile);
                }}
              />
            )}
          </div>
          {showJobs && (
            <section
              className="bottom-panel jobs-panel"
              style={{ height: jobsHeight }}
            >
              <div
                className="bottom-panel-resize-handle"
                role="separator"
                aria-label={t("調整任務面板高度", "Resize jobs panel")}
                aria-orientation="horizontal"
                tabIndex={0}
                onPointerDown={(event) =>
                  startBottomPanelResize(event, jobsHeight, setJobsHeight)
                }
                onKeyDown={(event) => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                    return;
                  event.preventDefault();
                  setJobsHeight((current) =>
                    clampBottomPanelHeight(
                      current + (event.key === "ArrowUp" ? 24 : -24),
                    ),
                  );
                }}
              />
              <div className="bottom-panel-content">
                <div className="jobs-heading">
                  <Activity size={16} />
                  <strong>{t("背景任務", "Background jobs")}</strong>
                  <div className="spacer" />
                  <button onClick={() => setShowReceipts(true)}>
                    {t("操作收據", "Operation receipts")}
                  </button>
                  <button
                    className="icon"
                    aria-label={t("關閉任務面板", "Close jobs panel")}
                    onClick={() => setShowJobs(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
                {!jobs.length && (
                  <p className="muted">
                    {t("目前沒有傳輸任務。", "No transfer jobs yet.")}
                  </p>
                )}
                {jobs
                  .slice()
                  .reverse()
                  .map((job) => (
                    <div className="job-row" key={job.jobId}>
                      {job.status === "running" ? (
                        <LoaderCircle size={17} className="spin" />
                      ) : job.status === "completed" ? (
                        <CircleCheck size={17} />
                      ) : (
                        <CircleAlert size={17} />
                      )}
                      <div className="job-description">
                        <strong>
                          {job.status} · {job.processed.toLocaleString()}{" "}
                          {t("筆成功", "successful")} · {job.failed}{" "}
                          {t("筆失敗", "failed")}
                        </strong>
                        <span>{job.message}</span>
                        <small>
                          {job.path}
                          {job.errorPath ? ` · ${job.errorPath}` : ""}
                        </small>
                      </div>
                      <span className="muted small">
                        {(job.bytes / 1048576).toFixed(1)} MB
                      </span>
                      <button
                        className="icon"
                        aria-label={t(
                          "複製任務診斷資料",
                          "Copy job diagnostics",
                        )}
                        title={t("複製任務診斷資料", "Copy job diagnostics")}
                        onClick={() =>
                          void api
                            .request("clipboard.write", {
                              text: jobDiagnosticText(job),
                            })
                            .then(() =>
                              notify(
                                t(
                                  "已複製已遮蔽憑證的任務診斷資料",
                                  "Credential-redacted job diagnostics copied",
                                ),
                              ),
                            )
                            .catch((error) => notify(message(error), true))
                        }
                      >
                        <Copy size={15} />
                      </button>
                      {job.status === "running" && (
                        <button
                          onClick={() =>
                            void api
                              .request("transferJobs.cancel", {
                                jobId: job.jobId,
                              })
                              .catch((e) => notify(message(e), true))
                          }
                        >
                          {t("取消", "Cancel")}
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            </section>
          )}
          {history && (
            <section
              className="bottom-panel history-panel"
              style={{ height: historyHeight }}
            >
              <div
                className="bottom-panel-resize-handle"
                role="separator"
                aria-label={t("調整歷史面板高度", "Resize history panel")}
                aria-orientation="horizontal"
                tabIndex={0}
                onPointerDown={(event) =>
                  startBottomPanelResize(event, historyHeight, setHistoryHeight)
                }
                onKeyDown={(event) => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                    return;
                  event.preventDefault();
                  setHistoryHeight((current) =>
                    clampBottomPanelHeight(
                      current + (event.key === "ArrowUp" ? 24 : -24),
                    ),
                  );
                }}
              />
              <div className="bottom-panel-content">
                <div className="jobs-heading history-heading">
                  <History size={16} />
                  <strong>
                    {t("查詢歷史與收藏", "Query history & saved queries")}
                  </strong>
                  <div
                    className="segmented"
                    aria-label={t("查詢資料類別", "Query library sections")}
                  >
                    <button
                      className={historyView === "history" ? "active" : ""}
                      onClick={() => {
                        setHistoryView("history");
                        void api
                          .request("history.list", {})
                          .then(setHistory)
                          .catch((e) => notify(message(e), true));
                      }}
                    >
                      {t("歷史與舊收藏", "History & legacy favorites")}
                    </button>
                    <button
                      className={historyView === "saved" ? "active" : ""}
                      onClick={() => setHistoryView("saved")}
                    >
                      {t("已儲存查詢", "Saved queries")}
                    </button>
                  </div>
                  <div className="spacer" />
                  <button
                    className="icon"
                    aria-label={t("關閉歷史面板", "Close history panel")}
                    onClick={() => setHistory(undefined)}
                  >
                    <X size={16} />
                  </button>
                </div>
                {historyView === "saved" ? (
                  <Suspense
                    fallback={
                      <p className="muted" role="status">
                        {t("正在載入儲存查詢…", "Loading saved queries…")}
                      </p>
                    }
                  >
                    <SavedQueries
                      revision={savedQueryRevision}
                      target={
                        activeTab && activeTab.kind !== "aggregation"
                          ? {
                              label: `${activeTab.connectionName} / ${activeTab.database}.${activeTab.collection || "Shell"}`,
                              kind: activeTab.kind,
                            }
                          : undefined
                      }
                      apply={(query) => {
                        setTabs((old) =>
                          old.map((tab) =>
                            tab.id === active
                              ? {
                                  ...tab,
                                  requestedQuery: {
                                    value: query,
                                    id: crypto.randomUUID(),
                                  },
                                }
                              : tab,
                          ),
                        );
                        notify(
                          t(
                            "已套用查詢條件，確認目標後按執行。",
                            "Query inputs applied. Check the target, then press Run.",
                          ),
                        );
                      }}
                    />
                  </Suspense>
                ) : (
                  <div className="history-list">
                    <label className="history-search">
                      <Search size={14} aria-hidden="true" />
                      <input
                        aria-label={t(
                          "搜尋歷史與收藏",
                          "Search history and saved queries",
                        )}
                        value={historySearch}
                        onChange={(event) =>
                          setHistorySearch(event.target.value)
                        }
                        placeholder={t(
                          "搜尋名稱、DB、Collection 或查詢內容",
                          "Search name, DB, collection or query text",
                        )}
                      />
                    </label>
                    {!history.length && (
                      <p className="muted">
                        {t(
                          "執行查詢後會顯示在這裡。",
                          "Executed queries will appear here.",
                        )}
                      </p>
                    )}
                    {history.length > 0 &&
                      !filterHistory(history, historySearch).length && (
                        <p className="muted">
                          {t(
                            "沒有符合的歷史或收藏。",
                            "No matching history or saved query.",
                          )}
                        </p>
                      )}
                    {filterHistory(history, historySearch).map((item) => (
                      <div className="history-item" key={item.id}>
                        <div>
                          <span className="badge">
                            {item.favorite ? "SAVED" : "HISTORY"}
                          </span>
                          <strong>
                            {item.label ||
                              `${item.database}.${item.collection}`}
                          </strong>
                          <small>
                            {new Date(item.createdAt).toLocaleString()}
                          </small>
                        </div>
                        <pre>{item.code}</pre>
                        <div className="toolbar">
                          <button
                            onClick={() => {
                              const profile = profiles.find(
                                (p) => p.id === item.connectionId,
                              );
                              if (profile) {
                                openTab(
                                  profile,
                                  item.database,
                                  item.collection,
                                  "shell",
                                  item.code,
                                );
                                setHistory(undefined);
                              } else
                                notify(
                                  t(
                                    "原連線已移除",
                                    "Original connection was removed",
                                  ),
                                  true,
                                );
                            }}
                          >
                            {t("在 Shell 開啟", "Open in Shell")}
                          </button>
                          <button
                            onClick={() =>
                              void api
                                .request("history.save", {
                                  ...item,
                                  favorite: !item.favorite,
                                })
                                .then(() => api.request("history.list", {}))
                                .then(setHistory)
                            }
                          >
                            {item.favorite
                              ? t("取消收藏", "Unsave")
                              : t("收藏", "Save")}
                          </button>
                          <button
                            className="icon"
                            onClick={() =>
                              void api
                                .request("history.delete", { id: item.id })
                                .then(() => api.request("history.list", {}))
                                .then(setHistory)
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
          <footer className="status-bar">
            <span>Irwin</span>
            <span>{t("本機工作區", "Local workspace")}</span>
            <div className="spacer" />
            <span>
              {secure === undefined
                ? t("正在檢查憑證安全儲存…", "Checking credential storage…")
                : secure
                  ? t("憑證加密保護", "Credentials encrypted")
                  : t("憑證僅工作階段有效", "Session-only credentials")}
            </span>
            <span>UTF-8 · BSON</span>
          </footer>
        </main>
        {toast && (
          <div
            className={`toast ${toast.error ? "error" : "success"}`}
            role="status"
          >
            {toast.error ? (
              <CircleAlert size={18} />
            ) : (
              <CircleCheck size={18} />
            )}
            <span>{toast.text}</span>
            <button
              className="icon"
              aria-label={t("關閉通知", "Dismiss notification")}
              onClick={() => setToast(undefined)}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {removingProfile && (
          <Modal
            title={t("移除連線設定", "Remove saved connection")}
            close={() => {
              if (!removing) setRemovingProfile(undefined);
            }}
            footer={
              <>
                <button
                  disabled={removing}
                  onClick={() => setRemovingProfile(undefined)}
                >
                  {t("取消", "Cancel")}
                </button>
                <button
                  className="danger"
                  disabled={removing}
                  onClick={() => void removeProfile()}
                >
                  {removing
                    ? t("移除中…", "Removing…")
                    : t("移除連線設定", "Remove connection")}
                </button>
              </>
            }
          >
            <p>
              {t(
                "即將移除以下連線的本機設定與儲存的密碼：",
                "Remove the local settings and saved passwords for this connection:",
              )}
            </p>
            <p className="removal-target">{removingProfile.name}</p>
            <p className="hint">
              {t(
                "此連線的分頁將會關閉。資料庫中的資料不會被刪除。",
                "Tabs for this connection will close. Data in the database will not be deleted.",
              )}
            </p>
          </Modal>
        )}
        {connectionDialog && (
          <ConnectionDialog
            secure={secure === true}
            profile={connectionDialog.profile}
            close={() => setConnectionDialog(undefined)}
            saved={(profile, connectAfterSave) => {
              void loadProfiles();
              if (connectAfterSave) void openConnection(profile, true);
            }}
          />
        )}
        {closingShellTab && (
          <Modal
            title={t("關閉 Shell 分頁", "Close Shell tab")}
            close={() => setClosingShellTab(undefined)}
            footer={
              <>
                <button onClick={() => setClosingShellTab(undefined)}>
                  {t("取消", "Cancel")}
                </button>
                <button
                  onClick={() => {
                    const tab = closingShellTab;
                    const draft = shellDraftByTab[tab.id];
                    if (draft) {
                      void api
                        .request("shellDrafts.save", draft)
                        .catch((e) => notify(message(e), true));
                      setShellDrafts((old) => [
                        draft,
                        ...old.filter((item) => item.id !== draft.id),
                      ]);
                    }
                    setClosingShellTab(undefined);
                    removeTab(tab.id);
                  }}
                >
                  {t("保留草稿並關閉", "Keep draft & close")}
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    const tab = closingShellTab;
                    if (tab.draftId) {
                      void api
                        .request("shellDrafts.delete", { id: tab.draftId })
                        .catch((e) => notify(message(e), true));
                      setShellDrafts((old) =>
                        old.filter((draft) => draft.id !== tab.draftId),
                      );
                    }
                    setClosingShellTab(undefined);
                    removeTab(tab.id);
                  }}
                >
                  {t("放棄草稿", "Discard draft")}
                </button>
              </>
            }
          >
            <p>
              {t(
                "這個 Shell 有尚未執行的內容。保留草稿後，下次啟動可以選擇恢復；放棄草稿會永久刪除本機副本。",
                "This Shell has content that has not been executed. Keeping the draft lets you restore it after the next launch; discarding permanently removes the local copy.",
              )}
            </p>
          </Modal>
        )}
        {showShellDrafts && shellDrafts.length > 0 && (
          <Modal
            wide
            title={t("恢復 Shell 草稿", "Restore Shell drafts")}
            close={() => setShowShellDrafts(false)}
            footer={
              <button onClick={() => setShowShellDrafts(false)}>
                {t("稍後處理", "Later")}
              </button>
            }
          >
            <p className="hint">
              {t(
                "這些草稿是在上次關閉或異常結束前自動保存。請選擇恢復或明確放棄。",
                "These drafts were saved automatically before the last close or interruption. Restore each one or explicitly discard it.",
              )}
            </p>
            <div className="shell-draft-list">
              {shellDrafts.map((draft) => {
                const profile = profiles.find(
                  (item) => item.id === draft.connectionId,
                );
                return (
                  <div className="shell-draft-row" key={draft.id}>
                    <Terminal size={17} />
                    <div>
                      <strong>{profile?.name || draft.connectionId}</strong>
                      <span>
                        {draft.database}
                        {draft.collection ? ` / ${draft.collection}` : ""}
                        {` · ${new Date(draft.updatedAt).toLocaleString()}`}
                      </span>
                      <pre>{draft.code.slice(0, 240)}</pre>
                    </div>
                    <div className="toolbar">
                      <button
                        disabled={!profile}
                        onClick={() => restoreShellDraft(draft)}
                      >
                        {t("恢復", "Restore")}
                      </button>
                      <button
                        className="danger"
                        onClick={() => discardShellDraft(draft)}
                      >
                        {t("放棄", "Discard")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Modal>
        )}
        {palette && (
          <CommandPalette
            commands={palette === "commands"}
            items={paletteItems}
            close={() => setPalette(undefined)}
          />
        )}
        {analysis && (
          <AnalysisDialog
            mode={analysis.mode}
            initial={analysis.target}
            profiles={profiles}
            close={() => setAnalysis(undefined)}
            applyFilter={
              analysis.mode === "schema"
                ? (field, value, source) => {
                    const profile = profiles.find(
                      (p) => p.id === source.connectionId,
                    );
                    if (!profile) return;
                    const id = openTab(
                      profile,
                      source.database,
                      source.collection,
                      "collection",
                    );
                    setTabs((old) =>
                      old.map((tab) =>
                        tab.id === id
                          ? {
                              ...tab,
                              requestedFilter: {
                                value: buildCellFilter(
                                  "{}",
                                  field,
                                  value,
                                  "only",
                                ),
                                id: crypto.randomUUID(),
                              },
                            }
                          : tab,
                      ),
                    );
                  }
                : undefined
            }
          />
        )}
        {preferences && (
          <PreferencesDialog
            savedSettings={settings}
            draft={settingsDraft}
            initialSection={preferencesSection}
            onUpdate={setSettingsDraft}
            onSave={savePreferences}
            onClose={() => setPreferences(false)}
          />
        )}{" "}
        {showUpdates && (
          <UpdateDialog
            currentVersion={applicationVersion || "…"}
            platform={applicationPlatform}
            status={updateStatus}
            onCheck={checkForUpdates}
            onInstall={installUpdate}
            onOpenRelease={openReleasePage}
            onClose={() => setShowUpdates(false)}
          />
        )}
        {transfer && (
          <TransferDialog
            initial={transfer}
            readOnly={
              profiles.find((profile) => profile.id === transfer.connectionId)
                ?.readOnly
            }
            close={() => setTransfer(undefined)}
            started={() => setShowJobs(true)}
          />
        )}
        {showReceipts && (
          <Suspense fallback={null}>
            <ReceiptsDialog
              close={() => setShowReceipts(false)}
              notify={notify}
            />
          </Suspense>
        )}
        {usersRolesProfile && (
          <Suspense fallback={null}>
            <UsersRolesDialog
              profile={usersRolesProfile}
              close={() => setUsersRolesProfile(undefined)}
            />
          </Suspense>
        )}
        {admin && (
          <Modal
            title={
              admin.kind === "create"
                ? t("建立 DB／Collection", "Create database / collection")
                : t("刪除 DB／Collection", "Drop database / collection")
            }
            close={() => setAdmin(undefined)}
            footer={
              <>
                <button onClick={() => setAdmin(undefined)}>
                  {t("取消", "Cancel")}
                </button>
                <button
                  className={admin.kind === "drop" ? "danger" : "primary"}
                  disabled={
                    admin.kind === "drop" && confirm !== (adminColl || adminDb)
                  }
                  onClick={() => void submitAdmin()}
                >
                  {admin.kind === "drop"
                    ? t("刪除", "Drop")
                    : t("建立", "Create")}
                </button>
              </>
            }
          >
            <div className="form-grid">
              <Field full label="Database">
                <input
                  disabled={admin.kind === "drop"}
                  value={adminDb}
                  onChange={(e) => setAdminDb(e.target.value)}
                />
              </Field>
              <Field full label="Collection">
                <input
                  disabled={admin.kind === "drop"}
                  value={adminColl}
                  onChange={(e) => setAdminColl(e.target.value)}
                />
              </Field>
              {admin.kind === "drop" ? (
                <Field
                  full
                  label={`${t("輸入名稱確認刪除", "Type name to confirm deletion")}: ${adminColl || adminDb}`}
                >
                  <input
                    autoFocus
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </Field>
              ) : (
                <p className="hint full">
                  {t(
                    "MongoDB 會在建立第一個 Collection 時建立資料庫。Cosmos RU 請先在 Azure 設定分區鍵與 RU。",
                    "MongoDB creates a database with its first collection. For Cosmos RU, configure partition keys and RU in Azure first.",
                  )}
                </p>
              )}
            </div>
            {adminError && <div className="notice error">{adminError}</div>}
          </Modal>
        )}
      </div>
    </UiContext.Provider>
  );
}
