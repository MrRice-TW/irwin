import { describe, expect, it } from "vitest";
import { shouldCheckShellDrafts } from "../src/main/window-close-lifecycle";

describe("window close lifecycle", () => {
  it("does not read Shell drafts after application shutdown begins", () => {
    expect(
      shouldCheckShellDrafts({ shuttingDown: true, allowWindowClose: false }),
    ).toBe(false);
  });

  it("checks Shell drafts for a normal user window close", () => {
    expect(
      shouldCheckShellDrafts({ shuttingDown: false, allowWindowClose: false }),
    ).toBe(true);
  });

  it("does not repeat the draft check after the user confirms close", () => {
    expect(
      shouldCheckShellDrafts({ shuttingDown: false, allowWindowClose: true }),
    ).toBe(false);
  });
});
