import type { QueryInput, TransferInput } from "../shared/contracts";

/**
 * Builds a streaming transfer from the current filter without copying the
 * renderer page offset. A visible page can start at row 101, while an
 * all-matching export must always begin at the first matching document.
 */
export function allMatchingTransfer(
  query: QueryInput,
  format: "json" | "csv" = "json",
): Partial<TransferInput> & {
  connectionId: string;
  database: string;
} {
  return {
    connectionId: query.connectionId,
    database: query.database,
    collection: query.collection,
    direction: "export",
    format,
    filter: query.filter,
    sort: query.sort,
    projection: query.projection,
    limit: 0,
  };
}
