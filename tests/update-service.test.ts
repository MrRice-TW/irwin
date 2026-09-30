import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  shouldAutoCheckForUpdates,
  UpdateService,
  type UpdateStatus,
} from "../src/main/update-service";

function release(tag_name: string, body = "Release notes") {
  return new Response(
    JSON.stringify({
      tag_name,
      name: `Irwin ${tag_name}`,
      body,
    }),
    { status: 200 },
  );
}

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  checkForUpdates = vi.fn(async () => ({ updateInfo: { version: "0.2.0" } }));
  quitAndInstall = vi.fn();
}

function createService(
  options: {
    currentVersion?: string;
    platform?: NodeJS.Platform;
    packaged?: boolean;
    fetcher?: typeof fetch;
    updater?: FakeUpdater;
    onStatus?: (status: UpdateStatus) => void;
  } = {},
) {
  return new UpdateService({
    currentVersion: options.currentVersion ?? "0.1.0",
    platform: options.platform ?? "darwin",
    packaged: options.packaged ?? true,
    fetcher:
      options.fetcher ?? ((async () => release("v0.1.0")) as typeof fetch),
    updater: options.updater,
    onStatus: options.onStatus ?? (() => {}),
  });
}

describe("version update checks", () => {
  it("only permits startup checks when enabled and online", () => {
    expect(shouldAutoCheckForUpdates(true, true)).toBe(true);
    expect(shouldAutoCheckForUpdates(false, true)).toBe(false);
    expect(shouldAutoCheckForUpdates(true, false)).toBe(false);
  });

  it("orders semantic prereleases before their stable release", () => {
    expect(compareVersions("1.2.0-beta.2", "1.2.0-beta.10")).toBe(-1);
    expect(compareVersions("1.2.0-rc.1", "1.2.0")).toBe(-1);
  });

  it("treats the same release version as current after removing a v prefix", async () => {
    const service = createService({ fetcher: async () => release("v0.1.0") });

    const result = await service.check();
    expect(result).toMatchObject({
      state: "current",
      currentVersion: "0.1.0",
    });
    expect(result).not.toHaveProperty("availableVersion");
  });

  it("offers newer macOS releases as manual downloads when the app is unsigned", async () => {
    const service = createService({
      fetcher: async () => release("v0.2.0", "Fixes and improvements"),
    });

    await expect(service.check()).resolves.toMatchObject({
      state: "available",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      delivery: "manual",
      releaseNotes: "Fixes and improvements",
    });
  });

  it("starts automatic downloads only for packaged Windows and Linux releases", async () => {
    const updater = new FakeUpdater();
    const service = createService({
      platform: "win32",
      updater,
      fetcher: async () => release("0.2.0"),
    });

    await service.check();

    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowPrerelease).toBe(false);
  });

  it("publishes download progress and requires an explicit install after download", async () => {
    const updater = new FakeUpdater();
    const service = createService({
      platform: "linux",
      updater,
      fetcher: async () => release("0.2.0"),
    });
    await service.check();

    updater.emit("download-progress", { percent: 37.4 });
    expect(service.status).toMatchObject({
      state: "downloading",
      progress: 37,
    });
    await expect(service.install()).rejects.toThrow("has not been downloaded");

    updater.emit("update-downloaded", {
      version: "0.2.0",
      releaseNotes: "Notes",
    });
    expect(service.status).toMatchObject({
      state: "downloaded",
      progress: 100,
    });
    service.install();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it("reports a missing first public release without trying an installer", async () => {
    const updater = new FakeUpdater();
    const service = createService({
      platform: "win32",
      updater,
      fetcher: async () => new Response("Not Found", { status: 404 }),
    });

    await expect(service.check()).resolves.toMatchObject({
      state: "no-release",
    });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("rejects malformed release versions and reports network failure safely", async () => {
    const malformed = createService({
      fetcher: async () => release("latest"),
    });
    await expect(malformed.check()).resolves.toMatchObject({ state: "error" });

    const unavailable = createService({
      fetcher: async () => {
        throw new Error("socket failure");
      },
    });
    await expect(unavailable.check()).resolves.toMatchObject({
      state: "error",
      message: expect.not.stringContaining("socket failure"),
    });
  });

  it("keeps silent startup failures from changing visible update state", async () => {
    const onStatus = vi.fn();
    const service = createService({
      fetcher: async () => {
        throw new Error("offline");
      },
      onStatus,
    });
    const initialStatus = service.status;

    await expect(service.check({ silent: true })).resolves.toEqual(initialStatus);
    expect(service.status).toEqual(initialStatus);
    expect(onStatus).not.toHaveBeenCalled();
  });

  it("shows a new release found by a silent startup check without showing a spinner", async () => {
    const onStatus = vi.fn();
    const service = createService({
      fetcher: async () => release("0.2.0"),
      onStatus,
    });

    await service.check({ silent: true });

    expect(service.status).toMatchObject({
      state: "available",
      availableVersion: "0.2.0",
    });
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: "available" }),
    );
  });

  it("keeps a discovered update visible when the silent updater check fails", async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates = vi.fn(async () => {
      updater.emit("checking-for-update");
      updater.emit("error");
      throw new Error("offline during installer check");
    });
    const onStatus = vi.fn();
    const service = createService({
      platform: "win32",
      updater,
      fetcher: async () => release("0.2.0"),
      onStatus,
    });

    await service.check({ silent: true });

    expect(service.status).toMatchObject({
      state: "available",
      availableVersion: "0.2.0",
    });
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: "available" }),
    );
  });
});
