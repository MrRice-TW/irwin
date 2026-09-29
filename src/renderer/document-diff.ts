export type DocumentChange = {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: string;
  after?: string;
};

function valueText(value: unknown) {
  return JSON.stringify(value);
}

function diff(
  before: any,
  after: any,
  path: string,
  output: DocumentChange[],
) {
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      const child = path ? `${path}.${key}` : key;
      if (!Object.hasOwn(before, key))
        output.push({ path: child, kind: "added", after: valueText(after[key]) });
      else if (!Object.hasOwn(after, key))
        output.push({ path: child, kind: "removed", before: valueText(before[key]) });
      else diff(before[key], after[key], child, output);
    }
    return;
  }
  if (valueText(before) !== valueText(after))
    output.push({ path: path || "$", kind: "changed", before: valueText(before), after: valueText(after) });
}

export function documentChanges(original: string, current: string): DocumentChange[] {
  const output: DocumentChange[] = [];
  diff(JSON.parse(original), JSON.parse(current), "", output);
  return output;
}
