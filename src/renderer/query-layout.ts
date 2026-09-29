import type { TabState } from "../shared/workspace";

export function initialQueryLayout(
  saved?: Pick<TabState, "queryOptionsExpanded" | "resultFocus">,
) {
  return {
    queryOptionsExpanded: saved?.queryOptionsExpanded ?? true,
    resultFocus: saved?.resultFocus ?? false,
  };
}

export function queryOptionIndicators(
  sort: string,
  projection: string,
): string[] {
  const active = (text: string) => !!text.trim() && text.trim() !== "{}";
  return [
    ...(active(sort) ? ["SORT"] : []),
    ...(active(projection) ? ["PROJECTION"] : []),
  ];
}
