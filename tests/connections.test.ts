import { beforeAll, afterAll, test, expect } from "vitest";
import { MongoMemoryServer, MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { Server, utils } from "ssh2";
import { generateKeyPairSync, createHash } from "node:crypto";
import { connect as connectSocket } from "node:net";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { resolveConnection, type Route } from "../src/main/connection";
import { DatabaseService } from "../src/core/database";
import { profileSchema, type Profile } from "../src/shared/contracts";

const binary = { version: "8.0.18", downloadDir: ".runtime/mongodb" };
let mongo: MongoMemoryServer, tlsMongo: MongoMemoryServer, ssh: Server;
let sshPort: number, fingerprint: string;
const database = new DatabaseService();
const routes: Route[] = [];
const userKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: {
    type: "pkcs1",
    format: "pem",
    cipher: "aes-256-cbc",
    passphrase: "fixture-passphrase",
  },
  publicKeyEncoding: { type: "pkcs1", format: "pem" },
});
const privateKeyFile = resolve(".runtime/ssh-user-test.pem");
beforeAll(async () => {
  mongo = await MongoMemoryServer.create({
    binary,
    instance: { launchTimeout: 30000 },
    auth: {
      enable: true,
      customRootName: "fixture-user",
      customRootPwd: "fixture-password",
    },
  });
  tlsMongo = await MongoMemoryServer.create({
    binary,
    instance: {
      launchTimeout: 30000,
      args: [
        "--tlsMode",
        "requireTLS",
        "--tlsCertificateKeyFile",
        resolve("tests/fixtures/test-server.pem"),
        "--tlsCAFile",
        resolve("tests/fixtures/test-ca.pem"),
        "--tlsAllowConnectionsWithoutCertificates",
      ],
    },
  });
  const host = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  fingerprint = createHash("sha256")
    .update((utils.parseKey(host.privateKey) as any).getPublicSSH())
    .digest("hex");
  const parsed = utils.parseKey(
    userKey.privateKey,
    "fixture-passphrase",
  ) as any;
  await writeFile(privateKeyFile, userKey.privateKey);
  ssh = new Server({ hostKeys: [host.privateKey] }, (client) => {
    client.on("error", () => {});
    client
      .on("authentication", (ctx) => {
        if (ctx.username !== "fixture-user") return ctx.reject();
        if (
          ctx.method === "password" &&
          ctx.password === "ssh-fixture-password"
        )
          return ctx.accept();
        if (
          ctx.method === "publickey" &&
          ctx.key.data.equals(parsed.getPublicSSH())
        ) {
          if (
            !ctx.signature ||
            parsed.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) === true
          )
            return ctx.accept();
        }
        ctx.reject();
      })
      .on("ready", () =>
        client.on("tcpip", (accept, reject, info) => {
          const socket = connectSocket(info.destPort, info.destIP, () => {
            const stream = accept();
            stream.on("error", () => socket.destroy());
            socket.on("error", () => stream.destroy());
            socket.pipe(stream).pipe(socket);
          });
          socket.on("error", () => reject());
        }),
      );
  });
  await new Promise<void>((r) => ssh.listen(0, "127.0.0.1", r));
  sshPort = (ssh.address() as any).port;
}, 120000);
afterAll(async () => {
  await database.closeAll();
  routes.forEach((r) => r.close());
  if (ssh) await new Promise<void>((r) => ssh.close(() => r()));
  await mongo?.stop();
  await tlsMongo?.stop();
});
const base = (overrides: Partial<Profile> = {}) =>
  profileSchema.parse({
    id: crypto.randomUUID(),
    name: "fixture",
    uri: mongo.getUri(),
    username: "fixture-user",
    authSource: "admin",
    timeoutMS: 2000,
    ...overrides,
  });
async function open(profile: Profile, secrets: any) {
  const route = await resolveConnection(profile, secrets);
  routes.push(route);
  return database.connect(route.resolved);
}
test("SCRAM authentication accepts valid credentials and rejects wrong password", async () => {
  expect(
    (
      await open(base({ authMechanism: "SCRAM-SHA-256" }), {
        password: "fixture-password",
      })
    ).connected,
  ).toBe(true);
  await expect(open(base(), { password: "wrong-password" })).rejects.toThrow(
    /Authentication failed/i,
  );
});
test("TLS CA and hostname verification reject untrusted or mismatched certificates", async () => {
  const uri = tlsMongo.getUri().replace("127.0.0.1", "localhost");
  expect(
    (
      await open(
        base({
          uri,
          username: "",
          tls: true,
          caFile: resolve("tests/fixtures/test-ca.pem"),
        }),
        {},
      )
    ).connected,
  ).toBe(true);
  await expect(
    open(base({ uri, username: "", tls: true }), {}),
  ).rejects.toThrow();
  await expect(
    open(
      base({
        uri: tlsMongo.getUri(),
        username: "",
        tls: true,
        caFile: resolve("tests/fixtures/test-ca.pem"),
      }),
      {},
    ),
  ).rejects.toThrow(/altname|Hostname|IP/i);
});
test("SSH password, encrypted private key and host fingerprint verification", async () => {
  const config = {
    enabled: true,
    host: "127.0.0.1",
    port: sshPort,
    username: "fixture-user",
    privateKeyFile: "",
    hostFingerprint: fingerprint,
  };
  expect(
    (
      await open(base({ ssh: config }), {
        password: "fixture-password",
        sshPassword: "ssh-fixture-password",
      })
    ).connected,
  ).toBe(true);
  expect(
    (
      await open(base({ ssh: { ...config, privateKeyFile } }), {
        password: "fixture-password",
        sshPassphrase: "fixture-passphrase",
      })
    ).connected,
  ).toBe(true);
  await expect(
    open(base({ ssh: { ...config, hostFingerprint: "" } }), {
      sshPassword: "ssh-fixture-password",
    }),
  ).rejects.toThrow("SHA256 hex");
});
test("SSH with TLS preserves the original MongoDB hostname", async () => {
  const config = {
    enabled: true,
    host: "127.0.0.1",
    port: sshPort,
    username: "fixture-user",
    privateKeyFile: "",
    hostFingerprint: fingerprint,
  };
  expect(
    (
      await open(
        base({
          uri: tlsMongo.getUri().replace("127.0.0.1", "localhost"),
          username: "",
          tls: true,
          caFile: resolve("tests/fixtures/test-ca.pem"),
          ssh: config,
        }),
        { sshPassword: "ssh-fixture-password" },
      )
    ).connected,
  ).toBe(true);
});
test("replica-set discovery and reconnect", async () => {
  const repl = await MongoMemoryReplSet.create({
    binary,
    replSet: { count: 1 },
  });
  try {
    const profile = base({ uri: repl.getUri(), username: "" });
    await open(profile, {});
    await database.close(profile.id);
    expect((await open(profile, {})).connected).toBe(true);
  } finally {
    await database.closeAll();
    await repl.stop();
  }
}, 60000);
