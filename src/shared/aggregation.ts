import { object } from "./bson";

export interface AggregationStageDraft {
  id: string;
  enabled: boolean;
  text: string;
}

export class AggregationStageError extends Error {
  constructor(
    public readonly stageIndex: number,
    message: string,
  ) {
    super(`Stage ${stageIndex + 1}: ${message}`);
    this.name = "AggregationStageError";
  }
}

const READ_ONLY_STAGES = new Set([
  "$match",
  "$project",
  "$group",
  "$sort",
  "$limit",
  "$skip",
  "$unwind",
  "$lookup",
  "$addFields",
  "$set",
  "$unset",
  "$count",
  "$facet",
  "$replaceRoot",
  "$replaceWith",
  "$sample",
  "$sortByCount",
]);
const MAX_STAGES = 50;
const MAX_BYTES = 1024 * 1024;
const MAX_NESTING = 8;

function isPlainDocument(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value as { _bsontype?: string })._bsontype
  );
}

function validatePipeline(
  pipeline: unknown,
  stageIndex: number,
  path: string,
  depth: number,
): void {
  if (!Array.isArray(pipeline))
    throw new AggregationStageError(
      stageIndex,
      `${path} must be a pipeline array`,
    );
  if (depth > MAX_NESTING)
    throw new AggregationStageError(stageIndex, "Nested pipeline is too deep");
  if (pipeline.length > MAX_STAGES)
    throw new AggregationStageError(
      stageIndex,
      `Pipeline exceeds ${MAX_STAGES} stages`,
    );
  for (const [position, stage] of pipeline.entries()) {
    const location = `${path}[${position}]`;
    if (!isPlainDocument(stage))
      throw new AggregationStageError(
        stageIndex,
        `${location} must be a stage document`,
      );
    const operators = Object.keys(stage);
    if (operators.length !== 1)
      throw new AggregationStageError(
        stageIndex,
        `${location} must contain exactly one stage operator`,
      );
    const operator = operators[0];
    if (!READ_ONLY_STAGES.has(operator))
      throw new AggregationStageError(
        stageIndex,
        `${location} uses ${operator}, which is not approved for read-only aggregation`,
      );
    const value = stage[operator];
    if (operator === "$lookup" && isPlainDocument(value) && "pipeline" in value)
      validatePipeline(
        value.pipeline,
        stageIndex,
        `${location}.$lookup.pipeline`,
        depth + 1,
      );
    if (operator === "$facet") {
      if (!isPlainDocument(value))
        throw new AggregationStageError(
          stageIndex,
          `${location}.$facet must be a document`,
        );
      for (const [name, nested] of Object.entries(value))
        validatePipeline(
          nested,
          stageIndex,
          `${location}.$facet.${name}`,
          depth + 1,
        );
    }
  }
}

/** Compile only enabled stages. This check must also run in the database worker. */
export function compileReadOnlyPipeline(
  stages: AggregationStageDraft[],
): Record<string, any>[] {
  if (stages.length > MAX_STAGES)
    throw new AggregationStageError(
      MAX_STAGES,
      `Pipeline exceeds ${MAX_STAGES} stages`,
    );
  const bytes = stages.reduce(
    (total, stage) => total + new TextEncoder().encode(stage.text).byteLength,
    0,
  );
  if (bytes > MAX_BYTES)
    throw new AggregationStageError(0, "Pipeline exceeds 1 MB of stage text");
  const compiled: Record<string, any>[] = [];
  for (const [index, stage] of stages.entries()) {
    if (!stage.enabled) continue;
    let parsed: Record<string, any>;
    try {
      parsed = object(stage.text);
    } catch (error) {
      throw new AggregationStageError(index, (error as Error).message);
    }
    validatePipeline([parsed], index, "pipeline", 0);
    compiled.push(parsed);
  }
  return compiled;
}
