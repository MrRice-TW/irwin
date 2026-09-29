import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  Shield,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { Profile } from "../shared/contracts";
import type {
  RolePrivilege,
  UserRoleReference,
  UserSummary,
  UsersRolesSnapshot,
} from "../core/users-roles";
import { Field, Modal, api, message, useUi } from "./ui";

type Mode =
  | { kind: "create" }
  | { kind: "password" }
  | { kind: "grant" }
  | { kind: "revoke"; role: UserRoleReference }
  | { kind: "delete" };

const roleKey = (role: UserRoleReference) =>
  `${role.role}\u0000${role.database}`;
const userKey = (user: UserSummary) =>
  `${user.authenticationDatabase}\u0000${user.username}`;
const broadRoles = new Set([
  "root",
  "clusterManager",
  "hostManager",
  "userAdmin",
  "userAdminAnyDatabase",
  "dbOwner",
  "dbAdmin",
  "readWriteAnyDatabase",
  "readAnyDatabase",
  "dbAdminAnyDatabase",
  "clusterAdmin",
  "backup",
  "restore",
  "directShardOperations",
]);

function privilegeResource(resource: Record<string, unknown>) {
  if (resource.cluster === true) return "cluster";
  if (resource.anyResource === true) return "all resources";
  const database = String(resource.db || "");
  const collection = String(resource.collection || "");
  return [database, collection].filter(Boolean).join(".") || "all resources";
}

function PrivilegeList({
  items,
  empty,
}: {
  items: RolePrivilege[];
  empty: string;
}) {
  if (!items.length) return <p className="muted ur-empty-hint">{empty}</p>;
  return (
    <ul className="ur-privileges">
      {items.map((item, index) => (
        <li key={`${privilegeResource(item.resource)}-${index}`}>
          <code>{privilegeResource(item.resource)}</code>
          <span>{item.actions.join(", ") || "—"}</span>
        </li>
      ))}
    </ul>
  );
}

function RoleLabel({ role }: { role: UserRoleReference }) {
  return (
    <span className="ur-role-label">
      <code>{role.role}</code>
      <small>@ {role.database}</small>
    </span>
  );
}

