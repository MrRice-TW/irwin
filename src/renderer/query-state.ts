export type QueryState = "idle" | "success" | "stale" | "error";

export function queryStateAfterInputChange(state: QueryState): QueryState {
  return state === "success" ? "stale" : state;
}

export function queryResultNotice(
  state: QueryState,
  hasRows: boolean,
): "none" | "stale-results" | "previous-results-error" | "query-error" {
  if (state === "stale" && hasRows) return "stale-results";
  if (state === "error")
    return hasRows ? "previous-results-error" : "query-error";
  return "none";
}
