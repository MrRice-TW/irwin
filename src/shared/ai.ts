import { z } from "zod";
import { compileReadOnlyPipeline } from "./aggregation";

const text = z.string().trim().min(1).max(4000);
const jsonDocument = z.record(z.string(), z.unknown());
const metricNames = [
  "nReturned",
  "totalKeysExamined",
  "totalDocsExamined",
  "executionTimeMillis",
] as const;

export const aiProviderSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(100),
  kind: z.enum(["openai-compatible", "anthropic", "gemini"]),
  baseUrl: z.string().trim().min(1).max(2048),
  model: z.string().trim().min(1).max(255),
  allowInsecureHttp: z.boolean().default(false),
});
export type AiProvider = z.infer<typeof aiProviderSchema>;

export function validateAiEndpoint(
  value: string,
  allowInsecureHttp: boolean,
): { ok: boolean; message?: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, message: "Enter a valid model service URL" };
  }
  if (url.username || url.password || url.search || url.hash)
    return {
      ok: false,
      message:
        "Endpoint URLs cannot contain credentials, query strings, or fragments",
    };
  if (url.protocol === "https:") return { ok: true };
  const host = url.hostname.toLowerCase();
  const loopback =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    host === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(host);
  if (url.protocol === "http:" && loopback) return { ok: true };
  if (url.protocol === "http:" && allowInsecureHttp && isPrivateLanHost(host))
    return { ok: true };
  return {
    ok: false,
    message:
      "Use HTTPS, localhost HTTP, or explicitly allow an insecure LAN endpoint",
  };
}

function isPrivateLanHost(host: string) {
  const parts = host.split(".").map(Number);
  if (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return (
      parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254)
    );
  }
  const ipv6 = host.replace(/^\[|\]$/g, "");
  return (
    host.endsWith(".local") ||
    host.endsWith(".lan") ||
    host.endsWith(".internal") ||
    /^f[cd][0-9a-f]{2}:/i.test(ipv6) ||
    /^fe80:/i.test(ipv6)
  );
}

export function isAiEndpointRemote(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return !(
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "[::1]" ||
      host === "::1" ||
      /^127(?:\.\d{1,3}){3}$/.test(host)
    );
  } catch {
    return true;
  }
}

export const aiConnectionSchema = z.object({
  connectionId: z.string().min(1).max(128),
  enabled: z.boolean().default(false),
  providerId: z.string().min(1).max(128).optional(),
});
export type AiConnectionSettings = z.infer<typeof aiConnectionSchema>;

export const aiProviderSaveSchema = z.object({
  provider: aiProviderSchema,
  apiKey: z.string().max(4096).optional(),
});

export const aiAssistantRequestSchema = z.object({
  requestId: z.string().min(1).max(128),
  connectionId: z.string().min(1).max(128),
  database: z.string().min(1).max(255),
  collection: z.string().min(1).max(255),
  task: z.enum(["query", "explain"]),
  draftMode: z.enum(["find", "aggregation"]).optional(),
  language: z.enum(["zh", "en"]),
  question: z.string().trim().min(1).max(4000),
  currentQuery: z
    .object({
      filter: z.string().max(32000),
      sort: z.string().max(32000),
      projection: z.string().max(32000),
    })
    .optional(),
  aggregationStages: z
    .array(
      z.object({ text: z.string().max(1024 * 1024), enabled: z.boolean() }),
    )
    .max(50)
    .optional(),
  explainPlan: z
    .string()
    .max(1024 * 1024)
    .optional(),
  priorMessages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      }),
    )
    .max(10)
    .default([]),
  fieldHints: z
    .array(
      z.object({
        path: z.string().min(1).max(255),
        types: z.array(z.string().max(40)).max(12),
      }),
    )
    .max(500)
    .default([]),
  lookupCollection: z.string().min(1).max(255).optional(),
  maxTimeMS: z.number().int().min(1000).max(30000).default(10000),
});
export type AiAssistantRequest = z.infer<typeof aiAssistantRequestSchema>;

