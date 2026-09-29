import { describe, expect, it } from "vitest";
import { diagnoseConnectionError } from "../src/main/connection-diagnostics";

describe("connection diagnostics", () => {
  it("classifies actionable DNS, TLS and authentication failures", () => {
    expect(diagnoseConnectionError("getaddrinfo ENOTFOUND cluster.example").kind).toBe(
      "network",
    );
    expect(diagnoseConnectionError("unable to verify the first certificate").kind).toBe(
      "tls",
    );
    expect(diagnoseConnectionError("Authentication failed.").kind).toBe(
      "authentication",
    );
  });
});
