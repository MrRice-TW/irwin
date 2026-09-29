import type { MongoClient } from "mongodb";
import type { Profile } from "../shared/contracts";

export type UserRoleReference = { role: string; database: string };
export type UserSummary = {
  username: string;
  authenticationDatabase: string;
  mechanisms: string[];
  roles: UserRoleReference[];
  inheritedRoles?: UserRoleReference[];
  inheritedPrivileges?: RolePrivilege[];
};
export type RolePrivilege = {
  resource: Record<string, unknown>;
  actions: string[];
};
export type ConnectedIdentity = {
  username: string;
  authenticationDatabase: string;
};
export type RoleSummary = {
  name: string;
  database: string;
  builtin: boolean;
  roles: UserRoleReference[];
  inheritedRoles: UserRoleReference[];
  privileges: RolePrivilege[];
  inheritedPrivileges: RolePrivilege[];
};
export type UsersRolesSnapshot = {
  status: "available" | "partial" | "restricted" | "unsupported";
  databases: string[];
  restrictedDatabases: string[];
  diagnostics: string[];
  currentUsers: ConnectedIdentity[];
  currentRoles: UserRoleReference[];
  currentPrivileges: RolePrivilege[];
  users: UserSummary[];
  roles: RoleSummary[];
};

const roleReference = (value: any): UserRoleReference => ({
  role: String(value?.role || ""),
  database: String(value?.db || ""),
});

const privileges = (values: any): RolePrivilege[] =>
  Array.isArray(values)
    ? values.map((value) => ({
        resource:
          value?.resource && typeof value.resource === "object"
            ? value.resource
            : {},
        actions: Array.isArray(value?.actions) ? value.actions.map(String) : [],
      }))
    : [];

function safeUser(value: any): UserSummary {
  return {
    username: String(value?.user || ""),
    authenticationDatabase: String(value?.db || ""),
    mechanisms: Array.isArray(value?.mechanisms)
      ? value.mechanisms.map(String)
      : [],
    roles: Array.isArray(value?.roles) ? value.roles.map(roleReference) : [],
    ...(Array.isArray(value?.inheritedRoles)
      ? { inheritedRoles: value.inheritedRoles.map(roleReference) }
      : {}),
    ...(Array.isArray(value?.inheritedPrivileges)
      ? { inheritedPrivileges: privileges(value.inheritedPrivileges) }
      : {}),
  };
}

function safeRole(value: any): RoleSummary {
  return {
    name: String(value?.role || ""),
    database: String(value?.db || ""),
    builtin: value?.isBuiltin === true,
    roles: Array.isArray(value?.roles) ? value.roles.map(roleReference) : [],
    inheritedRoles: Array.isArray(value?.inheritedRoles)
      ? value.inheritedRoles.map(roleReference)
      : [],
    privileges: privileges(value?.privileges),
    inheritedPrivileges: privileges(value?.inheritedPrivileges),
  };
}

function isUnsupportedCommand(error: any) {
  return (
    error?.code === 59 ||
    error?.code === 303 ||
    error?.codeName === "CommandNotFound" ||
    error?.codeName === "CommandNotSupported"
  );
}

function isUnauthorized(error: any) {
  return error?.code === 13 || error?.codeName === "Unauthorized";
}

function loopbackConnection(uri: string) {
  const match = uri.match(
    /^mongodb(?:\+srv)?:\/\/(?:[^@/]+@)?(\[[^\]]+\]|[^/:?]+)/i,
  );
  const host = match?.[1]?.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host?.endsWith(".localhost") === true
  );
}

function tlsInUri(uri: string): boolean | undefined {
  const query = uri.split("?", 2)[1] || "";
  const options = new URLSearchParams(query);
  let setting: string | undefined;
  for (const [key, value] of options) {
    if (key.toLowerCase() === "tls" || key.toLowerCase() === "ssl")
      setting = value.toLowerCase();
  }
  if (setting === undefined) return undefined;
  return setting === "true";
}