const clarificationSchema = z.object({
  kind: z.literal("clarification"),
  question: text,
});
const explanationSchema = z.object({
  kind: z.literal("explanation"),
  summary: text,
  findings: z
    .array(
      z.object({
        text,
        metric: z.enum(metricNames).optional(),
        value: z.number().finite().optional(),
        stage: z.string().trim().min(1).max(64).optional(),
      }),
    )
    .max(12),
  suggestions: z
    .array(
      z.object({
        text,
        metric: z.enum(metricNames).optional(),
        value: z.number().finite().optional(),
        stage: z.string().trim().min(1).max(64).optional(),
        needsValidation: z.boolean().default(true),
      }),
    )
    .max(12),
});
const draftSchema = z.discriminatedUnion("mode", [
  z.object({
    kind: z.literal("draft"),
    mode: z.literal("find"),
    summary: text,
    assumptions: z.array(z.string().trim().max(500)).max(12),
    fieldsUsed: z.array(z.string().trim().min(1).max(255)).max(100),
    query: z.object({
      filter: jsonDocument.default({}),
      sort: jsonDocument.default({}),
      projection: jsonDocument.default({}),
    }),
  }),
  z.object({
    kind: z.literal("draft"),
    mode: z.literal("aggregation"),
    summary: text,
    assumptions: z.array(z.string().trim().max(500)).max(12),
    fieldsUsed: z.array(z.string().trim().min(1).max(255)).max(100),
    stages: z.array(jsonDocument).max(50),
  }),
]);

const assistantOutputSchema = z.discriminatedUnion("kind", [
  clarificationSchema,
  explanationSchema,
  draftSchema,
]);
export type AssistantOutput = z.infer<typeof assistantOutputSchema>;

export type AssistantContext = {
  task: "query" | "explain";
  draftMode?: "find" | "aggregation";
  fields: string[];
  fieldPrefixes?: string[];
  lookupCollections: string[];
  metrics?: Partial<Record<(typeof metricNames)[number], number>>;
  stages?: string[];
  allowAggregation?: boolean;
};

export type AssistantParseResult =
  { kind: "valid"; value: AssistantOutput } | { kind: "error"; error: string };

function hasNumericClaim(text: string): boolean {
  return /\d/.test(text);
}

function citedNumbersMatch(text: string, value: number): boolean {
  const numbers = text.match(/\d[\d,]*(?:\.\d+)?/g) || [];
  return numbers.every(
    (number) => Number(number.replaceAll(",", "")) === value,
  );
}

function parseJsonResponse(raw: string): unknown {
  const stripped = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    if (start < 0) throw new Error("The model did not return a JSON response");
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < stripped.length; index++) {
      const character = stripped[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth++;
      else if (character === "}" && --depth === 0)
        return JSON.parse(stripped.slice(start, index + 1));
    }
    throw new Error("The model returned incomplete JSON");
  }
}

function collectLookupTargets(
  value: unknown,
  targets: string[] = [],
): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectLookupTargets(item, targets);
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.$lookup && typeof record.$lookup === "object") {
      const from = (record.$lookup as Record<string, unknown>).from;
      if (typeof from === "string") targets.push(from);
    }
    for (const item of Object.values(record))
      collectLookupTargets(item, targets);
  }
  return targets;
}

const forbiddenAiOperators = new Set([
  "$where",
  "$function",
  "$accumulator",
  "$out",
  "$merge",
  "$search",
  "$searchMeta",
  "$vectorSearch",
  "$currentOp",
]);

function findForbiddenAiOperator(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenAiOperator(item);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenAiOperators.has(key)) return key;
      const found = findForbiddenAiOperator(child);
      if (found) return found;
    }
  }
  return undefined;
}

function referencedFields(value: unknown, fields: string[] = []): string[] {
  if (typeof value === "string" && /^\$[A-Za-z_]/.test(value)) {
    fields.push(value.slice(1));
  } else if (Array.isArray(value)) {
    for (const item of value) referencedFields(item, fields);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (!key.startsWith("$")) fields.push(key);
      referencedFields(item, fields);
    }
  }
  return fields;
}

function draftPayload(value: Extract<AssistantOutput, { kind: "draft" }>) {
  return value.mode === "find" ? value.query : { stages: value.stages };
}

function referencedValueFields(
  value: unknown,
  fields: string[] = [],
): string[] {
  if (typeof value === "string" && /^\$[A-Za-z_]/.test(value)) {
    fields.push(value.slice(1));
  } else if (Array.isArray(value)) {
    for (const item of value) referencedValueFields(item, fields);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value))
      referencedValueFields(item, fields);
  }
  return fields;
}

