import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
  nativeTheme,
  clipboard,
  Notification,
} from "electron";
import { join, resolve } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  commands,
  type Command,
  type Profile,
  type AppEvent,
} from "../shared/contracts";
import { Storage } from "./storage";
import { resolveConnection, type Route } from "./connection";
import { WorkerClient } from "./rpc";
import { operationAccess, redact } from "../core/policy";
import { shouldCheckShellDrafts } from "./window-close-lifecycle";
import { developmentIconPath } from "./app-icon";
import { nativeThemeSource } from "./theme";
import { capInteractiveQueryTimeout } from "../shared/query-timeout";
import { jobNotificationKind } from "../shared/job-notifications";
import {
  assertCsvSidecarTargetSafe,
  writeCsvFormulaSidecar,
} from "../core/csv-sidecar";
import {
  aiProviderSchema,
  isAiEndpointRemote,
  parseAssistantResponse,
  redactAggregationStage,
  redactQueryValues,
  summarizeExplainForAI,
} from "../shared/ai";
import {
  requestAiProvider,
  testAiProvider,
  assistantSystemPrompt,
  type AiMessage,
} from "./ai-service";
import {
  receiptFromCommand,
  receiptFromJob,
  type ReceiptContext,
} from "../shared/operation-safety";

let window: BrowserWindow;
let storage: Storage;
let database: WorkerClient;
let allowWindowClose = false;
let shuttingDown = false;
const routes = new Map<string, Route>();
const opening = new Map<string, Promise<any>>();
const shells = new Map<
  string,
  { worker: WorkerClient; connectionId: string; database: string }
