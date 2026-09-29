import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { MongoClient } from "mongodb";
import { DatabaseService } from "../src/core/database";
import { commands, profileSchema } from "../src/shared/contracts";

let server: MongoMemoryServer;
const database = new DatabaseService();
const connectionId = "users-roles-test";

test("delete-user contract binds confirmation to the exact authentication database and username", () => {
  const parse = (commands as Record<string, { parse(value: unknown): any }>)[
    "usersRoles.dropUser"
  ].parse;
  expect(
    parse({
      connectionId,
      authDatabase: "admin",
      username: "report-reader",
      confirmation: "admin.report-reader",
    }),
  ).toMatchObject({ confirmation: "admin.report-reader" });
  expect(() =>
    parse({
      connectionId,
      authDatabase: "admin",
      username: "report-reader",
      confirmation: "report-reader",
    }),
  ).toThrow();
});

beforeAll(async () => {
  server = await MongoMemoryServer.create({
    binary: { version: "8.0.18", downloadDir: ".runtime/mongodb" },
  });
  const profile = profileSchema.parse({
    id: connectionId,
    name: "User and role test",
    uri: server.getUri(),
    database: "admin",
    authSource: "admin",
    readOnly: false,
  });
  await database.connect({ profile, uri: server.getUri(), options: {} });
}, 120000);

afterAll(async () => {
  await database.closeAll();
  await server?.stop();
});

test("inspection returns self-managed MongoDB users and effective built-in roles without credentials", async () => {
  const snapshot = await database.execute("usersRoles.inspect", {
    connectionId,
  });

  expect(snapshot.databases).toContain("admin");
  expect(snapshot.currentUsers).toEqual([]);
  expect(snapshot.roles).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "read",
        database: "admin",
        builtin: true,
        privileges: expect.any(Array),
      }),
    ]),
  );
  expect(snapshot.users).toEqual([]);
  expect(JSON.stringify(snapshot)).not.toContain('"credentials"');
});

test("user creation, role grant/revoke, and password reset preserve only the requested account fields", async () => {
  await database.execute("usersRoles.createUser", {
    connectionId,
    authDatabase: "accounts",
    username: "qa-reader",
    password: "a-long-test-password",
    roles: [{ role: "read", database: "admin" }],
  });

  const listed = await database.execute("usersRoles.inspect", { connectionId });
  expect(listed.users).toContainEqual({
    username: "qa-reader",
    authenticationDatabase: "accounts",
    mechanisms: expect.any(Array),
    roles: [{ role: "read", database: "admin" }],
  });
  expect(JSON.stringify(listed)).not.toContain('"credentials"');

  const detailed = await database.execute("usersRoles.userDetails", {
    connectionId,
    authDatabase: "accounts",
    username: "qa-reader",
  });
  expect(detailed.inheritedPrivileges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        resource: expect.any(Object),
        actions: expect.arrayContaining(["find"]),
      }),
    ]),
  );

  await database.execute("usersRoles.grantRole", {
    connectionId,
    authDatabase: "accounts",
    username: "qa-reader",
    role: "readWrite",
    database: "admin",
  });
  let refreshed = await database.execute("usersRoles.userDetails", {
    connectionId,
    authDatabase: "accounts",
    username: "qa-reader",
  });
  expect(refreshed.roles).toEqual(
    expect.arrayContaining([
      { role: "read", database: "admin" },
      { role: "readWrite", database: "admin" },
    ]),
  );

  await database.execute("usersRoles.revokeRole", {
    connectionId,
    authDatabase: "accounts",
    username: "qa-reader",
    role: "read",
    database: "admin",
  });
  await database.execute("usersRoles.setPassword", {
    connectionId,
    authDatabase: "accounts",
    username: "qa-reader",
    password: "a-different-test-password",
  });
  refreshed = await database.execute("usersRoles.userDetails", {
    connectionId,
    authDatabase: "accounts",
    username: "qa-reader",
  });
  expect(refreshed.roles).toEqual([{ role: "readWrite", database: "admin" }]);
  expect(JSON.stringify(refreshed)).not.toContain('"credentials"');
});

test("management mutations refuse remote plaintext transport before issuing a command", async () => {
  const remote = new DatabaseService();
  const profile = profileSchema.parse({
    id: "remote-users-roles",
    name: "Remote non-TLS MongoDB",
    uri: "mongodb://db.example.invalid:27017",
    readOnly: false,
  });
  const command = vi.fn();
  remote.connections.set(profile.id, {
    client: { db: () => ({ command }) } as unknown as MongoClient,
    profile,
    version: "8.0",
  });

  await expect(
    remote.execute("usersRoles.grantRole", {
      connectionId: profile.id,
      authDatabase: "admin",
      username: "report-reader",
      role: "read",
      database: "reports",
    }),
  ).rejects.toThrow(/require TLS/i);
  expect(command).not.toHaveBeenCalled();
});

