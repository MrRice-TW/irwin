type SearchableHistory = {
  label?: string;
  database: string;
  collection: string;
  code: string;
};

export function filterHistory<T extends SearchableHistory>(
  items: readonly T[],
  search: string,
): T[] {
  const needle = search.trim().toLocaleLowerCase();
  if (!needle) return [...items];
  return items.filter((item) =>
    [item.label, item.database, item.collection, item.code]
      .join("\n")
      .toLocaleLowerCase()
      .includes(needle),
  );
}
