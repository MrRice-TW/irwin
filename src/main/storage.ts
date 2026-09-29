import { DatabaseSync } from "node:sqlite";
import { safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { ConnectionString } from "mongodb-connection-string-url";
import { exportMongoUri } from "./connection-uri";
import { tableLayoutSchema, workspaceSchema } from "../shared/workspace";
import { transferPresetSchema } from "../shared/contracts";
import { savedQuerySchema, type SavedQuery } from "../shared/saved-query";
import {
  savedPipelineSchema,
  type SavedPipeline,
} from "../shared/saved-pipeline";
import { compileReadOnlyPipeline } from "../shared/aggregation";
import {
  operationReceiptSchema,
  type OperationReceipt,
} from "../shared/operation-safety";
import {
  aiConnectionSchema,
  aiProviderSchema,
  type AiConnectionSettings,
  type AiProvider,
} from "../shared/ai";
import {
  profileSchema,
  settingsSchema,
  shellDraftSchema,
  type Profile,
  type Secrets,
  type Settings,
  type ShellDraft,
} from "../shared/contracts";

export class Storage {
  private db: DatabaseSync;
  private sessionSecrets = new Map<string, Secrets>();
  private aiSessionSecrets = new Map<string, string>();
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY, profile TEXT NOT NULL, secrets BLOB);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY, connectionId TEXT NOT NULL, databaseName TEXT NOT NULL, collectionName TEXT NOT NULL, code TEXT NOT NULL, favorite INTEGER NOT NULL, label TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS shell_drafts(id TEXT PRIMARY KEY, connectionId TEXT NOT NULL, databaseName TEXT NOT NULL, collectionName TEXT NOT NULL, code TEXT NOT NULL, updatedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS table_layouts(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS transfer_presets(id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS saved_queries(id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_providers(id TEXT PRIMARY KEY, value TEXT NOT NULL, secret BLOB);
      CREATE TABLE IF NOT EXISTS ai_connection_settings(connectionId TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    let version = Number(
      this.db.prepare("PRAGMA user_version").get()?.user_version,
    );
    if (version > 6) throw new Error(`Unsupported storage version ${version}`);
    if (version < 5) {
      this.db.exec(`BEGIN;
        CREATE TABLE IF NOT EXISTS saved_pipelines(id TEXT PRIMARY KEY, value TEXT NOT NULL);
        PRAGMA user_version=5;
        COMMIT;`);
      version = 5;
    }
    if (version < 6) {
      this.db.exec(`BEGIN;
        CREATE TABLE IF NOT EXISTS operation_receipts(id TEXT PRIMARY KEY, occurredAt TEXT NOT NULL, value TEXT NOT NULL);
        PRAGMA user_version=6;
        COMMIT;`);
    }
  }
  secure() {
    return (
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== "linux" ||
        safeStorage.getSelectedStorageBackend() !== "basic_text")
    );
  }
  list(): Profile[] {
    return this.db
      .prepare(
        "SELECT profile FROM connections ORDER BY json_extract(profile, '$.group'), json_extract(profile, '$.name')",
      )
      .all()
      .map((v) => profileSchema.parse(JSON.parse(v.profile as string)));
  }
  profile(id: string) {
    const row = this.db
      .prepare("SELECT profile FROM connections WHERE id=?")
      .get(id);
    if (!row) throw new Error("Connection not found");
    return profileSchema.parse(JSON.parse(row.profile as string));
  }
  secrets(id: string): Secrets {
    if (this.sessionSecrets.has(id)) return this.sessionSecrets.get(id)!;
    const row = this.db
      .prepare("SELECT secrets FROM connections WHERE id=?")
      .get(id);
    if (row?.secrets && this.secure()) {
      try {
        return JSON.parse(
          safeStorage.decryptString(Buffer.from(row.secrets as Uint8Array)),
        );
      } catch {
        throw new Error(
          "Unable to unlock saved credentials; re-enter them in connection settings",
        );
      }
    }
    return {};
  }
  clean(profile: Profile, changes: Secrets) {
    const uri = new ConnectionString(profile.uri);
    const secrets = { ...changes };
    if (uri.password) {
      secrets.password = decodeURIComponent(uri.password);
      uri.password = "";
    }
    if (uri.username)
      profile = { ...profile, username: decodeURIComponent(uri.username) };
    // Password-bearing query options belong in the encrypted secret store.
    for (const key of [...uri.searchParams.keys()]) {
      if (key.toLowerCase() === "tlscertificatekeyfilepassword") {
        secrets.certPassword = uri.searchParams.get(key)!;
        uri.searchParams.delete(key);
      } else if (/password|token|secret/i.test(key))
        throw new Error(
          "Use the credential fields for secrets instead of URI options",
        );
    }
    return { profile: { ...profile, uri: uri.toString() }, secrets };
  }
  save(profile: Profile, changes: Secrets) {
    const clean = this.clean(profile, changes);
    const secrets = { ...this.secrets(profile.id), ...clean.secrets };
    this.sessionSecrets.set(profile.id, secrets);
    const encrypted = this.secure()
      ? safeStorage.encryptString(JSON.stringify(secrets))
      : null;
    this.db
      .prepare(
        "INSERT INTO connections(id,profile,secrets) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET profile=excluded.profile,secrets=excluded.secrets",
      )
      .run(profile.id, JSON.stringify(clean.profile), encrypted);
    return { profile: clean.profile, persistentSecrets: !!encrypted };
  }
  copy(id: string) {
    const p = this.profile(id);
    return this.save(
      { ...p, id: randomUUID(), name: `${p.name} (copy)` },
      this.secrets(id),
    );
  }
  delete(id: string) {
    this.db.prepare("DELETE FROM connections WHERE id=?").run(id);
    this.db.prepare("DELETE FROM shell_drafts WHERE connectionId=?").run(id);
    this.sessionSecrets.delete(id);
    this.deleteAiConnection(id);
  }
  settings(): Settings {
    return settingsSchema.parse({
      language: "zh",
      theme: "dark",
      fontFamily: 'Inter, "Segoe UI", "Noto Sans TC", sans-serif',
      fontSize: 13,
      editorLineHeight: 24,
      editorPadding: 16,
      timezone: "local",
      datetimeFormat: "iso",
      tabWidth: 2,
      colors: {},
      ...Object.fromEntries(
        this.db
          .prepare("SELECT key,value FROM settings")
          .all()
          .map((v) => [v.key, JSON.parse(v.value as string)]),
      ),
    });
  }
  setSettings(values: Record<string, any>) {
    const settings = settingsSchema.parse(values);
    const stmt = this.db.prepare(
      "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    );
    for (const [k, v] of Object.entries(settings))
      stmt.run(k, JSON.stringify(v));
  }
  aiProviders() {
    return this.db
      .prepare(
        "SELECT id,value,secret FROM ai_providers ORDER BY json_extract(value,'$.name')",
      )
      .all()
      .map((row) => ({
        ...aiProviderSchema.parse(JSON.parse(row.value as string)),
        hasApiKey: !!this.aiProviderSecret(
          String(row.id),
          row.secret as Uint8Array | null,
        ),
        persistentApiKey: !!row.secret,
      }));
  }
  aiProvider(id: string): { provider: AiProvider; apiKey: string } {
    const row = this.db
      .prepare("SELECT value,secret FROM ai_providers WHERE id=?")
      .get(id);
    if (!row) throw new Error("AI provider not found");
    return {
      provider: aiProviderSchema.parse(JSON.parse(row.value as string)),
      apiKey: this.aiProviderSecret(id, row.secret as Uint8Array | null),
    };
  }
  hasAiProvider(id: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM ai_providers WHERE id=?").get(id);
  }
  private aiProviderSecret(id: string, encrypted?: Uint8Array | null): string {
    if (this.aiSessionSecrets.has(id)) return this.aiSessionSecrets.get(id)!;
    if (!encrypted) return "";
    if (!this.secure()) return "";
    try {
      return safeStorage.decryptString(Buffer.from(encrypted));
    } catch {
      throw new Error(
        "Unable to unlock the saved AI key; re-enter it in AI settings",
      );
    }
  }
  saveAiProvider(providerValue: unknown, apiKey?: string) {
    const provider = aiProviderSchema.parse(providerValue);
    const existing = this.db
      .prepare("SELECT secret FROM ai_providers WHERE id=?")
      .get(provider.id);
    const key =
      apiKey?.trim() ||
      this.aiProviderSecret(provider.id, existing?.secret as Uint8Array | null);
    if (key) this.aiSessionSecrets.set(provider.id, key);
    else this.aiSessionSecrets.delete(provider.id);
    const encrypted =
      key && this.secure() ? safeStorage.encryptString(key) : null;
    this.db
      .prepare(
        "INSERT INTO ai_providers(id,value,secret) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,secret=excluded.secret",
      )
      .run(provider.id, JSON.stringify(provider), encrypted);
    return {
      ...provider,
      hasApiKey: !!key,
      persistentApiKey: !!encrypted,
    };
  }
  deleteAiProvider(id: string) {
    this.db.prepare("DELETE FROM ai_providers WHERE id=?").run(id);
    this.aiSessionSecrets.delete(id);
    for (const row of this.db
      .prepare("SELECT connectionId,value FROM ai_connection_settings")
      .all()) {
      const value = aiConnectionSchema.parse(JSON.parse(row.value as string));
      if (value.providerId === id)
        this.setAiConnection({ ...value, providerId: undefined });
    }
    const settings = this.settings();
    if (settings.aiDefaultProviderId === id)
      this.setSettings({ ...settings, aiDefaultProviderId: "" });
  }
  aiConnection(connectionId: string): AiConnectionSettings {
    const row = this.db
      .prepare("SELECT value FROM ai_connection_settings WHERE connectionId=?")
      .get(connectionId);
    return row
      ? aiConnectionSchema.parse(JSON.parse(row.value as string))
      : aiConnectionSchema.parse({ connectionId, enabled: false });
  }
  setAiConnection(value: unknown) {
    const settings = aiConnectionSchema.parse(value);
    this.profile(settings.connectionId);
    if (
      settings.providerId &&
      !this.db
        .prepare("SELECT id FROM ai_providers WHERE id=?")
        .get(settings.providerId)
    )
      throw new Error("Select an existing AI provider");
    this.db
      .prepare(
        "INSERT INTO ai_connection_settings(connectionId,value) VALUES(?,?) ON CONFLICT(connectionId) DO UPDATE SET value=excluded.value",
      )
      .run(settings.connectionId, JSON.stringify(settings));
    return settings;
  }
  deleteAiConnection(connectionId: string) {
    this.db
      .prepare("DELETE FROM ai_connection_settings WHERE connectionId=?")
      .run(connectionId);
  }
  parseUri(uriText: string, name?: string) {
    const uri = new ConnectionString(uriText);
    if (!/^mongodb(\+srv)?:\/\//.test(uriText))
      throw new Error("MongoDB URI required");
    const username = uri.username ? decodeURIComponent(uri.username) : "";
    const password = uri.password
      ? decodeURIComponent(uri.password)
      : undefined;
    uri.username = "";
    uri.password = "";
    const database =
      uri.pathname && uri.pathname !== "/"
        ? decodeURIComponent(uri.pathname.slice(1))
        : "admin";
    const get = (key: string) => uri.searchParams.get(key);
    const profile = profileSchema.parse({
      id: randomUUID(),
      name: name?.trim() || "Imported connection",
      uri: uri.toString(),
      database,
      username,
      authSource: get("authSource") || "admin",
      authMechanism: (get("authMechanism") || "DEFAULT").toUpperCase(),
      tls: get("tls") === "true" || get("ssl") === "true",
      replicaSet: get("replicaSet") || "",
      directConnection: get("directConnection") === "true",
      readPreference: get("readPreference") || "primary",
      writeConcern: get("w") === "1" ? "1" : "majority",
    });
    return { profile, secrets: password === undefined ? {} : { password } };
  }
  exportUri(id: string, includePassword: boolean) {
    return exportMongoUri(this.profile(id), this.secrets(id), includePassword);
  }
  history(favoritesOnly: boolean) {
    return this.db
      .prepare(
        `SELECT id, connectionId, databaseName AS database, collectionName AS collection, code, favorite, label, createdAt FROM history ${favoritesOnly ? "WHERE favorite=1" : ""} ORDER BY createdAt DESC LIMIT 500`,
      )
      .all();
  }
  savedQueries(): SavedQuery[] {
    return this.db
      .prepare(
        "SELECT value FROM saved_queries ORDER BY json_extract(value,'$.group') COLLATE NOCASE, json_extract(value,'$.name') COLLATE NOCASE",
      )
      .all()
      .map((row) => savedQuerySchema.parse(JSON.parse(row.value as string)));
  }
  saveQuery(value: unknown) {
    const query = savedQuerySchema.parse(value);
    this.db
      .prepare(
        "INSERT INTO saved_queries VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(query.id, JSON.stringify(query));
    return query;
  }
  deleteQuery(id: string) {
    this.db.prepare("DELETE FROM saved_queries WHERE id=?").run(id);
  }
  savedPipelines(): SavedPipeline[] {
    return this.db
      .prepare(
        "SELECT value FROM saved_pipelines ORDER BY json_extract(value,'$.group') COLLATE NOCASE, json_extract(value,'$.name') COLLATE NOCASE",
      )
      .all()
      .map((row) => savedPipelineSchema.parse(JSON.parse(row.value as string)));
  }
  savePipeline(value: unknown) {
    const pipeline = savedPipelineSchema.parse(value);
    compileReadOnlyPipeline(pipeline.stages);
    this.db
      .prepare(
        "INSERT INTO saved_pipelines VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(pipeline.id, JSON.stringify(pipeline));
    return pipeline;
  }
  deletePipeline(id: string) {
    this.db.prepare("DELETE FROM saved_pipelines WHERE id=?").run(id);
  }
  receipts(): OperationReceipt[] {
    return this.db
      .prepare(
        "SELECT value FROM operation_receipts ORDER BY occurredAt DESC LIMIT 500",
      )
      .all()
      .map((row) =>
        operationReceiptSchema.parse(JSON.parse(row.value as string)),
      );
  }
  saveReceipt(value: unknown) {
    const receipt = operationReceiptSchema.parse(value);
    this.db
      .prepare(
        "INSERT INTO operation_receipts(id,occurredAt,value) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET occurredAt=excluded.occurredAt,value=excluded.value",
      )
      .run(receipt.id, receipt.occurredAt, JSON.stringify(receipt));
    this.db
      .prepare("DELETE FROM operation_receipts WHERE occurredAt < ?")
      .run(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());
    this.db.exec(
      "DELETE FROM operation_receipts WHERE id NOT IN (SELECT id FROM operation_receipts ORDER BY occurredAt DESC LIMIT 500)",
    );
    return receipt;
  }
  clearReceipts() {
    this.db.exec("DELETE FROM operation_receipts");
  }
  saveHistory(p: any) {
    const id = p.id || randomUUID();
    this.db
      .prepare(
        "INSERT INTO history VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET favorite=excluded.favorite,label=excluded.label,code=excluded.code",
      )
      .run(
        id,
        p.connectionId,
        p.database,
        p.collection,
        p.code,
        Number(p.favorite),
        p.label,
        new Date().toISOString(),
      );
    this.db.exec(
      "DELETE FROM history WHERE favorite=0 AND id NOT IN (SELECT id FROM history WHERE favorite=0 ORDER BY createdAt DESC LIMIT 500)",
    );
    return { id };
  }
  deleteHistory(id: string) {
    this.db.prepare("DELETE FROM history WHERE id=?").run(id);
  }
  shellDrafts(): ShellDraft[] {
    return this.db
      .prepare(
        "SELECT id, connectionId, databaseName AS database, collectionName AS collection, code, updatedAt FROM shell_drafts ORDER BY updatedAt DESC",
      )
      .all()
      .map((draft) => shellDraftSchema.parse(draft));
  }
  saveShellDraft(draft: ShellDraft) {
    const parsed = shellDraftSchema.parse(draft);
    this.db
      .prepare(
        "INSERT INTO shell_drafts(id,connectionId,databaseName,collectionName,code,updatedAt) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET connectionId=excluded.connectionId,databaseName=excluded.databaseName,collectionName=excluded.collectionName,code=excluded.code,updatedAt=excluded.updatedAt",
      )
      .run(
        parsed.id,
        parsed.connectionId,
        parsed.database,
        parsed.collection,
        parsed.code,
        parsed.updatedAt,
      );
    return parsed;
  }
  deleteShellDraft(id: string) {
    this.db.prepare("DELETE FROM shell_drafts WHERE id=?").run(id);
  }
  close() {
    this.db.close();
  }
  workspace() {
    const row = this.db
      .prepare("SELECT value FROM workspace_state WHERE key='current'")
      .get();
    return workspaceSchema.parse(row ? JSON.parse(row.value as string) : {});
  }
  saveWorkspace(value: unknown) {
    const parsed = workspaceSchema.parse(value);
    this.db
      .prepare(
        "INSERT INTO workspace_state VALUES('current',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(parsed));
    return parsed;
  }
  tableLayout(key: string) {
    const row = this.db
      .prepare("SELECT value FROM table_layouts WHERE key=?")
      .get(key);
    return row
      ? tableLayoutSchema.parse(JSON.parse(row.value as string))
      : null;
  }
  saveTableLayout(key: string, value: unknown) {
    const parsed = tableLayoutSchema.parse(value);
    if (!parsed.remember)
      this.db.prepare("DELETE FROM table_layouts WHERE key=?").run(key);
    else
      this.db
        .prepare(
          "INSERT INTO table_layouts VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(parsed));
    return parsed;
  }
  transferPresets() {
    return this.db
      .prepare(
        "SELECT value FROM transfer_presets ORDER BY json_extract(value,'$.name')",
      )
      .all()
      .map((row) =>
        transferPresetSchema.parse(JSON.parse(row.value as string)),
      );
  }
  saveTransferPreset(value: unknown) {
    const parsed = transferPresetSchema.parse(value);
    parsed.input = { ...parsed.input, path: "", confirmation: "", drop: false };
    this.db
      .prepare(
        "INSERT INTO transfer_presets VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(parsed.id, JSON.stringify(parsed));
    return parsed;
  }
  deleteTransferPreset(id: string) {
    this.db.prepare("DELETE FROM transfer_presets WHERE id=?").run(id);
  }
}