test("read-only profiles and Cosmos providers are blocked before issuing account commands", async () => {
  const readonly = new DatabaseService();
  const readonlyProfile = profileSchema.parse({
    id: "readonly-users-roles",
    name: "Read-only MongoDB",
    uri: "mongodb://127.0.0.1:27017",
    readOnly: true,
  });
  const readonlyCommand = vi.fn();
  readonly.connections.set(readonlyProfile.id, {
    client: {
      db: () => ({ command: readonlyCommand }),
    } as unknown as MongoClient,
    profile: readonlyProfile,
    version: "8.0",
  });
  await expect(
    readonly.execute("usersRoles.createUser", {
      connectionId: readonlyProfile.id,
      authDatabase: "admin",
      username: "blocked",
      password: "a-long-test-password",
      roles: [{ role: "read", database: "admin" }],
    }),
  ).rejects.toThrow(/read-only/i);
  expect(readonlyCommand).not.toHaveBeenCalled();

  const cosmos = new DatabaseService();
  const cosmosProfile = profileSchema.parse({
    id: "cosmos-users-roles",
    name: "Cosmos Mongo API",
    provider: "cosmos",
    uri: "mongodb://cosmos.example.invalid:10255",
    readOnly: false,
  });
  const cosmosCommand = vi.fn();
  cosmos.connections.set(cosmosProfile.id, {
    client: {
      db: () => ({ command: cosmosCommand }),
    } as unknown as MongoClient,
    profile: cosmosProfile,
    version: "7.0",
  });
  await expect(
    cosmos.execute("usersRoles.dropUser", {
      connectionId: cosmosProfile.id,
      authDatabase: "admin",
      username: "blocked",
      confirmation: "admin.blocked",
    }),
  ).rejects.toThrow(/only for self-managed MongoDB/i);
  expect(cosmosCommand).not.toHaveBeenCalled();
});

test("explicit TLS disablement overrides SRV defaults for management writes", async () => {
  const remote = new DatabaseService();
  const profile = profileSchema.parse({
    id: "plaintext-srv-users-roles",
    name: "SRV without TLS",
    uri: "mongodb+srv://db.example.invalid/?tls=false",
    readOnly: false,
  });
  const command = vi.fn();
  remote.connections.set(profile.id, {
    client: { db: () => ({ command }) } as unknown as MongoClient,
    profile,
    version: "8.0",
  });
  await expect(
    remote.execute("usersRoles.setPassword", {
      connectionId: profile.id,
      authDatabase: "admin",
      username: "report-reader",
      password: "a-new-test-password",
    }),
  ).rejects.toThrow(/require TLS/i);
  expect(command).not.toHaveBeenCalled();
});

test("the connected account cannot delete itself, and exact confirmation is checked in the database service", async () => {
  const connected = database.connections.get(connectionId)!;
  const previousUsername = connected.profile.username;
  const previousAuthSource = connected.profile.authSource;
  connected.profile.username = "qa-reader";
  connected.profile.authSource = "accounts";
  try {
    await expect(
      database.execute("usersRoles.dropUser", {
        connectionId,
        authDatabase: "accounts",
        username: "qa-reader",
        confirmation: "accounts.qa-reader",
      }),
    ).rejects.toThrow(/cannot remove the account used by this connection/i);
    await expect(
      database.execute("usersRoles.dropUser", {
        connectionId,
        authDatabase: "accounts",
        username: "qa-reader",
        confirmation: "qa-reader",
      }),
    ).rejects.toThrow(/confirmation must match/i);
  } finally {
    connected.profile.username = previousUsername;
    connected.profile.authSource = previousAuthSource;
  }

  await database.execute("usersRoles.createUser", {
    connectionId,
    authDatabase: "accounts",
    username: "qa-temporary",
    password: "another-test-password",
    roles: [{ role: "read", database: "admin" }],
  });
  await database.execute("usersRoles.dropUser", {
    connectionId,
    authDatabase: "accounts",
    username: "qa-temporary",
    confirmation: "accounts.qa-temporary",
  });
  const snapshot = await database.execute("usersRoles.inspect", {
    connectionId,
  });
  expect(
    snapshot.users.some((user: any) => user.username === "qa-temporary"),
  ).toBe(false);
});
