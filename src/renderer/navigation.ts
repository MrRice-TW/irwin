import type { Profile } from "../shared/contracts";
export interface NavigationEntry {
  connectionId: string;
  connectionName: string;
  database: string;
  collection: string;
  label: string;
}
export function navigationEntries(
  profiles: Profile[],
  connected: string[],
  databases: Record<string, string[]>,
  collections: Record<string, { name: string; type: string }[]>,
  search = "",
): NavigationEntry[] {
  const entries: NavigationEntry[] = [];
  for (const profile of profiles.filter((p) => connected.includes(p.id)))
    for (const database of databases[profile.id] || [profile.database]) {
      const names = collections[`${profile.id}/${database}`] || [];
      for (const name of ["", ...names.map((c) => c.name)]) {
        const label = `${profile.name} / ${database}${name ? ` / ${name}` : ""}`;
        if (
          label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
        )
          entries.push({
            connectionId: profile.id,
            connectionName: profile.name,
            database,
            collection: name,
            label,
          });
      }
    }
  return entries;
}
