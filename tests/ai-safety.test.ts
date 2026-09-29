import { describe, expect, it } from "vitest";
import {
  parseAssistantResponse,
  redactAggregationStage,
  redactQueryValues,
  summarizeExplainForAI,
} from "../src/shared/ai";

describe("AI context safety", () => {
  it("redacts query literals while preserving field and operator shape", () => {
    const redacted = redactQueryValues(
      JSON.stringify({
        status: "paid-customer@example.com",
        total: { $gte: 2400 },
        createdAt: { $gte: { $date: "2026-01-01T00:00:00.000Z" } },
      }),
    );

    expect(redacted).toContain('"status":"<string>"');
    expect(redacted).toContain('"$gte":"<number>"');
    expect(redacted).toContain('"createdAt":{"$gte":"<date>"}');
    expect(redacted).not.toContain("paid-customer@example.com");
    expect(redacted).not.toContain("2026-01-01");
    expect(redactQueryValues('{"createdAt":-1}', "sort")).toBe(
      '{"createdAt":-1}',
    );
    expect(redactQueryValues('{"status":1,"_id":0}', "projection")).toBe(
      '{"status":1,"_id":0}',
    );
    const stage = redactAggregationStage(
      '{"$match":{"email":"private@example.com"}}',
    );
    expect(stage).toContain('"$match"');
    expect(stage).toContain('"email":"<string>"');
    expect(stage).not.toContain("private@example.com");
    expect(redactAggregationStage('{"$sort":{"createdAt":-1}}')).toBe(
      '{"$sort":{"createdAt":-1}}',
    );
  });

  it("summarizes execution statistics without forwarding raw plan filters", () => {
    const summary = summarizeExplainForAI({
      queryPlanner: {
        winningPlan: {
          stage: "FETCH",
          filter: { email: "private@example.com" },
          inputStage: { stage: "IXSCAN", indexName: "email_1" },
        },
      },
      executionStats: {
        nReturned: 3,
        totalKeysExamined: 4,
        totalDocsExamined: 3,
        executionTimeMillis: 2,
      },
    });

    expect(summary).toEqual({
      metrics: {
        nReturned: 3,
        totalKeysExamined: 4,
        totalDocsExamined: 3,
        executionTimeMillis: 2,
      },
      stages: [{ stage: "FETCH" }, { stage: "IXSCAN", indexName: "email_1" }],
    });
    expect(JSON.stringify(summary)).not.toContain("private@example.com");
  });

  it("reads canonical Extended JSON numeric metrics", () => {
    const summary = summarizeExplainForAI({
      executionStats: {
        nReturned: { $numberLong: "12" },
        totalDocsExamined: { $numberLong: "80" },
      },
    });
    expect(summary.metrics).toEqual({ nReturned: 12, totalDocsExamined: 80 });
  });
});

