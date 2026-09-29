import { expect, test } from "vitest";
import { navigationEntries } from "../src/renderer/navigation";
import { defaultProfile } from "../src/shared/contracts";
test("searches cached namespaces without mixing connections or including disconnected profiles", () => {
  const profiles = [
    { ...defaultProfile(), id: "a", name: "DEV" },
    { ...defaultProfile(), id: "b", name: "PROD" },
  ];
  const found = navigationEntries(
    profiles,
    ["a"],
    { a: ["shop"], b: ["shop"] },
    {
      "a/shop": [{ name: "orders", type: "collection" }],
      "b/shop": [{ name: "orders", type: "collection" }],
    },
    "orders",
  );
  expect(found.map((f) => [f.connectionId, f.database, f.collection])).toEqual([
    ["a", "shop", "orders"],
  ]);
});
