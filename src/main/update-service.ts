export type UpdateStatus = {
  state:
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "downloaded"
    | "no-release"
    | "error";
  currentVersion: string;
  availableVersion?: string;
  releaseName?: string;
  releaseNotes?: string;
  delivery?: "automatic" | "manual";
  progress?: number;
  checkedAt?: string;
  message?: string;
};

type Release = {
  tag_name: string;
  name?: string | null;
  body?: string | null;
};

export interface UpdateAdapter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  on(event: string, listener: (...args: any[]) => void): this;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdateServiceOptions {
  currentVersion: string;
  platform: NodeJS.Platform;
  packaged: boolean;
  fetcher?: typeof fetch;
  updater?: UpdateAdapter;
  onStatus(status: UpdateStatus): void;
}

const releaseUrl = "https://api.github.com/repos/piayru/irwin/releases/latest";
const releasePage = "https://github.com/piayru/irwin/releases/latest";

function versionParts(value: string) {
  const match =
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      value,
    );
  if (!match) return undefined;
  const prerelease = match[4]?.split(".");
  if (
    prerelease?.some(
      (part) => /^\d+$/.test(part) && part.length > 1 && part[0] === "0",
    )
  )
    return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])] as const,
    prerelease,
  };
}

export function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) throw new Error("Invalid semantic version");
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] < b.core[i] ? -1 : 1;
  }
  if (!a.prerelease?.length) return b.prerelease?.length ? 1 : 0;
  if (!b.prerelease?.length) return -1;
  const count = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < count; i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return Number(x) < Number(y) ? -1 : 1;
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function readRelease(value: unknown): Release {
  if (!value || typeof value !== "object")
    throw new Error("Invalid release response");
  const release = value as Partial<Release>;
  if (typeof release.tag_name !== "string" || !versionParts(release.tag_name))
    throw new Error("Invalid release version");
  return {
    tag_name: release.tag_name,
    name: typeof release.name === "string" ? release.name.slice(0, 200) : "",
    body: typeof release.body === "string" ? release.body.slice(0, 12000) : "",
  };
}

const errorMessage =
  "Could not check for updates. Check your internet connection or open GitHub Releases.";

export function shouldAutoCheckForUpdates(enabled: boolean, online: boolean) {
  return enabled && online;
}

export class UpdateService {
  private value: UpdateStatus;
  private pendingCheck?: Promise<UpdateStatus>;
  private silentCheck = false;
  private readonly updater?: UpdateAdapter;
  private readonly fetcher: typeof fetch;
  private readonly onStatus: (status: UpdateStatus) => void;

  constructor(private readonly options: UpdateServiceOptions) {
    this.value = { state: "idle", currentVersion: options.currentVersion };
    this.updater =
      options.packaged &&
      (options.platform === "win32" || options.platform === "linux")
        ? options.updater
        : undefined;
    this.fetcher = options.fetcher ?? fetch;
    this.onStatus = options.onStatus;
    if (this.updater) {
      this.updater.autoDownload = true;
      this.updater.autoInstallOnAppQuit = false;
      this.updater.allowPrerelease = false;
      this.listenForUpdaterEvents();
    }
  }

  get status(): UpdateStatus {
    return { ...this.value };
  }

  check(options: { silent?: boolean } = {}): Promise<UpdateStatus> {
    if (this.pendingCheck) return this.pendingCheck;
    this.silentCheck = options.silent === true;
    this.pendingCheck = this.checkRelease(this.silentCheck).finally(() => {
      this.pendingCheck = undefined;
      this.silentCheck = false;
    });
    return this.pendingCheck;
  }

  async install(): Promise<void> {
    if (!this.updater || this.value.state !== "downloaded")
      throw new Error("The update has not been downloaded");
    this.updater.quitAndInstall(false, true);
  }

  static readonly releasePage = releasePage;

  private async checkRelease(silent: boolean): Promise<UpdateStatus> {
    if (!silent)
      this.set({
        state: "checking",
        currentVersion: this.options.currentVersion,
      });
    try {
      const response = await this.fetcher(releaseUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 404) {
        return this.set({
          state: "no-release",
          currentVersion: this.options.currentVersion,
          checkedAt: new Date().toISOString(),
        });
      }
      if (!response.ok) throw new Error("Release check failed");
      const release = readRelease(await response.json());
      const latestVersion = release.tag_name.replace(/^v/, "");
      if (compareVersions(latestVersion, this.options.currentVersion) <= 0) {
        return this.set({
          state: "current",
          currentVersion: this.options.currentVersion,
          checkedAt: new Date().toISOString(),
        });
      }
      this.set({
        state: "available",
        currentVersion: this.options.currentVersion,
        availableVersion: latestVersion,
        releaseName: release.name || `Irwin ${latestVersion}`,
        releaseNotes: release.body || "",
        delivery: this.updater ? "automatic" : "manual",
        checkedAt: new Date().toISOString(),
      });
      if (this.updater) await this.updater.checkForUpdates();
      return this.status;
    } catch {
      if (silent) return this.status;
      return this.set({
        state: "error",
        currentVersion: this.options.currentVersion,
        checkedAt: new Date().toISOString(),
        message: errorMessage,
      });
    }
  }

  private listenForUpdaterEvents() {
    const updater = this.updater!;
    updater.on("checking-for-update", () => {
      if (this.silentCheck) return;
      this.set({
        ...this.value,
        state: "checking",
        currentVersion: this.options.currentVersion,
      });
    });
    updater.on(
      "update-available",
      (info: { version?: string; releaseNotes?: unknown }) =>
        this.set({
          ...this.value,
          state: "available",
          availableVersion: info.version ?? this.value.availableVersion,
          releaseNotes:
            typeof info.releaseNotes === "string"
              ? info.releaseNotes.slice(0, 12000)
              : this.value.releaseNotes,
          delivery: "automatic",
        }),
    );
    updater.on("update-not-available", () =>
      this.set({
        state: "current",
        currentVersion: this.options.currentVersion,
        checkedAt: new Date().toISOString(),
      }),
    );
    updater.on("download-progress", (progress: { percent?: number }) => {
      const percent = Number(progress?.percent);
      this.set({
        ...this.value,
        state: "downloading",
        progress: Number.isFinite(percent)
          ? Math.max(0, Math.min(100, Math.round(percent)))
          : 0,
      });
    });
    updater.on(
      "update-downloaded",
      (info: { version?: string; releaseNotes?: unknown }) =>
        this.set({
          ...this.value,
          state: "downloaded",
          availableVersion: info.version ?? this.value.availableVersion,
          releaseNotes:
            typeof info.releaseNotes === "string"
              ? info.releaseNotes.slice(0, 12000)
              : this.value.releaseNotes,
          delivery: "automatic",
          progress: 100,
        }),
    );
    updater.on("error", () => {
      if (this.silentCheck) return;
      this.set({
        state: "error",
        currentVersion: this.options.currentVersion,
        availableVersion: this.value.availableVersion,
        delivery: this.value.delivery,
        checkedAt: new Date().toISOString(),
        message:
          "The update could not be downloaded. You can get it from GitHub Releases.",
      });
    });
  }

  private set(value: UpdateStatus): UpdateStatus {
    this.value = value;
    this.onStatus(this.status);
    return this.status;
  }
}