function aggregationStageFields(stage: Record<string, unknown>) {
  const operator = Object.keys(stage)[0];
  const payload = stage[operator];
  const fields: string[] = [];
  const outputs: string[] = [];
  if (operator === "$lookup" && isRecord(payload)) {
    if (typeof payload.localField === "string") fields.push(payload.localField);
    if (typeof payload.foreignField === "string")
      fields.push(payload.foreignField);
    if (Array.isArray(payload.pipeline))
      for (const nested of payload.pipeline)
        if (isRecord(nested))
          fields.push(...aggregationStageFields(nested).fields);
    if (typeof payload.as === "string") outputs.push(payload.as);
  } else if (operator === "$match" || operator === "$sort") {
    fields.push(...referencedFields(payload));
  } else if (operator === "$project" && isRecord(payload)) {
    for (const [name, value] of Object.entries(payload)) {
      outputs.push(name);
      if (value === 1 || value === 0 || value === true || value === false)
        fields.push(name);
      else fields.push(...referencedValueFields(value));
    }
  } else if (
    (operator === "$addFields" || operator === "$set") &&
    isRecord(payload)
  ) {
    for (const [name, value] of Object.entries(payload)) {
      outputs.push(name);
      fields.push(...referencedValueFields(value));
    }
  } else if (operator === "$group" && isRecord(payload)) {
    outputs.push(...Object.keys(payload));
    for (const value of Object.values(payload))
      fields.push(...referencedValueFields(value));
  } else if (operator === "$facet" && isRecord(payload)) {
    outputs.push(...Object.keys(payload));
    for (const nestedPipeline of Object.values(payload))
      if (Array.isArray(nestedPipeline))
        for (const nested of nestedPipeline)
          if (isRecord(nested))
            fields.push(...aggregationStageFields(nested).fields);
  } else if (operator === "$count" && typeof payload === "string") {
    outputs.push(payload);
  } else if (operator === "$unset") {
    for (const name of Array.isArray(payload) ? payload : [payload])
      if (typeof name === "string") fields.push(name);
  } else if (operator === "$unwind") {
    fields.push(...referencedValueFields(payload));
  } else {
    fields.push(...referencedValueFields(payload));
  }
  return { fields, outputs };
}

export function parseAssistantResponse(
  raw: string,
  context: AssistantContext,
): AssistantParseResult {
  let parsed: AssistantOutput;
  try {
    parsed = assistantOutputSchema.parse(parseJsonResponse(raw));
  } catch (error) {
    return {
      kind: "error",
      error: error instanceof Error ? error.message : "Invalid model response",
    };
  }

  if (parsed.kind === "explanation") {
    const availableStages = new Set(context.stages || []);
    if (hasNumericClaim(parsed.summary))
      return {
        kind: "error",
        error: "Numeric Explain claims must appear as cited findings",
      };
    for (const finding of parsed.findings) {
      if ((finding.metric === undefined) !== (finding.value === undefined))
        return {
          kind: "error",
          error:
            "Explain metric citations must include both a metric and its value",
        };
      if (finding.metric) {
        const actual = context.metrics?.[finding.metric];
        if (actual === undefined || finding.value !== actual)
          return {
            kind: "error",
            error:
              "The explanation cited an unsupported " +
              finding.metric +
              " value",
          };
      }
      if (finding.stage && !availableStages.has(finding.stage))
        return {
          kind: "error",
          error:
            "The explanation cited a stage that is not in the plan: " +
            finding.stage,
        };
      if (!finding.metric && !finding.stage)
        return {
          kind: "error",
          error: "Each Explain finding must cite a plan metric or stage",
        };
      if (
        hasNumericClaim(finding.text) &&
        (!finding.metric ||
          finding.value === undefined ||
          !citedNumbersMatch(finding.text, finding.value))
      )
        return {
          kind: "error",
          error:
            "Numeric Explain findings must match their cited plan metric value",
        };
    }
    for (const suggestion of parsed.suggestions) {
      if (
        (suggestion.metric === undefined) !==
        (suggestion.value === undefined)
      )
        return {
          kind: "error",
          error:
            "Explain metric citations must include both a metric and its value",
        };
      if (suggestion.metric) {
        const actual = context.metrics?.[suggestion.metric];
        if (actual === undefined || suggestion.value !== actual)
          return {
            kind: "error",
            error:
              "The suggestion cited an unsupported " +
              suggestion.metric +
              " value",
          };
      }
      if (suggestion.stage && !availableStages.has(suggestion.stage))
        return {
          kind: "error",
          error:
            "The suggestion cited a stage that is not in the plan: " +
            suggestion.stage,
        };
      if (!suggestion.metric && !suggestion.stage)
        return {
          kind: "error",
          error: "Each Explain suggestion must cite a plan metric or stage",
        };
      if (
        hasNumericClaim(suggestion.text) &&
        (!suggestion.metric ||
          suggestion.value === undefined ||
          !citedNumbersMatch(suggestion.text, suggestion.value))
      )
        return {
          kind: "error",
          error:
            "Numeric Explain suggestions must match their cited plan metric value",
        };
      if (!suggestion.needsValidation)
        return {
          kind: "error",
          error:
            "Explain performance suggestions must be marked for validation",
        };
    }
    return { kind: "valid", value: parsed };
  }
  if (parsed.kind === "clarification") return { kind: "valid", value: parsed };
  if (context.task !== "query")
    return {
      kind: "error",
      error: "A query draft is not valid for this request",
    };
  if (context.draftMode && parsed.mode !== context.draftMode)
    return {
      kind: "error",
      error: `A ${context.draftMode} draft is required for this request`,
    };
  if (
    parsed.kind === "draft" &&
    parsed.mode === "aggregation" &&
    context.allowAggregation === false
  )
    return {
      kind: "error",
      error: "Aggregation drafts are not enabled for this database provider",
    };

  const forbiddenOperator = findForbiddenAiOperator(draftPayload(parsed));
  if (forbiddenOperator)
    return {
      kind: "error",
      error: `The generated draft contains a disallowed operator: ${forbiddenOperator}`,
    };

  const knownFields = new Set(context.fields);
  knownFields.add("_id");
  const isKnownField = (field: string) =>
    knownFields.has(field) ||
    (context.fieldPrefixes || []).some((prefix) =>
      field.startsWith(prefix + "."),
    );
  const declaredUnknown = parsed.fieldsUsed.find(
    (field) => !isKnownField(field),
  );
  if (declaredUnknown)
    return {
      kind: "error",
      error: `Unknown field in generated query: ${declaredUnknown}`,
    };
  const usedFields =
    parsed.mode === "find"
      ? [
          ...referencedFields(parsed.query.filter),
          ...referencedFields(parsed.query.sort),
          ...referencedFields(parsed.query.projection),
        ]
      : [];
  const aliases = new Set<string>();
  if (parsed.mode === "aggregation") {
    for (const stage of parsed.stages) {
      const parts = aggregationStageFields(stage);
      usedFields.push(...parts.fields.filter((field) => !aliases.has(field)));
      parts.outputs.forEach((field) => aliases.add(field));
    }
  }
  const unknownField = usedFields.find((field) => !isKnownField(field));
  if (unknownField)
    return {
      kind: "error",
      error: `Unknown field in generated query: ${unknownField}`,
    };

  const targets = collectLookupTargets(draftPayload(parsed));
  const unapprovedTarget = targets.find(
    (target) => !context.lookupCollections.includes(target),
  );
  if (unapprovedTarget)
    return {
      kind: "error",
      error: `The lookup collection was not explicitly selected: ${unapprovedTarget}`,
    };

  if (parsed.mode === "aggregation") {
    try {
      compileReadOnlyPipeline(
        parsed.stages.map((stage, index) => ({
          id: `ai-${index}`,
          enabled: true,
          text: JSON.stringify(stage),
        })),
      );
    } catch (error) {
      return {
        kind: "error",
        error:
          error instanceof Error ? error.message : "Invalid read-only pipeline",
      };
    }
  }
  return { kind: "valid", value: parsed };
}