export function assertSecureUserManagementTransport(profile: Profile) {
  const uriTLS = tlsInUri(profile.uri);
  const loopback = loopbackConnection(profile.uri);
  if (uriTLS === false && !profile.ssh.enabled && !loopback)
    throw new Error(
      "User and role changes require TLS, an SSH tunnel, or a loopback connection to protect credentials and privilege changes in transit.",
    );
  if (
    uriTLS === true ||
    (uriTLS === undefined && profile.tls) ||
    profile.ssh.enabled ||
    (uriTLS === undefined && /^mongodb\+srv:\/\//i.test(profile.uri)) ||
    loopback
  )
    return;
  throw new Error(
    "User and role changes require TLS, an SSH tunnel, or a loopback connection to protect credentials and privilege changes in transit.",
  );
}

export class UsersRolesService {
  async inspect(
    client: MongoClient,
    profile: Profile,
  ): Promise<UsersRolesSnapshot> {
    const connection = await client
      .db("admin")
      .command({ connectionStatus: 1, showPrivileges: true });
    const authInfo = connection?.authInfo || {};
    const currentUsers = Array.isArray(authInfo.authenticatedUsers)
      ? authInfo.authenticatedUsers.map((user: any) => ({
          username: String(user?.user || ""),
          authenticationDatabase: String(user?.db || ""),
        }))
      : [];
    const currentRoles = Array.isArray(authInfo.authenticatedUserRoles)
      ? authInfo.authenticatedUserRoles.map(roleReference)
      : [];
    const currentPrivileges = privileges(authInfo.authenticatedUserPrivileges);
    const restrictedDatabases = new Set<string>();
    const diagnostics: string[] = [];
    let databases: string[];
    try {
      const result = await client
        .db("admin")
        .admin()
        .listDatabases({ nameOnly: true, authorizedDatabases: true });
      databases = result.databases
        .map((database) => database.name)
        .filter((database) => database !== "local");
    } catch {
      databases = [profile.authSource, profile.database, "admin"];
      restrictedDatabases.add("database list");
      diagnostics.push(
        "Database names are restricted. Showing databases from this connection profile only.",
      );
    }

    const users: UserSummary[] = [];
    const roles: RoleSummary[] = [];
    let userListAvailable = false;
    try {
      const result = await client.db("admin").command({
        usersInfo: { forAllDBs: true },
        showCustomData: false,
      });
      userListAvailable = true;
      users.push(...(result.users || []).map(safeUser));
    } catch (error: any) {
      if (isUnsupportedCommand(error))
        return {
          status: "unsupported",
          databases,
          restrictedDatabases: [],
          diagnostics: [
            "This deployment does not support self-managed MongoDB user commands. Atlas and Cosmos account management use separate administration APIs.",
          ],
          currentUsers,
          currentRoles,
          currentPrivileges,
          users: [],
          roles: [],
        };
      diagnostics.push(
        isUnauthorized(error)
          ? "The connected account cannot list users across databases. Grant viewUser access for each authentication database."
          : "Users could not be loaded across databases.",
      );
      restrictedDatabases.add("users across databases");
    }

    const roleDatabases = new Set([
      ...databases,
      profile.authSource,
      profile.database,
      ...users.map((user) => user.authenticationDatabase),
      ...users.flatMap((user) => user.roles.map((role) => role.database)),
    ]);
    roleDatabases.delete("local");
    databases = [...roleDatabases].filter(Boolean).sort();
    for (const database of databases) {
      try {
        const result = await client.db(database).command({
          rolesInfo: 1,
          showBuiltinRoles: true,
          showPrivileges: true,
        });
        roles.push(...(result.roles || []).map(safeRole));
      } catch (error: any) {
        restrictedDatabases.add(database);
        diagnostics.push(
          isUnauthorized(error)
            ? `The connected account cannot inspect roles in ${database}. Grant viewRole access to inspect them.`
            : `Roles in ${database} could not be loaded.`,
        );
      }
    }

    users.sort((a, b) =>
      `${a.authenticationDatabase}.${a.username}`.localeCompare(
        `${b.authenticationDatabase}.${b.username}`,
      ),
    );
    roles.sort((a, b) =>
      `${a.database}.${a.name}`.localeCompare(`${b.database}.${b.name}`),
    );
    const restricted = restrictedDatabases.size > 0;
    return {
      status: !userListAvailable
        ? "restricted"
        : restricted
          ? "partial"
          : "available",
      databases,
      restrictedDatabases: [...restrictedDatabases],
      diagnostics,
      currentUsers,
      currentRoles,
      currentPrivileges,
      users,
      roles,
    };
  }

  async userDetails(
    client: MongoClient,
    authDatabase: string,
    username: string,
  ) {
    const result = await client.db(authDatabase).command({
      usersInfo: { user: username, db: authDatabase },
      showPrivileges: true,
      showCustomData: false,
    });
    const user = result.users?.[0];
    if (!user)
      throw new Error("User was not found in that authentication database.");
    return safeUser(user);
  }

  createUser(
    client: MongoClient,
    input: {
      authDatabase: string;
      username: string;
      password: string;
      roles: UserRoleReference[];
    },
  ) {
    if (input.authDatabase === "local")
      throw new Error("MongoDB users cannot be created in the local database.");
    return client.db(input.authDatabase).command({
      createUser: input.username,
      pwd: input.password,
      roles: input.roles.map((role) => ({
        role: role.role,
        db: role.database,
      })),
      writeConcern: { w: "majority" },
    });
  }

  setPassword(
    client: MongoClient,
    input: { authDatabase: string; username: string; password: string },
  ) {
    return client.db(input.authDatabase).command({
      updateUser: input.username,
      pwd: input.password,
      writeConcern: { w: "majority" },
    });
  }

  grantRole(
    client: MongoClient,
    input: {
      authDatabase: string;
      username: string;
      role: string;
      database: string;
    },
  ) {
    return client.db(input.authDatabase).command({
      grantRolesToUser: input.username,
      roles: [{ role: input.role, db: input.database }],
      writeConcern: { w: "majority" },
    });
  }

  revokeRole(
    client: MongoClient,
    input: {
      authDatabase: string;
      username: string;
      role: string;
      database: string;
    },
  ) {
    return client.db(input.authDatabase).command({
      revokeRolesFromUser: input.username,
      roles: [{ role: input.role, db: input.database }],
      writeConcern: { w: "majority" },
    });
  }

  async dropUser(
    client: MongoClient,
    profile: Profile,
    input: { authDatabase: string; username: string; confirmation: string },
  ) {
    if (input.authDatabase === "local")
      throw new Error(
        "MongoDB users cannot be removed from the local database.",
      );
    if (input.confirmation !== `${input.authDatabase}.${input.username}`)
      throw new Error(
        "Confirmation must match authenticationDatabase.username.",
      );
    const identity = await client.db("admin").command({ connectionStatus: 1 });
    const currentUsers = Array.isArray(identity?.authInfo?.authenticatedUsers)
      ? identity.authInfo.authenticatedUsers
      : [];
    const sessionUsers = currentUsers.length
      ? currentUsers
      : profile.username
        ? [{ user: profile.username, db: profile.authSource }]
        : [];
    if (
      sessionUsers.some(
        (current: any) =>
          current.user === input.username && current.db === input.authDatabase,
      )
    )
      throw new Error("You cannot remove the account used by this connection.");
    return client.db(input.authDatabase).command({
      dropUser: input.username,
      writeConcern: { w: "majority" },
    });
  }
}