export default function UsersRolesDialog({
  profile,
  close,
}: {
  profile: Profile;
  close(): void;
}) {
  const { t } = useUi();
  const [snapshot, setSnapshot] = useState<UsersRolesSnapshot>();
  const [section, setSection] = useState<"users" | "roles">("users");
  const [selectedUserKey, setSelectedUserKey] = useState("");
  const [selectedRoleKey, setSelectedRoleKey] = useState("");
  const [userDetailsEntry, setUserDetailsEntry] = useState<{
    key: string;
    user: UserSummary;
  }>();
  const [detailsError, setDetailsError] = useState("");
  const [mode, setMode] = useState<Mode>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState("");
  const [createUsername, setCreateUsername] = useState("");
  const [createDatabase, setCreateDatabase] = useState(
    profile.authSource || "admin",
  );
  const [createPassword, setCreatePassword] = useState("");
  const [createPasswordConfirm, setCreatePasswordConfirm] = useState("");
  const [createRoles, setCreateRoles] = useState<UserRoleReference[]>([
    { role: "", database: "" },
  ]);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [grantRole, setGrantRole] = useState<UserRoleReference>();
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const current = snapshot?.currentUsers || [];
  const selectedUser = snapshot?.users.find(
    (user) => userKey(user) === selectedUserKey,
  );
  const selectedRole = snapshot?.roles.find(
    (role) =>
      roleKey({ role: role.name, database: role.database }) === selectedRoleKey,
  );
  const detailsKey = `${profile.id}\u0000${revision}\u0000${selectedUserKey}`;
  const userDetails =
    userDetailsEntry?.key === detailsKey ? userDetailsEntry.user : undefined;
  const filteredUsers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (snapshot?.users || []).filter((user) =>
      `${user.username} ${user.authenticationDatabase} ${user.roles
        .map((role) => `${role.role} ${role.database}`)
        .join(" ")}`
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [snapshot?.users, search]);
  const availableRoles = snapshot?.roles || [];
  const inspectionReady = snapshot?.status === "available";
  const writable = inspectionReady && !profile.readOnly && !busy && !loading;
  const selectedIsCurrent =
    !!selectedUser &&
    (current.some(
      (identity) =>
        identity.username === selectedUser.username &&
        identity.authenticationDatabase === selectedUser.authenticationDatabase,
    ) ||
      (!current.length &&
        profile.username === selectedUser.username &&
        profile.authSource === selectedUser.authenticationDatabase));
  const selectedDirectRoles = userDetails?.roles || selectedUser?.roles || [];

  const clearSecrets = () => {
    setCreatePassword("");
    setCreatePasswordConfirm("");
    setNewPassword("");
    setNewPasswordConfirm("");
  };
  const resetCreate = () => {
    setCreateUsername("");
    setCreateDatabase(profile.authSource || "admin");
    setCreateRoles([{ role: "", database: "" }]);
    clearSecrets();
  };
  const refresh = useCallback(async () => {
    if (profile.provider !== "mongodb") {
      setSnapshot(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result: UsersRolesSnapshot = await api.request(
        "usersRoles.inspect",
        { connectionId: profile.id },
      );
      setSnapshot(result);
      setSelectedUserKey((old) =>
        result.users.some((user) => userKey(user) === old)
          ? old
          : result.users[0]
            ? userKey(result.users[0])
            : "",
      );
      setSelectedRoleKey((old) =>
        result.roles.some(
          (role) =>
            roleKey({ role: role.name, database: role.database }) === old,
        )
          ? old
          : result.roles[0]
            ? roleKey({
                role: result.roles[0].name,
                database: result.roles[0].database,
              })
            : "",
      );
    } catch (cause) {
      setError(message(cause));
      setSnapshot(undefined);
    } finally {
      setLoading(false);
    }
  }, [profile.id, profile.provider]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedUser) {
      setUserDetailsEntry(undefined);
      setDetailsError("");
      return;
    }
    let active = true;
    setUserDetailsEntry(undefined);
    setDetailsError("");
    void api
      .request("usersRoles.userDetails", {
        connectionId: profile.id,
        authDatabase: selectedUser.authenticationDatabase,
        username: selectedUser.username,
      })
      .then((details: UserSummary) => {
        if (active) setUserDetailsEntry({ key: detailsKey, user: details });
      })
      .catch((cause) => {
        if (active) setDetailsError(message(cause));
      });
    return () => {
      active = false;
    };
  }, [profile.id, selectedUserKey, revision, snapshot?.users, detailsKey]);

  const afterMutation = async (successText: string) => {
    setMode(undefined);
    setNotice(successText);
    clearSecrets();
    setDeleteConfirmation("");
    setGrantRole(undefined);
    setRevision((old) => old + 1);
    await refresh();
  };
  const runMutation = async (
    command:
      | "usersRoles.createUser"
      | "usersRoles.setPassword"
      | "usersRoles.grantRole"
      | "usersRoles.revokeRole"
      | "usersRoles.dropUser",
    payload: Record<string, unknown>,
    successText: string,
  ): Promise<boolean> => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.request(command, {
        connectionId: profile.id,
        ...payload,
      } as any);
      await afterMutation(successText);
      return true;
    } catch (cause) {
      clearSecrets();
      setError(message(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const setCreateRole = (index: number, key: string) => {
    const selected = availableRoles.find(
      (role) => roleKey({ role: role.name, database: role.database }) === key,
    );
    setCreateRoles((old) =>
      old.map((role, currentIndex) =>
        currentIndex === index
          ? selected
            ? { role: selected.name, database: selected.database }
            : { role: "", database: "" }
          : role,
      ),
    );
  };
  const createRolesValid =
    createRoles.length > 0 &&
    createRoles.every((role) => role.role && role.database) &&
    new Set(createRoles.map(roleKey)).size === createRoles.length;
  const createPasswordValid =
    createPassword.length >= 8 && createPassword === createPasswordConfirm;
  const grantableRoles = availableRoles.filter(
    (role) =>
      !selectedDirectRoles.some(
        (assigned) =>
          assigned.role === role.name && assigned.database === role.database,
      ),
  );
  const mutationDisabled = !writable || !!detailsError || !userDetails;

  const submitCreate = () => {
    if (!writable || !createRolesValid || !createPasswordValid) return;
    void runMutation(
      "usersRoles.createUser",
      {
        authDatabase: createDatabase.trim(),
        username: createUsername.trim(),
        password: createPassword,
        roles: createRoles,
      },
      t("使用者已建立", "User created"),
    ).then((created) => {
      if (created) resetCreate();
    });
  };
  const submitPassword = () => {
    if (
      !selectedUser ||
      mutationDisabled ||
      !newPassword ||
      newPassword !== newPasswordConfirm
    )
      return;
    void runMutation(
      "usersRoles.setPassword",
      {
        authDatabase: selectedUser.authenticationDatabase,
        username: selectedUser.username,
        password: newPassword,
      },
      t("密碼已重設", "Password reset"),
    );
  };
  const submitGrant = () => {
    if (!selectedUser || mutationDisabled || !grantRole) return;
    void runMutation(
      "usersRoles.grantRole",
      {
        authDatabase: selectedUser.authenticationDatabase,
        username: selectedUser.username,
        role: grantRole.role,
        database: grantRole.database,
      },
      t("角色已授予", "Role granted"),
    );
  };
  const submitRevoke = (role: UserRoleReference) => {
    if (!selectedUser || mutationDisabled) return;
    void runMutation(
      "usersRoles.revokeRole",
      {
        authDatabase: selectedUser.authenticationDatabase,
        username: selectedUser.username,
        role: role.role,
        database: role.database,
      },
      t("角色已撤銷", "Role revoked"),
    );
  };
  const submitDrop = () => {
    if (!selectedUser || mutationDisabled) return;
    void runMutation(
      "usersRoles.dropUser",
      {
        authDatabase: selectedUser.authenticationDatabase,
        username: selectedUser.username,
        confirmation: deleteConfirmation,
      },
      t("使用者已刪除", "User deleted"),
    );
  };

  const closeDialog = () => {
    clearSecrets();
    close();
  };
  const title = t("使用者與角色", "Users & roles");

  return (
    <Modal
      wide
      resizable
      className="users-roles-modal"
      title={`${title} · ${profile.name}`}
      close={closeDialog}
      footer={
        <>
          <span className="muted ur-footer-note">
            {t(
              "僅顯示目前連線帳號可檢視的範圍。",
              "Only the scope visible to this connection is shown.",
            )}
          </span>
          <button onClick={closeDialog}>{t("關閉", "Close")}</button>
        </>
      }
    >
      <div className="users-roles-dialog">
        <header className="ur-context">
          <div className="ur-context-icon">
            <ShieldCheck size={18} />
          </div>
          <div className="ur-context-copy">
            <strong>{profile.name}</strong>
            <span>
              {t("環境", "Environment")}: {profile.environment} ·{" "}
              {
                profile.uri
                  .replace(/^mongodb(?:\+srv)?:\/\//i, "")
                  .split(/[/?]/)[0]
              }
            </span>
          </div>
          <span
            className={`ur-mode-badge ${profile.readOnly ? "readonly" : ""}`}
          >
            {profile.readOnly
              ? t("唯讀檢視", "Read-only inspection")
              : t("伺服器權限仍會限制操作", "Server privileges still apply")}
          </span>
          <button
            className="icon"
            aria-label={t("重新載入使用者與角色", "Reload users and roles")}
            title={t("重新載入", "Reload")}
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            {loading ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <RefreshCw size={16} />
            )}
          </button>
        </header>

        <div className="ur-safety-note" role="note">
          <Shield size={15} />
          <span>
            {t(
              "本頁使用 MongoDB 自架部署的帳號命令。Atlas 與 Cosmos DB 需要各自的管理端授權；此頁不會儲存新密碼或顯示密碼雜湊。",
              "This page uses self-managed MongoDB account commands. Atlas and Cosmos DB require separate administrative access. New passwords are not saved, and password hashes are never shown.",
            )}
          </span>
        </div>

        {profile.readOnly && (
          <div className="ur-readonly-note" role="status">
            <Shield size={14} />
            {t(
              "此連線設定為唯讀。你可以檢視可讀取的帳號與權限，不能變更資料庫使用者。",
              "This connection is read-only. You can inspect visible users and permissions, but cannot change database accounts.",
            )}
          </div>
        )}

        {error && (
          <div className="notice error ur-error" role="alert">
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="ur-success" role="status">
            <Check size={15} /> {notice}
          </div>
        )}

        {snapshot && snapshot.status !== "unsupported" && (
          <details className="ur-current-account">
            <summary>
              <span>
                <strong>
                  {t("目前連線身分", "Current connection identity")}
                </strong>
                <small>
                  {current.length
                    ? current
                        .map(
                          (identity) =>
                            `${identity.username}@${identity.authenticationDatabase}`,
                        )
                        .join(", ")
                    : t(
                        "未驗證身分或伺服器未啟用驗證",
                        "No authenticated identity or authentication is disabled",
                      )}
                </small>
              </span>
              <span className="ur-count">
                {t("有效權限", "Effective privileges")}:{" "}
                {snapshot.currentPrivileges.length}
              </span>
            </summary>
            <div className="ur-current-details">
              <div className="ur-role-chips">
                {snapshot.currentRoles.length ? (
                  snapshot.currentRoles.map((role) => (
                    <RoleLabel key={roleKey(role)} role={role} />
                  ))
                ) : (
                  <span className="muted">
                    {t("沒有回報目前角色", "No current roles reported")}
                  </span>
                )}
              </div>
              <PrivilegeList
                items={snapshot.currentPrivileges}
                empty={t(
                  "伺服器沒有回報有效權限。",
                  "The server returned no effective privileges.",
                )}
              />
            </div>
          </details>
        )}

        {loading && !snapshot && (
          <div className="ur-loading" role="status">
            <LoaderCircle className="spin" size={18} />
            {t("正在檢視使用者與角色…", "Loading users and roles…")}
          </div>
        )}

        {profile.provider !== "mongodb" && (
          <div className="ur-unavailable" role="status">
            <AlertTriangle size={20} />
            <strong>
              {t(
                "此連線尚未支援帳號管理",
                "Account management is not supported for this connection",
              )}
            </strong>
            <p>
              {t(
                "Cosmos DB for MongoDB 的使用者與角色由 Azure 管理端控制。",
                "Azure manages users and roles for Cosmos DB for MongoDB.",
              )}
            </p>
          </div>
        )}

        {snapshot?.status === "unsupported" && (
          <div className="ur-unavailable" role="status">
            <AlertTriangle size={20} />
            <strong>
              {t(
                "此部署不支援自架 MongoDB 帳號命令",
                "This deployment does not support self-managed MongoDB account commands",
              )}
            </strong>
            <p>
              {t(
                "如果這是 Atlas，請使用 Atlas Database Access 管理使用者與角色。若為自架 MongoDB，請確認版本與目前帳號的 viewUser 權限。",
                "For Atlas, manage users through Atlas Database Access. For self-managed MongoDB, check the server version and the connection account's viewUser privileges.",
              )}
            </p>
          </div>
        )}

        {snapshot && snapshot.status !== "unsupported" && (
          <>
            {!!snapshot.diagnostics.length && (
              <div className="ur-diagnostics" role="status">
                <AlertTriangle size={14} />
                <ul>
                  {snapshot.diagnostics.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            <nav
              className="ur-section-switch"
              aria-label={t("檢視分類", "Access sections")}
            >
              <button
                aria-pressed={section === "users"}
                className={section === "users" ? "active" : ""}
                onClick={() => {
                  setSection("users");
                  setMode(undefined);
                }}
              >
                <Users size={15} /> {t("使用者", "Users")}
                <span>{snapshot.users.length}</span>
              </button>
              <button
                aria-pressed={section === "roles"}
                className={section === "roles" ? "active" : ""}
                onClick={() => {
                  setSection("roles");
                  setMode(undefined);
                }}
              >
                <Shield size={15} /> {t("角色", "Roles")}
                <span>{snapshot.roles.length}</span>
              </button>
            </nav>

            {section === "users" ? (
              <div className="ur-workspace">
                <aside className="ur-list-panel">
                  <div className="ur-list-head">
                    <label>
                      <span>{t("使用者清單", "User list")}</span>
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={t(
                          "搜尋帳號或角色",
                          "Search users or roles",
                        )}
                        aria-label={t("搜尋使用者", "Search users")}
                      />
                    </label>
                    <button
                      className="icon"
                      aria-label={t("新增使用者", "Add user")}
                      title={t("新增使用者", "Add user")}
                      disabled={!writable}
                      onClick={() => {
                        resetCreate();
                        setMode({ kind: "create" });
                      }}
                    >
                      <UserPlus size={16} />
                    </button>
                  </div>
                  <nav
                    className="ur-user-list"
                    aria-label={t("資料庫使用者", "Database users")}
                  >
                    {filteredUsers.map((user) => {
                      const key = userKey(user);
                      const isCurrent = current.some(
                        (identity) =>
                          identity.username === user.username &&
                          identity.authenticationDatabase ===
                            user.authenticationDatabase,
                      );
                      return (
                        <button
                          key={key}
                          className={selectedUserKey === key ? "selected" : ""}
                          aria-pressed={selectedUserKey === key}
                          onClick={() => {
                            setSelectedUserKey(key);
                            setMode(undefined);
                          }}
                        >
                          <span className="ur-user-icon">
                            <Users size={15} />
                          </span>
                          <span className="ur-user-label">
                            <strong>{user.username}</strong>
                            <small>
                              {user.authenticationDatabase} ·{" "}
                              {user.roles.length} {t("個角色", "roles")}
                            </small>
                          </span>
                          {isCurrent && (
                            <span className="ur-current-mark">
                              {t("目前", "YOU")}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {!filteredUsers.length && (
                      <p className="muted ur-list-empty">
                        {snapshot.users.length
                          ? t("沒有符合的帳號。", "No users match this search.")
                          : t(
                              "目前可檢視範圍內沒有使用者。",
                              "No users are visible in this scope.",
                            )}
                      </p>
                    )}
                  </nav>
                </aside>

                <section className="ur-detail-panel" aria-live="polite">
                  {mode?.kind === "create" ? (
                    <div className="ur-form-panel">
                      <div className="ur-panel-heading">
                        <div>
                          <h3>{t("新增使用者", "Create user")}</h3>
                          <p>
                            {t(
                              "選擇驗證資料庫與最小必要角色。",
                              "Choose an authentication database and the minimum required roles.",
                            )}
                          </p>
                        </div>
                        <button
                          className="icon"
                          aria-label={t("取消新增", "Cancel create user")}
                          onClick={() => {
                            setMode(undefined);
                            resetCreate();
                          }}
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <div className="ur-form-grid">
                        <Field full label={t("使用者名稱", "Username")}>
                          <input
                            autoComplete="off"
                            value={createUsername}
                            onChange={(event) =>
                              setCreateUsername(event.target.value)
                            }
                            maxLength={255}
                          />
                        </Field>
                        <Field
                          full
                          label={t("驗證資料庫", "Authentication database")}
                        >
                          <input
                            autoComplete="off"
                            value={createDatabase}
                            onChange={(event) =>
                              setCreateDatabase(event.target.value)
                            }
                            maxLength={255}
                          />
                          <small>
                            {t(
                              "帳號以此資料庫作為登入身分；角色可以套用到其他資料庫。",
                              "The account authenticates against this database. Its roles can apply to other databases.",
                            )}
                          </small>
                        </Field>
                        <Field label={t("密碼", "Password")}>
                          <input
                            type="password"
                            autoComplete="new-password"
                            value={createPassword}
                            onChange={(event) =>
                              setCreatePassword(event.target.value)
                            }
                            maxLength={1024}
                          />
                        </Field>
                        <Field label={t("再次輸入密碼", "Confirm password")}>
                          <input
                            type="password"
                            autoComplete="new-password"
                            value={createPasswordConfirm}
                            onChange={(event) =>
                              setCreatePasswordConfirm(event.target.value)
                            }
                            maxLength={1024}
                          />
                        </Field>
                        <fieldset className="ur-role-assignment">
                          <legend>{t("指派角色", "Assign roles")}</legend>
                          {createRoles.map((role, index) => (
                            <div className="ur-role-select-row" key={index}>
                              <select
                                value={role.role ? roleKey(role) : ""}
                                onChange={(event) =>
                                  setCreateRole(index, event.target.value)
                                }
                                aria-label={`${t("使用者角色", "User role")} ${index + 1}`}
                              >
                                <option value="">
                                  {t(
                                    "選擇角色與資料庫…",
                                    "Choose role and database…",
                                  )}
                                </option>
                                {availableRoles.map((option) => {
                                  const ref = {
                                    role: option.name,
                                    database: option.database,
                                  };
                                  return (
                                    <option
                                      key={roleKey(ref)}
                                      value={roleKey(ref)}
                                    >
                                      {option.name} @ {option.database}
                                      {option.builtin
                                        ? ` · ${t("內建", "built-in")}`
                                        : ` · ${t("自訂", "custom")}`}
                                    </option>
                                  );
                                })}
                              </select>
                              {createRoles.length > 1 && (
                                <button
                                  className="icon"
                                  aria-label={t("移除此角色", "Remove role")}
                                  onClick={() =>
                                    setCreateRoles((old) =>
                                      old.filter((_, item) => item !== index),
                                    )
                                  }
                                >
                                  <X size={14} />
                                </button>
                              )}
                            </div>
                          ))}
                          <button
                            className="text-button ur-add-role"
                            disabled={createRoles.length >= 64}
                            onClick={() =>
                              setCreateRoles((old) => [
                                ...old,
                                { role: "", database: "" },
                              ])
                            }
                          >
                            <Plus size={13} /> {t("新增角色", "Add role")}
                          </button>
                        </fieldset>
                      </div>
                      {createRoles.some((role) =>
                        broadRoles.has(role.role),
                      ) && (
                        <div className="ur-role-warning" role="note">
                          <AlertTriangle size={14} />
                          {t(
                            "所選角色具有廣泛資料庫或管理權限，請確認授權範圍。",
                            "A selected role grants broad database or administration access. Review its scope before continuing.",
                          )}
                        </div>
                      )}
                      {createPassword &&
                        createPasswordConfirm &&
                        createPassword !== createPasswordConfirm && (
                          <p className="preference-error" role="alert">
                            {t(
                              "兩次輸入的密碼不相符。",
                              "Passwords do not match.",
                            )}
                          </p>
                        )}
                      <div className="ur-review-summary">
                        <strong>{t("建立摘要", "Create summary")}</strong>
                        <span>
                          {createUsername || "—"} @ {createDatabase || "—"}
                        </span>
                        <div className="ur-role-chips">
                          {createRoles
                            .filter((role) => role.role)
                            .map((role) => (
                              <RoleLabel key={roleKey(role)} role={role} />
                            ))}
                        </div>
                      </div>
                      <div className="ur-form-actions">
                        <button
                          onClick={() => {
                            setMode(undefined);
                            resetCreate();
                          }}
                        >
                          {t("取消", "Cancel")}
                        </button>
                        <button
                          className="primary"
                          disabled={
                            !writable ||
                            !createUsername.trim() ||
                            !createDatabase.trim() ||
                            !createRolesValid ||
                            !createPasswordValid
                          }
                          onClick={submitCreate}
                        >
                          {busy
                            ? t("正在建立…", "Creating…")
                            : t("建立使用者", "Create user")}
                        </button>
                      </div>
                    </div>
                  ) : selectedUser ? (
                    <div className="ur-user-detail">
                      <div className="ur-panel-heading">
                        <div>
                          <h3>{selectedUser.username}</h3>
                          <p>
                            {t("驗證資料庫", "Authentication database")}:{" "}
                            <code>{selectedUser.authenticationDatabase}</code>{" "}
                            {selectedIsCurrent && (
                              <span className="ur-current-mark">
                                {t(
                                  "目前連線帳號",
                                  "Current connection account",
                                )}
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="ur-user-actions">
                          <button
                            disabled={mutationDisabled}
                            onClick={() => {
                              clearSecrets();
                              setMode({ kind: "password" });
                            }}
                          >
                            <KeyRound size={14} />{" "}
                            {t("重設密碼", "Reset password")}
                          </button>
                          <button
                            disabled={
                              mutationDisabled || !grantableRoles.length
                            }
                            onClick={() => {
                              setGrantRole(undefined);
                              setMode({ kind: "grant" });
                            }}
                          >
                            <Plus size={14} /> {t("授予角色", "Grant role")}
                          </button>
                          <button
                            className="danger-text"
                            disabled={mutationDisabled || selectedIsCurrent}
                            onClick={() => {
                              setDeleteConfirmation("");
                              setMode({ kind: "delete" });
                            }}
                          >
                            <Trash2 size={14} />{" "}
                            {t("刪除使用者", "Delete user")}
                          </button>
                        </div>
                      </div>

                      {detailsError && (
                        <p className="ur-inline-warning" role="status">
                          {detailsError}
                        </p>
                      )}
                      {!userDetails && !detailsError && (
                        <p className="muted">
                          {t(
                            "正在讀取此帳號的繼承權限…",
                            "Loading this user's inherited permissions…",
                          )}
                        </p>
                      )}
                      <section className="ur-assigned-roles">
                        <h4>
                          {t("直接指派的角色", "Directly assigned roles")}
                        </h4>
                        {selectedDirectRoles.length ? (
                          selectedDirectRoles.map((role) => (
                            <div
                              className="ur-assigned-role"
                              key={roleKey(role)}
                            >
                              <RoleLabel role={role} />
                              <button
                                disabled={mutationDisabled}
                                className="text-button"
                                onClick={() =>
                                  setMode({ kind: "revoke", role })
                                }
                              >
                                {t("撤銷", "Revoke")}
                              </button>
                            </div>
                          ))
                        ) : (
                          <p className="muted">
                            {t(
                              "沒有直接指派角色。",
                              "No roles are directly assigned.",
                            )}
                          </p>
                        )}
                      </section>

                      {userDetails && (
                        <div className="ur-permission-columns">
                          <section>
                            <h4>{t("繼承的角色", "Inherited roles")}</h4>
                            <div className="ur-role-chips">
                              {userDetails.inheritedRoles?.length ? (
                                userDetails.inheritedRoles.map((role) => (
                                  <RoleLabel key={roleKey(role)} role={role} />
                                ))
                              ) : (
                                <span className="muted">
                                  {t("沒有繼承角色。", "No inherited roles.")}
                                </span>
                              )}
                            </div>
                          </section>
                          <section>
                            <h4>{t("有效權限", "Effective privileges")}</h4>
                            <PrivilegeList
                              items={userDetails.inheritedPrivileges || []}
                              empty={t(
                                "沒有可顯示的有效權限。",
                                "No effective privileges are available.",
                              )}
                            />
                          </section>
                        </div>
                      )}

                      {mode?.kind === "password" && (
                        <div className="ur-action-form">
                          <strong>
                            {t("重設密碼", "Reset password")}:{" "}
                            {selectedUser.username}
                          </strong>
                          <div className="ur-form-grid">
                            <Field label={t("新密碼", "New password")}>
                              <input
                                type="password"
                                autoComplete="new-password"
                                value={newPassword}
                                onChange={(event) =>
                                  setNewPassword(event.target.value)
                                }
                                maxLength={1024}
                              />
                            </Field>
                            <Field
                              label={t(
                                "再次輸入新密碼",
                                "Confirm new password",
                              )}
                            >
                              <input
                                type="password"
                                autoComplete="new-password"
                                value={newPasswordConfirm}
                                onChange={(event) =>
                                  setNewPasswordConfirm(event.target.value)
                                }
                                maxLength={1024}
                              />
                            </Field>
                          </div>
                          {newPassword &&
                            newPasswordConfirm &&
                            newPassword !== newPasswordConfirm && (
                              <p className="preference-error" role="alert">
                                {t(
                                  "兩次輸入的密碼不相符。",
                                  "Passwords do not match.",
                                )}
                              </p>
                            )}
                          <div className="ur-form-actions">
                            <button
                              onClick={() => {
                                setMode(undefined);
                                clearSecrets();
                              }}
                            >
                              {t("取消", "Cancel")}
                            </button>
                            <button
                              className="primary"
                              disabled={
                                mutationDisabled ||
                                newPassword.length < 8 ||
                                newPassword !== newPasswordConfirm
                              }
                              onClick={submitPassword}
                            >
                              {busy
                                ? t("正在重設…", "Resetting…")
                                : t("重設密碼", "Reset password")}
                            </button>
                          </div>
                        </div>
                      )}

                      {mode?.kind === "grant" && (
                        <div className="ur-action-form">
                          <strong>
                            {t("授予角色", "Grant role")}:{" "}
                            {selectedUser.username}
                          </strong>
                          <Field
                            label={t(
                              "角色與套用資料庫",
                              "Role and database scope",
                            )}
                          >
                            <select
                              value={grantRole ? roleKey(grantRole) : ""}
                              onChange={(event) => {
                                const role = grantableRoles.find(
                                  (option) =>
                                    roleKey({
                                      role: option.name,
                                      database: option.database,
                                    }) === event.target.value,
                                );
                                setGrantRole(
                                  role
                                    ? {
                                        role: role.name,
                                        database: role.database,
                                      }
                                    : undefined,
                                );
                              }}
                            >
                              <option value="">
                                {t("選擇角色…", "Choose a role…")}
                              </option>
                              {grantableRoles.map((role) => (
                                <option
                                  key={roleKey({
                                    role: role.name,
                                    database: role.database,
                                  })}
                                  value={roleKey({
                                    role: role.name,
                                    database: role.database,
                                  })}
                                >
                                  {role.name} @ {role.database}
                                  {role.builtin
                                    ? ` · ${t("內建", "built-in")}`
                                    : ` · ${t("自訂", "custom")}`}
                                </option>
                              ))}
                            </select>
                          </Field>
                          {grantRole && (
                            <div className="ur-review-summary">
                              <strong>{t("授權摘要", "Grant summary")}</strong>
                              <RoleLabel role={grantRole} />
                              {broadRoles.has(grantRole.role) && (
                                <span className="ur-role-warning">
                                  <AlertTriangle size={14} />
                                  {t(
                                    "此角色具有廣泛權限。",
                                    "This role grants broad privileges.",
                                  )}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="ur-form-actions">
                            <button
                              onClick={() => {
                                setMode(undefined);
                                setGrantRole(undefined);
                              }}
                            >
                              {t("取消", "Cancel")}
                            </button>
                            <button
                              className="primary"
                              disabled={mutationDisabled || !grantRole}
                              onClick={submitGrant}
                            >
                              {busy
                                ? t("正在授予…", "Granting…")
                                : t("授予角色", "Grant role")}
                            </button>
                          </div>
                        </div>
                      )}

                      {mode?.kind === "revoke" && (
                        <div className="ur-action-form ur-confirm-form">
                          <strong>
                            {t("確認撤銷角色", "Confirm role revocation")}
                          </strong>
                          <p>
                            {t(
                              "將從此帳號移除以下直接指派的角色：",
                              "Remove this directly assigned role from the account:",
                            )}
                          </p>
                          <RoleLabel role={mode.role} />
                          <div className="ur-form-actions">
                            <button onClick={() => setMode(undefined)}>
                              {t("取消", "Cancel")}
                            </button>
                            <button
                              className="danger"
                              disabled={mutationDisabled}
                              onClick={() => submitRevoke(mode.role)}
                            >
                              {busy
                                ? t("正在撤銷…", "Revoking…")
                                : t("確認撤銷", "Revoke role")}
                            </button>
                          </div>
                        </div>
                      )}

                      {mode?.kind === "delete" && (
                        <div className="ur-action-form ur-confirm-form">
                          <strong>
                            {t("刪除資料庫使用者", "Delete database user")}
                          </strong>
                          <p>
                            {t(
                              "這會移除此登入帳號及其直接角色。請輸入完整驗證資料庫與使用者名稱確認：",
                              "This removes the login account and its direct roles. Enter the full authentication database and username to confirm:",
                            )}
                          </p>
                          <code className="ur-delete-target">
                            {selectedUser.authenticationDatabase}.
                            {selectedUser.username}
                          </code>
                          <Field label={t("確認目標", "Confirm target")}>
                            <input
                              autoComplete="off"
                              value={deleteConfirmation}
                              onChange={(event) =>
                                setDeleteConfirmation(event.target.value)
                              }
                            />
                          </Field>
                          <div className="ur-form-actions">
                            <button onClick={() => setMode(undefined)}>
                              {t("取消", "Cancel")}
                            </button>
                            <button
                              className="danger"
                              disabled={
                                mutationDisabled ||
                                deleteConfirmation !==
                                  `${selectedUser.authenticationDatabase}.${selectedUser.username}`
                              }
                              onClick={submitDrop}
                            >
                              {busy
                                ? t("正在刪除…", "Deleting…")
                                : t("刪除使用者", "Delete user")}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="ur-empty-detail">
                      <Users size={27} />
                      <strong>
                        {t(
                          "選擇使用者以檢視權限",
                          "Select a user to inspect permissions",
                        )}
                      </strong>
                      <p>
                        {t(
                          "使用者與角色清單只會顯示目前連線帳號可檢視的範圍。",
                          "The user and role lists show only the scope visible to this connection.",
                        )}
                      </p>
                    </div>
                  )}
                </section>
              </div>
            ) : (
              <div className="ur-workspace ur-roles-workspace">
                <aside className="ur-list-panel">
                  <div className="ur-list-head">
                    <strong>{t("角色清單", "Role list")}</strong>
                  </div>
                  <nav
                    className="ur-user-list"
                    aria-label={t("資料庫角色", "Database roles")}
                  >
                    {availableRoles.map((role) => {
                      const key = roleKey({
                        role: role.name,
                        database: role.database,
                      });
                      return (
                        <button
                          key={key}
                          className={selectedRoleKey === key ? "selected" : ""}
                          aria-pressed={selectedRoleKey === key}
                          onClick={() => setSelectedRoleKey(key)}
                        >
                          <span className="ur-user-icon">
                            <Shield size={15} />
                          </span>
                          <span className="ur-user-label">
                            <strong>{role.name}</strong>
                            <small>
                              {role.database} ·{" "}
                              {role.builtin
                                ? t("內建", "built-in")
                                : t("自訂", "custom")}
                            </small>
                          </span>
                        </button>
                      );
                    })}
                    {!availableRoles.length && (
                      <p className="muted ur-list-empty">
                        {t(
                          "目前可檢視範圍沒有角色。",
                          "No roles are visible in this scope.",
                        )}
                      </p>
                    )}
                  </nav>
                </aside>
                <section
                  className="ur-detail-panel ur-role-detail"
                  aria-live="polite"
                >
                  {selectedRole ? (
                    <>
                      <div className="ur-panel-heading">
                        <div>
                          <h3>{selectedRole.name}</h3>
                          <p>
                            {t("角色資料庫", "Role database")}:{" "}
                            <code>{selectedRole.database}</code> ·{" "}
                            {selectedRole.builtin
                              ? t("內建角色", "Built-in role")
                              : t("自訂角色", "Custom role")}
                          </p>
                        </div>
                        <span className="ur-readonly-chip">
                          {t("僅檢視", "View only")}
                        </span>
                      </div>
                      <div className="ur-role-detail-grid">
                        <section>
                          <h4>
                            {t("直接繼承角色", "Direct role inheritance")}
                          </h4>
                          <div className="ur-role-chips">
                            {selectedRole.roles.length ? (
                              selectedRole.roles.map((role) => (
                                <RoleLabel key={roleKey(role)} role={role} />
                              ))
                            ) : (
                              <span className="muted">
                                {t("沒有直接繼承角色。", "No inherited roles.")}
                              </span>
                            )}
                          </div>
                        </section>
                        <section>
                          <h4>{t("完整繼承角色", "All inherited roles")}</h4>
                          <div className="ur-role-chips">
                            {selectedRole.inheritedRoles.length ? (
                              selectedRole.inheritedRoles.map((role) => (
                                <RoleLabel key={roleKey(role)} role={role} />
                              ))
                            ) : (
                              <span className="muted">
                                {t("沒有繼承角色。", "No inherited roles.")}
                              </span>
                            )}
                          </div>
                        </section>
                        <section>
                          <h4>{t("直接權限", "Direct privileges")}</h4>
                          <PrivilegeList
                            items={selectedRole.privileges}
                            empty={t("沒有直接權限。", "No direct privileges.")}
                          />
                        </section>
                        <section>
                          <h4>{t("完整有效權限", "Effective privileges")}</h4>
                          <PrivilegeList
                            items={selectedRole.inheritedPrivileges}
                            empty={t(
                              "沒有有效權限。",
                              "No effective privileges.",
                            )}
                          />
                        </section>
                      </div>
                      <p className="ur-role-note">
                        {t(
                          "角色清單來自可列舉的資料庫及使用者已引用的角色資料庫。若自訂角色位於不可列舉的空資料庫，且沒有使用者引用，可能不會出現在清單。自訂角色目前僅供檢視；請在 MongoDB 管理端編輯。",
                          "Roles are listed for databases visible to this connection and databases referenced by users. An unassigned custom role in an otherwise unlisted empty database may not appear. Custom roles are view-only here; edit them through your MongoDB administration workflow.",
                        )}
                      </p>
                    </>
                  ) : (
                    <div className="ur-empty-detail">
                      <Shield size={27} />
                      <strong>
                        {t(
                          "選擇角色以檢視有效權限",
                          "Select a role to inspect its effective privileges",
                        )}
                      </strong>
                    </div>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
