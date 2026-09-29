import { z } from "zod";
import { tableLayoutSchema, workspaceSchema } from "./workspace";
import { savedQuerySchema } from "./saved-query";
import { savedPipelineSchema } from "./saved-pipeline";
import type { AggregationStageDraft } from "./aggregation";
import {
  aiAssistantRequestSchema,
  aiConnectionSchema,
  aiProviderSaveSchema,
} from "./ai";

const name = z.string().min(1).max(255);
const id = z.string().min(1).max(128);
export const profileSchema = z
  .object({
    id,
    name,
    group: z.string().default(""),
    environment: z
      .enum(["development", "staging", "production"])
      .default("development"),
    readOnly: z.boolean().optional(),
    provider: z.enum(["mongodb", "cosmos"]).default("mongodb"),
    uri: z
      .string()
      .max(16384)
      .refine((v) => /^mongodb(\+srv)?:\/\//.test(v), "MongoDB URI required"),
    database: z.string().default("admin"),
    username: z.string().default(""),
    authSource: z.string().default("admin"),
    authMechanism: z
      .enum(["DEFAULT", "SCRAM-SHA-1", "SCRAM-SHA-256", "MONGODB-X509"])
      .default("DEFAULT"),
    tls: z.boolean().default(false),
    caFile: z.string().default(""),
    certFile: z.string().default(""),
    replicaSet: z.string().default(""),
    directConnection: z.boolean().default(false),
    readPreference: z
      .enum([
        "primary",
        "primaryPreferred",
        "secondary",
        "secondaryPreferred",
        "nearest",
      ])
      .default("primary"),
    writeConcern: z.enum(["majority", "1"]).default("majority"),
    timeoutMS: z.number().int().min(1000).max(120000).default(10000),
    queryTimeoutMS: z.number().int().min(5000).max(120000).default(30000),
    partitionKeys: z.record(z.string(), z.string()).default({}),
    ssh: z
      .object({
        enabled: z.boolean().default(false),
        host: z.string().default(""),
        port: z.number().int().min(1).max(65535).default(22),
        username: z.string().default(""),
        privateKeyFile: z.string().default(""),
        hostFingerprint: z.string().default(""),
      })
      .default({
        enabled: false,
        host: "",
        port: 22,
        username: "",
        privateKeyFile: "",
        hostFingerprint: "",
      }),
  })
  .transform((profile) => ({
    ...profile,
    readOnly: profile.readOnly ?? profile.environment === "production",
  }));
export type Profile = z.infer<typeof profileSchema>;
export function withEnvironment(
  profile: Profile,
  environment: Profile["environment"],
): Profile {
  return {
    ...profile,
    environment,
    readOnly:
      environment === "production" && profile.environment !== "production"
        ? true
        : profile.readOnly,
  };
}
export const secretsSchema = z.object({
  password: z.string().optional(),
  sshPassword: z.string().optional(),
  sshPassphrase: z.string().optional(),
  certPassword: z.string().optional(),
});
export type Secrets = z.infer<typeof secretsSchema>;
export const timezones = [
  "local",
  "UTC",
  "Asia/Taipei",
  "Asia/Tokyo",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
] as const;
export const settingsSchema = z.object({
  language: z.enum(["zh", "en"]).default("zh"),
  theme: z.enum(["dark", "light", "azure", "forest", "system"]).default("dark"),
  systemLightTheme: z.enum(["light", "azure", "forest"]).default("light"),
  uiScale: z
    .union([z.literal(100), z.literal(110), z.literal(125)])
    .default(100),
  fontFamily: z
    .string()
    .min(1)
    .max(160)
    .default('Inter, "Segoe UI", "Noto Sans TC", sans-serif'),
  editorFontFamily: z
    .string()
    .min(1)
    .max(160)
    .default(
      'ui-monospace, "Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
    ),
  fontSize: z.number().int().min(11).max(18).default(13),
  editorLineHeight: z.number().int().min(18).max(36).default(24),
  editorPadding: z.number().int().min(8).max(32).default(16),
  autoRunOnOpen: z.boolean().default(true),
  rowDensity: z.enum(["comfortable", "compact"]).default("comfortable"),
  longTextDisplay: z.enum(["truncate", "wrap"]).default("truncate"),
  bsonTypeLabels: z.enum(["selected", "always"]).default("selected"),
  jobNotifications: z.enum(["off", "failures", "all"]).default("failures"),
  aiCloudConsent: z.boolean().default(false),
  aiDefaultProviderId: z.string().max(128).default(""),
  jsonExpandedDepth: z.number().int().min(0).max(4).default(0),
  timezone: z.enum(timezones).default("local"),
  datetimeFormat: z.enum(["iso", "space", "locale"]).default("iso"),
  tabWidth: z.union([z.literal(2), z.literal(4), z.literal(8)]).default(2),
  colors: z
    .object({
      string: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .default("#c7d6e0"),
      number: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .default("#e6bd89"),
      objectId: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .default("#8bbba9"),
      boolean: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .default("#bd9ddb"),
      null: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .default("#5c6974"),
    })
    .default({
      string: "#c7d6e0",
      number: "#e6bd89",
      objectId: "#8bbba9",
      boolean: "#bd9ddb",
      null: "#5c6974",
    }),
});
export type Settings = z.infer<typeof settingsSchema>;
const target = z.object({ connectionId: id, database: name, collection: name });
const userRoleReferenceSchema = z.strictObject({
  role: name,
  database: name,
});
const userRoleTargetSchema = z.strictObject({
  connectionId: id,
  authDatabase: name,
  username: name,
});
const userRolePasswordSchema = z.string().min(8).max(1024);
export const querySchema = target.extend({
  cursorId: id.optional(),
  filter: z.string().default("{}"),
  sort: z.string().default("{}"),
  projection: z.string().default("{}"),
  skip: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  batchSize: z.number().int().min(1).max(1000).default(100),
  maxTimeMS: z.number().int().min(100).max(3600000).default(30000),
});
// Optional legacy property keeps older callers type-compatible; the runtime
// query contract omits it and collection reads are no longer capped by LIMIT.
export type QueryInput = z.infer<typeof querySchema> & { limit?: number };
export const aggregationStageSchema = z.object({
  id,
  enabled: z.boolean(),
  text: z.string().max(1024 * 1024),
});
export const aggregationSchema = target.extend({
  stages: z.array(aggregationStageSchema).max(50),
  cursorId: id.optional(),
  throughIndex: z.number().int().min(0).max(49).optional(),
  batchSize: z.number().int().min(1).max(1000).default(100),
  maxTimeMS: z.number().int().min(100).max(3600000).default(30000),
});
export type AggregationInput = z.infer<typeof aggregationSchema> & {
  stages: AggregationStageDraft[];
};
export const aggregationExportSchema = target.extend({
  stages: z.array(aggregationStageSchema).max(50),
  path: z.string().min(1),
  maxTimeMS: z.number().int().min(100).max(3600000).default(300000),
});
export type AggregationExportInput = z.infer<typeof aggregationExportSchema>;
export const csvColumnSchema = z.object({
  source: name,
  target: z.string().max(255),
  type: z.enum([
    "string",
    "int32",
    "int64",
    "double",
    "decimal",
    "boolean",
    "date",
    "objectId",
    "json",
  ]),
  empty: z.enum(["string", "null", "omit"]).default("string"),
});
export type CsvColumn = z.infer<typeof csvColumnSchema>;
export const transferSchema = z.object({
  connectionId: id,
  database: name,
  collection: z.string().default(""),
  direction: z.enum(["import", "export"]),
  format: z.enum(["json", "csv", "bson"]),
  path: z.string().min(1),
  mode: z.enum(["insert", "replace"]).default("insert"),
  filter: z.string().default("{}"),
  sort: z.string().default("{}"),
  projection: z.string().default("{}"),
  limit: z.number().int().min(0).default(0),
  csvColumns: z.array(csvColumnSchema).default([]),
  drop: z.boolean().default(false),
  confirmation: z.string().default(""),
  sourceVersion: z.string().max(64).default(""),
});
export type TransferInput = z.infer<typeof transferSchema>;
export const transferPresetSchema = z.object({
  id,
  name,
  input: transferSchema.extend({ path: z.string().default("") }),
});
export const schemaInput = target.extend({
  filter: z.string().default("{}"),
  sampleSize: z.number().int().min(1).max(1000).default(200),
  jobId: id,
  maxTimeMS: z.number().min(100).max(3600000).default(30000),
});
export const compareInput = z.object({
  source: target,
  target,
  sourceFilter: z.string().default("{}"),
  targetFilter: z.string().default("{}"),
  matchKeys: z.array(name).min(1).max(20),
  ignorePaths: z.array(name).max(100).default([]),
  jobId: id,
  maxTimeMS: z.number().min(100).max(3600000).default(300000),
});
export const shellDraftSchema = z.object({
  id,
  connectionId: id,
  database: name,
  collection: z.string().default(""),
  code: z.string().max(1000000),
  updatedAt: z.string().datetime(),
});
export type ShellDraft = z.infer<typeof shellDraftSchema>;
export const commands = {
  "ai.providers.list": z.object({}),
  "ai.providers.save": aiProviderSaveSchema,
  "ai.providers.delete": z.object({ id }),
  "ai.providers.test": z.object({ id }),
  "ai.connections.get": z.object({ connectionId: id }),
  "ai.connections.set": aiConnectionSchema,
  "ai.assistant.start": aiAssistantRequestSchema,
  "ai.assistant.cancel": z.object({ requestId: id }),
  "workspace.get": z.object({}),
  "workspace.save": workspaceSchema,
  "tableLayouts.get": z.object({ key: z.string().max(1024) }),
  "tableLayouts.save": z.object({
    key: z.string().max(1024),
    layout: tableLayoutSchema,
  }),
  "transferPresets.list": z.object({}),
  "transferPresets.save": transferPresetSchema,
  "transferPresets.delete": z.object({ id }),
  "analysis.schema": schemaInput,
  "analysis.compare": compareInput,
  "analysis.cancel": z.object({ jobId: id }),
  "reports.export": z.object({
    path: z.string().min(1),
    content: z.string().max(64 * 1024 * 1024),
  }),
  "connections.list": z.object({}),
  "connections.save": z.object({
    profile: profileSchema,
    secrets: secretsSchema.default({}),
  }),
  "connections.delete": z.object({ id }),
  "connections.copy": z.object({ id }),
  "connections.test": z.object({
    profile: profileSchema,
    secrets: secretsSchema.default({}),
  }),
  "connections.parseUri": z.object({
    uri: z.string().min(1).max(16384),
    name: z.string().max(255).optional(),
  }),
  "connections.exportUri": z.object({
    id,
    includePassword: z.boolean().default(false),
  }),
  "connections.open": z.object({ id }),
  "connections.close": z.object({ id }),
  "metadata.databases": z.object({ connectionId: id }),
  "usersRoles.inspect": z.strictObject({ connectionId: id }),
  "usersRoles.userDetails": userRoleTargetSchema,
  "usersRoles.createUser": userRoleTargetSchema.extend({
    password: userRolePasswordSchema,
    roles: z.array(userRoleReferenceSchema).min(1).max(64),
  }),
  "usersRoles.setPassword": userRoleTargetSchema.extend({
    password: userRolePasswordSchema,
  }),
  "usersRoles.grantRole": userRoleTargetSchema.extend(
    userRoleReferenceSchema.shape,
  ),
  "usersRoles.revokeRole": userRoleTargetSchema.extend(
    userRoleReferenceSchema.shape,
  ),
  "usersRoles.dropUser": userRoleTargetSchema
    .extend({ confirmation: z.string().min(1).max(512) })
    .refine(
      (input) =>
        input.confirmation === `${input.authDatabase}.${input.username}`,
      {
        path: ["confirmation"],
        message: "Confirmation must match database.user",
      },
    ),
  "metadata.collections": z.object({ connectionId: id, database: name }),
  "metadata.indexes": target,
  "metadata.createCollection": target,
  "metadata.drop": z.object({
    connectionId: id,
    database: name,
    collection: z.string().default(""),
    confirmation: name,
  }),
  "metadata.createIndex": target.extend({
    keys: z.string(),
    unique: z.boolean().default(false),
    name: z.string().default(""),
    expireAfterSeconds: z.number().int().min(0).optional(),
  }),
  "metadata.dropIndex": target.extend({ name }),
  "metadata.editIndex": target.extend({
    oldName: name,
    keys: z.string(),
    unique: z.boolean().default(false),
    name: z.string().default(""),
    expireAfterSeconds: z.number().int().min(0).optional(),
  }),
  "queries.run": querySchema,
  "aggregations.run": aggregationSchema,
  "aggregations.preview": aggregationSchema,
  "aggregations.explain": aggregationSchema,
  "aggregations.export": aggregationExportSchema,
  "queries.count": querySchema,
  "queries.next": z.object({ cursorId: id }),
  "queries.cancel": z.object({ cursorId: id }),
  "queries.explain": querySchema,
  "results.export": z.object({
    path: z.string().min(1),
    format: z.enum(["csv", "excel"]),
    content: z.string().max(64 * 1024 * 1024),
  }),
  "documents.update": target.extend({
    original: z.string(),
    field: z.string().min(1),
    value: z.string(),
  }),
  "documents.insert": target.extend({ document: z.string() }),
  "documents.fetch": target.extend({ original: z.string() }),
  "documents.delete": target.extend({ original: z.string() }),
  "documents.replace": target.extend({
    original: z.string(),
    document: z.string(),
  }),
  "shellSessions.open": z.object({
    connectionId: id,
    database: name,
    sessionId: id,
  }),
  "shellSessions.execute": z.object({
    sessionId: id,
    code: z.string().min(1).max(1000000),
  }),
  "shellSessions.next": z.object({ sessionId: id }),
  "shellSessions.close": z.object({ sessionId: id }),
  "shellSessions.cancel": z.object({ sessionId: id }),
  "shellDrafts.list": z.object({}),
  "shellDrafts.save": shellDraftSchema,
  "shellDrafts.delete": z.object({ id }),
  "transferJobs.start": transferSchema,
  "transferJobs.cancel": z.object({ jobId: id }),
  "transferJobs.preview": z.object({ path: z.string().min(1) }),
  "history.list": z.object({ favoritesOnly: z.boolean().default(false) }),
  "savedQueries.list": z.object({}),
  "savedQueries.save": savedQuerySchema,
  "savedQueries.delete": z.object({ id }),
  "savedPipelines.list": z.object({}),
  "savedPipelines.save": savedPipelineSchema,
  "savedPipelines.delete": z.object({ id }),
  "operationReceipts.list": z.object({}),
  "operationReceipts.clear": z.object({}),
  "history.save": z.object({
    id: z.string().optional(),
    connectionId: id,
    database: name,
    collection: z.string().default(""),
    code: z.string().max(1000000),
    favorite: z.boolean().default(false),
    label: z.string().default(""),
  }),
  "history.delete": z.object({ id }),
  "settings.get": z.object({}),
  "settings.set": settingsSchema,
  "settings.zoom": z.object({ value: settingsSchema.shape.uiScale }),
  "files.choose": z.object({
    kind: z.enum(["open", "save", "directory"]),
    title: z.string(),
    defaultPath: z.string().optional(),
  }),
  "app.status": z.object({}),
  "clipboard.write": z.object({ text: z.string().max(32 * 1024 * 1024) }),
} as const;
export type Command = keyof typeof commands;
export type Input<K extends Command> = z.input<(typeof commands)[K]>;
export interface Row {
  ejson: string;
  editable: boolean;
  reason?: string;
  source?: {
    connectionId: string;
    database: string;
    collection: string;
    identity: string;
  };
}
export interface Page {
  cursorId: string;
  rows: Row[];
  hasMore: boolean;
  elapsedMS: number;
}
export interface ShellResult {
  rows: Row[];
  output: string[];
  hasMore: boolean;
  database?: string;
}
export interface JobProgress {
  jobId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  processed: number;
  failed: number;
  bytes: number;
  message: string;
  path?: string;
  errorPath?: string;
}
export interface AppEvent {
  type: "job" | "connection" | "shell" | "analysis" | "openJobs";
  data: any;
}
export interface WorkbenchApi {
  request<K extends Command>(command: K, payload: Input<K>): Promise<any>;
  subscribe(listener: (event: AppEvent) => void): () => void;
}
export interface ResolvedConnection {
  profile: Profile;
  uri: string;
  options: Record<string, any>;
}
export interface RpcMessage {
  id: string;
  command: string;
  payload: any;
}
export const defaultProfile = (): Profile =>
  profileSchema.parse({
    id: crypto.randomUUID(),
    name: "Local MongoDB",
    uri: "mongodb://127.0.0.1:27017",
    database: "admin",
  });
