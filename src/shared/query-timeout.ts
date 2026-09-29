export function capInteractiveQueryTimeout<T extends { maxTimeMS?: number }>(
  command: string,
  payload: T,
  capMS: number,
): T {
  if (
    ![
      "queries.run",
      "queries.count",
      "queries.explain",
      "aggregations.run",
      "aggregations.preview",
      "aggregations.explain",
    ].includes(command)
  )
    return payload;
  return { ...payload, maxTimeMS: Math.min(payload.maxTimeMS ?? capMS, capMS) };
}
