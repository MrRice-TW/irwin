import { describe, expect, it } from "vitest";
import { documentChanges } from "../src/renderer/document-diff";

describe("document changes", () => {
  it("reports added, removed and nested changed values for an edited document", () => {
    expect(
      documentChanges(
        '{"name":"Ada","meta":{"active":true},"old":1}',
        '{"name":"Grace","meta":{"active":false},"new":2}',
      ),
    ).toEqual([
      { path: "meta.active", kind: "changed", before: "true", after: "false" },
      { path: "name", kind: "changed", before: '"Ada"', after: '"Grace"' },
      { path: "new", kind: "added", after: "2" },
      { path: "old", kind: "removed", before: "1" },
    ]);
  });
});
