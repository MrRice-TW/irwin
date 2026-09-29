import dns from "node:dns";
import { MongoMemoryServer } from "mongodb-memory-server";
import { expect, test, vi } from "vitest";
import { ShellService } from "../src/core/shell";
import {
  profileSchema,
  type ResolvedConnection,
} from "../src/shared/contracts";

test("mongosh connects to an SRV database with the driver's DNS resolver", async () => {
  const server = await MongoMemoryServer.create({
    binary: { version: "8.0.18", downloadDir: ".runtime/mongodb" },
    instance: { dbName: "irwin_shell_srv_test", launchTimeout: 30000 },
  });
  const shell = new ShellService();
  const resolution = vi
    .spyOn(dns.promises, "resolve")
    .mockImplementation(async (_hostname, rrtype) => {
      if (rrtype === "SRV")
        return [
          {
            name: "node.cluster.irwin.test",
            port: server.instanceInfo!.port,
            priority: 0,
            weight: 0,
          },
        ];
      if (rrtype === "TXT") return [["authSource=admin"]];
      throw new Error(`Unexpected DNS request: ${rrtype}`);
    });
  const uri = "mongodb+srv://cluster.irwin.test/?tls=false";
  const resolved: ResolvedConnection = {
    profile: profileSchema.parse({
      id: "shell-srv-test",
      name: "Shell SRV test",
      uri,
    }),
    uri,
    options: {
      serverSelectionTimeoutMS: 5000,
      lookup(
        _hostname: string,
        options: dns.LookupOptions,
        callback: (
          error: NodeJS.ErrnoException | null,
          address: string | dns.LookupAddress[],
          family?: number,
        ) => void,
      ) {
        if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
        else callback(null, "127.0.0.1", 4);
      },
    },
  };
  try {
    await shell.open(resolved, "irwin_shell_srv_test");
    await shell.execute(
      'db.items.insertOne({ name: "SRV 測試", active: true })',
    );
    const result = await shell.execute("db.items.find({ active: true })");
    expect(result.rows).toHaveLength(1);
    expect(JSON.parse(result.rows[0]!.ejson).name).toBe("SRV 測試");
    expect(resolution).toHaveBeenCalledWith(
      "_mongodb._tcp.cluster.irwin.test",
      "SRV",
    );
    expect(resolution).toHaveBeenCalledWith("cluster.irwin.test", "TXT");
  } finally {
    await shell.close();
    resolution.mockRestore();
    await server.stop();
  }
}, 60000);