>();
const fileGrants = new Map<string, "open" | "save" | "directory">();
const receiptContexts = new Map<string, ReceiptContext>();
const earlyFinalJobs = new Map<string, AppEvent["data"]>();
const notifiedJobs = new Set<string>();
const aiRequests = new Map<string, AbortController>();
function saveJobReceipt(jobId: string, result: AppEvent["data"]) {
  const context = receiptContexts.get(jobId);
  if (!context) {
    earlyFinalJobs.set(jobId, result);
    if (earlyFinalJobs.size > 100)
      earlyFinalJobs.delete(earlyFinalJobs.keys().next().value!);
    return;
  }
  receiptContexts.delete(jobId);
  earlyFinalJobs.delete(jobId);
  try {
    storage.saveReceipt(receiptFromJob(context, result));
  } catch (error) {
    console.error("Could not store operation receipt:", redact(error));
  }
}
function rememberJob(jobId: string, context: ReceiptContext) {
  receiptContexts.set(jobId, context);
  const final = earlyFinalJobs.get(jobId);
  if (final) saveJobReceipt(jobId, final);
}
function saveCommandReceipt(
  context: ReceiptContext,
  id: string,
  status: "completed" | "unknown",
  processed?: number,
) {
  try {
    storage.saveReceipt(receiptFromCommand(context, id, status, processed));
  } catch (error) {
    console.error("Could not store operation receipt:", redact(error));
  }
}
const event = (value: AppEvent) => {
  if (value.type === "job" && value.data.status !== "running") {
    saveJobReceipt(value.data.jobId, value.data);
    const settings = !shuttingDown ? storage.settings() : undefined;
    const kind =
      settings && jobNotificationKind(settings.jobNotifications, value.data);
    if (kind && !notifiedJobs.has(value.data.jobId)) {
      notifiedJobs.add(value.data.jobId);
      if (notifiedJobs.size > 100)
        notifiedJobs.delete(notifiedJobs.values().next().value!);
      if (
        window &&
        !window.isDestroyed() &&
        !window.isFocused() &&
        Notification.isSupported()
      ) {
        const zh = settings.language === "zh";
        try {
          const notification = new Notification({
            title:
              kind === "failed"
                ? zh
                  ? "Irwin 背景任務失敗"
                  : "Irwin background job failed"
                : zh
                  ? "Irwin 背景任務完成"
                  : "Irwin background job completed",
            body: zh
              ? "開啟背景任務查看結果。"
              : "Open Background jobs to review the result.",
          });
          notification.on("click", () => {
            if (window.isDestroyed()) return;
            if (window.isMinimized()) window.restore();
            window.show();
            window.focus();
            event({ type: "openJobs", data: {} });
          });
          notification.show();
        } catch (error) {
          console.error("Could not display job notification:", redact(error));
        }
      }
    }
  }
  if (window && !window.isDestroyed())
    window.webContents.send("workbench:event", value);
};
function newDatabase() {
  return new WorkerClient(join(__dirname, "database.cjs"), event, () => {
    if (!shuttingDown)
      for (const [jobId, context] of receiptContexts) {
        try {
          storage.saveReceipt(
            receiptFromJob(context, {
              jobId,
              status: "unknown",
              processed: 0,
              failed: 0,
              bytes: 0,
              message: "Database worker exited",
            }),
          );
        } catch (error) {
          console.error(
            "Could not store unknown operation receipt:",
            redact(error),
          );
        }
      }
    receiptContexts.clear();
    for (const route of routes.values()) route.close();
    routes.clear();
    for (const s of shells.values()) s.worker.kill();
    shells.clear();
    event({ type: "connection", data: { allClosed: true } });
  });
}
function engine() {
  if (!database || database.closed) database = newDatabase();
  return database;
}
async function disconnect(id: string) {
  for (const [key, shell] of shells)
    if (shell.connectionId === id) {
      shell.worker.kill();
      shells.delete(key);
    }
  try {
    if (!database?.closed) await database?.request("disconnect", { id });
  } finally {
    routes.get(id)?.close();
    routes.delete(id);
    event({ type: "connection", data: { id, connected: false } });
  }
}
async function connect(id: string) {
  if (opening.has(id)) return opening.get(id);
  if (routes.has(id)) return { connected: true };
  const task = (async () => {
    const profile = storage.profile(id);
    const route = await resolveConnection(profile, storage.secrets(id));
    try {
      const result = await engine().request("connect", route.resolved);
      routes.set(id, route);
      event({ type: "connection", data: { id, ...result } });
      return result;
    } catch (e) {
      route.close();
      throw e;
    }
  })().finally(() => opening.delete(id));
  opening.set(id, task);
  return task;
}
async function openShell(sessionId: string, connectionId: string, db: string) {
  await connect(connectionId);
  shells.get(sessionId)?.worker.kill();
  const worker = new WorkerClient(join(__dirname, "shell.cjs"), event);
  shells.set(sessionId, { worker, connectionId, database: db });
  try {
    await worker.request("open", {
      resolved: routes.get(connectionId)!.resolved,
      database: db,
    });
  } catch (e) {
    worker.kill();
    shells.delete(sessionId);
    throw e;
  }
  return { sessionId };
}
function schemaHints(report: any) {
  return (report?.fields || [])
    .filter((field: any) => typeof field?.path === "string")
    .slice(0, 500)
    .map((field: any) => ({
      path: field.path,
      types: Object.keys(field.types || {}).slice(0, 12),
    }));
}
async function sampleSchema(
  connectionId: string,
  databaseName: string,
  collection: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const jobId = randomUUID();
  const cancel = () => {
    void engine()
      .request("analysis.cancel", { jobId })
      .catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const report = await engine()
    .request(
      "analysis.schema",
      {
        jobId,
        connectionId,
        database: databaseName,
        collection,
        filter: "{}",
        sampleSize: 100,
        maxTimeMS: 10000,
      },
      18000,
    )
    .finally(() => signal.removeEventListener("abort", cancel));
  signal.throwIfAborted();
  return schemaHints(report);
}
async function runAiAssistant(input: any) {
  const p = input;
  if (aiRequests.has(p.requestId))
    throw new Error("AI request is already running");
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 90000);
  aiRequests.set(p.requestId, controller);
  try {
    const connection = storage.aiConnection(p.connectionId);
    if (!connection.enabled)
      throw new Error("Enable AI for this database connection first");
    const profile = storage.profile(p.connectionId);
    if (p.task === "explain" && profile.provider === "cosmos")
      throw new Error(
        "Explain assistance is not yet available for Cosmos connections",
      );
    const settings = storage.settings();
    const providerId = connection.providerId || settings.aiDefaultProviderId;
    if (!providerId) throw new Error("Choose an AI provider in Preferences");
    const { provider, apiKey } = storage.aiProvider(providerId);
    aiProviderSchema.parse(provider);
    if (isAiEndpointRemote(provider.baseUrl) && !settings.aiCloudConsent)
      throw new Error(
        "Allow cloud AI data transfer in Preferences before using this provider",
      );
    await connect(p.connectionId);

    let fields = p.fieldHints
      .map((field: any) => ({
        path: field.path,
        types: field.types,
      }))
      .slice(0, 120);
    let lookupFields: any[] = [];
    if (p.task === "query" && fields.length === 0)
      fields = await sampleSchema(
        p.connectionId,
        p.database,
        p.collection,
        controller.signal,
      );

    const lookupCollections: string[] = [];
    if (p.lookupCollection) {
      if (p.lookupCollection === p.collection)
        throw new Error("Choose another collection for $lookup");
      const collections: { name: string }[] = await engine().request(
        "metadata.collections",
        { connectionId: p.connectionId, database: p.database },
      );
      if (!collections.some((item) => item.name === p.lookupCollection))
        throw new Error(
          "The selected $lookup collection is not in this database",
        );
      lookupCollections.push(p.lookupCollection);
      lookupFields = await sampleSchema(
        p.connectionId,
        p.database,
        p.lookupCollection,
        controller.signal,
      );
    }

    let explainContext: ReturnType<typeof summarizeExplainForAI> | undefined;
    if (p.task === "explain") {
      if (!p.explainPlan)
        throw new Error("Run Explain before asking AI to interpret it");
      let rawPlan: unknown;
      try {
        rawPlan = JSON.parse(p.explainPlan);
      } catch {
        throw new Error("The Explain result is invalid");
      }
      explainContext = summarizeExplainForAI(rawPlan);
    }

    const safeQuery = p.currentQuery
      ? {
          filter: redactQueryValues(p.currentQuery.filter),
          sort: redactQueryValues(p.currentQuery.sort, "sort"),
          projection: redactQueryValues(
            p.currentQuery.projection,
            "projection",
          ),
        }
      : undefined;
    const safeStages = (p.aggregationStages || []).map((stage: any) =>
      stage.enabled ? redactAggregationStage(stage.text) : "<disabled stage>",
    );
    const schemaFields = [...fields, ...lookupFields];
    const fieldPrefixes = schemaFields
      .filter((field: any) =>
        field.types.some(
          (type: string) => type === "Object" || type === "Array",
        ),
      )
      .map((field: any) => field.path);
    const context =
      p.task === "explain"
        ? {
            task: p.task,
            namespace: `${p.database}.${p.collection}`,
            query: safeQuery,
            explain: explainContext,
          }
        : {
            task: p.task,
            draftMode: p.draftMode,
            namespace: `${p.database}.${p.collection}`,
            fields,
            ...(lookupCollections.length
              ? {
                  lookupSchema: {
                    collection: lookupCollections[0],
                    fields: lookupFields,
                  },
                }
              : {}),
            currentQuery: safeQuery,
            currentPipeline: safeStages,
            explicitlySelectedLookupCollection: p.lookupCollection,
          };
    const messages: AiMessage[] = [
      {
        role: "system",
        content: `${assistantSystemPrompt(p.language, p.task)}\nContext (JSON):\n${JSON.stringify(context)}`,
      },
      ...p.priorMessages,
      { role: "user", content: p.question },
    ];
    const response = await requestAiProvider(
      provider,
      apiKey,
      messages,
      controller.signal,
    );
    controller.signal.throwIfAborted();
    const parsed = parseAssistantResponse(response, {
      task: p.task,
      draftMode: p.draftMode,
      fields: schemaFields.map((field: any) => field.path),
      fieldPrefixes,
      lookupCollections,
      allowAggregation: profile.provider === "mongodb",
      metrics: explainContext?.metrics,
      stages: explainContext?.stages.map((stage) => stage.stage),
    });
    if (parsed.kind === "error") throw new Error(parsed.error);
    return parsed.value;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(
        timedOut ? "AI request timed out" : "AI request cancelled",
      );
    throw error;
  } finally {
    clearTimeout(timeout);
    if (aiRequests.get(p.requestId) === controller)
      aiRequests.delete(p.requestId);
  }
}
async function request(command: Command, raw: any): Promise<any> {
  const p: any = commands[command].parse(raw);
  switch (command) {
    case "ai.providers.list":
      return storage.aiProviders();
    case "ai.providers.save": {
      return storage.saveAiProvider(p.provider, p.apiKey);
    }
    case "ai.providers.delete":
      return storage.deleteAiProvider(p.id);
    case "ai.providers.test": {
      const { provider, apiKey } = storage.aiProvider(p.id);
      return testAiProvider(provider, apiKey);
    }
    case "ai.connections.get":
      return storage.aiConnection(p.connectionId);
    case "ai.connections.set":
      return storage.setAiConnection(p);
    case "ai.assistant.start":
      return runAiAssistant(p);
    case "ai.assistant.cancel": {
      aiRequests.get(p.requestId)?.abort();
      return { cancelled: aiRequests.has(p.requestId) };
    }
    case "connections.list":
      return storage.list();
    case "connections.save":
      if (routes.has(p.profile.id)) await disconnect(p.profile.id);
      return storage.save(p.profile, p.secrets);
    case "connections.copy":
      return storage.copy(p.id);
    case "connections.delete":
      await disconnect(p.id);
      return storage.delete(p.id);
    case "connections.open":
      return connect(p.id);
    case "connections.close":
      return disconnect(p.id);
    case "connections.parseUri":
      return storage.parseUri(p.uri, p.name);
    case "connections.exportUri":
      return storage.exportUri(p.id, p.includePassword);
    case "connections.test": {
      const normalized = storage.clean(p.profile, {
        ...storage.secrets(p.profile.id),
        ...p.secrets,
      });
      const profile: Profile = {
        ...normalized.profile,
        id: `test-${randomUUID()}`,
      };
      let route: Route | undefined;
      try {
        route = await resolveConnection(profile, normalized.secrets);
        const result = await engine().request("connect", route.resolved);
        return {
          ...result,
          checks: [
            "network",
            "TLS / transport",
            "authentication",
            "database ping",
          ],
        };
      } finally {
        try {
          await engine().request("disconnect", { id: profile.id });
        } finally {
          route?.close();
        }
      }
    }
    case "settings.get":
      return storage.settings();
    case "workspace.get":
      return storage.workspace();
    case "workspace.save":
      return storage.saveWorkspace(p);
    case "tableLayouts.get":
      return storage.tableLayout(p.key);
    case "tableLayouts.save":
      return storage.saveTableLayout(p.key, p.layout);
    case "transferPresets.list":
      return storage.transferPresets();
    case "transferPresets.save":
      return storage.saveTransferPreset(p);
    case "transferPresets.delete":
      return storage.deleteTransferPreset(p.id);
    case "analysis.compare":
      await connect(p.source.connectionId);
      await connect(p.target.connectionId);
      return engine().request(command, p, p.maxTimeMS + 15000);
    case "analysis.schema":
      await connect(p.connectionId);
      return engine().request(command, p, p.maxTimeMS + 15000);
    case "reports.export":
      if (fileGrants.get(resolve(p.path)) !== "save")
        throw new Error("Select an export path using the file picker");
      JSON.parse(p.content);
      await writeFile(resolve(p.path), p.content, "utf8");
      return { path: resolve(p.path) };
    case "clipboard.write":
      await clipboard.writeText(p.text);
      return {};
    case "settings.set":
      if (
        p.aiDefaultProviderId &&
        !storage.hasAiProvider(p.aiDefaultProviderId)
      )
        throw new Error("Choose an existing AI provider as the default");
      storage.setSettings(p);
      nativeTheme.themeSource = nativeThemeSource(p.theme);
      return storage.settings();
    case "settings.zoom":
      window.webContents.setZoomFactor(p.value / 100);
      return {};
    case "history.list":
      return storage.history(p.favoritesOnly);
    case "savedQueries.list":
      return storage.savedQueries();
    case "savedQueries.save":
      return storage.saveQuery(p);
    case "savedQueries.delete":
      return storage.deleteQuery(p.id);
    case "savedPipelines.list":
      return storage.savedPipelines();
    case "savedPipelines.save":
      return storage.savePipeline(p);
    case "savedPipelines.delete":
      return storage.deletePipeline(p.id);
    case "operationReceipts.list":
      return storage.receipts();
    case "operationReceipts.clear":
      return storage.clearReceipts();
    case "history.save":
      return storage.saveHistory(p);
    case "history.delete":
      return storage.deleteHistory(p.id);
    case "app.status":
      return {
        version: app.getVersion(),
        platform: process.platform,
        secureStorage: storage.secure(),
        connections: [...routes.keys()],
        toolsAvailable: existsSync(
          join(
            toolsPath(),
            process.platform === "win32" ? "mongodump.exe" : "mongodump",
          ),
        ),
      };
    case "files.choose": {
      let path: string | undefined;
      if (p.kind === "save") {
        const result = await dialog.showSaveDialog(window, {
          title: p.title,
          defaultPath: p.defaultPath,
        });
        if (!result.canceled) path = result.filePath;
      } else {
        const result = await dialog.showOpenDialog(window, {
          title: p.title,
          properties: [p.kind === "directory" ? "openDirectory" : "openFile"],
        });
        if (!result.canceled) path = result.filePaths[0];
      }
      if (path) fileGrants.set(resolve(path), p.kind);
      return path || null;
    }
    case "shellSessions.open":
      return openShell(p.sessionId, p.connectionId, p.database);
    case "shellSessions.execute":
    case "shellSessions.next": {
      const s = shells.get(p.sessionId);
      if (!s) throw new Error("Open the Shell session first");
      return s.worker.request(
        command.endsWith("next") ? "next" : "execute",
        p,
        3600000,
      );
    }
    case "shellSessions.close":
      shells.get(p.sessionId)?.worker.kill();
      shells.delete(p.sessionId);
      return {};
    case "shellSessions.cancel": {
      const s = shells.get(p.sessionId);
      if (!s) return {};
      s.worker.kill();
      shells.delete(p.sessionId);
      await openShell(p.sessionId, s.connectionId, s.database);
      return { reset: true };
    }
    case "shellDrafts.list":
      return storage.shellDrafts();
    case "shellDrafts.save":
      return storage.saveShellDraft(p);
    case "shellDrafts.delete":
      return storage.deleteShellDraft(p.id);
    case "transferJobs.start": {
      const grant = fileGrants.get(resolve(p.path));
      const needed =
        p.format !== "bson" && !p.collection
          ? "directory"
          : p.direction === "import"
            ? "open"
            : "save";
      if (grant !== needed)
        throw new Error("Select the transfer path using the file picker");
      await connect(p.connectionId);
      const started = await engine().request(command, {
        ...p,
        resolved: routes.get(p.connectionId)!.resolved,
        toolsPath: toolsPath(),
      });
      const profile = storage.profile(p.connectionId);
      rememberJob(started.jobId, {
        connectionName: profile.name,
        environment: profile.environment,
        namespace: p.collection ? `${p.database}.${p.collection}` : p.database,
        action:
          p.format === "bson" && p.direction === "import"
            ? "restore"
            : p.direction,
        mode:
          p.direction === "import"
            ? p.drop
              ? "drop-and-restore"
              : p.mode
            : p.format,
        scope: p.collection ? "collection" : "database",
      });
      return started;
    }
    case "aggregations.export":
      if (fileGrants.get(resolve(p.path)) !== "save")
        throw new Error("Select an export path using the file picker");
      await connect(p.connectionId);
      {
        const started = await engine().request(command, p);
        const profile = storage.profile(p.connectionId);
        rememberJob(started.jobId, {
          connectionName: profile.name,
          environment: profile.environment,
          namespace: `${p.database}.${p.collection}`,
          action: "aggregation.export",
          mode: "jsonl",
          scope: "collection",
        });
        return started;
      }
    case "transferJobs.preview":
      if (fileGrants.get(resolve(p.path)) !== "open")
        throw new Error("Select a CSV file first");
      return engine().request(command, p);
    case "results.export":
      if (fileGrants.get(resolve(p.path)) !== "save")
        throw new Error("Select an export path using the file picker");
      if (p.format === "excel")
        await writeFile(resolve(p.path), Buffer.from(p.content, "base64"));
      else {
        const path = resolve(p.path);
        await assertCsvSidecarTargetSafe(path);
        await writeFile(path, p.content, "utf8");
        await writeCsvFormulaSidecar(path);
      }
      return { path: resolve(p.path), format: p.format };
    default:
      if (p.connectionId) await connect(p.connectionId);
      {
        const queryPayload = capInteractiveQueryTimeout(
          command,
          p,
          p.connectionId
            ? storage.profile(p.connectionId).queryTimeoutMS
            : 30000,
        );
        const write = operationAccess(command) === "write";
        const profile = write ? storage.profile(p.connectionId) : undefined;
        const receiptContext: ReceiptContext | undefined = profile
          ? {
              connectionName: profile.name,
              environment: profile.environment,
              namespace: p.collection
                ? `${p.database}.${p.collection}`
                : p.authDatabase || p.database || "admin",
              action: command,
              mode: command === "metadata.editIndex" ? "recreate" : "single",
              scope: p.collection ? "collection" : "database",
            }
          : undefined;
        const receiptId = receiptContext ? randomUUID() : undefined;
        try {
          const result = await engine().request(
            command,
            queryPayload,
            command === "queries.run" ||
              command === "queries.count" ||
              command === "queries.explain" ||
              command === "aggregations.run" ||
              command === "aggregations.preview" ||
              command === "aggregations.explain"
              ? queryPayload.maxTimeMS + 15000
              : 60000,
          );
          if (receiptContext && receiptId)
            saveCommandReceipt(
              receiptContext,
              receiptId,
              "completed",
              command.startsWith("documents.") ? 1 : undefined,
            );
          return result;
        } catch (error) {
          // A worker or network failure can occur after the server committed.
          if (receiptContext && receiptId)
            saveCommandReceipt(receiptContext, receiptId, "unknown");
          throw error;
        }
      }
  }
}
function toolsPath() {
  return app.isPackaged
    ? join(process.resourcesPath, "tools")
    : join(
        app.getAppPath(),
        "vendor",
        "tools",
        `${process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux"}-${process.arch}`,
      );
}
app.whenReady().then(() => {
  if (process.platform === "win32")
    app.setAppUserModelId(
      app.isPackaged ? "dev.mongoworkbench.desktop" : process.execPath,
    );
  const data = process.env.WORKBENCH_USER_DATA || app.getPath("userData");
  mkdirSync(data, { recursive: true });
  storage = new Storage(join(data, "workbench.sqlite"));
  // Warm the database worker while the renderer and window are starting.
  engine();
  nativeTheme.themeSource = nativeThemeSource(storage.settings().theme);
  window = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: "#101418",
    title: "Irwin",
    icon: developmentIconPath({
      appPath: app.getAppPath(),
      isPackaged: app.isPackaged,
      platform: process.platform,
    }),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (e) => e.preventDefault());
  window.on("close", (closeEvent) => {
    if (
      !shouldCheckShellDrafts({ shuttingDown, allowWindowClose }) ||
      !storage.shellDrafts().length
    )
      return;
    closeEvent.preventDefault();
    void dialog
      .showMessageBox(window, {
        type: "question",
        buttons: ["Keep drafts and quit", "Cancel"],
        defaultId: 0,
        cancelId: 1,
        title: "Irwin",
        message: "Shell drafts are saved locally",
        detail:
          "Unexecuted Shell content will remain available to restore next time you open Irwin.",
      })
      .then(({ response }) => {
        if (response !== 0) return;
        allowWindowClose = true;
        window.close();
      });
  });
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  const devUrl = !app.isPackaged ? process.env.WORKBENCH_DEV_URL : undefined;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          devUrl
            ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:*; worker-src 'self' blob:; img-src 'self' data:; font-src 'self' data:"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; img-src 'self' data:; font-src 'self' data:; connect-src 'self'",
        ],
      },
    }),
  );
  ipcMain.handle("workbench:request", async (e, command: string, payload) => {
    if (
      e.sender !== window.webContents ||
      e.senderFrame !== window.webContents.mainFrame ||
      !Object.hasOwn(commands, command)
    )
      return { ok: false, error: "Invalid request" };
    try {
      return { ok: true, result: await request(command as Command, payload) };
    } catch (error) {
      return { ok: false, error: redact((error as Error).message) };
    }
  });
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(join(__dirname, "renderer/index.html"));
  window.once("ready-to-show", () => window.show());
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  shuttingDown = true;
  allowWindowClose = true;
  for (const controller of aiRequests.values()) controller.abort();
  aiRequests.clear();
  for (const s of shells.values()) s.worker.kill();
  shells.clear();
  database?.kill();
  for (const route of routes.values()) route.close();
  routes.clear();
  storage?.close();
});
