import { describe, expect, it } from "vitest";
import { formatBsonDate } from "../src/renderer/datetime";

describe("BSON datetime formatting", () => {
  it("renders configured named timezones without labelling local time as UTC", () => {
    const value = new Date("2025-01-02T03:04:05Z");
    expect(formatBsonDate(value, { timezone: "UTC", datetimeFormat: "space" })).toBe("2025-01-02 03:04:05");
    expect(formatBsonDate(value, { timezone: "Asia/Taipei", datetimeFormat: "space" })).toBe("2025-01-02 11:04:05");
  });
});
