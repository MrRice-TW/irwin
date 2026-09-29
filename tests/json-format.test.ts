import { describe, expect, it } from "vitest";
import { formatDocument, prettyDocument, shellJsonLanguage } from "../src/renderer/json-format";

describe("JSON document formatting", () => {
  it("uses the configured indentation width", () => {
    expect(
      prettyDocument(
        { profile: { name: "Ada", tags: ["math", "code"] } },
        { indent: 4 },
      ),
    ).toContain("    profile: {");
  });

  it("keeps shell-friendly BSON constructors while formatting numbers", () => {
    expect(
      prettyDocument(
        {
          _id: { $oid: "6a4f6bffbed892721b94b460" },
          number1: { $numberInt: "1" },
          number2: { $numberDouble: "1.2" },
        },
        { indent: 2 },
      ),
    ).toContain(
      'ObjectId("6a4f6bffbed892721b94b460")',
    );
    expect(prettyDocument({ number1: { $numberInt: "1" } }, { indent: 2 })).toContain(
      "number1: 1",
    );
  });
  it("formats editable Extended JSON with the configured indentation", () => {
    expect(formatDocument("{\"name\":\"Ada\",\"n\":{\"$numberInt\":\"1\"}}", 4)).toContain("    \"n\": {");
  });

  it("uses a diagnostic-free Mongo JSON mode for display", () => {
    expect(shellJsonLanguage).toBe("mongo-json");
  });
});