function redactValue(value: unknown): unknown {
  if (value === null) return "<null>";
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === "string") return "<string>";
  if (typeof value === "number") return "<number>";
  if (typeof value === "boolean") return "<boolean>";
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    const keys = Object.keys(item);
    if (keys.length === 1) {
      if (keys[0] === "$date") return "<date>";
      if (keys[0] === "$oid") return "<objectId>";
      if (
        keys[0] === "$numberInt" ||
        keys[0] === "$numberLong" ||
        keys[0] === "$numberDouble" ||
        keys[0] === "$numberDecimal"
      )
        return "<number>";
      if (keys[0] === "$binary") return "<binary>";
      if (keys[0] === "$regularExpression") return "<regularExpression>";
      if (keys[0] === "$timestamp") return "<timestamp>";
    }
    return Object.fromEntries(
      Object.entries(item).map(([key, child]) => [key, redactValue(child)]),
    );
  }
  return "<value>";
}

export function redactQueryValues(
  query: string,
  mode: "filter" | "sort" | "projection" = "filter",
): string {
  try {
    const value = JSON.parse(query);
    if (!value || Array.isArray(value) || typeof value !== "object")
      return "<invalid query>";
    if (mode === "filter") return JSON.stringify(redactValue(value));
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          const structural =
            mode === "sort"
              ? item === 1 || item === -1
              : item === 0 || item === 1 || item === false || item === true;
          return [key, structural ? item : redactValue(item)];
        }),
      ),
    );
  } catch {
    return "<invalid query>";
  }
}

