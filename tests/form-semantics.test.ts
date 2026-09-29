import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const renderer = (file: string) =>
  readFileSync(resolve(import.meta.dirname, `../src/renderer/${file}`), "utf8");

describe("secondary dialog form semantics", () => {
  it("gives transfer inputs stable field names", () => {
    const transfer = renderer("TransferDialog.tsx");
    for (const field of [
      "transfer-preset",
      "transfer-connection",
      "transfer-direction",
      "transfer-format",
      "transfer-database",
      "transfer-collection",
      "transfer-filter",
    ])
      expect(transfer).toContain(`name="${field}"`);
  });

  it("gives each analysis target stable field names", () => {
    const analysis = renderer("AnalysisDialog.tsx");
    for (const field of ["connection", "database", "collection"])
      expect(analysis).toContain(`name={\`analysis-${"${id}"}-${field}\`}`);
    expect(analysis).toContain('name="analysis-source-filter"');
  });
});
