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
      { path: "new", kind: "added", after: 'Int32("2")' },
      { path: "old", kind: "removed", before: 'Int32("1")' },
    ]);
  });

  it("compares canonical Extended JSON with the friendly editor syntax by BSON type", () => {
    expect(
      documentChanges(
        '{"_id":{"$oid":"507f1f77bcf86cd799439011"},"count":{"$numberInt":"1"}}',
        '{ _id: ObjectId("507f1f77bcf86cd799439011"), count: Int32("1") }',
      ),
    ).toEqual([]);

    expect(
      documentChanges(
        '{"count":{"$numberDouble":"1.0"}}',
        '{ count: Int32("1") }',
      ),
    ).toEqual([
      {
        path: "count",
        kind: "changed",
        before: 'Double("1.0")',
        after: 'Int32("1")',
      },
    ]);
  });
});
