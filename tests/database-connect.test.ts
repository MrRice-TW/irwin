import { describe, expect, it, vi } from "vitest";

vi.mock("mongodb", () => {
  class FakeMongoClient {
    constructor(..._args: any[]) {}
    async connect() {}
    async close() {}
    db() {
      const command = async (request: { ping?: number; buildInfo?: number }) => {
        if (request.buildInfo) await new Promise((resolve) => setTimeout(resolve, 200));
        return request.buildInfo ? { version: "8.0.18" } : { ok: 1 };
      };
      return { command, admin: () => ({ command }) };
    }
  }
  return { MongoClient: FakeMongoClient };
});

import { DatabaseService } from "../src/core/database";
import { profileSchema } from "../src/shared/contracts";

describe("DatabaseService first connection", () => {
  it("reports connected without waiting for slow buildInfo", async () => {
    const service = new DatabaseService();
    const profile = profileSchema.parse({
      id: "slow-build-info",
      name: "Slow buildInfo",
      uri: "mongodb://127.0.0.1:27017",
      database: "admin",
    });
    const resolved = { profile, uri: profile.uri, options: {} };
    const result = await Promise.race([
      service.connect(resolved),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 80)),
    ]);

    expect(result).not.toBe("timeout");
    await service.closeAll();
  });
});
