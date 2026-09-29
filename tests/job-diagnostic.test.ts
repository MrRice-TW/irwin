import { describe, expect, it } from "vitest";
import { jobDiagnosticText } from "../src/renderer/job-diagnostic";

describe("job diagnostics", () => {
  it("copies useful transfer details without exposing URI credentials", () => {
    const text = jobDiagnosticText({
      jobId: "job-1",
      status: "failed",
      processed: 10,
      failed: 1,
      bytes: 200,
      message: "mongodb://admin:s3cret@db.example.test failed",
      path: "C:/exports/items.jsonl",
    });
    expect(text).toContain('"status": "failed"');
    expect(text).toContain("[credentials]");
    expect(text).not.toContain("s3cret");
  });
});