function redactExpression(value: unknown, preserveOneZero = false): unknown {
  if (typeof value === "string")
    return value.startsWith("$") ? value : "<string>";
  if (typeof value === "number")
    return preserveOneZero && (value === 0 || value === 1) ? value : "<number>";
  if (typeof value === "boolean") return "<boolean>";
  if (value === null) return "<null>";
  if (Array.isArray(value))
    return value.map((item) => redactExpression(item, preserveOneZero));
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (
      keys.length === 1 &&
      keys[0] in
        {
          $date: 1,
          $oid: 1,
          $numberInt: 1,
          $numberLong: 1,
          $numberDouble: 1,
          $numberDecimal: 1,
          $binary: 1,
          $regularExpression: 1,
          $timestamp: 1,
        }
    )
      return redactValue(value);
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactExpression(item, preserveOneZero),
      ]),
    );
  }
  return "<value>";
}

function redactPipelineStage(stage: unknown): unknown {
  if (!isRecord(stage)) return "<invalid stage>";
  const operator = Object.keys(stage)[0];
  const payload = stage[operator];
  if (
    operator === "$limit" ||
    operator === "$skip" ||
    operator === "$count" ||
    operator === "$unset" ||
    operator === "$sample" ||
    operator === "$unwind"
  )
    return stage;
  if (operator === "$sort" && isRecord(payload)) {
    const redacted = JSON.parse(
      redactQueryValues(JSON.stringify(payload), "sort"),
    );
    return { [operator]: redacted };
  }
  if (operator === "$project" && isRecord(payload)) {
    return {
      [operator]: Object.fromEntries(
        Object.entries(payload).map(([key, value]) => [
          key,
          value === 0 || value === 1 || value === true || value === false
            ? value
            : redactExpression(value),
        ]),
      ),
    };
  }
  if (operator === "$lookup" && isRecord(payload)) {
    return {
      [operator]: Object.fromEntries(
        Object.entries(payload).map(([key, value]) => [
          key,
          key === "pipeline" && Array.isArray(value)
            ? value.map(redactPipelineStage)
            : key === "let"
              ? redactExpression(value)
              : value,
        ]),
      ),
    };
  }
  if (operator === "$facet" && isRecord(payload))
    return {
      [operator]: Object.fromEntries(
        Object.entries(payload).map(([name, pipeline]) => [
          name,
          Array.isArray(pipeline)
            ? pipeline.map(redactPipelineStage)
            : "<invalid pipeline>",
        ]),
      ),
    };
  if (operator === "$match") return { [operator]: redactValue(payload) };
  if (operator === "$group")
    return { [operator]: redactExpression(payload, true) };
  if (operator === "$addFields" || operator === "$set")
    return { [operator]: redactExpression(payload) };
  return { [operator]: redactExpression(payload) };
}

export function redactAggregationStage(stageText: string): string {
  try {
    const stage = JSON.parse(stageText);
    return JSON.stringify(redactPipelineStage(stage));
  } catch {
    return "<invalid stage>";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function findExecutionStats(
  value: unknown,
  depth = 0,
): Record<string, unknown> | undefined {
  if (depth > 12 || !isRecord(value)) return undefined;
  if (isRecord(value.executionStats)) return value.executionStats;
  for (const child of Object.values(value)) {
    const found = findExecutionStats(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function finiteMetric(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0)
    return value;
  if (isRecord(value)) {
    const raw =
      value.$numberInt ??
      value.$numberLong ??
      value.$numberDouble ??
      value.$numberDecimal;
    if (typeof raw === "string") {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
  }
  return undefined;
}

function collectPlanStages(
  value: unknown,
): { stage: string; indexName?: string }[] {
  const result: { stage: string; indexName?: string }[] = [];
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number) => {
    if (depth > 16 || result.length >= 40 || !isRecord(item) || seen.has(item))
      return;
    seen.add(item);
    if (typeof item.stage === "string" && /^[A-Z_]{2,40}$/.test(item.stage)) {
      result.push({
        stage: item.stage,
        ...(typeof item.indexName === "string"
          ? { indexName: item.indexName.slice(0, 160) }
          : {}),
      });
    }
    for (const child of Object.values(item)) {
      if (Array.isArray(child))
        for (const nested of child) visit(nested, depth + 1);
      else visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return result;
}

export function summarizeExplainForAI(value: unknown): {
  metrics: Partial<Record<(typeof metricNames)[number], number>>;
  stages: { stage: string; indexName?: string }[];
} {
  const executionStats = findExecutionStats(value);
  const metrics: Partial<Record<(typeof metricNames)[number], number>> = {};
  if (executionStats) {
    for (const key of metricNames) {
      const item = finiteMetric(executionStats[key]);
      if (item !== undefined) metrics[key] = item;
    }
  }
  const stages = collectPlanStages(value);
  return { metrics, stages };
}