describe("AI response validation", () => {
  const context = {
    task: "query" as const,
    fields: ["status", "total", "createdAt", "customerId"],
    lookupCollections: ["customers"],
  };

  it("accepts a find draft that only uses known fields", () => {
    const result = parseAssistantResponse(
      JSON.stringify({
        kind: "draft",
        mode: "find",
        summary: "Find paid orders above the requested amount.",
        assumptions: [],
        fieldsUsed: ["status", "total"],
        query: {
          filter: { status: "paid", total: { $gte: 100 } },
          sort: { createdAt: -1 },
          projection: { _id: 0, status: 1, total: 1 },
        },
      }),
      context,
    );

    expect(result.kind).toBe("valid");
    if (result.kind === "valid") expect(result.value.kind).toBe("draft");
  });

  it("accepts aggregation aliases without treating output names as source fields", () => {
    const result = parseAssistantResponse(
      JSON.stringify({
        kind: "draft",
        mode: "aggregation",
        summary: "Group paid orders by status.",
        assumptions: [],
        fieldsUsed: ["status", "total"],
        stages: [
          { $match: { status: "paid" } },
          { $project: { orderTotal: "$total", status: 1, _id: 0 } },
          { $group: { _id: "$status", amount: { $sum: "$orderTotal" } } },
        ],
      }),
      context,
    );
    expect(result.kind).toBe("valid");
  });

  it("accepts a lookup only when its collection and fields were explicitly selected", () => {
    const result = parseAssistantResponse(
      JSON.stringify({
        kind: "draft",
        mode: "aggregation",
        summary: "Join each order with its customer.",
        assumptions: [],
        fieldsUsed: ["customerId"],
        stages: [
          {
            $lookup: {
              from: "customers",
              localField: "customerId",
              foreignField: "_id",
              as: "customer",
            },
          },
        ],
      }),
      context,
    );

    expect(result.kind).toBe("valid");
  });

  it("rejects write stages and unapproved lookup targets", () => {
    const write = parseAssistantResponse(
      JSON.stringify({
        kind: "draft",
        mode: "aggregation",
        summary: "Write results.",
        assumptions: [],
        fieldsUsed: ["status"],
        stages: [{ $out: "archive" }],
      }),
      context,
    );
    const lookup = parseAssistantResponse(
      JSON.stringify({
        kind: "draft",
        mode: "aggregation",
        summary: "Join another collection.",
        assumptions: [],
        fieldsUsed: ["customerId"],
        stages: [
          {
            $lookup: {
              from: "secrets",
              localField: "customerId",
              foreignField: "_id",
              as: "customer",
            },
          },
        ],
      }),
      context,
    );

    expect(write.kind).toBe("error");
    expect(lookup.kind).toBe("error");
  });

  it("rejects server-side JavaScript in AI-generated filters and pipelines", () => {
    const where = parseAssistantResponse(
      JSON.stringify({
        kind: "draft",
        mode: "find",
        summary: "Run a server-side function.",
        assumptions: [],
        fieldsUsed: [],
        query: { filter: { $where: "function () { return true; }" } },
      }),
      context,
    );
    const functionStage = parseAssistantResponse(
      JSON.stringify({
        kind: "draft",
        mode: "aggregation",
        summary: "Run a server-side function.",
        assumptions: [],
        fieldsUsed: [],
        stages: [
          {
            $addFields: {
              value: {
                $function: {
                  body: "function () { return 1; }",
                  args: [],
                  lang: "js",
                },
              },
            },
          },
        ],
      }),
      context,
    );
    expect(where.kind).toBe("error");
    expect(functionStage.kind).toBe("error");
  });

  it("rejects unknown fields instead of applying a guessed query", () => {
    const result = parseAssistantResponse(
      JSON.stringify({
        kind: "draft",
        mode: "find",
        summary: "Find recent orders.",
        assumptions: [],
        fieldsUsed: ["createdOn"],
        query: { filter: { createdOn: { $gte: "2026-01-01" } } },
      }),
      context,
    );

    expect(result.kind).toBe("error");
  });

  it("checks full dotted paths unless the schema marks an object or array prefix", () => {
    const makeDraft = (field: string) =>
      JSON.stringify({
        kind: "draft",
        mode: "find",
        summary: "Find records by a nested field.",
        assumptions: [],
        fieldsUsed: [field],
        query: { filter: { [field]: "value" } },
      });
    const exact = parseAssistantResponse(makeDraft("profile.name"), {
      ...context,
      fields: ["profile", "profile.name"],
    });
    const unknown = parseAssistantResponse(makeDraft("profile.secret"), {
      ...context,
      fields: ["profile", "profile.name"],
    });
    const allowedObjectChild = parseAssistantResponse(
      makeDraft("profile.displayName"),
      {
        ...context,
        fields: ["profile"],
        fieldPrefixes: ["profile"],
      },
    );

    expect(exact.kind).toBe("valid");
    expect(unknown.kind).toBe("error");
    expect(allowedObjectChild.kind).toBe("valid");
  });

  it("requires Explain findings to cite exact plan evidence", () => {
    const explainContext = {
      task: "explain" as const,
      fields: [],
      lookupCollections: [],
      metrics: { totalDocsExamined: 80 },
      stages: ["COLLSCAN"],
    };
    const valid = parseAssistantResponse(
      JSON.stringify({
        kind: "explanation",
        summary: "This plan scans documents before returning results.",
        findings: [
          {
            text: "The plan examined 80 documents.",
            metric: "totalDocsExamined",
            value: 80,
            stage: "COLLSCAN",
          },
        ],
        suggestions: [
          {
            text: "Check whether COLLSCAN is expected for this query.",
            stage: "COLLSCAN",
            needsValidation: true,
          },
        ],
      }),
      explainContext,
    );
    const unsupported = parseAssistantResponse(
      JSON.stringify({
        kind: "explanation",
        summary: "This plan scans many documents.",
        findings: [
          {
            text: "The plan examined 81 documents.",
            metric: "totalDocsExamined",
            value: 80,
          },
        ],
        suggestions: [],
      }),
      explainContext,
    );
    const ungrounded = parseAssistantResponse(
      JSON.stringify({
        kind: "explanation",
        summary: "The query is 90% inefficient.",
        findings: [],
        suggestions: [],
      }),
      explainContext,
    );

    expect(valid.kind).toBe("valid");
    expect(unsupported.kind).toBe("error");
    expect(ungrounded.kind).toBe("error");
  });

  it("keeps Cosmos query drafting separate from aggregation support", () => {
    const result = parseAssistantResponse(
      JSON.stringify({
        kind: "draft",
        mode: "aggregation",
        summary: "Group records.",
        assumptions: [],
        fieldsUsed: ["status"],
        stages: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
      }),
      { ...context, allowAggregation: false },
    );

    expect(result.kind).toBe("error");
  });
});
