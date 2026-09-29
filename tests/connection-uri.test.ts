import { describe, expect, it } from "vitest";
import { ConnectionString } from "mongodb-connection-string-url";
import { profileSchema } from "../src/shared/contracts";
import { exportMongoUri } from "../src/main/connection-uri";

describe("connection URI export", () => {
  it("applies saved connection settings while preserving unrelated URI options", () => {
    const profile = profileSchema.parse({
      id: "profile-1",
      name: "Atlas",
      uri: "mongodb://legacy:old@db.example.test:27017/old?appName=KeepMe",
      database: "application",
      username: "irwin-user",
      authSource: "authdb",
      authMechanism: "SCRAM-SHA-256",
      tls: true,
      replicaSet: "rs0",
      directConnection: true,
      readPreference: "secondaryPreferred",
      writeConcern: "1",
      timeoutMS: 12000,
    });

    const exported = exportMongoUri(profile, { password: "s3cret" }, true);
    const uri = new ConnectionString(exported.uri);

    expect(uri.username).toBe("irwin-user");
    expect(uri.password).toBe("s3cret");
    expect(uri.pathname).toBe("/application");
    expect(uri.searchParams.get("appName")).toBe("KeepMe");
    expect(uri.searchParams.get("authSource")).toBe("authdb");
    expect(uri.searchParams.get("authMechanism")).toBe("SCRAM-SHA-256");
    expect(uri.searchParams.get("tls")).toBe("true");
    expect(uri.searchParams.get("replicaSet")).toBe("rs0");
    expect(uri.searchParams.get("directConnection")).toBe("true");
    expect(uri.searchParams.get("readPreference")).toBe("secondaryPreferred");
    expect(uri.searchParams.get("w")).toBe("1");
    expect(uri.searchParams.get("serverSelectionTimeoutMS")).toBe("12000");
  });
});
