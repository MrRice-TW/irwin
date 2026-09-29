import assert from "node:assert/strict";
import { _electron as electron, expect } from "@playwright/test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { closeElectronWindowNormally } from "./helpers/close-electron.mjs";

const outputDir = ".runtime/qa-users-roles";
await mkdir(outputDir, { recursive: true });
const dataDir = resolve(`.runtime/users-roles-user-data-${Date.now()}`);
const rootUser = "fixture-user";
const rootPassword = "fixture-password";
const server = await MongoMemoryServer.create({
  binary: { version: "8.0.18", downloadDir: ".runtime/mongodb" },
  auth: {
    enable: true,
    customRootName: rootUser,
    customRootPwd: rootPassword,
  },
});
const uri = server.getUri();
const client = new MongoClient(uri, {
  auth: { username: rootUser, password: rootPassword },
  authSource: "admin",
});
await client.connect();
await client.db("admin").command({
  createUser: "qa-limited",
  pwd: "limited-password",
  roles: [{ role: "read", db: "admin" }],
});

let app;
let page;
const checks = [];
const screenshots = [];
const errors = [];
const dialog = () => page.locator("dialog.users-roles-modal[open]");
const check = async (name, run) => {
  try {
    await run();
    checks.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    const path = `${outputDir}/failure-${screenshots.length + 1}.png`;
    if (page) await page.screenshot({ path }).catch(() => {});
    screenshots.push(path);
    console.error(`FAIL ${name}: ${error.stack || error}`);
    throw error;
  }
};
const shot = async (name) => {
  const path = `${outputDir}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  screenshots.push(path);
};
const resize = async (width, height) => {
  await app.evaluate(
    ({ BrowserWindow }, size) =>
      BrowserWindow.getAllWindows()[0].setContentSize(...size),
    [width, height],
  );
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
  await expect.poll(() => page.evaluate(() => innerHeight)).toBe(height);
};
const openAccess = async (profileName) => {
  let node = page.locator(".connection-node").filter({ hasText: profileName });
  if (!(await node.count())) {
    const connectionLabel =
      (await page.locator("html").getAttribute("lang")) === "en"
        ? "Connections"
        : "連線";
    await page
      .locator(".app-header")
      .getByRole("button", { name: connectionLabel })
      .click();
    await page
      .locator(".connection-picker")
      .getByRole("button", { name: profileName })
      .click();
    await expect
      .poll(() => node.count(), { timeout: 30000 })
      .toBeGreaterThan(0);
    node = page.locator(".connection-node").filter({ hasText: profileName });
  }
  await node.locator(".connection-row > .node-menu-trigger").click();
  const label =
    (await page.locator("html").getAttribute("lang")) === "en"
      ? "Users & roles"
      : "使用者與角色";
  await node.locator(".node-menu").getByRole("button", { name: label }).click();
  await expect(dialog()).toBeVisible();
  await expect(dialog().locator(".ur-workspace, .ur-unavailable")).toBeVisible({
    timeout: 30000,
  });
};
const closeAccess = async () => {
  const label =
    (await page.locator("html").getAttribute("lang")) === "en"
      ? "Close"
      : "關閉";
  await dialog()
    .locator(".modal-footer")
    .getByRole("button", { name: label, exact: true })
    .click();
  await expect(dialog()).toHaveCount(0);
};
const setAppearance = async (language, theme) => {
  await page.evaluate(
    async ({ language, theme }) => {
      const settings = await window.workbench.request("settings.get", {});
      await window.workbench.request("settings.set", {
        ...settings,
        language,
        theme,
      });
    },
    { language, theme },
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "lang",
    language === "en" ? "en" : "zh-Hant",
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
};
const selectRole = async (select, prefix) => {
  const value = await select.locator("option").evaluateAll((options, text) => {
    const match = options.find((option) =>
      option.textContent?.trim().startsWith(text),
    );
    return match?.value;
  }, prefix);
  assert.ok(value, `Expected role option starting with ${prefix}`);
  await select.selectOption(value);
};
const selectUser = async (username) => {
  const user = dialog()
    .locator(".ur-user-list > button")
    .filter({ hasText: username });
  await expect(user).toBeVisible();
  await user.click();
  await expect(dialog().locator(".ur-user-detail h3")).toHaveText(username);
};
const checkDialogGeometry = async () => {
  const geometry = await dialog().evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const footer = element
      .querySelector(".modal-footer")
      .getBoundingClientRect();
    const body = element.querySelector(".modal-body");
    const workspace = element
      .querySelector(".ur-workspace")
      .getBoundingClientRect();
    return {
      modalInside:
        bounds.left >= 0 &&
        bounds.top >= 0 &&
        bounds.right <= innerWidth &&
        bounds.bottom <= innerHeight,
      footerVisible: footer.height > 0 && footer.bottom <= innerHeight,
      noHorizontalOverflow: body.scrollWidth <= body.clientWidth + 1,
      workspaceVisible: workspace.width > 300 && workspace.height > 180,
    };
  });
  assert.deepEqual(geometry, {
    modalInside: true,
    footerVisible: true,
    noHorizontalOverflow: true,
    workspaceVisible: true,
  });
};

try {
  const env = { ...process.env, WORKBENCH_USER_DATA: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    args: [".", "--disable-gpu"],
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => {
    if (!/ICodeLensCache|treeViewsDndService/.test(error.message))
      errors.push(error.message);
  });
  await expect(page.locator(".brand strong")).toHaveText("Irwin", {
    timeout: 30000,
  });
  await page.evaluate(
    async ({ uri, rootUser, rootPassword }) => {
      const settings = await window.workbench.request("settings.get", {});
      await window.workbench.request("settings.set", {
        ...settings,
        language: "en",
        theme: "dark",
      });
      for (const profile of [
        {
          id: "qa-user-admin",
          name: "QA User Admin",
          uri,
          database: "admin",
          username: rootUser,
          authSource: "admin",
          readOnly: false,
        },
        {
          id: "qa-user-readonly",
          name: "QA User Read Only",
          uri,
          database: "admin",
          username: rootUser,
          authSource: "admin",
          readOnly: true,
        },
        {
          id: "qa-user-limited",
          name: "QA User Limited",
          uri,
          database: "admin",
          username: "qa-limited",
          authSource: "admin",
          readOnly: false,
        },
      ]) {
        await window.workbench.request("connections.save", {
          profile,
          secrets: {
            password:
              profile.username === "qa-limited"
                ? "limited-password"
                : rootPassword,
          },
        });
      }
    },
    { uri, rootUser, rootPassword },
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await resize(1480, 960);

  await check(
    "large dark English screen shows user inventory and identity context",
    async () => {
      await openAccess("QA User Admin");
      await expect(dialog()).toContainText("Current connection identity");
      await expect(dialog()).toContainText(`${rootUser}@admin`);
      await expect(dialog().locator(".ur-user-list")).toContainText(rootUser);
      await expect(dialog().locator(".ur-diagnostics")).toHaveCount(0);
      await checkDialogGeometry();
      await shot("01-en-dark-users-large");
    },
  );

  await check(
    "reload refreshes the visible user and role inventory",
    async () => {
      await dialog()
        .getByRole("button", { name: "Reload users and roles" })
        .click();
      await expect(dialog().locator(".ur-user-list")).toContainText(rootUser);
      await expect(dialog().locator(".ur-diagnostics")).toHaveCount(0);
    },
  );

  await check(
    "role inventory reveals built-in role scope and effective privileges",
    async () => {
      await dialog()
        .getByRole("button", { name: /^Roles/ })
        .click();
      const readRole = dialog().getByRole("button", {
        name: "read admin · built-in",
        exact: true,
      });
      await expect(readRole).toBeVisible();
      await readRole.click();
      await expect(dialog().locator(".ur-role-detail")).toContainText("read");
      await expect(dialog().locator(".ur-role-detail")).toContainText("admin");
      await expect(dialog().locator(".ur-role-detail")).toContainText("find");
      await expect(dialog().locator(".ur-role-note")).toContainText(
        "An unassigned custom role in an otherwise unlisted empty database may not appear",
      );
      await shot("02-en-dark-role-details-large");
      await dialog()
        .getByRole("button", { name: /^Users/ })
        .click();
    },
  );

  await check(
    "create user assigns an explicit authentication database and role",
    async () => {
      await dialog().getByRole("button", { name: "Add user" }).click();
      await dialog().getByLabel("Username").fill("qa-managed");
      await dialog().getByLabel("Authentication database").fill("qa_accounts");
      await dialog()
        .getByLabel("Password", { exact: true })
        .fill("first-test-password");
      await dialog()
        .getByLabel("Confirm password", { exact: true })
        .fill("first-test-password");
      const createRole = dialog().getByLabel("User role 1");
      await selectRole(createRole, "root @ admin");
      await expect(dialog().locator(".ur-role-warning")).toContainText(
        "broad database or administration access",
      );
      await selectRole(createRole, "read @ admin");
      await expect(dialog().locator(".ur-role-warning")).toHaveCount(0);
      await expect(dialog().locator(".ur-review-summary")).toContainText(
        "qa-managed @ qa_accounts",
      );
      await dialog()
        .getByRole("button", { name: "Create user", exact: true })
        .click();
      await expect(dialog().locator(".ur-success")).toContainText(
        "User created",
      );
      await expect(dialog().locator(".ur-user-list")).toContainText(
        "qa-managed",
      );
      expect(
        await client.db("qa_accounts").command({ usersInfo: 1 }),
      ).toMatchObject({
        users: [
          expect.objectContaining({ user: "qa-managed", db: "qa_accounts" }),
        ],
      });
      await shot("03-en-dark-user-created-large");
    },
  );

  await check(
    "failed duplicate create keeps the form open and clears its password fields",
    async () => {
      await dialog().getByRole("button", { name: "Add user" }).click();
      await dialog().getByLabel("Username").fill("qa-managed");
      await dialog().getByLabel("Authentication database").fill("qa_accounts");
      await dialog()
        .getByLabel("Password", { exact: true })
        .fill("second-test-password");
      await dialog()
        .getByLabel("Confirm password", { exact: true })
        .fill("second-test-password");
      await selectRole(dialog().getByLabel("User role 1"), "read @ admin");
      await dialog()
        .getByRole("button", { name: "Create user", exact: true })
        .click();
      await expect(dialog().locator(".ur-error")).toBeVisible();
      await expect(
        dialog().getByLabel("Password", { exact: true }),
      ).toHaveValue("");
      await expect(
        dialog().getByLabel("Confirm password", { exact: true }),
      ).toHaveValue("");
      await expect(dialog().getByLabel("Username")).toHaveValue("qa-managed");
      await dialog()
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
    },
  );

  await check(
    "grant and revoke affect one role while preserving the other role",
    async () => {
      await selectUser("qa-managed");
      await dialog().getByRole("button", { name: "Grant role" }).click();
      await selectRole(
        dialog().getByLabel("Role and database scope"),
        "readWrite @ admin",
      );
      await dialog()
        .getByRole("button", { name: "Grant role", exact: true })
        .last()
        .click();
      await expect(dialog().locator(".ur-success")).toContainText(
        "Role granted",
      );
      const afterGrant = await client.db("qa_accounts").command({
        usersInfo: { user: "qa-managed", db: "qa_accounts" },
      });
      expect(afterGrant.users[0].roles).toEqual(
        expect.arrayContaining([
          { role: "read", db: "admin" },
          { role: "readWrite", db: "admin" },
        ]),
      );

      const assignedRoles = dialog().locator(".ur-assigned-role");
      const originalRoleIndex = await assignedRoles.evaluateAll((rows) =>
        rows.findIndex(
          (row) =>
            row.querySelector(".ur-role-label code")?.textContent === "read",
        ),
      );
      assert.notEqual(
        originalRoleIndex,
        -1,
        "Expected direct read role assignment",
      );
      const originalRole = assignedRoles.nth(originalRoleIndex);
      assert.equal(
        await originalRole.locator(".ur-role-label code").textContent(),
        "read",
      );
      await originalRole.getByRole("button", { name: "Revoke" }).click();
      await expect(
        dialog().locator(".ur-confirm-form .ur-role-label code"),
      ).toHaveText("read");
      await dialog()
        .getByRole("button", { name: "Revoke role", exact: true })
        .click();
      await expect(dialog().locator(".ur-success")).toContainText(
        "Role revoked",
      );
      const afterRevoke = await client.db("qa_accounts").command({
        usersInfo: { user: "qa-managed", db: "qa_accounts" },
      });
      expect(afterRevoke.users[0].roles).toEqual([
        { role: "readWrite", db: "admin" },
      ]);
    },
  );

  await check(
    "password reset changes authentication and leaves assigned roles intact",
    async () => {
      await selectUser("qa-managed");
      await dialog().getByRole("button", { name: "Reset password" }).click();
      await dialog()
        .getByLabel("New password", { exact: true })
        .fill("updated-test-password");
      await dialog()
        .getByLabel("Confirm new password")
        .fill("updated-test-password");
      await dialog()
        .getByRole("button", { name: "Reset password", exact: true })
        .last()
        .click();
      await expect(dialog().locator(".ur-success")).toContainText(
        "Password reset",
      );
      const afterReset = await client.db("qa_accounts").command({
        usersInfo: { user: "qa-managed", db: "qa_accounts" },
      });
      expect(afterReset.users[0].roles).toEqual([
        { role: "readWrite", db: "admin" },
      ]);
      const authenticated = new MongoClient(uri, {
        auth: { username: "qa-managed", password: "updated-test-password" },
        authSource: "qa_accounts",
      });
      await authenticated.connect();
      await authenticated.close();
      const oldPassword = new MongoClient(uri, {
        auth: { username: "qa-managed", password: "first-test-password" },
        authSource: "qa_accounts",
        serverSelectionTimeoutMS: 2000,
      });
      try {
        await expect(oldPassword.connect()).rejects.toThrow();
      } finally {
        await oldPassword.close().catch(() => {});
      }
    },
  );

  await check(
    "self-delete is disabled and another user needs exact confirmation",
    async () => {
      await selectUser(rootUser);
      await expect(
        dialog()
          .locator(".ur-user-actions")
          .getByRole("button", { name: "Delete user" }),
      ).toBeDisabled();
      await selectUser("qa-managed");
      await dialog().getByRole("button", { name: "Delete user" }).click();
      const deleteButton = dialog()
        .locator(".ur-action-form")
        .getByRole("button", { name: "Delete user", exact: true });
      await expect(deleteButton).toBeDisabled();
      await dialog().getByLabel("Confirm target").fill("qa-managed");
      await expect(deleteButton).toBeDisabled();
      await dialog()
        .getByLabel("Confirm target")
        .fill("qa_accounts.qa-managed");
      await expect(deleteButton).toBeEnabled();
      await shot("04-en-dark-exact-delete-confirmation");
      await deleteButton.click();
      await expect(dialog().locator(".ur-success")).toContainText(
        "User deleted",
      );
      const users = await client.db("qa_accounts").command({ usersInfo: 1 });
      expect(users.users).toEqual([]);
    },
  );

  await check(
    "operation receipts omit usernames, role payloads, and passwords",
    async () => {
      const receipts = await page.evaluate(() =>
        window.workbench.request("operationReceipts.list", {}),
      );
      const text = JSON.stringify(receipts);
      expect(text).not.toContain("qa-managed");
      expect(text).not.toContain("updated-test-password");
      expect(text).not.toContain("first-test-password");
      expect(text).not.toContain("readWrite");
    },
  );

  await check(
    "read-only profile permits inspection but disables every mutation",
    async () => {
      await closeAccess();
      await openAccess("QA User Read Only");
      await expect(dialog().locator(".ur-readonly-note")).toBeVisible();
      await expect(
        dialog().getByRole("button", { name: "Add user" }),
      ).toBeDisabled();
      await selectUser(rootUser);
      await expect(
        dialog()
          .locator(".ur-user-actions")
          .getByRole("button", { name: "Reset password" }),
      ).toBeDisabled();
      await expect(
        dialog()
          .locator(".ur-user-actions")
          .getByRole("button", { name: "Grant role" }),
      ).toBeDisabled();
      await expect(dialog().locator(".ur-diagnostics")).toHaveCount(0);
      await closeAccess();
    },
  );

  await check(
    "restricted MongoDB account shows diagnostics and no write controls",
    async () => {
      await openAccess("QA User Limited");
      await expect(dialog().locator(".ur-diagnostics")).toBeVisible();
      await expect(
        dialog().getByRole("button", { name: "Add user" }),
      ).toBeDisabled();
      await expect(dialog()).toContainText("viewUser");
      await shot("05-en-dark-restricted-permissions");
      await closeAccess();
    },
  );

  await check(
    "compact English light view keeps details, workspace, and footer in bounds",
    async () => {
      await setAppearance("en", "light");
      await resize(1024, 768);
      await openAccess("QA User Admin");
      await expect(dialog().locator(".ur-workspace")).toBeVisible();
      await checkDialogGeometry();
      await shot("06-en-light-users-compact");
      await dialog()
        .getByRole("button", { name: /^Roles/ })
        .click();
      await checkDialogGeometry();
      await shot("07-en-light-roles-compact");
      await closeAccess();
    },
  );

  await check(
    "compact Traditional Chinese dark view fits without clipping",
    async () => {
      await setAppearance("zh", "dark");
      await resize(1024, 768);
      await openAccess("QA User Admin");
      await checkDialogGeometry();
      await expect(dialog()).toContainText("目前連線身分");
      await shot("08-zh-dark-users-compact");
      await closeAccess();
    },
  );

  await check(
    "large Traditional Chinese light view supports user and role details",
    async () => {
      await setAppearance("zh", "light");
      await resize(1480, 960);
      await openAccess("QA User Admin");
      await checkDialogGeometry();
      await selectUser(rootUser);
      await expect(
        dialog()
          .locator(".ur-user-actions")
          .getByRole("button", { name: "刪除使用者" }),
      ).toBeDisabled();
      await shot("09-zh-light-user-details-large");
      await dialog().getByRole("button", { name: /^角色/ }).click();
      await expect(dialog().locator(".ur-role-detail-grid")).toBeVisible();
      await checkDialogGeometry();
      await shot("10-zh-light-roles-large");
      await closeAccess();
    },
  );

  await check("renderer has no uncaught page errors", async () => {
    assert.deepEqual(errors, []);
  });

  const report = { checks, screenshots, errors, completed: true };
  await writeFile(`${outputDir}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = {
    checks,
    screenshots,
    errors,
    completed: false,
    error: error.stack || String(error),
  };
  await writeFile(`${outputDir}/report.json`, JSON.stringify(report, null, 2));
  throw error;
} finally {
  if (app) await closeElectronWindowNormally(app).catch(() => {});
  await client.close().catch(() => {});
  await server.stop().catch(() => {});
}
