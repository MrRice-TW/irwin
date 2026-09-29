import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const app = readFileSync(
  resolve(import.meta.dirname, "../src/renderer/App.tsx"),
  "utf8",
);

describe("renderer startup loading", () => {
  it("defers the collection workspace until a collection tab is needed", () => {
    expect(app).toContain('lazy(() => import("./CollectionTab"))');
    expect(app).toMatch(/lazy\(\(\) =>\s*import\("\.\/SavedQueries"\)/);
    expect(app).toContain("<Suspense");
    expect(app).not.toContain("import CollectionTab, {");
    expect(app).not.toContain('import { SavedQueries } from "./SavedQueries"');
  });
});
