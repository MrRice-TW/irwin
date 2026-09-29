import { describe, expect, test } from "vitest";
import { Decimal128, ObjectId } from "bson";
import {
  AggregationStageError,
  compileReadOnlyPipeline,
  type AggregationStageDraft,
} from "../src/shared/aggregation";

const stage = (text: string, enabled = true): AggregationStageDraft => ({
  id: crypto.randomUUID(),
  enabled,
  text,
});

describe("read-only aggregation pipeline", () => {
  test("keeps enabled stages in order and preserves Canonical BSON", () => {
    const id = new ObjectId();
    const pipeline = compileReadOnlyPipeline([
      stage(`{ "$match": { "_id": { "$oid": "${id}" } } }`),
      stage('{ "$out": "ignored" }', false),
      stage(
        '{ "$group": { "_id": "$team", "total": { "$sum": { "$numberDecimal": "1.25" } } } }',
      ),
    ]);
    expect(pipeline).toHaveLength(2);
    expect((pipeline[0].$match as { _id: ObjectId })._id).toBeInstanceOf(
      ObjectId,
    );
    expect(
      ((pipeline[1].$group as any).total.$sum as Decimal128).toString(),
    ).toBe("1.25");
  });

  test.each([
    '{ "$out": "target" }',
    '{ "$merge": "target" }',
    '{ "$lookup": { "from": "other", "pipeline": [{ "$out": "target" }], "as": "joined" } }',
    '{ "$facet": { "one": [{ "$merge": "target" }] } }',
    '{ "$unionWith": { "coll": "other", "pipeline": [{ "$out": "target" }] } }',
    '{ "$match": {}, "$out": "target" }',
    "{}",
  ])("rejects unsafe or invalid stage %s", (text) => {
    expect(() => compileReadOnlyPipeline([stage(text)])).toThrow(
      AggregationStageError,
    );
  });

  test("reports the visible stage index", () => {
    try {
      compileReadOnlyPipeline([
        stage('{ "$match": {} }'),
        stage('{ "$out": "x" }'),
      ]);
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregationStageError);
      expect((error as AggregationStageError).stageIndex).toBe(1);
    }
  });

  test("validates nested lookup and facet structure", () => {
    expect(() =>
      compileReadOnlyPipeline([
        stage(
          '{ "$lookup": { "from": "other", "pipeline": {}, "as": "joined" } }',
        ),
      ]),
    ).toThrow(/pipeline/i);
    expect(() =>
      compileReadOnlyPipeline([
        stage('{ "$facet": { "one": { "$match": {} } } }'),
      ]),
    ).toThrow(/facet/i);
    expect(
      compileReadOnlyPipeline([
        stage(
          '{ "$lookup": { "from": "other", "pipeline": [{ "$match": {} }], "as": "joined" } }',
        ),
        stage('{ "$facet": { "one": [{ "$limit": 1 }] } }'),
      ]),
    ).toHaveLength(2);
  });

  test("limits stage count and payload bytes", () => {
    expect(() =>
      compileReadOnlyPipeline(
        Array.from({ length: 51 }, () => stage('{ "$match": {} }')),
      ),
    ).toThrow(/50/);
    expect(() =>
      compileReadOnlyPipeline([
        stage(`{ "$match": { "x": "${"a".repeat(1024 * 1024)}" } }`),
      ]),
    ).toThrow(/1 MB/);
  });
});
