import { describe, expect, it } from "vitest";
import { jobNotificationKind } from "../src/shared/job-notifications";

const job = {
  jobId: "job-1",
  status: "completed" as const,
  processed: 20,
  failed: 0,
  bytes: 128,
  message: "Finished",
};

describe("background job notifications", () => {
  it("notifies failures and partial failures with the default setting", () => {
    expect(jobNotificationKind("failures", { ...job, status: "failed" })).toBe(
      "failed",
    );
    expect(jobNotificationKind("failures", { ...job, failed: 2 })).toBe(
      "failed",
    );
    expect(jobNotificationKind("failures", job)).toBeUndefined();
  });

  it("supports all final results while ignoring cancellations and progress", () => {
    expect(jobNotificationKind("all", job)).toBe("completed");
    expect(
      jobNotificationKind("all", { ...job, status: "cancelled" }),
    ).toBeUndefined();
    expect(
      jobNotificationKind("all", { ...job, status: "running" }),
    ).toBeUndefined();
    expect(
      jobNotificationKind("off", { ...job, status: "failed" }),
    ).toBeUndefined();
  });
});
